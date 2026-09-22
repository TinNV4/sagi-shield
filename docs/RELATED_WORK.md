# Related work — phone-scam detection (prior art check)

Researched 2026-09-22 against primary sources (press releases, product/support pages, government pages, arXiv). Items I could only confirm through secondary reporting are marked **unverified**. This file exists so the pitch, README and demo video do not claim more novelty than the record supports.

## 1. The Macnica / Elith announcement (2026-09-15)

Source: https://www.macnica.co.jp/public-relations/news/2026/150434/ (also carried by AI Watch https://ai.watch.impress.co.jp/docs/news/2141010.html and ITmedia https://kn.itmedia.co.jp/kn/article/2609/21/2000001609/).

- **Title:** 「マクニカとElith、国内初となるEdge AIでの特殊詐欺電話を検知するPoCを実施」. The "国内初" (first in Japan) claim is footnoted as Macnica/Elith's own research — it is a self-declared first, scoped to *edge AI on a home-network device*.
- **Partners:** Macnica (distributor) + Elith, Inc. (AI safety/security company) using a **Broadcom NPU-equipped PON MAC SoC evaluation board** (the chip family used in fibre home gateways). No carrier, police, prefecture or bank is named.
- **What the PoC does:** call audio arriving through a **USB speakerphone or similar** is analysed **in real time on the device** (「クラウドではなく固定電話の接続先であるホームゲートウェイ等の端末側でEdge AIによる推論処理を行う」); it flags scam signs from 「会話内容や文脈」 (conversation content and context). The release does not say whether speech is transcribed first, what kind of model it is, who trained it, or the latency.
- **Evaluation:** publicly available voice data; scenarios = オレオレ詐欺, 公的機関を装う詐欺, call-centre fraud, plus normal-conversation scenarios; **"90% 以上の判定精度"** in the PoC environment. Dataset names, sample counts, precision/recall split are not disclosed. ITmedia adds the caveat that real-world performance may vary with call quality and content.
- **Privacy design:** processing completes inside the device (「端末内でAI処理を完結」), positioned as reducing leakage risk.
- **Timeline:** PoC only. Next: expand scenarios, improve the model, and verify with **通信事業者・機器メーカー** in real environments. No launch date.
- **Policy context cited:** NPA 2025 figures (27,832 cases, ¥142.31B) and a **July 2026 MIC (総務省) request** to carriers to strengthen anti-fraud measures, explicitly promoting AI-based detection/warning services. This means every JP carrier is now expected to ship something in this space.

## 2. Comparison table

| Name | Org | Year | Detects | Method | Where processed | Languages | Status | Source |
|---|---|---|---|---|---|---|---|---|
| Edge AI 特殊詐欺検知 PoC | Macnica + Elith (Broadcom NPU) | 2026-09 | scam intent in live call audio | undisclosed AI model, "content and context" | on home gateway / edge device | ja | PoC, >90% acc. on public data | macnica.co.jp/…/150434 |
| Pixel **Scam Detection** (calls) | Google | 2025-03 (US) → JP 2026-03 | scam conversation patterns during a call | Gemini Nano (Pixel 9+), on-device ML on older Pixels | on device; no audio/transcript stored or sent | en + ja (JP listed as supported country) | shipping; opt-in; beep every few minutes | support.google.com/phoneapp/answer/15654065 |
| Pixel Scam Detection (messages / notifications) | Google | 2025 → 9 more countries incl. JP 2026-09 | scam text in chat-app notifications | Gemini on-device model | on device | en, ar, fr, de, pt, es, ja | shipping, on by default | blog.google (Sept 2026 Pixel Drop) — **language list unverified against a Google page** |
| Galaxy S26 Scam Detection | Samsung + Google | 2026-02 | same as Pixel calls | Gemini Nano | on device | en, US only | shipping | blog.google/security/… (2026-02-25) |
| 生成AI 詐欺電話判定 | NTT Docomo | 2026-01 (internal trial) | scam in **recorded** calls | generative AI + RAG over a scam-case DB, 3-level risk | not stated (app shows results; DB lookup implies cloud) | ja | targeting FY2026 launch; "正解率95%以上" | nikkan.co.jp/articles/view/00770254 (newspaper, **no Docomo release found**) |
| あんしんセキュリティ 詐欺対策プラス | NTT Docomo (Tobila DB, F-Secure AI) | 2026-05-27 | nuisance numbers; scam text in screenshots; deepfake images | number DB; AI text classification (9 scam types) | cloud (implied) | ja | shipping, ¥999/mo | docomo.ne.jp/info/news_release/2026/05/25_00.html |
| 特殊詐欺対策サービス | NTT West / East | earlier (page undated) | suspicious content in recorded landline calls | records call, uploads to NTT cloud, "AI analyses content", notifies relatives | **NTT cloud** | ja | shipping, ¥440–1,650/mo + install | ntt-west.co.jp/info/support/special-fraud-support_service.html |
| 迷惑電話対策サービス | KDDI | 2025-08 | known scam numbers | number DB (~30k, daily) on auひかり home gateway; manual 1442 registration on mobile | gateway / network | n/a | shipping, 6 months free | newsroom.kddi.com/news/detail/kddi_nr-614_3948.html |
| Kagawa Police + SoftBank + BBSS agreement | SoftBank group | 2026-05-26 | scam in text **and call audio** | generative AI on call audio, in-call warning | not stated | ja | in development, service targeted autumn 2026 | softbank.jp/sbnews/entry/20260603_01 |
| 振り込め詐欺誘引通話検出 | Nagoya Univ + Fujitsu + JST | 2012-03 / trial 2012-08 | "過信状態" (over-trust) via pitch/volume + keyword spotting | signal processing + word spotting | device attached to home phone | ja | research; >90% over-trust detection on police recordings; 100+ households in Okayama | pr.fujitsu.com/jp/news/2012/03/19.html, jst.go.jp/pr/announce/20120319 |
| 詐欺対策 by NTTタウンページ | Tobila Systems + NTT Townpage | 2026-03-05 | known scam numbers, caller ID | police + Tobila number DBs | cloud lookup | n/a | shipping, free, 警察庁推奨 | tobila.com/news/release/p2791/ |
| Whoscall | Gogolook | 2025–26 (JP relaunch) | numbers, SMS, URLs, screenshots | DB + community reports + Gemini-based checks | cloud | ja and others | shipping; live caller ID "plus" in early access | k-tai.watch.impress.co.jp/docs/news/2053759.html (secondary) |
| Digi Police | 警視庁 | int'l block 2025-12 | international-number calls | number-origin block, alerts | device | ja | shipping | keishicho.metro.tokyo.lg.jp/…/digipolice.html |
| 防犯電話機 (Sharp, Panasonic) | Sharp / Panasonic | ongoing | deterrence: pre-ring warning, "this call is recorded", auto recording, callback warning | fixed messages, no content AI | device | ja | shipping | jp.sharp/phone/sagitaisaku/functions/, panasonic.jp/fax/contents/meiwaku.html |
| nTrust | Vietnam National Cybersecurity Association (with Bộ Công an data) | 2024-07-30 | scam numbers, accounts, URLs, QR, malware apps | 1M+ record DB, on-device number check | on device (numbers), cloud DB | vi | shipping, free | bocongan.gov.vn/…/ntrust-…-t40454 |
| Voice Brandname (định danh cuộc gọi) | Bộ TT&TT / Cục Viễn thông + carriers | 2023-10 → | impersonation of agencies by showing verified caller name | network caller-ID labelling | carrier network | vi | shipping (732 agency numbers) | xaydungchinhsach.chinhphu.vn/…-119231027091451317.htm |
| "It Warned Me Just at the Right Moment" | HK PolyU et al. | 2025-02 | scam intent from live transcripts, turn by turn | LLM (GPT-4o, GLM4, Doubao, ERNIE) | cloud LLM | zh | paper; recall 0.98–1.00, precision 0.70–0.77 on synthetic | arxiv.org/abs/2502.03964 |
| MASK | same group | 2025-10 | privacy-preserving sanitisation before LLM detection | keyword → neural masking | before cloud LLM | zh (assumed, **unverified**) | paper | arxiv.org/abs/2510.18493 |
| TeleAntiFraud-28k | Ma, Wang et al. | 2025-03 | telecom fraud from audio+text | SFT model on 28,511 pairs | — | zh (**unverified** from abstract) | dataset + model | arxiv.org/abs/2503.24115 |

## 3. Details per entry

### Google Pixel Scam Detection (the main competitor)
- Support page (https://support.google.com/phoneapp/answer/15654065): "powered by Gemini Nano on-device" on Pixel 9+, Google's on-device ML on older Pixels; "Data processing for Scam Detection is all done on-device. No conversation audio or transcription is stored on the device, sent to Google servers or anywhere else"; **off by default, opt-in**; "audible beep at the start of the call and every few minutes after"; does not run on saved contacts; "Not all scam calls can be detected. Scam Detection is not 100% accurate". Countries: US (Pixel 6+), and Pixel 9+ in Australia, Canada, France, Germany, India, Ireland, Italy, **Japan**, Mexico, Singapore, Spain, UK.
- Japan launch: March 2026 Pixel Drop, Google Japan blog (https://blog.google/intl/ja-jp/products/devices-services/march-2026-pixel-drop/): 「詐欺電話に特有の会話パターンをリアルタイムで認識し、不審な兆候がある場合に警告を表示」. Japanese-language coverage of calls is therefore live since 2026-03 (ITmedia 2026-03-04 confirms, https://www.itmedia.co.jp/mobile/articles/2603/04/news133.html).
- Messages: September 2026 Pixel Drop (https://blog.google/products-and-platforms/devices/pixel/september-2026-pixel-drop/) adds Gboard inline warnings (US) and notification scam detection in more regions; press coverage lists Japan + Japanese among the additions (**unverified on a Google page**).
- Android security post 2026-02-25 (https://blog.google/security/staying-one-step-ahead-strengthening-androids-lead-in-scam-protection/): call detection also on Galaxy S26 (US), message detection in 20+ countries, "work with our partners to bring these … to even more users". No published precision/recall.
- **Vietnam is not in any list.** Vietnamese is not a supported language for calls or messages as of 2026-09.
- Limits relevant to us: requires a Pixel 9+ / Galaxy S26, runs only on the phone taking the call (no landline, no second-device / kiosk mode), no family alert, no recovery flow, no shareable reports; scores are not exposed.

### Apple iOS 26 Call Screening
- Answers unknown callers, asks name/reason, live-transcribes the reply for the user to decide; does **not** evaluate scam content (secondary sources: https://blog.hiya.com/what-you-need-to-know-about-apples-ios-26-call-screening). No Apple statement of scam analysis found — treat as screening, not detection.

### NTT Docomo
- Generative-AI scam-call judgement (Nikkan Kogyo 2026-01-07, https://www.nikkan.co.jp/articles/view/00770254; Newswitch https://newswitch.jp/p/48020): records the call, RAG over a victim-case DB, high/medium/low risk, push + voice warning, shows scam type and reasoning; "正解率95%以上"; in-house trial, aiming at FY2026 commercial launch inside あんしんセキュリティ. Real-time vs post-call and the model vendor are not stated. **No Docomo press release found — newspaper only.**
- Shipping today (2026-05-27 release, https://www.docomo.ne.jp/info/news_release/2026/05/25_00.html): number blocking (Tobila DB), AI check of pasted/screenshot text for 9 scam types (F-Secure), deepfake image check. No live-call analysis.

### NTT West / East 特殊詐欺対策サービス
- https://www.ntt-west.co.jp/info/support/special-fraud-support_service.html: a box at the customer's home records the landline call, sends it to NTT's cloud where "AI が内容を分析", and warns registered relatives by phone/mail. Closest functional match to Live Guard + family alert, but **audio leaves the home**, and it is landline-hardware-bound with an install fee.

### KDDI
- 2025-08-01 release (https://newsroom.kddi.com/news/detail/kddi_nr-614_3948.html): number-DB blocking; on auひかり it runs on the home gateway against ~30k numbers, "約98%" of nuisance calls blocked (2024). Also invested in Resemble AI for deepfake detection (https://www.kddi.com/open-innovation-program/news/2025/1209/). No content analysis product found.

### SoftBank / BBSS / Kagawa Police
- https://www.softbank.jp/sbnews/entry/20260603_01: agreement signed 2026-05-26; BBSS is building generative-AI analysis of 「テキストだけではなく、通話音声」 with an in-call danger alert, targeted for **autumn 2026**. Processing location and model not stated. This is the closest carrier plan to our Live Guard; watch for its launch during the contest window.

### Fujitsu + Nagoya University (2012)
- https://pr.fujitsu.com/jp/news/2012/03/19.html and https://www.jst.go.jp/pr/announce/20120319/index.html: detects the victim's 「過信状態」 from pitch/volume plus word spotting (借金, 補償…); >90% on real recordings supplied by the Police University; 2012-08 field trial in 100+ Okayama households with Okayama police and Chugoku Bank (https://info.archives.global.fujitsu/jp/news/2012/08/3.html). Establishes that *device-side, keyword + acoustic* detection with family notification is 14 years old.

### Tobila / Whoscall / Digi Police / 防犯電話機
- All number-database or deterrence products. Tobila's app is 警察庁推奨 (https://tobila.com/news/release/p2791/); Digi Police blocks international numbers because "約8割" of scam calls use them (https://www.keishicho.metro.tokyo.lg.jp/kurashi/tokushu/furikome/digipolice.html); Sharp phones were designed with 警視庁 and 大阪府警 input (https://jp.sharp/phone/sagitaisaku/functions/); Panasonic plays "this call is recorded" before ringing and auto-records (https://panasonic.jp/fax/contents/meiwaku.html). Whoscall Japan uses Gemini for text/URL/image checks and community data (secondary: https://k-tai.watch.impress.co.jp/docs/news/2053759.html). None analyses live conversation content.

### Vietnam
- nTrust (https://bocongan.gov.vn/bai-viet/hiep-hoi-an-ninh-mang-quoc-gia-chinh-thuc-ra-mat-phan-mem-phong-chong-lua-dao-ntrust-d2-t40454): free app from the National Cybersecurity Association, DB (1M+ records) from Bộ Công an, Bộ TT&TT, State Bank; checks numbers, accounts, links, QR, apps; number checks on device; community reporting. **No call-content analysis.**
- Voice Brandname (https://xaydungchinhsach.chinhphu.vn/tu-ngay-27-10-bo-tttt-va-cac-nha-mang-su-dung-ten-dinh-danh-de-chong-cuoc-goi-mao-danh-119231027091451317.htm): carriers show verified agency names on calls; 732 agency numbers registered (secondary: https://lsvn.vn/732-so-dien-thoai-di-dong-cua-cac-co-quan-nha-nuoc-da-duoc-dinh-danh-a149748.html).
- Bộ KH&CN 2025-11 coverage (https://mst.gov.vn/doanh-nghiep-viet-ung-dung-ai-phat-hien-som-cac-dau-hieu-lua-dao-tan-cong-197251121172659434.htm): VNPT IT and Huawei apply AI to eKYC, login anomalies and deepfakes — not calls.
- I found **no Vietnamese product or pilot that analyses call transcripts with an LLM**; Google's feature does not cover Vietnamese. This gap is real but should be stated as "we found none", not "none exists".

### Academic
- arXiv 2502.03964 (https://arxiv.org/abs/2502.03964, HTML https://arxiv.org/html/2502.03964): LLM judges a Chinese conversation turn by turn with prior context; on real transcripts recall 0.98–1.00 / precision 0.96–1.00, on synthetic data precision falls to 0.70–0.77 because partial context causes false positives; no user study; notes users' fear of monitoring. Our co-occurrence rules + LLM fusion is a response to exactly this precision problem, and our PLAN already lists it as a reference.
- arXiv 2510.18493 MASK (https://arxiv.org/abs/2510.18493): modular sanitisation of transcripts before a cloud LLM (keyword masking for high-privacy users up to neural approaches). Same idea as our masking of numbers before the LLM, generalised.
- arXiv 2503.24115 TeleAntiFraud-28k (https://arxiv.org/abs/2503.24115): 28,511 audio–text pairs, privacy-preserved ASR + TTS regeneration + LLM augmentation + adversarial multi-agent synthesis; tasks: scenario classification, fraud detection, fraud type. Confirms that synthetic-transcript generation is the accepted way to build such datasets (our `gen_dataset.py` does the same, in ja/vi).
- Others seen but not read in full: ScamAgent (arXiv 2508.06457, LLM agents simulating scam calls) and adversarial scam detection (arXiv 2412.00621).

## 4. Implications for Sagi Shield

**What is genuinely differentiating (safe to say):**
1. **Second-device, browser-only Live Guard for landlines and speakerphones, with no audio upload.** Pixel/Galaxy detection only runs on the smartphone taking the call and needs 2025–26 flagship hardware; NTT's landline service uploads recordings to its cloud; Macnica/Elith needs a new gateway SoC. Ours runs in a browser on any old tablet, STT stays on the device (Web Speech `processLocally`), and only masked text lines reach the server. Phrase it as "no audio leaves the device", never "nothing leaves the device" (masked text does, in `gate=periodic`; `gate=rules` is the strict mode).
2. **Explainable kill-chain rules fused with an LLM, with hard combos the model cannot veto** and a reporting cap. Published LLM-only systems show the precision drop we address (arXiv 2502.03964); commercial products publish no false-positive rate. We can cite our own dev/test/final numbers and the 93-minute benign-speech run.
3. **Japanese and Vietnamese from one engine** via language packs. No product found covers Vietnamese call content; Google lists neither Vietnam nor Vietnamese.
4. **Whole-journey coverage:** Quick Check (text/screenshot/audio/number/URL) + family pairing alert + community reports + F6 recovery agent (ADK) in one app. Competitors ship one or two of these; none pairs live detection with a post-loss recovery agent.
5. **Google-stack, contest-fresh code**, with an evaluation that separates the generator (DeepSeek) from the judge (Gemini).

**Claims to avoid or qualify:**
- Do **not** say "first", "world's first" or "国内初" for real-time call-content AI: Fujitsu/Nagoya did device-side detection in 2012, NTT sells cloud analysis of landline calls today, Google has shipped on-device Japanese call detection since 2026-03, and Macnica/Elith announced an edge PoC a week ago. Say "unlike…" with the concrete difference instead.
- Do **not** say "on-device AI" for the scam judgement. Only STT is on-device; the rules run on the server and Gemini runs on Agent Platform. Google and Macnica/Elith are fully on-device — our honest position is "audio stays on the device; the judge sees masked text".
- Do **not** compare accuracy numbers head to head. Macnica's 90% and Docomo's 95% are on undisclosed data; ours are on synthetic sets plus a private real-audio set. Present our numbers with their data source and never as "better than X".
- Do **not** call number-database apps (Tobila, Whoscall, nTrust, Digi Police) competitors in the same category; they are complementary and our phone-number tab is the weak overlap (we count community reports, they have police data).
- "Novel" is defensible only for the specific combination (browser STT gate + kill-chain fusion + JP/VN packs + family/recovery flow), not for any single component. Say "our contribution is the combination and the privacy tiering".
- Note in the roadmap that the MIC July 2026 request means carriers (Docomo FY2026, SoftBank/BBSS autumn 2026) will ship LLM call analysis inside the contest window; position Sagi Shield as the device-agnostic, cross-market, open-to-banks (`/precheck` API) option rather than as a carrier substitute.

**Things worth reading next, if time allows:** the Docomo Technical Journal for its RAG design (no public paper found yet), the BBSS launch announcement when it appears, and Google's message-detection language list on a Google page.
