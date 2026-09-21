# Demo video script (max 3:00, English narration)

Rules: English only; no police audio and no third-party footage - every call in the video is our own re-enactment
(`tools/test_calls.json`, spoken by a teammate or TTS). Record the phone screen + a tablet next to a landline.
Judging weights: Technical merit & Gen AI 40% · Problem alignment 25% · Innovation 25% · UX 10%.

| Time | Picture | Narration (≈ 390 words total) |
|---|---|---|
| 0:00-0:20 | Black screen, a landline rings. Text: "¥142.3 billion lost in Japan in 2025 - ¥390 million a day. Source: National Police Agency." | "Last year phone scammers took 142 billion yen from people in Japan - double the year before. [VERIFY the age share in the NPA PDF before recording, or drop the clause: "Most victims were over 65"], alone, on a landline. No app on their phone could help, because the scam happens in a conversation." |
| 0:20-0:40 | Tablet on a shelf next to the phone, big clock, "見守り中". Hands never touch it. | "This is Sagi Shield. An old tablet sits next to the phone and listens to calls on speaker. Speech is turned into text on the device - the caller's voice never leaves the room." |
| 0:40-1:25 | Re-enacted fake-police call. Split screen: caller script on the left, tablet on the right. Meter climbs: authority → fear → isolation → "let's move to LINE". Screen turns red, the tablet SPEAKS: 「詐欺の可能性が高いです。電話を切ってください」. | "A caller claims to be the police. Your account was used in a crime. Tell no one. Sagi Shield follows the scam kill chain - authority, fear, isolation, channel switch, money. Rules run on every sentence, offline. Every twenty seconds Gemini reads the number-masked text and judges the whole story. When the caller says 'I'll show you the warrant on LINE', the screen takes over and the tablet says out loud: hang up." |
| 1:25-1:45 | Daughter's phone: Guardian dashboard, alert appears, one line summary, "Call mom now". | "Her daughter gets one sentence - never the transcript - and a button to call." |
| 1:45-2:10 | The two-call scam: day 1 "it's me, my number changed, I have a cold" - tablet stays green. Day 2 "I need two million yen today" - red at the fifth sentence. Then the big button: "Hang up and call Taro on the saved number". | "The hardest scam needs two calls. Day one asks for nothing: 'It's me, my number changed.' Sagi Shield stays quiet - but the device remembers. Day two, the same voice needs money. The alarm fires on the fifth sentence, and one tap calls the real son on the number she already had." |
| 2:10-2:35 | Quick Check montage: paste a message · screenshot of a fake arrest warrant → HIGH "police never send warrants by chat" · a link · a phone number from overseas · "I already paid" recovery agent drafting the police statement. | "For everything else there is Quick Check: a message, a screenshot - Gemini vision reads the fake warrant - a link, a number, a recording. And if the money is already gone, an ADK agent walks through the first hour: freeze the transfer, call the police, and it drafts the statement." |
| 2:35-2:52 | Evaluation slide: "Rules only → rules + Gemini: recall 65% → 100%, false alarms 49% → 4%" · "Real police recordings: 14 of 15 scam cases raised the alarm" · "93 minutes of real non-scam speech: 0 false alarms". | "We measured it. On calls written by a different model than the judge, Gemini lifts recall from 65 to 100 percent and cuts false alarms from 49 to 4. On real recordings published by the police, 14 of 15 scam cases raised the alarm. On an hour and a half of ordinary speech: zero." |
| 2:52-3:00 | Architecture strip: PWA → Cloud Run → Gemini on Agent Platform · Firestore · BigQuery · Web Risk. Logo + URL. | "All on Google Cloud. Sagi Shield - so the next call ends with a dial tone, not a transfer." |

Shot list / checks before recording
- [ ] Settings → trusted contact saved ("Taro"), language Japanese, kiosk mode on, volume up (the spoken alert must be audible).
- [ ] Live Guard works with the microphone in the recording browser (on-device pack installed - the badge must say on-device).
- [ ] Cloud Run `min-instances=1` for the recording day (no cold start on camera).
- [ ] Numbers on the evaluation slide match `docs/EVAL.md` on the day of recording.
- [ ] No real phone numbers, no police audio, no third-party logos on screen.
