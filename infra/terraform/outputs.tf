output "url" {
  description = "The one URL: PWA + API"
  value       = google_cloud_run_v2_service.api.uri
}

output "service_account" {
  value = google_service_account.api.email
}

output "bq_table" {
  value = "${var.project}.${google_bigquery_dataset.sagi.dataset_id}.${google_bigquery_table.events.table_id}"
}

output "pwa_build_env" {
  description = "Public values the PWA is built with (repository variables for deploy.yml)"
  value = {
    VITE_FIREBASE_API_KEY   = data.google_firebase_web_app_config.pwa.api_key
    VITE_FIREBASE_APP_ID    = google_firebase_web_app.pwa.app_id
    VITE_RECAPTCHA_SITE_KEY = google_recaptcha_enterprise_key.app_check.name
  }
}

output "pilot_url" {
  description = "The pilot service URL (empty unless pilot_enabled)"
  value       = var.pilot_enabled ? google_cloud_run_v2_service.pilot[0].uri : ""
}

output "verdict_tables" {
  description = "Per environment: the VERDICT_TABLE value once the first verdict record has landed (the sink creates run_googleapis_com_stdout lazily)"
  value       = { for k, o in local.observability : k => "${var.project}.${o.dataset}.run_googleapis_com_stdout" }
}
