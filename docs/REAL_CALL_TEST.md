# Real-call field test (Live Guard on a real phone line)

Closes the limits the deck still lists: Live Guard has never run with a real microphone on a real call, false alarms
have never been counted on real benign calls, and there is no real Vietnamese speech at all. Synthetic replays
(`tools/replay_live.py`) feed text to the socket. This test puts two people on two phones, a third device on
speaker, and counts what the deployed service does.

What it is not: a benchmark. n is small (about 15 scripted calls plus free-form ones), so report **counts**, never
percentages, and never tune rules or prompts on these runs. If a call fails, write it down, fix it later, and check
the fix with a new set of scripts (same rule as the final eval set in `EVAL.md`).

## 0. Roles, devices, consent

| Who | Does |
|---|---|
| Caller | Phone A. Reads the caller lines (C1, C2, ...) at a natural pace and may ad-lib around them. |
| Callee | Phone B, **on speaker**. Answers in their own words; the R lines are hints. Never reads the app screen aloud. |
| Observer | Watches Device C and fills one row of `tools/real_call_sheet.csv` per call. Can be the callee for short runs. |
| Guardian | Phone D (or Phone A after the call), paired through Family Link, notes when the alert arrives. |

- Device C runs Live Guard: an Android phone or tablet with Chrome 139+, or a laptop with Chrome. **Not** the Claude
  desktop browser pane: its engine reports on-device recognition `unavailable` for ja-JP, vi-VN and en-US (checked
  2026-10-18), so it cannot run this test.
- Place Device C 10-30 cm from Phone B's speaker (the onboarding screen says the same), normal living-room noise.
- Everyone on a free-form call (section 4) agrees at the start: "an app is checking this call for scams; nothing is
  recorded". Scripted calls use made-up names and no real phone or account numbers (say "XXX" if a number comes up).
- No police audio, no recordings: the app keeps no audio, and nobody records the call for this test.

## 1. Before the session (15 min)

1. Deploy the revision that logs `live_call` / `live_alarm` (this commit). Check `/health` answers.
2. Optional, avoids a cold start on the first call: `gcloud run services update sagi-shield-api --region
   asia-northeast1 --min-instances 1`; set it back to `0` after the session.
3. On Device C open the live URL, pick the language of the script block (日本語 / Tiếng Việt), save a trusted contact
   (a teammate), pair Phone D through Family Link, turn the volume up.
4. Open Live Guard and **write down the speech badge** in the sheet column `stt_mode`:
   - `On-Device: Ready` → `on-device`.
   - `Language pack download needed` → press Speech Setup, install, wait for Ready. If it never becomes Ready, write
     `pack-failed`.
   - The cloud opt-in prompt ("This device does not support on-device speech models") → accept and write `cloud`.
     Report these runs separately: audio went to the browser vendor's recognizer, not ours, and the deck must not
     call them on-device.
5. Write down the Chrome version (`chrome://version`) once per device.

## 2. How to run one call

1. Observer writes `run_id`, `start_jst` (HH:MM:SS from a clock) and presses **Start Monitoring**.
2. Caller dials Phone B; callee answers on speaker; play the script.
3. Observer writes `line_medium` / `line_high`: the script line (C3, R4, ...) being spoken when the meter first turns
   orange / when the red takeover appears. `spoken_alert` = Y if the spoken warning was understandable from 1 m.
4. After hanging up: Guardian writes `guardian_s` (seconds from the takeover to the alert, `-` if none).
   Observer rates `transcript_q` from the "Recent Live Transcription" box: 3 = readable, 2 = gist survives, 1 = garbage.
5. Press **Stop Monitoring** before the next call (each call becomes its own `live_call` record). For the two-call
   script, Stop/Start is exactly what carries the set-up-call flag to the second call.

Pace: ~3 min per call including notes. Interleave scam and benign calls as listed, so a latch that fails to reset
shows up as a false alarm on the next benign call.

## 3. Scripts

Expected outcome is decided now, before anyone runs a call. **Pass** = the column `expect` in the sheet:
`HIGH` (spoken takeover before the call ends), `MEDIUM+` (at least orange), `LOW-or-MEDIUM` (never red).

### S1 · ja · fake police (警視庁) · expect HIGH

- C1 もしもし、佐藤さんのお宅でしょうか。こちら警視庁捜査二課の山田と申します。
- R1 はい、そうですが…
- C2 突然のお電話で申し訳ありません。詐欺グループを逮捕しまして、押収した資料の中に佐藤さん名義の口座がありました。
- R2 えっ、私の口座ですか？
- C3 その口座がマネーロンダリングに使われた疑いがあります。このままですと、佐藤さんにも逮捕状が出る可能性があります。
- R3 そんな、身に覚えがありません。
- C4 ですので、無実を証明する手続きをこちらで進めます。ただし捜査上の秘密ですので、ご家族や銀行の方には絶対に話さないでください。
- C5 詳しい書類はLINEでお送りします。IDを検索して友だち追加をお願いします。ビデオ通話で警察手帳もお見せします。
- R5 LINEですか…
- C6 逮捕状の写しもそちらで確認できます。それから、お金の流れを調べるために、預金を一時的にこちらが指定する安全な口座に移していただきます。
- C7 調査が終われば全額お返しします。今日の三時までに手続きが必要です。今から銀行に行けますか？

### B1 · ja · real police, lost property · expect LOW-or-MEDIUM

- C1 お世話になっております。中央警察署、遺失物係の鈴木と申します。
- C2 昨日、駅前で財布の落とし物が届きまして、中に入っていた診察券からご連絡しました。
- R2 あ、ありがとうございます！
- C3 お受け取りには、身分証明書をお持ちのうえ、平日の九時から五時の間に警察署の窓口へお越しください。
- C4 ご不明な点がありましたら、警察署の代表番号までお電話ください。失礼いたします。

### S2 · ja · ore-ore (son, new number) · expect HIGH

- C1 もしもし、俺だけど。
- R1 え、誰？…たかし？
- C2 そう、たかし。風邪ひいて声が変なんだ。携帯を落として番号が変わったから、この番号を登録しといて。
- C3 それでさ、実は会社のお金が入ったカバンを電車に置き忘れちゃったんだ。
- R3 ええっ？
- C4 今日中に三百万円用意しないと、会社をクビになるかもしれない。父さんには心配かけたくないから、誰にも言わないでほしい。
- R4 三百万なんて…
- C5 銀行で聞かれたら、リフォーム代って言っておいて。あとで会社の同僚が家まで受け取りに行くから。

### B2 · ja · real card fraud desk (hard negative) · expect LOW-or-MEDIUM

- C1 〇〇銀行カードセンターの田中と申します。ご本人様でいらっしゃいますか。
- C2 本日、海外のサイトで五万円のカード利用がありまして、念のため確認のお電話をしました。お心当たりはございますか。
- R2 いいえ、使っていません。
- C3 承知しました。不正利用の可能性がありますので、このカードは本日停止いたします。新しいカードは一週間ほどでご登録の住所にお送りします。
- C4 ご不安でしたら、カード裏面の番号におかけ直しください。

### S3 · ja · refund at the ATM (還付金) · expect MEDIUM+ (HIGH preferred)

The one real recording that stays below the alarm on the live path is a refund scam; this script checks that case.

- C1 もしもし、こちら〇〇市役所保険年金課の佐藤と申します。
- C2 医療費の払い戻しが三万二千円ございまして、何度かお手紙をお送りしたのですが、期限が今日までとなっております。
- R2 そうなんですか、知りませんでした。
- C3 今日中でしたらATMで受け取りの手続きができます。キャッシュカードをお持ちになって、近くのコンビニのATMへ行っていただけますか。
- C4 着きましたら、こちらに携帯でお電話ください。画面の操作をご案内します。周りの方には声をかけないでくださいね。
- C5 では「振込」のボタンを押して、こちらが言う番号を入力してください。

### B3 · ja · son borrows money, legitimately (hard negative) · expect LOW-or-MEDIUM

- C1 もしもし、お母さん？たかしだよ。
- C2 来月の引っ越しで敷金がちょっと足りなくて、五万円だけ貸してもらえないかな。
- R2 いいけど、いつ要るの？
- C3 週末に家に寄るから、そのときでいいよ。お父さんにも相談しておいて。
- C4 ボーナスが出たらすぐ返すから。じゃあ土曜日にね。

### S4a + S4b · ja · two-call scam · expect S4a LOW-or-MEDIUM, S4b HIGH

S4a, day one, asks for nothing:

- C1 もしもし、母さん？俺、ゆうき。
- C2 携帯を変えたんだ。この番号が新しい番号だから、前の番号は消しておいて。
- R2 あら、そうなの。
- C3 最近どう？体調は大丈夫？今度の連休、帰れたら帰るよ。じゃあまたね。

Stop Monitoring, wait one minute, Start Monitoring (the device now holds the set-up-call flag), call again. S4b:

- C1 母さん、ゆうきだけど、今ちょっといい？
- C2 実は株の取引で失敗しちゃって、今日中に二百万円払わないといけないんだ。
- R2 二百万？
- C3 弁護士の先生が間に入ってくれてるから、その先生の事務所の口座に振り込んでほしい。
- C4 嫁には内緒にしてほしいんだ。

### B4 · ja · clinic appointment · expect LOW-or-MEDIUM

- C1 〇〇クリニックの受付です。明日十時のご予約の確認でお電話しました。
- C2 保険証とお薬手帳をお持ちください。ご都合が悪くなりましたら、お電話でご連絡ください。
- R2 はい、伺います。
- C3 では明日お待ちしております。失礼いたします。

### E1 · ja · B4 again while scam news plays in the room · expect LOW-or-MEDIUM

A third person reads this news paragraph aloud near Device C (or a real news programme plays on TV) during B4:

> 警察によりますと、警察官を名乗る男から「あなたの口座が犯罪に使われている」と電話があり、女性はLINEで逮捕状の画像を見せられたうえ、
> 現金を振り込んだということです。警察は「警察がLINEで逮捕状を送ることはない」として注意を呼びかけています。

### E2 · ja · S1 again, harder conditions · expect HIGH

Device C 50 cm from the speaker, kitchen or TV noise in the background.

### S5 · vi · fake công an · expect HIGH

- C1 A lô, có phải chị Lan không? Tôi là Trung úy Nguyễn Văn Hùng, công an quận Ba Đình.
- R1 Dạ phải, có chuyện gì vậy anh?
- C2 Chúng tôi đang điều tra một đường dây rửa tiền, và tài khoản đứng tên chị có liên quan đến vụ án.
- R2 Sao lại thế được ạ?
- C3 Nếu chị không hợp tác, cơ quan điều tra sẽ ra lệnh bắt tạm giam. Đây là bí mật điều tra, chị không được nói với ai, kể cả người nhà.
- C4 Chị kết bạn Zalo với tôi để nhận giấy triệu tập và lệnh bắt, tôi sẽ gọi video cho chị.
- C5 Chị cài ứng dụng VNeID theo đường link tôi gửi để xác minh danh tính.
- C6 Sau đó chị chuyển toàn bộ tiền trong tài khoản sang tài khoản tạm giữ của cơ quan công an để kiểm tra. Điều tra xong sẽ hoàn trả.

### B5 · vi · son sends money for Tết · expect LOW-or-MEDIUM

- C1 Alo mẹ ơi, con Minh đây. Mẹ khỏe không?
- C2 Tết này con về. Con chuyển trước cho mẹ năm triệu để mẹ sắm đồ Tết nhé.
- R2 Con giữ mà tiêu, mẹ còn tiền.
- C3 Mẹ cứ cầm đi, con chuyển vào tài khoản của mẹ như mọi lần. Tối con gọi video cho cả nhà.

### S6 · vi · fake bank asks for the OTP · expect MEDIUM+ (HIGH preferred)

- C1 Chào anh, em gọi từ bộ phận chăm sóc khách hàng của ngân hàng. Tài khoản của anh vừa có giao dịch bất thường mười lăm triệu đồng.
- R1 Tôi không thực hiện giao dịch nào cả.
- C2 Dạ vậy em hủy giao dịch giúp anh. Hệ thống sẽ gửi một mã OTP về điện thoại, anh đọc cho em mã đó nhé.
- C3 Anh làm nhanh giúp em, năm phút nữa tài khoản sẽ bị khóa.
- C4 Anh đừng gọi lên tổng đài, tổng đài đang quá tải, em xử lý trực tiếp cho anh luôn.

### B6 · vi · real bank payment reminder · expect LOW-or-MEDIUM

- C1 Chào chị, em là nhân viên ngân hàng, em gọi nhắc chị khoản vay mua xe đến hạn thanh toán vào ngày mười lăm.
- C2 Chị thanh toán qua ứng dụng ngân hàng hoặc tại quầy giao dịch như thường lệ.
- R2 Ừ, chị biết rồi, cảm ơn em.
- C3 Dạ, chúc chị một ngày tốt lành.

## 4. Free-form real calls (the false-alarm count)

Scripts measure what we wrote; ordinary calls measure what people say. During the test day each team member keeps
Live Guard running beside the phone for their own ordinary calls (family, work, shops, deliveries), with the consent
line from section 0. Target: at least 10 calls and 30 minutes per language we can cover. One sheet row per call with
`script` = `free`, `expect` = `LOW-or-MEDIUM`; write **no content**, only the level and, if it was not LOW, the
reason the screen showed.

## 5. Collecting the result

```bash
python tools/real_call_report.py --sheet tools/real_call_sheet.csv --fetch --project sagi-shield-560661 --date 2026-10-18
```

`--fetch` reads `live_call`, `live_alarm` and `live_look` records for that day from Cloud Logging (needs `gcloud`
signed in; `--logs file.json` reads a saved `gcloud logging read ... --format=json` instead). Each call is matched to
the sheet row whose `start_jst` comes last before the call's start. The tool prints one table row per call (sentences
heard, highest level, the sentence that raised the alarm, seconds to alarm, pass/fail against `expect`) and the
totals: scam calls warned / alarmed, benign calls with a false alarm, benign calls at MEDIUM. Paste the output into
`EVAL.md` under a dated heading. Cloud Logging keeps records for 30 days: collect them the same week.

## 6. What the deck may say afterwards

Only what the sheet and the logs show: e.g. "Field test, 2026-10-18: 7 of 7 scripted scam calls warned, 6 alarmed;
0 false alarms on 6 scripted and 12 real benign calls (on-device recognition on Android Chrome)". Runs on the cloud
recognizer and runs where the pack failed are reported as such, not folded into the on-device numbers.
