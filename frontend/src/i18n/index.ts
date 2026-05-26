// i18n bootstrap. Bundles all language resources into the JS so the
// Tauri webview never needs an HTTP backend - the app is offline-first
// and Duckle workspaces have no server to fetch locales from.
//
// Adding a language:
// 1. Add a row to LANGUAGES in ./languages.ts
// 2. Add a JSON file at ./locales/{code}.json (run scripts/i18n-gen.py to
//    auto-translate from en.json)
// 3. Import + register it in the RESOURCES map below

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { isRtl, LANGUAGES, type LangCode } from './languages';

import en from './locales/en.json';
import es from './locales/es.json';
import zhCN from './locales/zh-CN.json';
import zhTW from './locales/zh-TW.json';
import hi from './locales/hi.json';
import ar from './locales/ar.json';
import ptBR from './locales/pt-BR.json';
import bn from './locales/bn.json';
import ru from './locales/ru.json';
import ja from './locales/ja.json';
import pa from './locales/pa.json';
import de from './locales/de.json';
import ko from './locales/ko.json';
import fr from './locales/fr.json';
import vi from './locales/vi.json';
import te from './locales/te.json';
import mr from './locales/mr.json';
import tr from './locales/tr.json';
import ta from './locales/ta.json';
import ur from './locales/ur.json';
import fa from './locales/fa.json';
import pl from './locales/pl.json';
import it from './locales/it.json';
import uk from './locales/uk.json';
import id from './locales/id.json';
import th from './locales/th.json';
import nl from './locales/nl.json';
import he from './locales/he.json';
import sv from './locales/sv.json';
import el from './locales/el.json';
import cs from './locales/cs.json';
import hu from './locales/hu.json';
import ro from './locales/ro.json';
import tl from './locales/tl.json';
import ms from './locales/ms.json';

const RESOURCES: Record<LangCode, { common: typeof en }> = {
    'en':    { common: en },
    'es':    { common: es },
    'zh-CN': { common: zhCN },
    'zh-TW': { common: zhTW },
    'hi':    { common: hi },
    'ar':    { common: ar },
    'pt-BR': { common: ptBR },
    'bn':    { common: bn },
    'ru':    { common: ru },
    'ja':    { common: ja },
    'pa':    { common: pa },
    'de':    { common: de },
    'ko':    { common: ko },
    'fr':    { common: fr },
    'vi':    { common: vi },
    'te':    { common: te },
    'mr':    { common: mr },
    'tr':    { common: tr },
    'ta':    { common: ta },
    'ur':    { common: ur },
    'fa':    { common: fa },
    'pl':    { common: pl },
    'it':    { common: it },
    'uk':    { common: uk },
    'id':    { common: id },
    'th':    { common: th },
    'nl':    { common: nl },
    'he':    { common: he },
    'sv':    { common: sv },
    'el':    { common: el },
    'cs':    { common: cs },
    'hu':    { common: hu },
    'ro':    { common: ro },
    'tl':    { common: tl },
    'ms':    { common: ms },
};

void i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
        resources: RESOURCES,
        fallbackLng: 'en',
        supportedLngs: LANGUAGES.map(l => l.code),
        ns: ['common'],
        defaultNS: 'common',
        interpolation: { escapeValue: false },
        detection: {
            order: ['localStorage', 'navigator'],
            caches: ['localStorage'],
            lookupLocalStorage: 'duckle.lang',
        },
    });

function applyDocumentDir(lang: string) {
    const dir = isRtl(lang) ? 'rtl' : 'ltr';
    document.documentElement.setAttribute('lang', lang);
    document.documentElement.setAttribute('dir', dir);
}

applyDocumentDir(i18n.language);
i18n.on('languageChanged', applyDocumentDir);

export default i18n;
