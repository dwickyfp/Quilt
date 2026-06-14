import { type ReactElement } from 'react';

type Props = {
    label: string;
    children: ReactElement;
    side?: 'bottom';
};

// Lightweight CSS-only tooltip: appears instantly on hover/focus, themed to
// match the app. Keep the wrapped control's aria-label for screen readers.
export default function Tooltip({ label, children, side = 'bottom' }: Props) {
    return (
        <span className={'tt-wrap tt-' + side}>
            {children}
            <span className="tt-bubble" role="tooltip">
                {label}
            </span>
        </span>
    );
}
