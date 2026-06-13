// Supported UI languages. Native name is what shows up in the selector
// so a user reading their own language recognizes it immediately.
// Direction is "rtl" for right-to-left scripts (Arabic, Hebrew, Persian,
// Urdu); index.ts sets document.dir based on the active language.

export type LangCode =
  | 'en' | 'es' | 'zh-CN' | 'zh-TW' | 'hi' | 'ar' | 'pt-BR' | 'bn'
  | 'ru' | 'ja' | 'pa' | 'de' | 'ko' | 'fr' | 'vi' | 'te'
  | 'mr' | 'tr' | 'ta' | 'ur' | 'fa' | 'pl' | 'it' | 'uk'
  | 'id' | 'th' | 'nl' | 'he' | 'sv' | 'el' | 'cs' | 'hu'
  | 'ro' | 'tl' | 'ms'
  | 'no' | 'da' | 'fi' | 'ca' | 'bg' | 'sk' | 'hr' | 'sr'
  | 'sl' | 'lt' | 'lv' | 'et' | 'km' | 'my' | 'si' | 'ne'
  | 'sw' | 'af' | 'cy' | 'ga' | 'is' | 'sq' | 'az' | 'mn' | 'kk';

export interface LangMeta {
    code: LangCode;
    name: string;       // English name (for accessibility / debug)
    nativeName: string; // What the user sees in their language
    dir: 'ltr' | 'rtl';
}

export const LANGUAGES: LangMeta[] = [
    { code: 'en',    name: 'English',              nativeName: 'English',           dir: 'ltr' },
    { code: 'es',    name: 'Spanish',              nativeName: 'Espanol',           dir: 'ltr' },
    { code: 'zh-CN', name: 'Chinese (Simplified)', nativeName: '中文 (简体)',     dir: 'ltr' },
    { code: 'zh-TW', name: 'Chinese (Traditional)',nativeName: '中文 (繁體)',     dir: 'ltr' },
    { code: 'hi',    name: 'Hindi',                nativeName: 'हिंदी',  dir: 'ltr' },
    { code: 'ar',    name: 'Arabic',               nativeName: 'العربية', dir: 'rtl' },
    { code: 'pt-BR', name: 'Portuguese (Brazil)',  nativeName: 'Portugues (Brasil)',dir: 'ltr' },
    { code: 'bn',    name: 'Bengali',              nativeName: 'বাংলা',  dir: 'ltr' },
    { code: 'ru',    name: 'Russian',              nativeName: 'Русский', dir: 'ltr' },
    { code: 'ja',    name: 'Japanese',             nativeName: '日本語',              dir: 'ltr' },
    { code: 'pa',    name: 'Punjabi',              nativeName: 'ਪੰਜਾਬੀ', dir: 'ltr' },
    { code: 'de',    name: 'German',               nativeName: 'Deutsch',           dir: 'ltr' },
    { code: 'ko',    name: 'Korean',               nativeName: '한국어',              dir: 'ltr' },
    { code: 'fr',    name: 'French',               nativeName: 'Francais',          dir: 'ltr' },
    { code: 'vi',    name: 'Vietnamese',           nativeName: 'Tieng Viet',        dir: 'ltr' },
    { code: 'te',    name: 'Telugu',               nativeName: 'తెలుగు', dir: 'ltr' },
    { code: 'mr',    name: 'Marathi',              nativeName: 'मराठी',  dir: 'ltr' },
    { code: 'tr',    name: 'Turkish',              nativeName: 'Turkce',            dir: 'ltr' },
    { code: 'ta',    name: 'Tamil',                nativeName: 'தமிழ்',  dir: 'ltr' },
    { code: 'ur',    name: 'Urdu',                 nativeName: 'اردو',        dir: 'rtl' },
    { code: 'fa',    name: 'Persian',              nativeName: 'فارسی',  dir: 'rtl' },
    { code: 'pl',    name: 'Polish',               nativeName: 'Polski',            dir: 'ltr' },
    { code: 'it',    name: 'Italian',              nativeName: 'Italiano',          dir: 'ltr' },
    { code: 'uk',    name: 'Ukrainian',            nativeName: 'Українська', dir: 'ltr' },
    { code: 'id',    name: 'Indonesian',           nativeName: 'Bahasa Indonesia',  dir: 'ltr' },
    { code: 'th',    name: 'Thai',                 nativeName: 'ไทย',              dir: 'ltr' },
    { code: 'nl',    name: 'Dutch',                nativeName: 'Nederlands',        dir: 'ltr' },
    { code: 'he',    name: 'Hebrew',               nativeName: 'עברית',  dir: 'rtl' },
    { code: 'sv',    name: 'Swedish',              nativeName: 'Svenska',           dir: 'ltr' },
    { code: 'el',    name: 'Greek',                nativeName: 'Ελληνικά', dir: 'ltr' },
    { code: 'cs',    name: 'Czech',                nativeName: 'Cestina',           dir: 'ltr' },
    { code: 'hu',    name: 'Hungarian',            nativeName: 'Magyar',            dir: 'ltr' },
    { code: 'ro',    name: 'Romanian',             nativeName: 'Romana',            dir: 'ltr' },
    { code: 'tl',    name: 'Filipino',             nativeName: 'Filipino',          dir: 'ltr' },
    { code: 'ms',    name: 'Malay',                nativeName: 'Bahasa Melayu',     dir: 'ltr' },
    { code: 'no',    name: 'Norwegian',            nativeName: 'Norsk',             dir: 'ltr' },
    { code: 'da',    name: 'Danish',               nativeName: 'Dansk',             dir: 'ltr' },
    { code: 'fi',    name: 'Finnish',              nativeName: 'Suomi',             dir: 'ltr' },
    { code: 'ca',    name: 'Catalan',              nativeName: 'Catala',            dir: 'ltr' },
    { code: 'bg',    name: 'Bulgarian',            nativeName: 'Български', dir: 'ltr' },
    { code: 'sk',    name: 'Slovak',               nativeName: 'Slovencina',        dir: 'ltr' },
    { code: 'hr',    name: 'Croatian',             nativeName: 'Hrvatski',          dir: 'ltr' },
    { code: 'sr',    name: 'Serbian',              nativeName: 'Српски',  dir: 'ltr' },
    { code: 'sl',    name: 'Slovenian',            nativeName: 'Slovenscina',       dir: 'ltr' },
    { code: 'lt',    name: 'Lithuanian',           nativeName: 'Lietuviu',          dir: 'ltr' },
    { code: 'lv',    name: 'Latvian',              nativeName: 'Latviesu',          dir: 'ltr' },
    { code: 'et',    name: 'Estonian',             nativeName: 'Eesti',             dir: 'ltr' },
    { code: 'km',    name: 'Khmer',                nativeName: 'ខ្មែរ',  dir: 'ltr' },
    { code: 'my',    name: 'Burmese',              nativeName: 'မြန်မာ',  dir: 'ltr' },
    { code: 'si',    name: 'Sinhala',              nativeName: 'සිංහල',  dir: 'ltr' },
    { code: 'ne',    name: 'Nepali',               nativeName: 'नेपाली',  dir: 'ltr' },
    { code: 'sw',    name: 'Swahili',              nativeName: 'Kiswahili',         dir: 'ltr' },
    { code: 'af',    name: 'Afrikaans',            nativeName: 'Afrikaans',         dir: 'ltr' },
    { code: 'cy',    name: 'Welsh',                nativeName: 'Cymraeg',           dir: 'ltr' },
    { code: 'ga',    name: 'Irish',                nativeName: 'Gaeilge',           dir: 'ltr' },
    { code: 'is',    name: 'Icelandic',            nativeName: 'Islenska',          dir: 'ltr' },
    { code: 'sq',    name: 'Albanian',             nativeName: 'Shqip',             dir: 'ltr' },
    { code: 'az',    name: 'Azerbaijani',          nativeName: 'Azerbaycanca',      dir: 'ltr' },
    { code: 'mn',    name: 'Mongolian',            nativeName: 'Монгол',  dir: 'ltr' },
    { code: 'kk',    name: 'Kazakh',               nativeName: 'Қазақша', dir: 'ltr' },
];

export const RTL_LANGS = new Set<string>(
    LANGUAGES.filter(l => l.dir === 'rtl').map(l => l.code as string),
);

export function isRtl(code: string): boolean {
    return RTL_LANGS.has(code);
}

export function metaFor(code: string): LangMeta | undefined {
    return LANGUAGES.find(l => l.code === code);
}
