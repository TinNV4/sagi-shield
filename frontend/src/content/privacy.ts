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
          'サギシールドは、電話や画面のやりとりに詐欺の兆候がないかを一緒に確かめる補助アプリです。警察でも銀行でもありません。',
          '「必ず安全」とお伝えすることはできません。迷ったときは、自分で調べた公式の番号に電話して確かめてください。',
        ],
      },
      {
        title: '端末の外に出る情報',
        paragraphs: [
          'ライブガードの音声認識は、お使いの端末の中で行います。音声が端末の外に出ることはありません。ただし、設定でクラウド認識を自分でオンにした場合は別で、その場合は画面にはっきり表示されます。',
          '通話中は約20秒ごとに、数字を伏せた文章だけを Google の Gemini に送って判定します。「確認する」を使ったときも、選んだ文章や画像を、電話番号や口座番号などの数字を伏せたうえで送ります。送信先は日本やベトナムの外にある Google のグローバルな接続先です。',
          'Agent Platform 上の Gemini は、お客様のデータを学習に使いません。',
        ],
      },
      {
        title: '保存される情報',
        paragraphs: [
          '家族への通知: 危険度と、要約の一文だけを{alert_days}日間保存します。',
          '「この判定は合っていましたか」への回答: 文章は付けず、{feedback_days}日間保存します。',
          'みんなの通報: 電話番号そのものではなく、ハッシュ（元に戻せない変換値）だけを保存します。',
          '技術ログ: 文章や電話番号を含まない記録を{verdict_days}日間保存し、その後は自動で消えます。',
          '音声も通話の文字起こしも、保存しません。',
        ],
      },
      {
        title: '誰が見られるか',
        paragraphs: [
          '同じ世帯の見守り役の方が、家族への通知を見られます。',
          'このパイロットの運営者が見られるのは件数などの集計だけで、文章や番号は見られません。',
          'Google は、同社のクラウド規約のもとで送信された文章を処理します。それ以外の人には見えません。',
        ],
      },
      {
        title: '削除する方法',
        paragraphs: [
          '世帯の管理者が、見守り画面から世帯を削除できます。通知とペアリングがすべて消えます。',
          '技術ログは、上に書いた期間が過ぎると自動で消えます。',
        ],
      },
      {
        title: '困ったときの連絡先',
        paragraphs: [
          '日本: 警察相談専用電話 #9110、消費者ホットライン 188。',
          'ベトナム: 警察 113。',
          'このパイロットについては、お誘いした運営者にお尋ねください。',
        ],
      },
      {
        title: 'このパイロットについて',
        paragraphs: [
          'これは、親戚の方々と行う小さな試験運用です。この説明文は、まだ弁護士の確認を受けていません。',
          'いつでもやめることができます。やめるときは、見守り画面から世帯を削除してください。',
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
          'Nhận dạng giọng nói của Live Guard chạy ngay trên thiết bị của bạn. Âm thanh không rời khỏi thiết bị, trừ khi chính bạn bật nhận dạng trên đám mây trong phần cài đặt; khi đó màn hình sẽ ghi rõ.',
          'Trong cuộc gọi, khoảng 20 giây một lần, chỉ phần chữ đã được che số mới được gửi đến Gemini của Google để đánh giá. Khi bạn dùng chức năng kiểm tra, văn bản hoặc hình ảnh bạn chọn cũng được gửi đi sau khi che số điện thoại và số tài khoản. Máy chủ nhận nằm ở điểm kết nối toàn cầu của Google, ngoài Nhật Bản và Việt Nam.',
          'Gemini trên Agent Platform không dùng dữ liệu của khách hàng để huấn luyện.',
        ],
      },
      {
        title: 'Thông tin được lưu lại',
        paragraphs: [
          'Cảnh báo gửi gia đình: chỉ một câu tóm tắt và mức độ, lưu trong {alert_days} ngày.',
          'Câu trả lời của bạn cho "Đánh giá này có đúng không?": không kèm nội dung, lưu trong {feedback_days} ngày.',
          'Báo cáo của cộng đồng: chỉ lưu giá trị băm (hash) của số điện thoại, không lưu chính số đó.',
          'Nhật ký kỹ thuật: không chứa nội dung tin nhắn hay số điện thoại, lưu trong {verdict_days} ngày rồi tự xóa.',
          'Không lưu âm thanh và không lưu bản ghi lời thoại của cuộc gọi.',
        ],
      },
      {
        title: 'Ai có thể xem',
        paragraphs: [
          'Những người giám hộ trong cùng hộ gia đình xem được các cảnh báo.',
          'Người điều hành đợt thử nghiệm chỉ xem được số liệu tổng hợp, không thấy nội dung hay số điện thoại.',
          'Google xử lý phần văn bản được gửi đi theo điều khoản đám mây của Google. Không ai khác xem được.',
        ],
      },
      {
        title: 'Cách xóa dữ liệu',
        paragraphs: [
          'Chủ hộ có thể xóa hộ gia đình trong màn hình theo dõi. Toàn bộ cảnh báo và liên kết ghép đôi sẽ bị xóa.',
          'Nhật ký kỹ thuật tự hết hạn sau thời gian nêu ở trên.',
        ],
      },
      {
        title: 'Số điện thoại cần gọi',
        paragraphs: [
          'Việt Nam: công an 113.',
          'Nhật Bản: đường dây tư vấn của cảnh sát #9110, đường dây tiêu dùng 188.',
          'Về đợt thử nghiệm này, hãy hỏi người đã mời bạn tham gia.',
        ],
      },
      {
        title: 'Về đợt thử nghiệm này',
        paragraphs: [
          'Đây là một đợt thử nghiệm nhỏ với người thân. Bản thông báo này chưa được luật sư xem xét.',
          'Bạn có thể dừng bất cứ lúc nào. Để dừng, hãy xóa hộ gia đình trong màn hình theo dõi.',
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
          'Live Guard recognises speech on your own device. Audio does not leave it, unless you yourself turn on cloud recognition in Settings; the screen says so clearly when it is on.',
          'During a call, about every 20 seconds, only the text with phone and account numbers hidden is sent to Google\'s Gemini for a judgement. When you run a check, the text or image you chose is sent the same way, numbers hidden. It goes to a global Google endpoint, which is outside Japan and Vietnam.',
          'Gemini on Agent Platform does not use customer data for training.',
        ],
      },
      {
        title: 'What is kept',
        paragraphs: [
          'Alerts to your family: one summary sentence and the risk level, for {alert_days} days.',
          'Your answers to "Was this right?": no text, for {feedback_days} days.',
          'Community reports: a hash of the number only, never the number itself.',
          'A technical log without any text or phone numbers: {verdict_days} days, then it deletes itself.',
          'No audio and no call transcripts are stored.',
        ],
      },
      {
        title: 'Who can see it',
        paragraphs: [
          'The guardians of your household can see the alerts.',
          'The owner of this pilot sees counts only, never text or numbers.',
          'Google processes the text that is sent under its cloud terms. No one else can see it.',
        ],
      },
      {
        title: 'How to delete',
        paragraphs: [
          'The household owner can delete the household in the guardian dashboard. That removes the alerts and the pairings.',
          'The technical log expires on its own after the period above.',
        ],
      },
      {
        title: 'Who to call',
        paragraphs: [
          'Japan: police consultation line #9110, consumer hotline 188.',
          'Vietnam: police 113.',
          'About this pilot, ask the person who invited you.',
        ],
      },
      {
        title: 'This pilot',
        paragraphs: [
          'This is a small test with relatives. A lawyer has not yet reviewed this notice.',
          'You can stop at any time. To stop, delete the household in the guardian dashboard.',
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
