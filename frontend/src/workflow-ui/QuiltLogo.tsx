// Quilt brand mark: a 2x2 patchwork grid of colored quilt squares joined by a
// dashed white stitch cross - mirrors the app icon. Self-contained colors so
// the mark renders identically across themes. Decorative by default - the
// adjacent "Quilt" wordmark carries the accessible name.

export function QuiltLogo({ size = 24, className }: { size?: number; className?: string }) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 256 256"
            className={className ? `quilt-logo ${className}` : 'quilt-logo'}
            aria-hidden="true"
        >
            {/* 2x2 patchwork: indigo / teal / amber / blue-accent */}
            <rect x="16" y="16" width="106" height="106" rx="24" fill="#3B3D8F" />
            <rect x="134" y="16" width="106" height="106" rx="24" fill="#1F9E8E" />
            <rect x="16" y="134" width="106" height="106" rx="24" fill="#F5A21E" />
            <rect x="134" y="134" width="106" height="106" rx="24" fill="#2563EB" />
            {/* dashed stitch cross */}
            <g stroke="#FFFFFF" strokeOpacity="0.92" strokeWidth="7" strokeLinecap="round" strokeDasharray="14 12">
                <line x1="128" y1="26" x2="128" y2="230" />
                <line x1="26" y1="128" x2="230" y2="128" />
            </g>
        </svg>
    );
}
