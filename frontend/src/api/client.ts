import {
  CheckResult,
  DeepCheckPayload,
  DeepCheckResult,
  FamilyAlertItem,
  LiveSocketCallbacks,
  LiveSocketConnection,
  LiveWsClientMessage,
  LiveWsServerMessage,
  PrecheckPayload,
  ReportPayload,
  RecoveryResponse,
  StatsResult,
} from './types';

export interface SagiApi {
  isMock: boolean;
  check(formData: FormData): Promise<CheckResult>;
  precheck(payload: PrecheckPayload): Promise<CheckResult>;
  deepcheck(payload: DeepCheckPayload): Promise<DeepCheckResult>;
  recovery(sessionId: string, message: string, lang: string): Promise<RecoveryResponse>;
  report(data: ReportPayload): Promise<{ok: boolean}>;
  createFamilyCode(): Promise<{pair_code: string; guardians: string[]}>;
  linkFamily(pairCode: string, fcmToken?: string): Promise<{ok: boolean; guardian_name: string}>;
  notifyFamily(result: CheckResult, lang: string): Promise<boolean>;
  getFamilyAlerts(): Promise<FamilyAlertItem[]>;
  getStats(): Promise<StatsResult>;
  connectLiveSocket(
    lang: string,
    mode: 'kiosk' | 'manual',
    callbacks: LiveSocketCallbacks
  ): LiveSocketConnection;
}

export const getReporterId = (): string => {
  try {
    let id = localStorage.getItem('sagi_reporter_id');
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem('sagi_reporter_id', id);
    }
    return id;
  } catch {
    return '';
  }
};

/** Pair code carried by a scanned QR link. It lives in the URL *fragment* (#pair=123456): fragments are never sent
 *  to a server, so the code stays out of access logs. Read once, then removed from the address bar. */
export const PAIR_FROM_LINK: string = (() => {
  try {
    const m = window.location.hash.match(/pair=(\d{6})/);
    if (m) window.history.replaceState(null, '', window.location.pathname);
    return m ? m[1] : '';
  } catch {
    return '';
  }
})();

// VITE_API_BASE: empty = MockApi (DEMO badge) · 'same-origin' = the API that serves this page (Cloud Run) · or a full URL
const RAW_API_BASE = (import.meta.env.VITE_API_BASE || '').trim();
export const API_BASE = (RAW_API_BASE === 'same-origin' ? window.location.origin : RAW_API_BASE).replace(/\/+$/, '');

// The backend has language packs for ja and vi only; an English UI still checks Japanese content.
const apiLang = (lang: string) => (lang === 'vi' ? 'vi' : 'ja');

// family_id is the shared secret of one family: an identifier, not personal data. It is the only
// thing this app persists besides UI preferences.
export function getFamilyId(): string | null {
  try {
    return localStorage.getItem('sagi_family_id');
  } catch {
    return null;
  }
}

function setFamilyId(id: string) {
  try {
    localStorage.setItem('sagi_family_id', id);
  } catch {}
}

// ==========================================
// ERRORS
// ==========================================

/** Why a request failed, in terms a screen can translate: the raw fetch error ("Failed to fetch") never reaches the user. */
export type ApiErrorKind = 'offline' | 'rate_limited' | 'unavailable' | 'failed';

export class ApiError extends Error {
  constructor(
    readonly kind: ApiErrorKind,
    /** A sentence written for the user by the server (429 / 503 carry one), if any. */
    readonly detail: string | null,
    readonly status: number
  ) {
    super(detail || `${kind} (${status || 'network'})`);
    this.name = 'ApiError';
  }
}

/** The i18n key for an error from this client; anything else is a generic failure. */
export const apiErrorKey = (err: unknown): string => {
  const kind: ApiErrorKind = err instanceof ApiError ? err.kind : 'failed';
  return `api.${kind}`;
};

/** The sentence to show: the server's own wording when it wrote one (429 / 503), otherwise the translated kind. */
export const describeApiError = (err: unknown, t: (key: string) => string): string =>
  err instanceof ApiError && err.detail ? err.detail : t(apiErrorKey(err));

/** True while the browser reports no network: the screens use it to say "offline" before the first click. */
export const isOffline = (): boolean => typeof navigator !== 'undefined' && navigator.onLine === false;

const kindOf = (status: number): ApiErrorKind =>
  status === 429 ? 'rate_limited' : status === 503 || status === 502 || status === 504 ? 'unavailable' : 'failed';

// ==========================================
// REAL API IMPLEMENTATION
// ==========================================
export class RealApi implements SagiApi {
  readonly isMock = false;
  private baseUrl: string;

  constructor(base: string) {
    this.baseUrl = base.replace(/\/+$/, '');
  }

  /** One fetch for every route: a dropped connection becomes ApiError('offline'), a non-2xx keeps the server's
   *  `detail` sentence when there is one. JSON bodies get their header; FormData sets its own boundary. */
  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, init);
    } catch {
      throw new ApiError('offline', null, 0);
    }
    if (!res.ok) {
      const detail = await res.json().then((b) => (typeof b?.detail === 'string' ? b.detail : null)).catch(() => null);
      throw new ApiError(kindOf(res.status), detail, res.status);
    }
    return res.json();
  }

  private postJson<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  }

  check(formData: FormData): Promise<CheckResult> {
    formData.set('lang', apiLang(String(formData.get('lang') || 'ja')));
    return this.request<CheckResult>('/check', {method: 'POST', body: formData});
  }

  precheck(payload: PrecheckPayload): Promise<CheckResult> {
    return this.postJson('/precheck', {...payload, lang: apiLang(payload.lang)});
  }

  deepcheck(payload: DeepCheckPayload): Promise<DeepCheckResult> {
    return this.postJson('/deepcheck', {...payload, lang: apiLang(payload.lang)});
  }

  recovery(sessionId: string, message: string, lang: string): Promise<RecoveryResponse> {
    return this.postJson('/agent/recovery', {
      session_id: sessionId,
      message,
      lang: apiLang(lang),
      ui_lang: lang,
      family_id: getFamilyId(),
    });
  }

  report(data: ReportPayload): Promise<{ok: boolean}> {
    // random per-install id: lets the server count distinct reporters without any account or address
    return this.postJson('/report', {...data, reporter_id: getReporterId()});
  }

  async createFamilyCode(): Promise<{pair_code: string; guardians: string[]}> {
    const data = await this.postJson<{pair_code: string; guardians: string[]; family_id: string}>('/family/code', {
      family_id: getFamilyId(),
    });
    setFamilyId(data.family_id);
    return data;
  }

  async notifyFamily(result: CheckResult, lang: string): Promise<boolean> {
    const family_id = getFamilyId();
    if (!family_id) return false;
    try {
      await this.postJson('/family/notify', {
        family_id,
        risk_level: result.risk_level,
        scam_type: result.scam_type,
        stage: result.stage,
        reasons: result.reasons.slice(0, 2),
        lang: apiLang(lang),
      });
      return true;
    } catch {
      return false;
    }
  }

  async linkFamily(pairCode: string, fcmToken?: string): Promise<{ok: boolean; guardian_name: string}> {
    const data = await this.postJson<{ok: boolean; guardian_name: string; family_id: string}>('/family/link', {
      pair_code: pairCode,
      fcm_token: fcmToken,
    });
    setFamilyId(data.family_id);
    return data;
  }

  getFamilyAlerts(): Promise<FamilyAlertItem[]> {
    const familyId = getFamilyId();
    if (!familyId) return Promise.resolve([]);
    return this.request<FamilyAlertItem[]>(`/family/alerts?family_id=${encodeURIComponent(familyId)}`);
  }

  getStats(): Promise<StatsResult> {
    return this.request<StatsResult>('/stats');
  }

  connectLiveSocket(
    lang: string,
    mode: 'kiosk' | 'manual',
    callbacks: LiveSocketCallbacks
  ): LiveSocketConnection {
    // Text-only WebSocket (PLAN 6.9). There is deliberately NO per-line HTTP fallback: the server
    // decides when a masked window may go to Gemini; while offline, lines are dropped, not queued.
    const wsUrl = `${this.baseUrl.replace(/^http/, 'ws')}/ws/live?lang=${apiLang(lang)}&mode=${mode}&input=text` +
      (getFamilyId() ? `&family_id=${encodeURIComponent(getFamilyId()!)}` : '');
    // Cross-call memory lives on this device: a flag + expiry, never any text. A set-up call ("my number changed")
    // asks for nothing; the money request comes a day later, and the server must know the first call happened.
    const PRECURSOR_KEY = 'sagi_precursor_until';
    const priorParam = () => {
      try {
        return Number(localStorage.getItem(PRECURSOR_KEY) || 0) > Date.now() ? '&prior=precursor' : '';
      } catch {
        return '';
      }
    };
    let ws: WebSocket | null = null;
    let isClosed = false;
    let reconnectDelay = 1000;
    let setThisCall = false; // did THIS call set the set-up flag? (only then may it clear it again)
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (isClosed) return;
      let gate = '';
      try {
        gate = localStorage.getItem('sagi_llm_gate') === 'rules' ? '&gate=rules' : ''; // Settings > strict privacy
      } catch {}
      ws = new WebSocket(wsUrl + priorParam() + gate);
      ws.onopen = () => {
        reconnectDelay = 1000;
        callbacks.onStatus('connected');
        callbacks.onStatus('listening');
      };
      ws.onmessage = (event) => {
        try {
          const data: LiveWsServerMessage = JSON.parse(event.data);
          if ('event' in data && data.event === 'session_reset') callbacks.onReset();
          else if ('risk_level' in data) {
            const setup = (data as {precursor?: boolean}).precursor;
            try {
              if (setup === true) {
                localStorage.setItem(PRECURSOR_KEY, String(Date.now() + 48 * 3600 * 1000));
                setThisCall = true;
              } else if (setup === false && setThisCall) {
                localStorage.removeItem(PRECURSOR_KEY); // the call turned into an alarm: it was the scam, not a set-up
                setThisCall = false;
              }
            } catch {}
            callbacks.onRisk(data);
          }
        } catch (e) {
          console.error('WS parse error:', e);
        }
      };
      ws.onclose = () => {
        if (isClosed) return;
        callbacks.onStatus('reconnecting');
        reconnectTimer = setTimeout(connect, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, 15000);
      };
    };
    callbacks.onStatus('reconnecting');
    connect();

    return {
      sendTranscript: (text: string) => {
        if (isClosed || !ws || ws.readyState !== WebSocket.OPEN) return;
        if (callbacks.onTranscript) callbacks.onTranscript(text);
        const msg: LiveWsClientMessage = {type: 'transcript', text, final: true};
        ws.send(JSON.stringify(msg));
      },
      sendReset: () => {
        if (isClosed) return;
        if (ws && ws.readyState === WebSocket.OPEN) {
          const msg: LiveWsClientMessage = {type: 'reset'};
          ws.send(JSON.stringify(msg));
        }
        callbacks.onReset();
      },
      close: () => {
        isClosed = true;
        if (reconnectTimer) clearTimeout(reconnectTimer);
        if (ws) ws.close();
        callbacks.onStatus('disconnected');
      },
    };
  }
}

// ==========================================
// MOCK API IMPLEMENTATION (WITH REALISTIC DELAY)
// ==========================================
class MockApi implements SagiApi {
  readonly isMock = true;

  private mockAlerts: FamilyAlertItem[] = [
    {
      id: 'alert-1',
      created_at: new Date(Date.now() - 1000 * 60 * 18).toISOString(),
      member_name: '母（敏子さん・東京世田谷）',
      risk_level: 'HIGH',
      scam_type: 'fake_police',
      stage: 5,
      summary: '警視庁を名乗る男から「口座差押え回避のため送金せよ」との通話を検知し、全画面遮断しました。',
      phone_tel: '090-1234-5678',
    },
    {
      id: 'alert-2',
      created_at: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString(),
      member_name: '父（健一さん・大阪豊中）',
      risk_level: 'MEDIUM',
      scam_type: 'refund',
      stage: 3,
      summary: '年金事務所を装う自動音声「還付金23,800円の受取期限です」を検知しました。',
      phone_tel: '080-9876-5432',
    },
  ];

  private recoveryStepCount = 0;

  async check(formData: FormData): Promise<CheckResult> {
    await new Promise((r) => setTimeout(r, 1200));

    const text = (formData.get('text') as string) || '';
    const phone = (formData.get('phone') as string) || '';
    const url = (formData.get('url') as string) || '';
    const lang = (formData.get('lang') as string) || 'ja';

    const lower = (text + ' ' + url).toLowerCase();

    // 1. Vietnamese fake police / VNeID link
    if (
      lower.includes('vneid') ||
      lower.includes('công an') ||
      lower.includes('lệnh bắt') ||
      lower.includes('bộ công an') ||
      lower.includes('dichvucong')
    ) {
      return {
        risk_score: 96,
        risk_level: 'HIGH',
        stage: 4,
        scam_type: 'fake_police',
        reasons: [
          lang === 'vi'
            ? 'Yêu cầu cài đặt ứng dụng VNeID từ liên kết bên ngoài hoặc giấy triệu tập công an qua mạng.'
            : 'ベトナム警察・公的機関を騙る偽アプリ/Webサイト誘導が検出されました。',
          lang === 'vi'
            ? 'Đe dọa khởi tố hình sự và phong tỏa tài sản nhằm ép chuyển tiền.'
            : '逮捕や口座差押えをちらつかせて送金を迫る典型手口です。',
        ],
        advice:
          lang === 'vi'
            ? 'Tuyệt đối không cài đặt ứng dụng APK và không chuyển tiền. Hãy liên hệ Công an địa phương.'
            : '絶対に指定URLを開かず、送金もしないでください。最寄りの警察へ通報してください。',
        hotlines: ['113', '069.234.8560'],
        evidence_flags: ['Giả mạo Bộ Công An', 'Đường link độc hại .online', 'Tống tiền khẩn cấp'],
        rule_hits: {
          'RULE-VN-POLICE': ['vneid', 'công an', 'lệnh bắt'],
          'RULE-MAL-URL': [url || 'vneid-gov.online'],
        },
        community_hits: 142,
      };
    }

    // 2. Japanese fake police
    if (
      text.includes('警視庁') ||
      text.includes('警察') ||
      text.includes('捜査二課') ||
      text.includes('逮捕状') ||
      text.includes('資金調査') ||
      text.includes('マネーロンダリング') ||
      phone.startsWith('+1') ||
      phone.startsWith('050')
    ) {
      return {
        risk_score: 94,
        risk_level: 'HIGH',
        stage: 5,
        scam_type: 'fake_police',
        reasons: [
          '警察や検察を名乗り「口座が犯罪に使われた」「資金調査のため送金」と指示する典型的な詐欺手口です。',
          '警察が電話やLINEで預金を別の口座に移すよう求めることは制度上絶対にありません。',
        ],
        advice: '直ちに電話を切り、警察相談専用電話「#9110」または最寄りの警察署へ通報してください。',
        hotlines: ['#9110', '110', '188'],
        evidence_flags: ['公的機関偽装', '国際電話/非通知着信', '秘密保持の強要'],
        rule_hits: {
          'RULE-JP-POLICE': ['警視庁', '捜査二課', '資金調査'],
        },
        community_hits: 289,
      };
    }

    // 3. Refund scam (還付金詐欺)
    if (
      text.includes('還付金') ||
      text.includes('年金事務所') ||
      text.includes('市役所') ||
      text.includes('ATM') ||
      text.includes('医療費')
    ) {
      return {
        risk_score: 88,
        risk_level: 'HIGH',
        stage: 4,
        scam_type: 'refund',
        reasons: [
          '「医療費や保険料の還付がある」と言ってATMへ誘導するのは、還付金詐欺の典型的な手口です。',
          'ATMの操作で金銭を受け取ることは絶対にできません（すべて振込送金させられます）。',
        ],
        advice: 'ATMには絶対に行かず、相手の指定した番号ではなく自治体公式サイトの代表電話へ確認してください。',
        hotlines: ['#9110', '188'],
        evidence_flags: ['ATM操作指示', '本日中期限の焦燥感'],
        rule_hits: {
          'RULE-REFUND': ['還付金', 'ATM', '年金事務所'],
        },
        community_hits: 174,
      };
    }

    // 4. Safe legitimate notification
    if (
      text.includes('残高') ||
      text.includes('定期便') ||
      text.includes('引き落とし完了') ||
      text.includes('学費') ||
      (text.includes('銀行') && !text.includes('送金') && !text.includes('暗証番号'))
    ) {
      return {
        risk_score: 12,
        risk_level: 'LOW',
        stage: 0,
        scam_type: 'safe',
        reasons: [
          '詐欺特有の脅迫文言や秘密保持、不審な外部口座への送金指示は検知されませんでした。',
        ],
        advice: '明確な危険は見当たりません。もし少しでも疑問がある場合は、通帳記載の正規窓口へお問い合わせください。',
        hotlines: ['#9110'],
        evidence_flags: ['公式送信用ドメイン', '脅迫語彙なし'],
        rule_hits: {},
        community_hits: 3,
      };
    }

    // Default medium suspicious
    return {
      risk_score: 52,
      risk_level: 'MEDIUM',
      stage: 2,
      scam_type: 'unknown',
      reasons: [
        '至急の対応を求める表現や、確認の取れていない連絡先が含まれています。',
        '安易にURLをクリックしたり、返信で個人情報を伝えないよう注意してください。',
      ],
      advice: 'ご自身で公式の問い合わせ窓口を検索して確認し、相手から指定された連絡先には応対しないでください。',
      hotlines: ['#9110', '188'],
      evidence_flags: ['未確認の送信元', '急迫性の誘導'],
      rule_hits: {'RULE-SUSP-URGENT': ['至急', '確認']},
      community_hits: 38,
    };
  }

  async deepcheck(payload: DeepCheckPayload): Promise<DeepCheckResult> {
    await new Promise((r) => setTimeout(r, 900));
    const subjects = [payload.url?.replace(/^https?:\/\/(www\.)?/, '').split('/')[0], payload.org].filter(Boolean) as string[];
    return {
      subjects,
      found: true,
      summary: 'Demo: public warnings mention this sender pattern. Finding nothing would not mean it is safe.',
      sources: [{title: 'National Police Agency (demo)', uri: 'https://www.npa.go.jp/'}],
      queries: subjects.map((s) => `${s} 詐欺`),
      evidence_flags: ['public_reports_found'],
    };
  }

  async precheck(payload: PrecheckPayload): Promise<CheckResult> {
    await new Promise((r) => setTimeout(r, 1100));

    const {who_asked, recipient_type, lang} = payload;
    const lower = (payload.reason_text || payload.transcript || '').toLowerCase();

    // High risk precheck scenarios:
    // a. "police told me to move savings to a safe account"
    // b. who_asked === "police"
    // c. recipient_type === "government" or "person" when who_asked is stranger/police
    if (
      who_asked === 'police' ||
      lower.includes('警察') ||
      lower.includes('口座を守る') ||
      lower.includes('資金調査') ||
      lower.includes('công an') ||
      lower.includes('xác minh') ||
      (who_asked === 'bank' && recipient_type === 'person')
    ) {
      return {
        risk_score: 98,
        risk_level: 'HIGH',
        stage: 5,
        scam_type: 'fake_police',
        reasons: [
          lang === 'vi'
            ? 'Công an hoặc cơ quan điều tra không bao giờ yêu cầu chuyển tiền vào tài khoản tạm giữ.'
            : '警察や検察が預金の安全確認のために指定口座へ送金させることは絶対にありません。',
          lang === 'vi'
            ? 'Tài khoản bạn sắp chuyển là tài khoản của tội phạm lừa đảo.'
            : '振り込み先の口座は犯罪グループが用意したマネーロンダリング用の使い捨て口座です。',
        ],
        advice:
          lang === 'vi'
            ? 'Đừng thực hiện giao dịch này. Hãy cúp máy và gọi 113 hoặc công an địa phương để xác minh.'
            : '振り込まないでください。窓口の行員に相談するか、110番に連絡してください。',
        hotlines: ['#9110', '110', '188'],
        evidence_flags: ['ニセ警察手口', '個人口座への公的名目送金', '心理的強制'],
        rule_hits: {
          'PRECHECK-CRITICAL': ['who_asked: police', 'reason: safe account'],
        },
        community_hits: 412,
      };
    }

    // Safe precheck scenario: "paying my nephew's tuition to the university"
    if (
      (lower.includes('学費') || lower.includes('tuition') || lower.includes('học phí')) &&
      (who_asked === 'family' || who_asked === 'nobody')
    ) {
      return {
        risk_score: 8,
        risk_level: 'LOW',
        stage: 0,
        scam_type: 'safe',
        reasons: [
          '学費や生活費の正規送金パターンに合致しています。',
          'ただし、家族を名乗る人物から急な口座変更依頼があった場合は必ず電話確認を行ってください。',
        ],
        advice: '明確な危険は見つかりません。必要に応じて、ご家族本人の既知の連絡先に電話で一声かけてから手続きしてください。',
        hotlines: ['#9110'],
        evidence_flags: ['通常教育費名目'],
        rule_hits: {},
        community_hits: 0,
      };
    }

    // Moderate/Cautious check
    return {
      risk_score: 64,
      risk_level: 'MEDIUM',
      stage: 3,
      scam_type: who_asked === 'family' ? 'family_impersonation' : 'unknown',
      reasons: [
        '「急ぎでお金が必要」と求められている場合、なりすまし詐欺の危険があります。',
        '振込先の名義が相手の告げた氏名と異なっていないか確認が必要です。',
      ],
      advice: '急かされても振り込まず、周囲の家族や銀行窓口に「この振込は大丈夫か」と声をかけてください。',
      hotlines: ['#9110', '188'],
      evidence_flags: ['急迫した金銭要求'],
      rule_hits: {'PRECHECK-MEDIUM': [who_asked || 'unknown']},
      community_hits: 85,
    };
  }

  async recovery(sessionId: string, message: string, lang: string): Promise<RecoveryResponse> {
    await new Promise((r) => setTimeout(r, 900));
    this.recoveryStepCount++;

    const isJa = lang === 'ja';
    const isVi = lang === 'vi';

    if (this.recoveryStepCount === 1) {
      return {
        reply: isJa
          ? '大丈夫です。今からできることを一緒に落ち着いて進めましょう。まずは一番被害を抑えられる「銀行口座の緊急凍結」から行います。何分前にお金を振り込みましたか？'
          : isVi
          ? 'Đừng quá hoảng loạn. Chúng tôi sẽ cùng bạn từng bước giảm thiểu thiệt hại. Bước tối quan trọng lúc này là liên hệ ngân hàng phong tỏa dòng tiền. Bạn đã chuyển tiền cách đây bao lâu?'
          : 'You are safe here. Let us walk through damage control steps together calmly. First and most critically: freezing the recipient bank account. How many minutes ago did you make the transfer?',
        checklist: [
          {
            step: isJa
              ? '送金した銀行の緊急窓口へ電話し、振込先口座の凍結・支払停止を要請する'
              : isVi
              ? 'Gọi hotline ngân hàng yêu cầu phong tỏa khẩn cấp tài khoản đích'
              : 'Call your bank fraud desk immediately to freeze destination account',
            done: false,
            tel: '0120-110-110',
          },
          {
            step: isJa
              ? '警察相談専用電話 #9110 または 110番 へ被害を届ける'
              : isVi
              ? 'Gọi cảnh sát 113 hoặc đến Công an phường gần nhất trình báo'
              : 'Report to Police Emergency (110 / #9110)',
            done: false,
            tel: '110',
          },
          {
            step: isJa
              ? '振込明細書、相手のLINE・SMSの会話履歴、通話履歴を保存（スクショ）する'
              : isVi
              ? 'Lưu lại toàn bộ ảnh chụp tin nhắn, số tài khoản nhận, lịch sử cuộc gọi'
              : 'Save transaction receipt, chat screenshots, and call records',
            done: false,
          },
          {
            step: isJa
              ? '信頼できるご家族に現状を正直に共有し、孤立を防ぐ'
              : isVi
              ? 'Báo ngay cho người thân trong gia đình để cùng hỗ trợ'
              : 'Notify a trusted family member for mutual support',
            done: false,
          },
        ],
      };
    }

    if (this.recoveryStepCount === 2) {
      return {
        reply: isJa
          ? 'ありがとうございます。相手の口座が凍結できれば、振り込め詐欺救済法により被害回復給付金としてお金が戻る可能性があります。次に、警察に説明するための「被害メモ」を自動作成しました。下のカードからコピーできます。'
          : isVi
          ? 'Cảm ơn thông tin của bạn. Khi tài khoản bị đóng băng kịp thời, cơ quan điều tra có cơ hội thu hồi dòng tiền. Chúng tôi đã lập sẵn Bản tường trình tóm tắt bên dưới để bạn đọc cho công an.'
          : 'Thank you. If frozen in time, legal restitution funds may recover your assets. We have prepared an official Statement Draft below for you to read directly to the police.',
        checklist: [
          {
            step: isJa ? '銀行へ連絡して口座停止手続き完了' : 'Liên hệ ngân hàng phong tỏa xong',
            done: true,
          },
          {
            step: isJa
              ? '警察相談専用電話 #9110 または 110番 へ被害届を出す'
              : 'Trình báo Công an',
            done: false,
            tel: '110',
          },
          {
            step: isJa ? '証拠（振込明細・画面スクショ）を保存' : 'Lưu lại hóa đơn và bằng chứng',
            done: false,
          },
          {
            step: isJa ? 'ご家族へ相談・共有する' : 'Thông báo cho người thân',
            done: false,
          },
        ],
        draft_statement: isJa
          ? '【警察・金融機関への申告用メモ】\n・発生日時：本日\n・手口：警察官を名乗る人物から「口座が犯罪に使われている」と脅迫された\n・振込理由：身の潔白の証明および資金調査のためと指示された\n・要求事項：犯罪利用預金口座等の凍結および振り込め詐欺被害回復給付金の申請'
          : isVi
          ? '【BẢN TƯỜNG TRÌNH KHẨN CẤP GỬI CÔNG AN & NGÂN HÀNG】\n- Thời gian: Hôm nay\n- Thủ đoạn: Đối tượng gọi điện tự xưng cán bộ cơ quan điều tra, đe dọa lệnh bắt\n- Lý do chuyển: Bị yêu cầu chuyển tiền vào tài khoản để phục vụ công tác thanh tra xác minh\n- Đề nghị: Phong tỏa khẩn cấp tài khoản thụ hưởng và hỗ trợ truy vết dòng tiền lừa đảo'
          : '【EMERGENCY STATEMENT FOR POLICE & BANK】\n- Incident Time: Today\n- Method: Caller impersonating law enforcement claimed my account was involved in crime\n- Reason: Directed to transfer funds to a safe verification account under duress\n- Requested Action: Urgent freeze of recipient account and registration for fraud restitution.',
      };
    }

    // Turn 3 onwards
    return {
      reply: isJa
        ? '証拠保全とお手続きは順調に進んでいます。相手から再度「なぜ通報した」等の電話があっても一切出ないでください。警察署で被害届が受理されると受理番号が発行されますので、それを銀行にも伝えてくださいね。'
        : isVi
        ? 'Bạn đang xử lý rất đúng hướng. Nếu đối tượng liên hệ lại, tuyệt đối không nghe máy. Khi Công an tiếp nhận hồ sơ sẽ cấp mã số tiếp nhận, hãy cung cấp mã này cho ngân hàng.'
        : 'You are handling this precisely right. If the scammer calls again, do not answer. Once the police issue a report number, relay it to your bank fraud officer.',
      checklist: [
        {step: isJa ? '銀行緊急連絡' : 'Liên hệ ngân hàng', done: true},
        {step: isJa ? '警察被害届' : 'Báo công an', done: true, tel: '110'},
        {step: isJa ? '証拠保存完了' : 'Lưu bằng chứng', done: true},
        {step: isJa ? '家族へ共有完了' : 'Báo người thân', done: true},
      ],
      draft_statement: isJa
        ? '【警察・金融機関への申告用メモ】\n・発生日時：本日\n・手口：警察官を名乗る人物から「口座が犯罪に使われている」と脅迫された\n・要求事項：犯罪利用預金口座等の凍結および振り込め詐欺被害回復給付金の申請'
        : undefined,
    };
  }

  async report(data: ReportPayload): Promise<{ok: boolean}> {
    await new Promise((r) => setTimeout(r, 600));
    return {ok: true};
  }

  async createFamilyCode(): Promise<{pair_code: string; guardians: string[]}> {
    return {pair_code: '782904', guardians: []};
  }

  async notifyFamily(): Promise<boolean> {
    return true;
  }

  async linkFamily(pairCode: string, fcmToken?: string): Promise<{ok: boolean; guardian_name: string}> {
    await new Promise((r) => setTimeout(r, 800));
    return {ok: true, guardian_name: '長男（太郎・神奈川）'};
  }

  async getFamilyAlerts(): Promise<FamilyAlertItem[]> {
    await new Promise((r) => setTimeout(r, 400));
    return [...this.mockAlerts];
  }

  addMockAlert(alert: FamilyAlertItem) {
    this.mockAlerts.unshift(alert);
  }

  async getStats(): Promise<StatsResult> {
    await new Promise((r) => setTimeout(r, 500));
    return {
      total_checks: 18450,
      high_risk: 3290,
      by_type: {
        fake_police: 1420,
        refund: 890,
        family_impersonation: 640,
        fake_billing: 210,
        investment: 130,
      },
      by_region: {
        '東京都 (Tokyo)': 842,
        '大阪府 (Osaka)': 512,
        '神奈川県 (Kanagawa)': 428,
        '愛知県 (Aichi)': 315,
        '福岡県 (Fukuoka)': 264,
        'Hà Nội': 380,
        'TP. Hồ Chí Minh': 445,
        'Đà Nẵng': 106,
      },
      trend: [
        {date: '09/07', count: 180},
        {date: '09/08', count: 210},
        {date: '09/09', count: 195},
        {date: '09/10', count: 240},
        {date: '09/11', count: 220},
        {date: '09/12', count: 275},
        {date: '09/13', count: 260},
        {date: '09/14', count: 290},
        {date: '09/15', count: 310},
        {date: '09/16', count: 325},
        {date: '09/17', count: 300},
        {date: '09/18', count: 340},
        {date: '09/19', count: 365},
        {date: '09/20', count: 390},
      ],
      simulated_reports: 3290, // everything in MockApi is made up
    };
  }

  connectLiveSocket(
    lang: string,
    mode: 'kiosk' | 'manual',
    callbacks: LiveSocketCallbacks
  ): LiveSocketConnection {
    let timerId: any = null;
    let resetTimerId: any = null;
    let isClosed = false;
    let step = 0;

    callbacks.onStatus('connected');
    setTimeout(() => {
      if (!isClosed) callbacks.onStatus('listening');
    }, 400);

    const simulationScriptJa = [
      {
        delay: 3000,
        stage: 1 as const,
        score: 28,
        level: 'LOW' as const,
        trigger: '警視庁捜査二課',
        text: 'もしもし、警視庁捜査二課の警察官ですが、ご本人様で間違いないでしょうか。',
        advice: '警察官を名乗る人物から着信しています。落ち着いて所属と氏名を確認してください。',
      },
      {
        delay: 7000,
        stage: 2 as const,
        score: 55,
        level: 'MEDIUM' as const,
        trigger: '資金洗浄・逮捕状',
        text: 'あなた名義の口座がマネーロンダリング事件の主犯格に使われています。このままだと逮捕状が執行されます。',
        advice: '逮捕をちらつかせて不安を煽る手口です。警察が電話で逮捕の予告をすることはありません。',
      },
      {
        delay: 12000,
        stage: 3 as const,
        score: 72,
        level: 'MEDIUM' as const,
        trigger: '守秘義務・他言無用',
        text: '捜査の秘密保持義務がありますので、ご家族や銀行の職員にも絶対に話してはいけません。',
        advice: '周囲に相談させないようにする手口です。電話を切って、家族に相談してください。',
      },
      {
        delay: 16000,
        stage: 4 as const,
        score: 86,
        level: 'HIGH' as const,
        trigger: 'LINE・偽警察手帳',
        text: '私の警察手帳をお見せしますので、LINEで友だち追加してビデオ通話をつないでください。',
        advice: 'LINEなどへ誘導し、偽の警察手帳を見せる手口です。友だち追加はしないでください。',
        speak: '警察がLINEで連絡することはありません。電話を今すぐ切ってください。',
      },
      {
        delay: 20000,
        stage: 5 as const,
        score: 96,
        level: 'HIGH' as const,
        trigger: '安全口座・資金移動',
        text: 'あなたの潔白を証明するため、すべての預金を一時的に安全調査用口座へ振り込んでください。',
        advice: '金銭の要求がありました。詐欺の可能性が高いです。電話を切って、#9110 に相談してください。',
        speak: 'この通話は詐欺の可能性があります。電話を切ってください。',
      },
    ];

    const simulationScriptVi = [
      {
        delay: 3000,
        stage: 1 as const,
        score: 30,
        level: 'LOW' as const,
        trigger: 'Bộ Công An / Cục Cảnh sát',
        text: 'Chào anh/chị, tôi là cán bộ điều tra thuộc Cơ quan Cảnh sát Điều tra Bộ Công An.',
        advice: 'Người lạ tự xưng công an. Hãy ghi nhớ công an không làm việc qua điện thoại.',
      },
      {
        delay: 7000,
        stage: 2 as const,
        score: 58,
        level: 'MEDIUM' as const,
        trigger: 'Lệnh bắt giam / Rửa tiền',
        text: 'Tài khoản của anh/chị đang liên quan đường dây rửa tiền xuyên quốc gia, viện kiểm sát đã ký lệnh bắt tạm giam.',
        advice: 'Chiêu trò đe dọa án phạt để nạn nhân hoảng sợ. Tuyệt đối không làm theo.',
      },
      {
        delay: 12000,
        stage: 3 as const,
        score: 74,
        level: 'MEDIUM' as const,
        trigger: 'Bí mật án / Không được báo người thân',
        text: 'Đây là vụ án cấp quốc gia, tuyệt đối không được tiết lộ cho gia đình hay ngân hàng biết.',
        advice: 'Đây là thủ đoạn bắt giữ bí mật để bạn không hỏi ý kiến con cháu. Hãy cúp máy và gọi cho người thân.',
      },
      {
        delay: 16000,
        stage: 4 as const,
        score: 88,
        level: 'HIGH' as const,
        trigger: 'Kết bạn Zalo / Tải app định danh giả',
        text: 'Anh/chị kết bạn Zalo ngay để nhận lệnh bắt và cài đặt phần mềm bảo mật VNeID theo link tôi gửi.',
        advice: 'Đừng kết bạn Zalo hay cài phần mềm theo đường link người gọi gửi.',
        speak: 'Công an không gửi lệnh bắt qua Zalo. Hãy cúp máy.',
      },
      {
        delay: 20000,
        stage: 5 as const,
        score: 98,
        level: 'HIGH' as const,
        trigger: 'Chuyển tiền vào tài khoản an toàn',
        text: 'Để chứng minh trong sạch, hãy chuyển toàn bộ số dư vào tài khoản thanh tra của cơ quan điều tra.',
        advice: 'Nhiều khả năng là lừa đảo. Cơ quan nhà nước không yêu cầu chuyển tiền vào "tài khoản thanh tra". Hãy cúp máy và gọi 113.',
        speak: 'Cuộc gọi này có dấu hiệu lừa đảo. Hãy cúp máy ngay.',
      },
    ];

    const script = lang === 'vi' ? simulationScriptVi : simulationScriptJa;

    // Start automated timeline to simulate live call analysis rising over 20s
    const runNextStep = () => {
      if (isClosed || step >= script.length) return;
      const current = script[step];
      const prevDelay = step === 0 ? 0 : script[step - 1].delay;
      const waitTime = current.delay - prevDelay;

      timerId = setTimeout(() => {
        if (isClosed) return;
        callbacks.onStatus('checking');

        if (callbacks.onTranscript) {
          callbacks.onTranscript(current.text);
        }

        callbacks.onRisk({
          risk_score: current.score,
          risk_level: current.level,
          stage: current.stage,
          trigger_phrase: current.trigger,
          transcript_tail: current.text,
          advice: current.advice,
          speak: current.speak,
          session_id: 'mock-session-123',
        });

        setTimeout(() => {
          if (!isClosed) callbacks.onStatus('listening');
        }, 500);

        step++;
        runNextStep();
      }, waitTime);
    };

    runNextStep();

    return {
      sendTranscript: (text: string) => {
        if (isClosed) return;
        callbacks.onStatus('checking');
        if (callbacks.onTranscript) callbacks.onTranscript(text);

        setTimeout(() => {
          if (isClosed) return;
          const lower = text.toLowerCase();
          const isDanger =
            lower.includes('警察') ||
            lower.includes('逮捕') ||
            lower.includes('振り込み') ||
            lower.includes('công an') ||
            lower.includes('chuyển tiền') ||
            lower.includes('lệnh bắt');

          callbacks.onRisk({
            risk_score: isDanger ? 92 : 35,
            risk_level: isDanger ? 'HIGH' : 'LOW',
            stage: isDanger ? 5 : 1,
            trigger_phrase: isDanger ? text.slice(0, 20) : '通常会話',
            transcript_tail: text,
            advice: isDanger
              ? '不審な送金指示が検知されました。電話を切ってください。'
              : '安全基準値内です。',
            speak: isDanger ? 'この通話は詐欺の可能性があります。電話を切ってください。' : undefined,
            session_id: 'mock-session-user',
          });
          callbacks.onStatus('listening');
        }, 600);
      },
      sendReset: () => {
        if (isClosed) return;
        if (timerId) clearTimeout(timerId);

        // Prompt requirement: "simulates live risk rising over 20 s, then a session_reset event 10 s after the user taps 'I am safe now'."
        resetTimerId = setTimeout(() => {
          if (!isClosed) {
            callbacks.onReset();
          }
        }, 10000);
      },
      close: () => {
        isClosed = true;
        if (timerId) clearTimeout(timerId);
        if (resetTimerId) clearTimeout(resetTimerId);
        callbacks.onStatus('disconnected');
      },
    };
  }
}

// API Instances
export const realApiInstance = new RealApi(API_BASE);
export const mockApiInstance = new MockApi();

// Mock when no backend is configured, or when the demo helper forces it.
export function isMockModeActive(): boolean {
  if (!API_BASE) return true;
  try {
    return localStorage.getItem('sagi_use_mock') === 'true';
  } catch {
    return false;
  }
}

export function setMockMode(enabled: boolean) {
  try {
    localStorage.setItem('sagi_use_mock', String(enabled));
  } catch {}
  window.dispatchEvent(new CustomEvent('sagi-api-mode-changed', {detail: enabled}));
}

export function getActiveApi(): SagiApi {
  return isMockModeActive() ? mockApiInstance : realApiInstance;
}

// Delegating proxy active instance
export const api: SagiApi = {
  get isMock() {
    return getActiveApi().isMock;
  },
  check(formData: FormData) {
    return getActiveApi().check(formData);
  },
  precheck(payload: PrecheckPayload) {
    return getActiveApi().precheck(payload);
  },
  deepcheck(payload: DeepCheckPayload) {
    return getActiveApi().deepcheck(payload);
  },
  recovery(sessionId: string, message: string, lang: string) {
    return getActiveApi().recovery(sessionId, message, lang);
  },
  report(data: any) {
    return getActiveApi().report(data);
  },
  createFamilyCode() {
    return getActiveApi().createFamilyCode();
  },
  linkFamily(pairCode: string, fcmToken?: string) {
    return getActiveApi().linkFamily(pairCode, fcmToken);
  },
  notifyFamily(result: CheckResult, lang: string) {
    return getActiveApi().notifyFamily(result, lang);
  },
  getFamilyAlerts() {
    return getActiveApi().getFamilyAlerts();
  },
  getStats() {
    return getActiveApi().getStats();
  },
  connectLiveSocket(lang: string, mode: 'kiosk' | 'manual', callbacks: LiveSocketCallbacks) {
    return getActiveApi().connectLiveSocket(lang, mode, callbacks);
  },
};
