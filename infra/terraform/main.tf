# Sagi Shield on Google Cloud, as code. Mirrors infra/setup.ps1 + infra/deploy.sh (which remain the quick path).
#
#   cd infra/terraform
#   terraform init
#   terraform apply -var project=<id> -var image=asia-northeast1-docker.pkg.dev/<id>/cloud-run-source-deploy/sagi-shield-api:latest
#
# The container image is built outside Terraform (Cloud Build from backend/Dockerfile: `gcloud builds submit` or
# infra/deploy.sh); Terraform owns everything around it: APIs, runtime identity, Firestore + TTL, the HMAC secret,
# BigQuery, and the Cloud Run service. State stays local by default (a demo project); add a GCS backend for a team.

terraform {
  required_version = ">= 1.5"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 6.0"
    }
    google-beta = { # only for the Firebase project and the web app config (not in the GA provider)
      source  = "hashicorp/google-beta"
      version = ">= 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = ">= 3.5"
    }
  }
}

provider "google" {
  project = var.project
  region  = var.region
}

provider "google-beta" {
  project = var.project
  region  = var.region
}

# ---------------------------------------------------------------- APIs
resource "google_project_service" "apis" {
  for_each = toset([
    "run.googleapis.com",
    "aiplatform.googleapis.com",
    "firestore.googleapis.com",
    "webrisk.googleapis.com",
    "secretmanager.googleapis.com",
    "cloudbuild.googleapis.com",
    "artifactregistry.googleapis.com",
    "speech.googleapis.com",
    "bigquery.googleapis.com",
    "logging.googleapis.com",
    "cloudscheduler.googleapis.com",
    "firebase.googleapis.com",
    "firebaseappcheck.googleapis.com",
    "recaptchaenterprise.googleapis.com",
    "fcm.googleapis.com",
    "monitoring.googleapis.com",
  ])
  service            = each.value
  disable_on_destroy = false
}

# ---------------------------------------------------------------- runtime identity (least privilege)
resource "google_service_account" "api" {
  account_id   = "sagi-api"
  display_name = "Sagi Shield API"
  depends_on   = [google_project_service.apis]
}

resource "google_project_iam_member" "api_roles" {
  for_each = toset([
    "roles/aiplatform.user",                # Gemini on Agent Platform
    "roles/datastore.user",                 # Firestore
    "roles/speech.client",                  # Chirp 3 fallback transcription
    "roles/bigquery.dataEditor",            # anonymous verdict rows
    "roles/logging.logWriter",              # verdict log lines
    "roles/firebaseappcheck.tokenVerifier", # consume limited-use App Check tokens on /report
    "roles/firebasecloudmessaging.admin",   # guardian push (FCM HTTP v1, app/notifier.py)
  ])
  project = var.project
  role    = each.value
  member  = "serviceAccount:${google_service_account.api.email}"
}

# ---------------------------------------------------------------- Firestore: lookups while the user waits
resource "google_firestore_database" "db" {
  name        = "(default)"
  location_id = var.region
  type        = "FIRESTORE_NATIVE"
  depends_on  = [google_project_service.apis]
}

# recovery chats are deleted for real: TTL on expires_at
resource "google_firestore_field" "recovery_ttl" {
  database   = google_firestore_database.db.name
  collection = "recovery_sessions"
  field      = "expires_at"
  ttl_config {}
}

# ---------------------------------------------------------------- HMAC key for phone-number hashes (never printed)
resource "random_id" "hash_key" {
  byte_length = 32
}

resource "google_secret_manager_secret" "hash_key" {
  secret_id = "sagi-hash-key"
  replication {
    auto {}
  }
  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "hash_key" {
  secret      = google_secret_manager_secret.hash_key.id
  secret_data = random_id.hash_key.hex
}

resource "google_secret_manager_secret_iam_member" "hash_key_reader" {
  secret_id = google_secret_manager_secret.hash_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api.email}"
}

# Optional: API key for gemini-3.5-transcribe (Developer API only). Created empty here; add the version by hand:
#   echo -n "<key>" | gcloud secrets versions add sagi-stt-api-key --data-file=-
resource "google_secret_manager_secret" "stt_key" {
  count     = var.stt_api_key_secret ? 1 : 0
  secret_id = "sagi-stt-api-key"
  replication {
    auto {}
  }
  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_iam_member" "stt_key_reader" {
  count     = var.stt_api_key_secret ? 1 : 0
  secret_id = google_secret_manager_secret.stt_key[0].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api.email}"
}

# ---------------------------------------------------------------- BigQuery: anonymous verdict events for the scam map
resource "google_bigquery_dataset" "sagi" {
  dataset_id  = "sagi"
  location    = var.region
  description = "Sagi Shield anonymous verdict events (no text, numbers or ids)"
  depends_on  = [google_project_service.apis]
}

resource "google_bigquery_table" "events" {
  dataset_id          = google_bigquery_dataset.sagi.dataset_id
  table_id            = "events"
  deletion_protection = false
  time_partitioning {
    type          = "DAY"
    field         = "ts"
    expiration_ms = 34560000000 # 400 days
  }
  schema = jsonencode([
    { name = "ts", type = "TIMESTAMP", mode = "REQUIRED" },
    { name = "kind", type = "STRING" },
    { name = "lang", type = "STRING" },
    { name = "source", type = "STRING" },
    { name = "risk_level", type = "STRING" },
    { name = "risk_score", type = "INTEGER" },
    { name = "scam_type", type = "STRING" },
    { name = "stage", type = "INTEGER" },
    { name = "prefecture", type = "STRING" },
    { name = "llm_used", type = "BOOLEAN" },
    { name = "latency_ms", type = "INTEGER" },
    { name = "feedback_correct", type = "BOOLEAN" },
  ])
}

# ---------------------------------------------------------------- Cloud Run: API + built PWA, one service, one URL
resource "google_cloud_run_v2_service" "api" {
  name     = var.service
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    service_account  = google_service_account.api.email
    timeout          = "3600s" # WebSocket /ws/live stays open for a whole call
    session_affinity = true    # LiveTracker state lives in the instance that holds the socket
    scaling {
      min_instance_count = var.min_instances # 1 on demo day, 0 otherwise
      max_instance_count = 3
    }
    max_instance_request_concurrency = 40
    containers {
      image = var.image
      resources {
        limits = { cpu = "1", memory = "1Gi" }
      }
      dynamic "env" {
        for_each = {
          GOOGLE_GENAI_USE_ENTERPRISE = "true"
          GOOGLE_CLOUD_PROJECT        = var.project
          GOOGLE_CLOUD_LOCATION       = "global"
          GEMINI_MODEL                = var.gemini_model
          GEMINI_VISION_MODEL         = var.gemini_vision_model
          STORE                       = "firestore"
          USE_WEBRISK                 = "1"
          USE_LLM                     = "1"
          CORS_ORIGINS                = var.cors_origins
          BQ_TABLE                    = "${var.project}.${google_bigquery_dataset.sagi.dataset_id}.${google_bigquery_table.events.table_id}"
          APPCHECK                    = var.app_check_mode
          AUTH                        = var.auth_mode
          LEGACY_FAMILY               = var.legacy_family
        }
        content {
          name  = env.key
          value = env.value
        }
      }
      env {
        name = "HASH_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.hash_key.secret_id
            version = "latest"
          }
        }
      }
      dynamic "env" {
        for_each = var.stt_api_key_secret ? [1] : []
        content {
          name = "STT_API_KEY"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.stt_key[0].secret_id
              version = "latest"
            }
          }
        }
      }
    }
  }

  depends_on = [
    google_project_iam_member.api_roles,
    google_secret_manager_secret_iam_member.hash_key_reader,
    google_secret_manager_secret_version.hash_key,
  ]
}

# the PWA and the API are public; per-client rate limiting is in app/guard.py
resource "google_cloud_run_v2_service_iam_member" "public" {
  name     = google_cloud_run_v2_service.api.name
  location = google_cloud_run_v2_service.api.location
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ---------------------------------------------------------------- monthly reload of the JPCERT/CC phishing URL list
# Same image as the API, another entry point (backend/app/phish_list.py); idempotent, so a re-run costs reads only.
resource "google_cloud_run_v2_job" "phish_loader" {
  name                = "sagi-phish-loader"
  location            = var.region
  deletion_protection = false

  template {
    task_count = 1
    template {
      service_account = google_service_account.api.email
      max_retries     = 1
      timeout         = "900s"
      containers {
        image   = var.image
        command = ["python"]
        args    = ["-m", "app.phish_list", "--months", "2"]
        resources {
          limits = { cpu = "1", memory = "512Mi" }
        }
        env {
          name  = "STORE"
          value = "firestore"
        }
        env {
          name  = "GOOGLE_CLOUD_PROJECT"
          value = var.project
        }
        env { # app/storage.py refuses STORE=firestore without it (phishing keys themselves are plain sha256)
          name = "HASH_KEY"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.hash_key.secret_id
              version = "latest"
            }
          }
        }
      }
    }
  }

  depends_on = [google_project_iam_member.api_roles, google_secret_manager_secret_iam_member.hash_key_reader]
}

# the scheduler's identity can start this one job and nothing else
resource "google_service_account" "scheduler" {
  account_id   = "sagi-scheduler"
  display_name = "Sagi Shield scheduler"
  depends_on   = [google_project_service.apis]
}

resource "google_cloud_run_v2_job_iam_member" "scheduler_invoker" {
  name     = google_cloud_run_v2_job.phish_loader.name
  location = google_cloud_run_v2_job.phish_loader.location
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.scheduler.email}"
}

resource "google_cloud_scheduler_job" "phish_loader" {
  name        = "sagi-phish-loader"
  region      = var.region
  description = "Monthly reload of the JPCERT/CC phishing URL list"
  schedule    = var.phish_reload_schedule
  time_zone   = "Asia/Tokyo"

  http_target {
    http_method = "POST"
    uri         = "https://run.googleapis.com/v2/projects/${var.project}/locations/${var.region}/jobs/${google_cloud_run_v2_job.phish_loader.name}:run"
    oauth_token {
      service_account_email = google_service_account.scheduler.email
    }
  }

  depends_on = [google_cloud_run_v2_job_iam_member.scheduler_invoker]
}

# ---------------------------------------------------------------- hourly sweep for silent Live Guard devices
# Mirrors infra/setup_heartbeat_job.ps1. A job reads one Firestore database, so production and the pilot each get one;
# the pilot's keeps the script's name (deploy-pilot.yml moves it to each new image). The production job waits behind
# heartbeat_sweep_prod_enabled: main's image has no app.heartbeat_sweep until the pilot branch is merged.

resource "google_cloud_run_v2_job" "heartbeat_sweep_prod" {
  count               = var.heartbeat_sweep_prod_enabled ? 1 : 0
  name                = "sagi-heartbeat-sweep-prod"
  location            = var.region
  deletion_protection = false

  template {
    task_count = 1
    template {
      service_account = google_service_account.api.email
      max_retries     = 1
      timeout         = "300s"
      containers {
        image   = var.image
        command = ["python"]
        args    = ["-m", "app.heartbeat_sweep"]
        resources {
          limits = { cpu = "1", memory = "512Mi" }
        }
        env {
          name  = "STORE"
          value = "firestore"
        }
        env {
          name  = "GOOGLE_CLOUD_PROJECT"
          value = var.project
        }
        env {
          name  = "FIRESTORE_DB"
          value = "(default)"
        }
        env {
          name = "HASH_KEY"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.hash_key.secret_id
              version = "latest"
            }
          }
        }
      }
    }
  }

  depends_on = [google_project_service.apis, google_project_iam_member.api_roles, google_secret_manager_secret_iam_member.hash_key_reader]
}

resource "google_cloud_run_v2_job_iam_member" "heartbeat_sweep_prod_invoker" {
  count    = var.heartbeat_sweep_prod_enabled ? 1 : 0
  name     = google_cloud_run_v2_job.heartbeat_sweep_prod[0].name
  location = google_cloud_run_v2_job.heartbeat_sweep_prod[0].location
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.scheduler.email}"
}

resource "google_cloud_scheduler_job" "heartbeat_sweep_prod" {
  count       = var.heartbeat_sweep_prod_enabled ? 1 : 0
  name        = "sagi-heartbeat-sweep-prod"
  region      = var.region
  description = "Hourly check for Live Guard devices that stopped sending heartbeats"
  schedule    = var.heartbeat_sweep_schedule
  time_zone   = "Asia/Tokyo"

  http_target {
    http_method = "POST"
    uri         = "https://run.googleapis.com/v2/projects/${var.project}/locations/${var.region}/jobs/${google_cloud_run_v2_job.heartbeat_sweep_prod[0].name}:run"
    oauth_token {
      service_account_email = google_service_account.scheduler.email
    }
  }

  depends_on = [google_cloud_run_v2_job_iam_member.heartbeat_sweep_prod_invoker]
}

resource "google_cloud_run_v2_job" "heartbeat_sweep_pilot" {
  count               = var.pilot_enabled ? 1 : 0
  name                = "sagi-heartbeat-sweep"
  location            = var.region
  deletion_protection = false

  template {
    task_count = 1
    template {
      service_account = google_service_account.api.email
      max_retries     = 1
      timeout         = "300s"
      containers {
        image   = var.pilot_image != "" ? var.pilot_image : var.image
        command = ["python"]
        args    = ["-m", "app.heartbeat_sweep"]
        resources {
          limits = { cpu = "1", memory = "512Mi" }
        }
        env {
          name  = "STORE"
          value = "firestore"
        }
        env {
          name  = "GOOGLE_CLOUD_PROJECT"
          value = var.project
        }
        env {
          name  = "FIRESTORE_DB"
          value = google_firestore_database.pilot[0].name
        }
        env {
          name = "HASH_KEY"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.hash_key.secret_id
              version = "latest"
            }
          }
        }
      }
    }
  }

  depends_on = [google_project_service.apis, google_project_iam_member.api_roles, google_secret_manager_secret_iam_member.hash_key_reader]
}

resource "google_cloud_run_v2_job_iam_member" "heartbeat_sweep_pilot_invoker" {
  count    = var.pilot_enabled ? 1 : 0
  name     = google_cloud_run_v2_job.heartbeat_sweep_pilot[0].name
  location = google_cloud_run_v2_job.heartbeat_sweep_pilot[0].location
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.scheduler.email}"
}

resource "google_cloud_scheduler_job" "heartbeat_sweep_pilot" {
  count       = var.pilot_enabled ? 1 : 0
  name        = "sagi-heartbeat-sweep"
  region      = var.region
  description = "Hourly check for Live Guard devices that stopped sending heartbeats"
  schedule    = var.heartbeat_sweep_schedule
  time_zone   = "Asia/Tokyo"

  http_target {
    http_method = "POST"
    uri         = "https://run.googleapis.com/v2/projects/${var.project}/locations/${var.region}/jobs/${google_cloud_run_v2_job.heartbeat_sweep_pilot[0].name}:run"
    oauth_token {
      service_account_email = google_service_account.scheduler.email
    }
  }

  depends_on = [google_cloud_run_v2_job_iam_member.heartbeat_sweep_pilot_invoker]
}

# ---------------------------------------------------------------- Firebase App Check (reCAPTCHA Enterprise)
# Mirrors infra/setup_appcheck.ps1. The PWA is built with the web app's config and the site key (outputs below);
# the API verifies tokens according to var.app_check_mode (backend/app/appcheck.py).
resource "google_firebase_project" "default" {
  provider   = google-beta
  project    = var.project
  depends_on = [google_project_service.apis]
}

resource "google_firebase_web_app" "pwa" {
  provider        = google-beta
  project         = var.project
  display_name    = "Sagi Shield PWA"
  deletion_policy = "DELETE"
  depends_on      = [google_firebase_project.default]
}

data "google_firebase_web_app_config" "pwa" {
  provider   = google-beta
  web_app_id = google_firebase_web_app.pwa.app_id
}

# score-based (App Check refuses checkbox keys); never localhost on a production key
resource "google_recaptcha_enterprise_key" "app_check" {
  display_name = "sagi-shield-appcheck"
  web_settings {
    integration_type = "SCORE"
    allowed_domains  = concat([for u in google_cloud_run_v2_service.api.urls : trimprefix(u, "https://")], var.app_check_domains)
  }
  depends_on = [google_project_service.apis]
}

resource "google_firebase_app_check_recaptcha_enterprise_config" "pwa" {
  app_id    = google_firebase_web_app.pwa.app_id
  site_key  = google_recaptcha_enterprise_key.app_check.name
  token_ttl = "14400s" # 4 h: the SDK refreshes at half the TTL, one reCAPTCHA assessment each
}

# ---------------------------------------------------------------- pilot environment (docs/ROADMAP.md, phase 0)
# A second service for the family pilot, deployed from the pilot branch by .github/workflows/deploy-pilot.yml while the
# judged service above stays frozen. Same runtime account, secrets and models; its own Firestore database, so pilot
# reports, stats and households never reach the judged service; no analytics stream; PILOT badge in the PWA.
resource "google_firestore_database" "pilot" {
  count       = var.pilot_enabled ? 1 : 0
  name        = "pilot"
  location_id = var.region
  type        = "FIRESTORE_NATIVE"
  depends_on  = [google_project_service.apis]
}

resource "google_firestore_field" "pilot_recovery_ttl" {
  count      = var.pilot_enabled ? 1 : 0
  database   = google_firestore_database.pilot[0].name
  collection = "recovery_sessions"
  field      = "expires_at"
  ttl_config {}
}

resource "google_cloud_run_v2_service" "pilot" {
  count    = var.pilot_enabled ? 1 : 0
  name     = "sagi-shield-pilot"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    service_account  = google_service_account.api.email
    timeout          = "3600s"
    session_affinity = true
    scaling {
      min_instance_count = 0
      max_instance_count = 3
    }
    max_instance_request_concurrency = 40
    containers {
      image = var.pilot_image != "" ? var.pilot_image : var.image
      resources {
        limits = { cpu = "1", memory = "1Gi" }
      }
      dynamic "env" {
        for_each = {
          GOOGLE_GENAI_USE_ENTERPRISE = "true"
          GOOGLE_CLOUD_PROJECT        = var.project
          GOOGLE_CLOUD_LOCATION       = "global"
          GEMINI_MODEL                = var.gemini_model
          GEMINI_VISION_MODEL         = var.gemini_vision_model
          STORE                       = "firestore"
          FIRESTORE_DB                = google_firestore_database.pilot[0].name
          USE_WEBRISK                 = "1"
          USE_LLM                     = "1"
          CORS_ORIGINS                = var.cors_origins
          APPCHECK                    = var.app_check_mode
          AUTH                        = var.auth_mode
          LEGACY_FAMILY               = var.legacy_family
        }
        content {
          name  = env.key
          value = env.value
        }
      }
      env {
        name = "HASH_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.hash_key.secret_id
            version = "latest"
          }
        }
      }
      dynamic "env" {
        for_each = var.stt_api_key_secret ? [1] : []
        content {
          name = "STT_API_KEY"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.stt_key[0].secret_id
              version = "latest"
            }
          }
        }
      }
    }
  }

  depends_on = [
    google_project_iam_member.api_roles,
    google_secret_manager_secret_iam_member.hash_key_reader,
    google_secret_manager_secret_version.hash_key,
  ]
}

resource "google_cloud_run_v2_service_iam_member" "pilot_public" {
  count    = var.pilot_enabled ? 1 : 0
  name     = google_cloud_run_v2_service.pilot[0].name
  location = google_cloud_run_v2_service.pilot[0].location
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ---------------------------------------------------------------- observability (verdict log sink, uptime check, alert)
# Each environment that is switched on gets: a BigQuery dataset fed by a Cloud Logging sink (only the structured
# verdict records of app/verdict_log.py, day-partitioned), an uptime check on /health and an alert policy that mails
# var.alert_email when the check fails from 2 or more regions for 5 minutes. Pilot: pilot_enabled. Production:
# observability_prod_enabled (kept off until after the judging freeze).
locals {
  observability = merge(
    var.pilot_enabled ? {
      pilot = {
        service = "sagi-shield-pilot"
        dataset = "sagi_pilot"
        host    = replace(google_cloud_run_v2_service.pilot[0].uri, "https://", "")
      }
    } : {},
    var.observability_prod_enabled ? {
      prod = {
        service = var.service
        dataset = "sagi_verdicts"
        host    = replace(google_cloud_run_v2_service.api.uri, "https://", "")
      }
    } : {},
  )
}

resource "google_bigquery_dataset" "verdicts" {
  for_each    = local.observability
  dataset_id  = each.value.dataset
  location    = var.region
  description = "Structured verdict log of ${each.value.service} (rule hits, judge reasons, latency; no text, numbers or ids)"
  depends_on  = [google_project_service.apis]
}

resource "google_logging_project_sink" "verdicts" {
  for_each               = local.observability
  name                   = "sagi-verdicts-${each.value.service}"
  destination            = "bigquery.googleapis.com/projects/${var.project}/datasets/${google_bigquery_dataset.verdicts[each.key].dataset_id}"
  filter                 = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${each.value.service}\" AND jsonPayload.kind:*"
  unique_writer_identity = true

  bigquery_options {
    use_partitioned_tables = true
  }
}

resource "google_bigquery_dataset_iam_member" "verdict_sink_writer" {
  for_each   = local.observability
  dataset_id = google_bigquery_dataset.verdicts[each.key].dataset_id
  role       = "roles/bigquery.dataEditor"
  member     = google_logging_project_sink.verdicts[each.key].writer_identity
}

resource "google_monitoring_notification_channel" "alert_email" {
  for_each     = var.alert_email != "" ? local.observability : {}
  display_name = "${each.value.service} alerts"
  type         = "email"
  labels       = { email_address = var.alert_email }
  depends_on   = [google_project_service.apis]
}

resource "google_monitoring_uptime_check_config" "health" {
  for_each     = local.observability
  display_name = "${each.value.service} health"
  period       = "300s"
  timeout      = "10s"

  http_check {
    path           = "/health"
    port           = 443
    use_ssl        = true
    validate_ssl   = true
    request_method = "GET"
  }

  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = var.project
      host       = each.value.host
    }
  }

  depends_on = [google_project_service.apis]
}

resource "google_monitoring_alert_policy" "down" {
  for_each     = local.observability
  display_name = "${each.value.service} down"
  combiner     = "OR"

  conditions {
    display_name = "/health fails from 2 or more regions"
    condition_threshold {
      filter          = "metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND metric.labels.check_id=\"${google_monitoring_uptime_check_config.health[each.key].uptime_check_id}\" AND resource.type=\"uptime_url\""
      comparison      = "COMPARISON_GT"
      threshold_value = 1
      duration        = "300s"

      aggregations {
        alignment_period     = "1200s"
        per_series_aligner   = "ALIGN_NEXT_OLDER"
        cross_series_reducer = "REDUCE_COUNT_FALSE"
        group_by_fields      = ["resource.label.*"]
      }

      trigger {
        count = 1
      }
    }
  }

  notification_channels = var.alert_email != "" ? [google_monitoring_notification_channel.alert_email[each.key].id] : []
  depends_on            = [google_project_service.apis]
}
