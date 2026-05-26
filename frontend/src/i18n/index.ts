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
import no from './locales/no.json';
import da from './locales/da.json';
import fi from './locales/fi.json';
import ca from './locales/ca.json';
import bg from './locales/bg.json';
import sk from './locales/sk.json';
import hr from './locales/hr.json';
import sr from './locales/sr.json';
import sl from './locales/sl.json';
import lt from './locales/lt.json';
import lv from './locales/lv.json';
import et from './locales/et.json';
import km from './locales/km.json';
import my from './locales/my.json';
import si from './locales/si.json';
import ne from './locales/ne.json';
import sw from './locales/sw.json';
import af from './locales/af.json';
import cy from './locales/cy.json';
import ga from './locales/ga.json';
import is_ from './locales/is.json';
import sq from './locales/sq.json';
import az from './locales/az.json';
import mn from './locales/mn.json';
import kk from './locales/kk.json';

// Locales may be missing newer keys (filled in by scripts/i18n-translate.py).
// i18next's fallbackLng resolves missing keys to en, so loose typing is safe.
type LocaleBundle = { common: Record<string, unknown> };
const RESOURCES: Record<LangCode, LocaleBundle> = {
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
    // Pass 3 additions (25 languages, 35 -> 60 total)
    'no':    { common: no },
    'da':    { common: da },
    'fi':    { common: fi },
    'ca':    { common: ca },
    'bg':    { common: bg },
    'sk':    { common: sk },
    'hr':    { common: hr },
    'sr':    { common: sr },
    'sl':    { common: sl },
    'lt':    { common: lt },
    'lv':    { common: lv },
    'et':    { common: et },
    'km':    { common: km },
    'my':    { common: my },
    'si':    { common: si },
    'ne':    { common: ne },
    'sw':    { common: sw },
    'af':    { common: af },
    'cy':    { common: cy },
    'ga':    { common: ga },
    'is':    { common: is_ },
    'sq':    { common: sq },
    'az':    { common: az },
    'mn':    { common: mn },
    'kk':    { common: kk },
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
