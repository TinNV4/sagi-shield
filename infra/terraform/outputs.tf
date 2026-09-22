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
