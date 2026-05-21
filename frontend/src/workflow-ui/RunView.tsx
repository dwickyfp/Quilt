import type { EngineId } from './EngineSelector';

const ENGINE_LABEL: Record<EngineId, string> = {
    duckdb: 'DuckDB',
    slothdb: 'SlothDB',
    native: 'native',
};

type Props = {
    engine: EngineId;
};

export default function RunView({ engine }: Props) {
    return (
        <div className="empty-state">
            <svg
                className="empty-icon"
                width="40"
                height="40"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
            >
                <circle cx="12" cy="12" r="9" />
                <path d="M10 8.5L16 12L10 15.5V8.5Z" fill="currentColor" stroke="none" />
            </svg>
            <div className="empty-title">Run output</div>
            <div className="empty-desc">
                Logs, per-node row counts, and the execution trace from the {ENGINE_LABEL[engine]}{' '}
                engine will stream here when a pipeline runs.
            </div>
        </div>
    );
}
