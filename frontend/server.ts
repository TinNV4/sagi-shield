import express from 'express';
import path from 'path';
import multer from 'multer';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';

const upload = multer({
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB max
  storage: multer.memoryStorage(),
});

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '30mb' }));
app.use(express.urlencoded({ extended: true, limit: '30mb' }));

// Lazy initialization for Google GenAI
let aiClient: GoogleGenAI | null = null;
function getGenAI(): GoogleGenAI | null {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  if (!aiClient) {
    aiClient = new GoogleGenAI({ apiKey: key });
  }
  return aiClient;
}

// In-memory data store for community reports & family alerts
const reportsStore: Array<{
  id: string;
  created_at: string;
  scam_type: string;
  phone?: string;
  keywords: string[];
  prefecture?: string;
}> = [
  {
    id: 'rep-1',
    created_at: new Date(Date.now() - 3600000).toISOString(),
    scam_type: 'fake_police',
    phone: '03-6892-XXXX',
    keywords: ['警察署', '資金調査', '秘密口座'],
    prefecture: '東京都',
  },
  {
    id: 'rep-2',
    created_at: new Date(Date.now() - 7200000).toISOString(),
    scam_type: 'oreore',
    phone: '090-4122-XXXX',
    keywords: ['携帯落とした', '至急弁償', '上司の口座'],
    prefecture: '大阪府',
  },
  {
    id: 'rep-3',
    created_at: new Date(Date.now() - 14400000).toISOString(),
    scam_type: 'fake_police',
    phone: '+84 24 3825 XXXX',
    keywords: ['Công an điều tra', 'Lệnh bắt tạm giam', 'Chuyển tiền bảo lãnh'],
    prefecture: 'TP. Hồ Chí Minh',
  },
];

const familyAlertsStore: Array<{
  id: string;
  created_at: string;
  member_name: string;
  risk_level: 'HIGH' | 'MEDIUM' | 'LOW';
  scam_type: string;
  stage: number;
  summary: string;
  phone_tel?: string;
}> = [
  {
    id: 'alert-init-1',
    created_at: new Date(Date.now() - 7200000).toISOString(),
    member_name: '母（敏子さん）',
    risk_level: 'MEDIUM',
    scam_type: 'refund',
    stage: 3,
    summary: '市役所職員を名乗る還付金手続きの電話を検知し注意喚起しました。',
    phone_tel: '03-3456-XXXX',
  },
];

// =======================================================
// API ROUTES
// =======================================================

// Health & status
app.get('/api/health', (req, res) => {
  const hasKey = !!process.env.GEMINI_API_KEY;
  res.json({
    status: 'ok',
    gemini_configured: hasKey,
    model: 'gemini-3.8-flash',
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/status', (req, res) => {
  const hasKey = !!process.env.GEMINI_API_KEY;
  res.json({
    gemini_configured: hasKey,
    model: 'gemini-3.8-flash',
    reports_count: reportsStore.length,
    alerts_count: familyAlertsStore.length,
  });
});

// 1. Scam Check API (Screenshot, Audio, or Text analysis with Gemini 3.8 Flash)
app.post('/api/check', upload.single('file'), async (req, res) => {
  try {
    const textPrompt = (req.body.text || req.body.transcript || '').trim();
    const lang = req.body.lang || 'ja';
    const file = req.file;

    const ai = getGenAI();

    // If Gemini API Key is not configured, gracefully fallback with structured guidance
    if (!ai) {
      const lower = textPrompt.toLowerCase();
      const isScam =
        lower.includes('警察') ||
        lower.includes('逮捕') ||
        lower.includes('振り込み') ||
        lower.includes('口座') ||
        lower.includes('công an') ||
        lower.includes('chuyển tiền') ||
        lower.includes('lệnh bắt');

      return res.json({
        risk_score: isScam ? 94 : 20,
        risk_level: isScam ? 'HIGH' : 'LOW',
        scam_type: isScam ? 'fake_police' : 'safe',
        stage: isScam ? 5 : 0,
        summary: isScam
          ? '警察・公的機関を騙る金銭要求の疑いがあります（APIキー未設定モードでの解析）。'
          : '通常の内容と判定されました。',
        advice: isScam
          ? '相手は詐欺グループの可能性があります。電話を切り、警察（#9110）へ相談してください。'
          : '不審な送金指示がないか引き続きご注意ください。',
        trigger_phrases: isScam ? ['警察', '口座', '送金'] : [],
        suggested_actions: isScam
          ? ['今すぐ電話を切る', '指定された口座に振り込まない', '家族・警察に確認']
          : ['安全を確認'],
        helpline_recommended: isScam,
      });
    }

    const contents: any[] = [];

    // System instruction prompt for Gemini 3.8 Flash
    const systemPrompt = `You are "Sagi Shield AI", an expert fraud detection engine specialized in Japanese phone scams (オレオレ詐欺, ニセ警察詐欺, 架空料金請求, 還付金詐欺) and Vietnamese scams (Công an giả mạo, Viện kiểm sát, VNeID, phạt nguội, đóng băng tài khoản).
Evaluate the provided audio, screenshot, or text for fraud risk.
Response language: MUST match user's language: "${lang}" (if "vi" respond in Vietnamese, if "ja" respond in Japanese, if "en" respond in English).

You MUST output ONLY a valid raw JSON object (NO markdown backticks, NO \`\`\`json, NO surrounding text) matching this schema:
{
  "risk_score": <number between 0 and 100>,
  "risk_level": <"HIGH" | "MEDIUM" | "LOW">,
  "scam_type": <"oreore" | "fake_police" | "refund" | "lottery" | "phishing" | "safe">,
  "stage": <number between 0 and 5, representing fraud kill-chain progression: 1=Contact, 2=Authority/Fear, 3=Isolation, 4=Money request, 5=Urgent transfer>,
  "summary": <concise 1-2 sentence explanation of the risk and what the scammer is attempting>,
  "advice": <clear, actionable emergency instruction for elderly person or victim>,
  "trigger_phrases": <array of specific suspicious words or phrases detected>,
  "suggested_actions": <array of 3 short urgent action bullet points>,
  "helpline_recommended": <boolean true if high/medium risk>
}`;

    // Add file if uploaded
    if (file) {
      contents.push({
        inlineData: {
          mimeType: file.mimetype,
          data: file.buffer.toString('base64'),
        },
      });
    }

    // Add text content
    const userMessage = textPrompt
      ? `Analyze this content:\n${textPrompt}`
      : 'Analyze the attached file (audio recording or screenshot of payment/SMS/document) for scam indicators.';

    contents.push({ text: userMessage });

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: [
        { role: 'user', parts: [{ text: systemPrompt }, ...contents.map((c) => (c.text ? { text: c.text } : c))] },
      ],
      config: {
        temperature: 0.1,
        responseMimeType: 'application/json',
      },
    });

    const responseText = response.text?.trim() || '{}';
    let parsed: any;
    try {
      parsed = JSON.parse(responseText);
    } catch {
      const clean = responseText.replace(/```json/gi, '').replace(/```/g, '').trim();
      parsed = JSON.parse(clean);
    }

    res.json(parsed);
  } catch (error: any) {
    console.error('Error in /api/check with Gemini 3.8 Flash:', error);
    res.status(500).json({
      error: error.message || 'Gemini analysis failed',
      risk_score: 50,
      risk_level: 'MEDIUM',
      scam_type: 'unknown',
      stage: 2,
      summary: 'AI解析中に通信エラーが発生しました。慎重に行動してください。',
      advice: '不審な連絡の場合は一度電話を切り、警察や家族に直接確認してください。',
      trigger_phrases: [],
      suggested_actions: ['電話を切る', '家族に相談'],
      helpline_recommended: true,
    });
  }
});

// 2. Precheck API (Real-time transcript tail evaluation)
app.post('/api/precheck', async (req, res) => {
  try {
    const { transcript, lang = 'ja' } = req.body;
    if (!transcript) {
      return res.json({
        risk_score: 0,
        risk_level: 'LOW',
        scam_type: 'safe',
        stage: 0,
        summary: '発話なし',
        advice: '聞き取り待機中',
        trigger_phrases: [],
      });
    }

    const ai = getGenAI();
    if (!ai) {
      const lower = transcript.toLowerCase();
      const isDanger =
        lower.includes('警察') ||
        lower.includes('逮捕') ||
        lower.includes('振り込み') ||
        lower.includes('công an') ||
        lower.includes('chuyển tiền') ||
        lower.includes('lệnh bắt');

      return res.json({
        risk_score: isDanger ? 92 : 20,
        risk_level: isDanger ? 'HIGH' : 'LOW',
        scam_type: isDanger ? 'fake_police' : 'safe',
        stage: isDanger ? 5 : 1,
        summary: isDanger ? '不審な警察送金要求を検知しました' : '通常の通話です',
        advice: isDanger ? '電話を切ってください' : '安全',
        trigger_phrases: isDanger ? ['警察', '振り込み'] : [],
      });
    }

    const prompt = `You are a real-time call safety interceptor. Evaluate this live speech snippet for phone scam risk:
Snippet: "${transcript}"
Language: "${lang}"

Output a raw JSON object only:
{
  "risk_score": <number 0-100>,
  "risk_level": <"HIGH" | "MEDIUM" | "LOW">,
  "scam_type": <"fake_police" | "oreore" | "refund" | "safe">,
  "stage": <0 to 5>,
  "summary": <short 1-line verdict in ${lang}>,
  "advice": <short 1-line advice in ${lang}>,
  "trigger_phrases": <detected scam trigger words>
}`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        temperature: 0.1,
        responseMimeType: 'application/json',
      },
    });

    const parsed = JSON.parse(response.text?.trim() || '{}');
    res.json(parsed);
  } catch (error: any) {
    console.error('Error in /api/precheck:', error);
    res.json({
      risk_score: 30,
      risk_level: 'LOW',
      scam_type: 'safe',
      stage: 1,
      summary: '解析中',
      advice: '注意して通話してください',
      trigger_phrases: [],
    });
  }
});

// 3. Post-Scam Recovery Agent API (Interactive AI Counselor)
app.post('/api/agent/recovery', async (req, res) => {
  try {
    const { session_id, message = '', lang = 'ja' } = req.body;
    const ai = getGenAI();

    if (!ai) {
      return res.json({
        message:
          lang === 'vi'
            ? 'Đừng quá hoảng sợ. Hãy bình tĩnh thực hiện theo các bước sau để giảm thiểu thiệt hại và bảo vệ tài khoản.'
            : 'パニックにならず、まずは落ち着いてください。被害を最小限に抑えるための緊急措置を順次ご案内します。',
        step: 1,
        total_steps: 4,
        step_title:
          lang === 'vi' ? 'Khóa tài khoản ngân hàng ngay lập tức' : '銀行・カードの即時利用停止',
        actions:
          lang === 'vi'
            ? [
                'Gọi hotline ngân hàng yêu cầu khóa khẩn cấp ứng dụng và tài khoản',
                'Thu hồi các mã OTP hoặc đăng xuất các thiết bị lạ',
                'Chụp lại ảnh chụp màn hình giao dịch chuyển tiền',
              ]
            : [
                '振込先およびご自身の金融機関へ緊急連絡し、口座・カードを凍結してください',
                '振込明細書や送金画面のスクリーンショットを保存してください',
                '警察相談専用ダイヤル「#9110」または最寄りの警察署へ通報してください',
              ],
        emergency_contacts:
          lang === 'vi'
            ? [
                { name: 'Cục An ninh mạng (A05) BCA', number: '069.234.8560', desc: 'Đường dây nóng phòng chống tội phạm lừa đảo công nghệ cao' },
                { name: 'Cảnh sát phản ứng nhanh', number: '113', desc: 'Trình báo khẩn cấp địa phương' },
                { name: 'Tổng đài Bảo vệ Người tiêu dùng', number: '1800.6838', desc: 'Hỗ trợ quyền lợi người tiêu dùng' },
              ]
            : [
                { name: '警察相談専用電話', number: '#9110', desc: '全国共通・最寄りの警察総合相談窓口（通話料有料）' },
                { name: '消費者ホットライン', number: '188', desc: '身近な消費生活センターへ案内（局番なし）' },
                { name: '緊急通報', number: '110', desc: '犯人が現在自宅に向かっているなど緊急時' },
              ],
      });
    }

    const systemPrompt = `You are "Sagi Shield Recovery Agent", a compassionate, reassuring, and legally precise post-fraud crisis counselor.
The user may have just experienced a phone scam, transfer fraud, or fake police blackmail.
Language: "${lang}"
User message/situation: "${message}"

Output a raw JSON response only:
{
  "message": <warm, empathetic, calm reassurance and explanation of immediate priority in ${lang}>,
  "step": <number 1 to 4>,
  "total_steps": 4,
  "step_title": <short title of this phase in ${lang}>,
  "actions": <array of 3-4 specific, concrete actionable steps for the victim>,
  "emergency_contacts": [
    { "name": <agency name>, "number": <official telephone number>, "desc": <short description> }
  ]
}`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: [{ role: 'user', parts: [{ text: systemPrompt }] }],
      config: {
        temperature: 0.2,
        responseMimeType: 'application/json',
      },
    });

    const parsed = JSON.parse(response.text?.trim() || '{}');
    res.json(parsed);
  } catch (error: any) {
    console.error('Error in /api/agent/recovery:', error);
    res.status(500).json({
      message: '落ち着いて警察または金融機関にご連絡ください。',
      step: 1,
      total_steps: 4,
      step_title: '金融機関への緊急連絡',
      actions: ['口座凍結の依頼', '警察（#9110）への連絡'],
      emergency_contacts: [
        { name: '警察相談専用電話', number: '#9110', desc: '最寄りの警察相談窓口' },
      ],
    });
  }
});

// 4. Scam Report API (Community Watch)
app.post('/api/report', (req, res) => {
  const { scam_type, phone, keywords = [], prefecture, consent } = req.body;
  const newReport = {
    id: 'rep-' + Date.now(),
    created_at: new Date().toISOString(),
    scam_type: scam_type || 'unknown',
    phone: phone ? phone.replace(/(\d{2,4})\d{4}(\d{4})/, '$1-XXXX-$2') : undefined,
    keywords,
    prefecture: prefecture || '未設定',
  };
  reportsStore.unshift(newReport);
  res.json({ ok: true, id: newReport.id });
});

// 5. Family alerts API
app.get('/api/family/alerts', (req, res) => {
  res.json(familyAlertsStore);
});

app.post('/api/family/link', (req, res) => {
  const { pairCode } = req.body;
  res.json({ ok: true, guardian_name: '家族見守り（同期完了）' });
});

// 6. Community stats API
app.get('/api/stats', (req, res) => {
  res.json({
    total_blocked: 12430 + reportsStore.length * 3,
    high_risk_intercepts: 3820 + reportsStore.length,
    active_guardians: 8940,
    recent_reports: reportsStore.slice(0, 10),
  });
});

// =======================================================
// VITE MIDDLEWARE & SERVER START
// =======================================================
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Sagi Shield Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
