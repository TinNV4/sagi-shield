# Sagi Shield pilot protocol

Owner's protocol for phase 0 of `docs/ROADMAP.md`: three relative households (two ja, one vi) on the pilot service,
https://sagi-shield-pilot-209791011329.asia-northeast1.run.app (own database `pilot`, `PILOT` badge). The real-call field
test (scripts, observer sheet) stays in `docs/REAL_CALL_TEST.md`; this file is about running the pilot week by week.

## 1. Who is in the pilot, and what they agree to

Relatives only, until a lawyer has read the notice (section 8). One adult per household, the guardian, installs the app for a
parent and is the contact for everything below. The sentence each guardian (and the parent, read aloud in their language)
agrees to before anything is installed:

> I agree that Sagi Shield is installed on my parent's phone by me, that it warns our family when a call looks like a scam,
> that the owner of the pilot sees only counts and the reasons for a warning (never the words of a call, never audio), and
> that I can stop it, and have everything deleted, whenever I want.

The privacy notice the app links to is `/#privacy` (content in `frontend/src/content/privacy.ts`). Send it with the consent
sentence. Record the date each household said yes in the Log (section 9), by first name only.

## 2. Installing

Use the setup card, not a hand install: the guardian signs in, taps "Start protecting a parent" on the Guardian dashboard and
prints or shows the card (code, QR, steps). The parent's phone is set up by the guardian, not by the owner.

- **iPhone:** open the pilot URL in Safari, Share, Add to Home Screen. Open the app from the home screen icon (a home-screen app
  has its own storage; a code used in Safari links Safari, not the app). Inside it: "..." then Family Link, "I have a code from
  my family". Turn notifications on inside the home-screen app (iOS 16.4 or later).
- **Android:** Chrome. Install the app from the menu, then open it and enter the code. The share target ("Share to Sagi Shield")
  appears only after the app has been reinstalled once the update is live, so reinstall if the share sheet does not list it.
- Live Guard is switched on by the guardian (household settings), never by the owner. The phone listens only while the app is
  open on Live Guard, on speaker, and audio never leaves the phone.

## 3. What to report, and how

- On every result: the thumbs ("Was this right?"), with the reason chips for a wrong answer. The guardian's alert cards have
  "false alarm" and "real" buttons. These are the only labels the pilot produces; ask for them, they cost five seconds.
- Anything else (it was slow, it was confusing, it frightened someone): a message to the owner, in the family chat, in any words.
- Never forward the text of a call or a screenshot of a bank page. The owner does not need them and will not ask.

## 4. Weekly check-in

Once a week, ten minutes by phone or in person, one household at a time. Ask the guardian (and the parent when they are there).
Write the answers in the Log, not the names of callers or any numbers.

| # | English | ja | vi |
|---|---|---|---|
| 1 | How many times did you check something this week? | 今週、何回チェックしましたか。 | Tuần này bạn đã kiểm tra mấy lần? |
| 2 | Did the app raise an alarm? What happened? | アプリが警告を出したことはありましたか。そのときどうなりましたか。 | Ứng dụng có cảnh báo lần nào không? Chuyện gì đã xảy ra? |
| 3 | Was any alarm wrong, a real call that was not a scam? | 詐欺ではない普通の電話なのに警告が出たことはありましたか。 | Có cảnh báo nào sai, tức là cuộc gọi thật nhưng không phải lừa đảo không? |
| 4 | Did a scam call get through without a warning? | 詐欺の電話なのに警告が出なかったことはありましたか。 | Có cuộc gọi lừa đảo nào mà ứng dụng không cảnh báo không? |
| 5 | Did anything make you want to switch it off? | 「もうやめたい」と思ったことはありましたか。 | Có điều gì khiến bạn muốn tắt nó đi không? |

Question 5 matters most: an app that is switched off protects no one. If the answer is yes, fix or stop before the next week.

## 5. Incidents

- **A HIGH alarm on a legitimate call:** the guardian taps "false alarm" (or the thumbs down). The same day, the owner finds the
  record in the verdict log (Cloud Logging, filter `jsonPayload.kind="live_alarm"` or `"check"`, or `python tools/verdict_log.py`)
  and reads the rule hits and the judge's reasons. Note the cause in the Log. Fix the rule or prompt only through the dev and test
  sets, never the final set (`docs/EVAL.md`).
- **A missed scam:** the guardian says so (check-in question 4 or a message). Same day, same method. The transcript is never
  requested from the family: the verdict log holds the masked decision, which is enough; if it is not, say so in the Log and ask
  the guardian to describe the call in their own words.
- **Anything that frightened the parent or sent money anywhere:** stop the household's Live Guard first, then talk. Money
  already sent: the family calls the bank and the police hotline in the app's recovery screen; the owner does not handle money.
- **Deletion request:** the household owner (guardian) deletes it in the app; the owner confirms in the admin page that the
  household count dropped and writes the date in the Log.

## 6. The owner's weekly routine

1. `python tools/pilot_report.py --gcloud-token --project sagi-shield-560661 --days 7` from the repository root (verdicts
   per level and kind, Live Guard calls / looks / alarms, latency p50 / p95, feedback and its agreement rate, households,
   offline alerts sent). A missing verdict table prints a note, not a traceback.
2. Read `/#admin` signed in with the admin account: the same numbers by day, rule hits versus model reasons.
3. Run the check-in (section 4) with each household.
4. Handle open incidents (section 5).
5. Add a dated entry to the Log: numbers, anomalies, decisions, what changes next week.

Retention, so the notice stays true: alerts 90 days, feedback 365 days, verdict dataset partitions 400 days, recovery chats 24 hours.

## 7. Exit criteria (ROADMAP phase 0)

- Three households (two ja, one vi, all relatives) installed by a guardian without the owner touching the parent's device, on the
  pilot URL, through "Protect a parent" and the setup card.
- The Step 0 answer (on-device speech recognition on the real devices) recorded.
- The admin page shows the three households' verdicts within a minute of them happening.
- `python -m pytest`, `npm test`, CI and auto-deploy green; no `family_id` in any URL.
- 2026-11-14: delete `/family/*`, `getFamilyId`, `LEGACY_FAMILY` (one commit).

## 8. Open question: the lawyer

A lawyer must read the privacy notice, and the caller-consent reasoning (a party to a call may analyse it; Live Guard on speaker is
the protected person's own analysis of their own call), under Japanese and Vietnamese law before any household that is not a
relative joins. Who reads it and who pays is open (ROADMAP section 10, question 1). Until then the pilot is relatives only.

## 9. Family one-pager

Print one per household. Short on purpose; the full text is the notice at `/#privacy`.

### 日本語

**サギシールド(試験運用)のご案内**

- **何をするアプリか:** 親御さんの電話が詐欺かもしれないとき、ご本人とご家族にそっとお知らせします。「100%安全」とはお約束できません。あやしいと思ったら、電話を切って、ご家族か公式の番号に確認してください。
- **端末の外に出るもの:** 音声は端末の外に出ません。文字にした会話の一部だけが、電話番号などを伏せた形で判定に使われます。
- **保存されるもの:** ご家族への通知(要約の一文のみ)は90日で消えます。会話の文字や録音は保存しません。
- **やめたいとき:** いつでもやめられます。ご家族が設定から削除すれば、データも削除されます。
- **困ったとき:** 運営の連絡先(家族グループまたは電話)へ。あやしい電話の内容そのものを送る必要はありません。
- 詳しい説明は、アプリの「プライバシーについて」(`/#privacy`)をご覧ください。

### Tiếng Việt

**Giới thiệu Sagi Shield (dùng thử)**

- **Ứng dụng làm gì:** khi cuộc gọi đến cha mẹ có thể là lừa đảo, ứng dụng nhẹ nhàng báo cho chính người nhận và gia đình. Chúng tôi không thể hứa "an toàn 100%". Nếu thấy nghi ngờ, hãy cúp máy và gọi lại cho người nhà hoặc số chính thức.
- **Những gì rời khỏi điện thoại:** âm thanh không bao giờ rời khỏi điện thoại. Chỉ một phần lời thoại đã chuyển thành chữ, đã che số điện thoại và số tài khoản, được dùng để đánh giá.
- **Những gì được lưu:** thông báo gửi gia đình (chỉ một câu tóm tắt) tự xóa sau 90 ngày. Không lưu lời thoại hay bản ghi âm.
- **Khi muốn dừng:** dừng bất cứ lúc nào. Người nhà xóa trong phần cài đặt thì dữ liệu cũng bị xóa.
- **Khi cần giúp:** liên hệ người phụ trách (nhóm gia đình hoặc điện thoại). Không cần gửi nội dung cuộc gọi đáng ngờ.
- Xem giải thích đầy đủ trong ứng dụng, mục "Quyền riêng tư" (`/#privacy`).

## Log

Dated entries, newest last. One per week, plus one per incident.

### YYYY-MM-DD (template)

- Households active / Live Guard on / seen in 24 h:
- Checks / alarms / looks (from `tools/pilot_report.py`):
- Feedback (agreement rate, false alarms, missed scams):
- Check-in answers (questions 1-5, per household, first names only):
- Incidents and the cause found in the verdict log:
- Decisions and next week:
