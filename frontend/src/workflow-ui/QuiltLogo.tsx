// Quilt "D." brand mark: a disc with a half-disc "D" and a dot. Disc, glyph
// and ring colors come from the --logo-* CSS variables so the mark follows the
// active theme (yellow-on-slate in dark, orange on light). Decorative by
// default - the adjacent "Quilt" wordmark carries the accessible name.

export function QuiltLogo({ size = 24, className }: { size?: number; className?: string }) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 256 256"
            className={className ? `quilt-logo ${className}` : 'quilt-logo'}
            aria-hidden="true"
        >
            <circle className="quilt-logo-disc" cx="128" cy="128" r="120" vectorEffect="non-scaling-stroke" />
            <g className="quilt-logo-glyph">
                <path d="M56 54 A74 74 0 0 1 56 202 Z" />
                <circle cx="173" cy="128" r="27" />
            </g>
        </svg>
    );
}
