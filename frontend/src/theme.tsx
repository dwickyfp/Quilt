import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

export type Theme = 'dark' | 'light';

type ThemeContextValue = {
    theme: Theme;
    toggle: () => void;
    set: (t: Theme) => void;
};

const ThemeContext = createContext<ThemeContextValue>({
    theme: 'dark',
    toggle: () => {},
    set: () => {},
});

const STORAGE_KEY = 'quilt:theme';

function readInitialTheme(): Theme {
    if (typeof window === 'undefined') return 'dark';
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored === 'light' || stored === 'dark') return stored;
    } catch {
        /* ignore */
    }
    return 'dark';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
    const [theme, setTheme] = useState<Theme>(readInitialTheme);

    useEffect(() => {
        document.documentElement.dataset.theme = theme;
        try {
            localStorage.setItem(STORAGE_KEY, theme);
        } catch {
            /* ignore */
        }
    }, [theme]);

    const toggle = useCallback(() => setTheme(t => (t === 'dark' ? 'light' : 'dark')), []);

    return (
        <ThemeContext.Provider value={{ theme, toggle, set: setTheme }}>
            {children}
        </ThemeContext.Provider>
    );
}

export function useTheme(): ThemeContextValue {
    return useContext(ThemeContext);
}
