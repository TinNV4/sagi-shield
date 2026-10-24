variable "project" {
  description = "GCP project id"
  type        = string
}

variable "region" {
  description = "Cloud Run / Firestore / BigQuery region (Gemini itself is served from the global endpoint)"
  type        = string
  default     = "asia-northeast1"
}

variable "service" {
  description = "Cloud Run service name"
  type        = string
  default     = "sagi-shield-api"
}

variable "image" {
  description = "Container image built from backend/Dockerfile, e.g. asia-northeast1-docker.pkg.dev/<project>/cloud-run-source-deploy/sagi-shield-api:latest"
  type        = string
}

variable "min_instances" {
  description = "1 for a demo day (no cold start, the WebSocket stays warm), 0 otherwise (no idle cost)"
  type        = number
  default     = 0
}

variable "gemini_model" {
  description = "Text judge + recovery agent"
  type        = string
  default     = "gemini-3.5-flash-lite"
}

variable "gemini_vision_model" {
  description = "Screenshots / documents and the second opinion"
  type        = string
  default     = "gemini-3.8-flash"
}

variable "cors_origins" {
  description = "Comma-separated origins; * while the PWA is served by the API itself"
  type        = string
  default     = "*"
}

variable "stt_api_key_secret" {
  description = "Create the (empty) secret for the gemini-3.5-transcribe Developer API key and mount it; add the version by hand"
  type        = bool
  default     = false
}

variable "phish_reload_schedule" {
  description = "unix-cron, Asia/Tokyo: when the JPCERT/CC list is reloaded (it publishes the previous month early in the month)"
  type        = string
  default     = "0 6 15 * *"
}

variable "heartbeat_sweep_schedule" {
  description = "Cron (Asia/Tokyo) of the hourly offline sweep"
  type        = string
  default     = "0 * * * *"
}

variable "app_check_mode" {
  description = "off | monitor | enforce (backend/app/appcheck.py): start with monitor, enforce once real traffic shows ac=valid"
  type        = string
  default     = "off"
  validation {
    condition     = contains(["off", "monitor", "enforce"], var.app_check_mode)
    error_message = "app_check_mode must be off, monitor or enforce."
  }
}

variable "auth_mode" {
  description = "firebase | off (backend/app/auth.py): off skips sign-in checks and is refused with STORE=firestore, so keep firebase"
  type        = string
  default     = "firebase"
  validation {
    condition     = contains(["firebase", "off"], var.auth_mode)
    error_message = "auth_mode must be firebase or off."
  }
}

variable "legacy_family" {
  description = "1 = the shared-secret /family/* routes still work, 0 = they answer 410 (deleted for good on 2026-11-14)"
  type        = string
  default     = "1"
  validation {
    condition     = contains(["0", "1"], var.legacy_family)
    error_message = "legacy_family must be 0 or 1."
  }
}

variable "app_check_domains" {
  description = "Extra hosts for the reCAPTCHA key (a custom domain); every Cloud Run URL of the service is always included"
  type        = list(string)
  default     = []
}

variable "pilot_enabled" {
  description = "Create the second service sagi-shield-pilot (own Firestore database, no analytics), deployed from the pilot branch"
  type        = bool
  default     = false
}

variable "pilot_image" {
  description = "Image for the pilot service (deploy-pilot.yml pushes .../sagi/sagi-shield-pilot:<sha>)"
  type        = string
  default     = ""
}
