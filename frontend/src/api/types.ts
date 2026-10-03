export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export type ScamType =
  | 'fake_police'
  | 'family_impersonation'
  | 'fake_billing'
  | 'refund'
  | 'investment'
  | 'safe'
  | 'unknown';

export type KillChainStage = 0 | 1 | 2 | 3 | 4 | 5;

export interface CheckResult {
  risk_score: number; // 0 - 100
  risk_level: RiskLevel;
  stage: KillChainStage;
  scam_type: ScamType;
  reasons: string[];
  advice: string;
  hotlines: string[];
  evidence_flags: string[];
  rule_hits: Record<string, string[]>;
  community_hits: number;
  trigger_phrases?: string[];
  summary?: string;
  suggested_actions?: string[];
  helpline_recommended?: boolean;
  // several screenshots: "combined" = read as one story, "separate" = each judged alone (the worst one leads)
  images_mode?: 'combined' | 'separate';
  images?: ImageVerdictItem[];
}

// Opt-in community report. `phone` is hashed by the server on arrival (only the HMAC is stored);
// `lang` picks the market for that hash.
export interface ReportPayload {
  scam_type: string;
  phone?: string;
  keywords: string[];
  prefecture?: string;
  consent: boolean;
  lang: string;
}

// Opt-in deep check: public reports about the domains / organisation of a check (Google Search grounding)
export interface DeepCheckPayload {
  lang: string;
  url?: string;
  text?: string;
  org?: string;
}

export interface DeepCheckResult {
  subjects: string[];
  found: boolean;
  summary: string;
  sources: {title: string; uri: string}[];
  queries: string[];
  evidence_flags: string[];
}

export interface ImageVerdictItem {
  index: number;
  doc_type: string;
  risk_level?: RiskLevel;
  risk_score?: number;
  scam_type?: ScamType;
  reasons?: string[];
}

export interface PrecheckPayload {
  reason_text?: string;
  transcript?: string;
  amount?: string;
  recipient_type?: 'person' | 'company' | 'government' | 'unknown';
  who_asked?: 'police' | 'government' | 'bank' | 'family' | 'broker' | 'company' | 'stranger' | 'nobody';
  lang: string;
}

export interface LiveWsClientTranscriptMessage {
  type: 'transcript';
  text: string;
  final: true;
}

export interface LiveWsClientResetMessage {
  type: 'reset';
}

export type LiveWsClientMessage = LiveWsClientTranscriptMessage | LiveWsClientResetMessage;

export interface LiveWsServerRiskMessage {
  risk_score: number;
  risk_level: RiskLevel;
  stage: KillChainStage;
  trigger_phrase: string;
  transcript_tail: string;
  advice: string;
  speak?: string;
  session_id: string;
}

export interface LiveWsServerResetMessage {
  event: 'session_reset';
}

export type LiveWsServerMessage = LiveWsServerRiskMessage | LiveWsServerResetMessage;

export interface RecoveryChecklistItem {
  step: string;
  done: boolean;
  tel?: string;
}

export interface RecoveryResponse {
  reply: string;
  checklist: RecoveryChecklistItem[];
  draft_statement?: string;
}

export interface FamilyAlertItem {
  id: string;
  created_at: string;
  member_name: string;
  risk_level: RiskLevel;
  scam_type: ScamType;
  stage: KillChainStage;
  summary: string;
  /** Demo (MockApi) only: the API never stores or returns the protected person's number. */
  phone_tel?: string;
}

export interface StatsResult {
  total_checks: number;
  high_risk: number;
  by_type: Record<string, number>;
  by_region: Record<string, number>;
  trend: { date: string; count: number }[];
  /** Reports written by tools/seed_dashboard.py for the demo; the dashboard labels them. */
  simulated_reports?: number;
}

export interface LiveSocketCallbacks {
  onRisk: (data: LiveWsServerRiskMessage) => void;
  onReset: () => void;
  onStatus: (status: 'connected' | 'reconnecting' | 'disconnected' | 'listening' | 'checking') => void;
  onTranscript?: (line: string) => void;
  onError?: (err: Error) => void;
}

export interface LiveSocketConnection {
  sendTranscript: (text: string) => void;
  sendReset: () => void;
  close: () => void;
}
