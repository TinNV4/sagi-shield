import React, {useState} from 'react';
import {PhoneCall, UserCheck} from 'lucide-react';
import {useI18n} from '../i18n';

/**
 * The one action that defeats "it's me" and deepfake calls: hang up and call the number you ALREADY have.
 * The trusted contact (a name and a number) is kept in this browser only - it is never sent to the server.
 */
const KEY = 'sagi_trusted_contact';

export interface TrustedContactData {
  name: string;
  tel: string;
}

export const getTrustedContact = (): TrustedContactData | null => {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    return raw && raw.tel ? raw : null;
  } catch {
    return null;
  }
};

const saveTrustedContact = (c: TrustedContactData | null) => {
  try {
    if (c) localStorage.setItem(KEY, JSON.stringify(c));
    else localStorage.removeItem(KEY);
  } catch {}
};

export const telHref = (tel: string) => `tel:${tel.replace(/[^\d+#*]/g, '')}`;

/** Big call-back button; renders nothing until a contact is saved. */
export const CallTrustedButton: React.FC<{tone?: 'light' | 'alarm'}> = ({tone = 'light'}) => {
  const {t} = useI18n();
  const contact = getTrustedContact();
  if (!contact) return null;
  return (
    <a
      id="call-trusted-contact-btn"
      href={telHref(contact.tel)}
      className={`w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-2xl text-base sm:text-lg font-black shadow-md transition ${
        tone === 'alarm' ? 'bg-white text-red-800 hover:bg-yellow-50' : 'bg-[#1B4D3E] text-white hover:bg-[#143C30]'
      }`}
    >
      <PhoneCall className="w-5 h-5" />
      <span>{t('trusted.call_btn', {name: contact.name || t('guardian.member_fallback')})}</span>
    </a>
  );
};

/** Settings card: name + number of the person to verify with. */
export const TrustedContactSetting: React.FC = () => {
  const {t} = useI18n();
  const [contact, setContact] = useState<TrustedContactData>(() => getTrustedContact() || {name: '', tel: ''});
  const [saved, setSaved] = useState(false);

  const save = () => {
    const tel = contact.tel.trim();
    saveTrustedContact(tel ? {name: contact.name.trim().slice(0, 40), tel: tel.slice(0, 30)} : null);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div id="trusted-contact-setting" className="rounded-3xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-gray-800 shadow-sm p-5 space-y-3">
      <div className="flex items-center gap-2.5 text-gray-900 dark:text-white font-black text-base sm:text-lg">
        <UserCheck className="w-5 h-5 text-[#1B4D3E] dark:text-emerald-400" />
        <span>{t('trusted.title')}</span>
      </div>
      <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">{t('trusted.desc')}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input
          id="trusted-contact-name"
          type="text"
          value={contact.name}
          onChange={(e) => setContact({...contact, name: e.target.value})}
          placeholder={t('trusted.name_placeholder')}
          className="p-3 rounded-2xl bg-gray-50 dark:bg-slate-800 border border-gray-300 dark:border-gray-700 text-base"
        />
        <input
          id="trusted-contact-tel"
          type="tel"
          inputMode="tel"
          value={contact.tel}
          onChange={(e) => setContact({...contact, tel: e.target.value})}
          placeholder={t('trusted.tel_placeholder')}
          className="p-3 rounded-2xl bg-gray-50 dark:bg-slate-800 border border-gray-300 dark:border-gray-700 text-base"
        />
      </div>
      <button
        id="trusted-contact-save"
        onClick={save}
        className="px-4 py-2.5 rounded-2xl bg-[#1B4D3E] text-white text-sm font-bold hover:bg-[#143C30]"
      >
        {saved ? t('trusted.saved') : t('trusted.save')}
      </button>
    </div>
  );
};
