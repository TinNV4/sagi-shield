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
  phone_tel?: string;
}

export interface StatsResult {
  total_checks: number;
  high_risk: number;
  by_type: Record<string, number>;
  by_region: Record<string, number>;
  trend: { date: string; count: number }[];
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
