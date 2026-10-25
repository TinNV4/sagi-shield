import retention from './retention.json';

export interface PrivacySection {
  title: string;
  paragraphs: string[];
}

export interface PrivacyNotice {
  updated: string;
  sections: PrivacySection[];
}

// Retention figures come from the one file the backend's lifetimes are checked against, so the notice cannot drift.
const FIGURES: Record<string, string> = {
  alert_days: String(retention.alert_days),
  feedback_days: String(retention.feedback_days),
  verdict_days: String(retention.verdict_days),
};

const fill = (text: string): string => text.replace(/\{([a-z_]+)\}/g, (whole, key: string) => FIGURES[key] ?? whole);

const RAW: Record<'ja' | 'vi' | 'en', PrivacyNotice> = {
  ja: {
    updated: '2026年10月25日',
    sections: [
      {
        title: 'サギシールドとは',
        paragraphs: [
          'サギシールドは、電話やメッセージに詐欺の兆候がないかを一緒に確かめる補助アプリです。警察でも銀行でもありません。',
          '「必ず安全」とお伝えすることはできません。迷ったときは、自分で調べた公式の番号に電話して確かめてください。',
        ],
      },
      {
        title: '端末の外に出る情報',
        paragraphs: [
          '「通話を見守る」の音声認識は、お使いの端末の中で行い、音声は端末の外に出ません。「通話を見守る」の画面で、ブラウザのクラウド認識をご自身でオンにした場合だけ、音声がブラウザ提供元の音声認識サービスに送られます。そのときは画面にはっきり表示されます。',
          '認識された文は、1文ごとに文字として東京にあるサギシールドのサーバーに送られます。サーバーは届いた時点で数字を伏せ、文は保存しません。通話中は約20秒ごとに、直近の数行を（数字を伏せたまま）Google の Gemini に送って判定します。',
          '「今すぐチェック」では、文章が東京のサギシールドのサーバーに届き、サーバーが数字を伏せてから Gemini に送ります（保存しません）。スクリーンショットは見たままの形で、写っている数字も含めて送られます。確認のために選んだ録音は、文字起こしのために送られ、保存されません。',
          '送信先は Google のグローバルな接続先で、処理する国は日本とは限りません。Agent Platform 上の Gemini は、お客様のデータを学習に使いません。',
        ],
      },
      {
        title: '保存される情報',
        paragraphs: [
          '家族への通知: 危険度と、要約の一文だけを{alert_days}日間保存します。',
          '「この判定は合っていましたか」への回答: 文章は付けず、{feedback_days}日間保存します。',
          'みんなの通報: 詐欺の種類、都道府県、日付、そして電話番号の元に戻せない変換値だけを保存します。電話番号そのものは保存しません。地域統計が存在する限り保管されます。',
          '被害相談のチャット（数字は伏せたもの）: 24時間。',
          '技術ログ: 通話の文章や番号は含みませんが、判定ごとにアプリが書いた2行の説明は残ります。{verdict_days}日間保存し、その後は自動で消えます。',
          '世帯の情報: 世帯のメンバー（お名前を入れた場合は親御さんのお名前、見守り役のお名前、ログイン用の識別子、通知用のトークン）と、端末の状態（最後に確認できた時刻と、「通話を見守る」が動いているか。動いている間は3分ごとに送られます）。世帯を削除するまで保存され、その世帯の見守り役の方に見えます。',
          '音声も通話の文字起こしも、保存しません。',
        ],
      },
      {
        title: '誰が見られるか',
        paragraphs: [
          '同じ世帯の見守り役の方が、家族への通知を見られます。',
          '試験運用の運営者が見る概要画面には件数だけが表示され、個々の通知は開きません。誤警告や見逃しを調べるため、運営者がその警告の技術ログ（アプリの説明とルールの該当）を読むことがあります。通話の言葉や番号は含まれません。',
          'Google は、同社のクラウド規約のもとで送信された内容を処理します。それ以外の人には見えません。',
        ],
      },
      {
        title: '削除する方法',
        paragraphs: [
          'アプリで世帯をつくった方が、「見守り人ダッシュボード」から世帯と通知を削除できます。通知と、ご家族との連携が消えます。',
          '「合っていましたか」への回答（{feedback_days}日）と技術ログ（{verdict_days}日）は、文章を含まず、期間が過ぎると自動で消えます。みんなの通報にも文章は含まれません。見守り役の Google アカウントはご本人が削除するまで残ります。',
        ],
      },
      {
        title: '困ったときの連絡先',
        paragraphs: [
          '日本: 警察相談専用電話 #9110、消費者ホットライン 188。',
          'ベトナム: 警察 113。',
          'この試験運用については、このアプリを紹介した方にお尋ねください。',
        ],
      },
      {
        title: 'この試験運用について',
        paragraphs: [
          'これは、親戚の方々と行う小さな試験運用です。この説明文は、まだ弁護士の確認を受けていません。',
          'いつでもやめることができます。世帯をつくった方が、世帯と通知を削除することもできます。',
        ],
      },
    ],
  },
  vi: {
    updated: '25 tháng 10 năm 2026',
    sections: [
      {
        title: 'Sagi Shield là gì',
        paragraphs: [
          'Sagi Shield là ứng dụng hỗ trợ bạn kiểm tra xem cuộc gọi hay tin nhắn có dấu hiệu lừa đảo không. Đây không phải là cơ quan công an và cũng không phải ngân hàng.',
          'Ứng dụng không thể khẳng định điều gì là tuyệt đối an toàn. Khi còn nghi ngờ, hãy tự tra số chính thức rồi gọi lại để xác nhận.',
        ],
      },
      {
        title: 'Thông tin rời khỏi điện thoại',
        paragraphs: [
          'Phần giám sát cuộc gọi (Live Guard) nhận dạng giọng nói ngay trên thiết bị của bạn, âm thanh không rời khỏi thiết bị. Chỉ khi chính bạn bật nhận dạng trên đám mây của trình duyệt, ngay trên màn hình Live Guard, âm thanh mới được gửi đến dịch vụ giọng nói của nhà cung cấp trình duyệt; khi đó màn hình sẽ ghi rõ.',
          'Mỗi câu được nhận dạng sẽ được gửi dưới dạng chữ đến máy chủ Sagi Shield ở Tokyo; máy chủ che số ngay khi nhận và không lưu câu đó. Trong cuộc gọi, khoảng 20 giây một lần, vài dòng gần nhất (đã che số) được gửi tiếp đến Gemini của Google để đánh giá.',
          'Với "Kiểm tra nhanh": văn bản được gửi đến máy chủ Sagi Shield ở Tokyo; máy chủ che số rồi mới chuyển cho Gemini và không lưu lại. Ảnh chụp màn hình được gửi nguyên như bạn thấy, kể cả các con số trong ảnh. Bản ghi âm bạn chọn kiểm tra được gửi đi để chuyển thành chữ và không được lưu.',
          'Dữ liệu đến điểm kết nối toàn cầu của Google, nên có thể được xử lý ở bất kỳ quốc gia nào. Gemini trên Agent Platform không dùng dữ liệu của khách hàng để huấn luyện.',
        ],
      },
      {
        title: 'Thông tin được lưu lại',
        paragraphs: [
          'Cảnh báo gửi gia đình: chỉ một câu tóm tắt và mức độ, lưu trong {alert_days} ngày.',
          'Câu trả lời của bạn cho "Đánh giá này có đúng không?": không kèm nội dung, lưu trong {feedback_days} ngày.',
          'Báo cáo của cộng đồng: loại lừa đảo, tỉnh/thành, ngày báo và một mã một chiều của số điện thoại, không bao giờ lưu chính số đó. Được giữ chừng nào danh sách của cộng đồng còn tồn tại.',
          'Cuộc trò chuyện hỗ trợ khi bị lừa (đã che số): 24 giờ.',
          'Nhật ký kỹ thuật: không có nội dung cuộc gọi hay số điện thoại, nhưng giữ lại hai dòng giải thích do chính ứng dụng viết cho mỗi đánh giá. Lưu trong {verdict_days} ngày rồi tự xóa.',
          'Thông tin hộ gia đình: các thành viên (tên người thân nếu bạn nhập, tên những người giám hộ, mã định danh đăng nhập, mã thông báo) và trạng thái thiết bị (lần cuối thấy thiết bị, Live Guard có đang nghe không; gửi mỗi 3 phút khi đang chạy). Giữ đến khi hộ gia đình bị xóa và những người giám hộ của hộ đó xem được.',
          'Không lưu âm thanh và không lưu bản ghi lời thoại của cuộc gọi.',
        ],
      },
      {
        title: 'Ai có thể xem',
        paragraphs: [
          'Những người giám hộ trong cùng hộ gia đình xem được các cảnh báo.',
          'Màn hình tổng quan của người điều hành đợt thử nghiệm chỉ hiển thị số liệu đếm; họ không mở từng cảnh báo. Để tìm hiểu một cảnh báo sai hoặc một vụ lừa đảo bị bỏ sót, người điều hành có thể đọc mục nhật ký kỹ thuật của cảnh báo đó (phần giải thích của ứng dụng và các quy tắc đã khớp), không bao giờ có lời trong cuộc gọi hay số điện thoại.',
          'Google xử lý phần dữ liệu được gửi đi theo điều khoản đám mây của Google. Không ai khác xem được.',
        ],
      },
      {
        title: 'Cách xóa dữ liệu',
        paragraphs: [
          'Người tạo hộ gia đình trong ứng dụng có thể xóa hộ gia đình và các cảnh báo của hộ trong "Bảng điều khiển người giám hộ". Cảnh báo và các kết nối với người thân sẽ bị xóa.',
          'Câu trả lời "có đúng không" ({feedback_days} ngày) và nhật ký kỹ thuật ({verdict_days} ngày) không chứa nội dung và tự hết hạn. Báo cáo của cộng đồng cũng không chứa nội dung. Tài khoản Google của người giám hộ vẫn còn cho đến khi chính họ xóa.',
        ],
      },
      {
        title: 'Số điện thoại cần gọi',
        paragraphs: [
          'Việt Nam: công an 113.',
          'Nhật Bản: đường dây tư vấn của cảnh sát #9110, đường dây nóng tư vấn tiêu dùng 188.',
          'Về đợt thử nghiệm này, hãy hỏi người đã giới thiệu ứng dụng cho bạn.',
        ],
      },
      {
        title: 'Về đợt thử nghiệm này',
        paragraphs: [
          'Đây là một đợt thử nghiệm nhỏ với người thân. Bản thông báo này chưa được luật sư xem xét.',
          'Bạn có thể dừng bất cứ lúc nào; người tạo hộ gia đình cũng có thể xóa hộ gia đình và các cảnh báo.',
        ],
      },
    ],
  },
  en: {
    updated: 'October 25, 2026',
    sections: [
      {
        title: 'What Sagi Shield does',
        paragraphs: [
          'Sagi Shield helps you check whether a call or a message shows signs of a scam. It is an aid. It is not the police and it is not a bank.',
          'It can never promise that something is completely safe. When in doubt, look up an official number yourself and call it.',
        ],
      },
      {
        title: 'What leaves your phone',
        paragraphs: [
          'Live Guard recognises speech on your own device, and the audio stays there. Only if you yourself turn on the browser\'s cloud recogniser, on the Live Guard screen, does audio go to the browser maker\'s speech service; the screen says so clearly when it is on.',
          'Each recognised sentence goes as text to the Sagi Shield server in Tokyo, which hides numbers on arrival and does not store it. During a call, about every 20 seconds, the last few lines (numbers still hidden) go on to Google\'s Gemini for a judgement.',
          'In Quick Check, the text goes to the Sagi Shield server in Tokyo, which hides numbers before passing it on to Gemini and does not store it. A screenshot is sent as you see it, numbers included. A recording you choose to check is sent for transcription and is not stored.',
          'Everything goes to a global Google endpoint, so it may be processed in any country. Gemini on Agent Platform does not use customer data for training.',
        ],
      },
      {
        title: 'What is kept',
        paragraphs: [
          'Alerts to your family: one summary sentence and the risk level, for {alert_days} days.',
          'Your answers to "Was this right?": no text, for {feedback_days} days.',
          'Community reports: the type of scam, the prefecture, the date and a one-way code of the number, never the number itself; kept for as long as the community list exists.',
          'Recovery chat, numbers hidden: 24 hours.',
          'A technical log: no call text or numbers; it keeps the app\'s own two-line explanation of each verdict. {verdict_days} days, then it deletes itself.',
          'Household details: the members (the parent\'s name if given, the guardians\' names, sign-in identifiers, notification tokens) and the device status (when it was last seen, whether Live Guard is listening; sent every 3 minutes while it runs). Kept until the household is deleted, and visible to that household\'s guardians.',
          'No audio and no call transcripts are stored.',
        ],
      },
      {
        title: 'Who can see it',
        paragraphs: [
          'The guardians of your household can see the alerts.',
          'The pilot owner\'s overview shows counts only; they do not open individual alerts. To look into a false alarm or a missed scam, the owner may read the technical log entry for that warning (the app\'s explanation and rule hits, never the words of a call or numbers).',
          'Google processes what is sent under its cloud terms. No one else can see it.',
        ],
      },
      {
        title: 'How to delete',
        paragraphs: [
          'The household owner can delete the household and its alerts in the Guardian Dashboard. That removes the alerts and the links to your family.',
          'Answers to "Was this right?" ({feedback_days} days) and the technical log ({verdict_days} days) hold no text and expire on their own; community reports hold no text either. A guardian\'s Google sign-in account stays until they delete it themselves.',
        ],
      },
      {
        title: 'Who to call',
        paragraphs: [
          'Japan: police consultation line #9110, consumer hotline 188.',
          'Vietnam: police 113.',
          'About this pilot, ask the person who introduced you to the app.',
        ],
      },
      {
        title: 'This pilot',
        paragraphs: [
          'This is a small test with relatives. A lawyer has not yet reviewed this notice.',
          'You can stop at any time; the household owner can also delete the household and its alerts.',
        ],
      },
    ],
  },
};

export const PRIVACY: Record<'ja' | 'vi' | 'en', PrivacyNotice> = Object.fromEntries(
  Object.entries(RAW).map(([lang, notice]) => [
    lang,
    {
      updated: notice.updated,
      sections: notice.sections.map((s) => ({title: fill(s.title), paragraphs: s.paragraphs.map(fill)})),
    },
  ]),
) as Record<'ja' | 'vi' | 'en', PrivacyNotice>;
