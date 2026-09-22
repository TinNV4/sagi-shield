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
    "roles/aiplatform.user",     # Gemini on Agent Platform
    "roles/datastore.user",      # Firestore
    "roles/speech.client",       # Chirp 3 fallback transcription
    "roles/bigquery.dataEditor", # anonymous verdict rows
    "roles/logging.logWriter",   # verdict log lines
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
