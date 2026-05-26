import { Languages } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LANGUAGES } from './languages';

// Tiny topbar dropdown to switch UI language. The native name is what
// shows when collapsed so a Spanish user sees "Espanol", an Arabic user
// sees the Arabic name, etc. - they recognise their language without
// having to guess at the English label.
export default function LanguageSelector() {
    const { i18n, t } = useTranslation();

    const onChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        void i18n.changeLanguage(e.target.value);
    };

    // i18next sometimes returns the long form like "en-US" from the
    // language detector. Match the closest supported base code.
    const current = LANGUAGES.find(l => l.code === i18n.language)?.code
                 ?? LANGUAGES.find(l => i18n.language?.startsWith(l.code))?.code
                 ?? 'en';

    return (
        <div className="topbar-lang" title={t('topbar.languageAriaLabel')}>
            <Languages size={12} aria-hidden="true" />
            <select
                className="topbar-lang-select"
                value={current}
                onChange={onChange}
                aria-label={t('topbar.languageAriaLabel')}
            >
                {LANGUAGES.map(l => (
                    <option key={l.code} value={l.code}>
                        {l.nativeName}
                    </option>
                ))}
            </select>
        </div>
    );
}
