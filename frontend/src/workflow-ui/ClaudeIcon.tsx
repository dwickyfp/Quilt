// Stylized Claude-style sunburst mark, used for the MCP ("connect to your AI")
// button + popup. Inherits its orange color + soft glow from the .claude-icon
// CSS classes. Not the official logo - a simple radial burst.

export function ClaudeIcon({ size = 14, className }: { size?: number; className?: string }) {
    const rays = Array.from({ length: 12 }, (_, i) => {
        const a = (i * Math.PI) / 6;
        const r1 = 3.4;
        const r2 = 11;
        return (
            <line
                key={i}
                x1={12 + r1 * Math.cos(a)}
                y1={12 + r1 * Math.sin(a)}
                x2={12 + r2 * Math.cos(a)}
                y2={12 + r2 * Math.sin(a)}
            />
        );
    });
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.2}
            strokeLinecap="round"
            className={className}
            aria-hidden="true"
        >
            {rays}
        </svg>
    );
}
