import type { EngineId } from './EngineSelector';

const PLAN_LABEL: Record<EngineId, string> = {
    duckdb: 'and the DuckDB SQL it lowers to',
    slothdb: 'and the SlothDB query plan',
    native: 'and the native operator graph',
};

type Props = {
    engine: EngineId;
};

export default function PlanView({ engine }: Props) {
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
                <rect x="3" y="4" width="18" height="4" rx="1" />
                <rect x="3" y="10" width="12" height="4" rx="1" />
                <rect x="3" y="16" width="15" height="4" rx="1" />
            </svg>
            <div className="empty-title">Plan preview</div>
            <div className="empty-desc">
                The logical plan {PLAN_LABEL[engine]} will appear here once a pipeline passes
                validation.
            </div>
        </div>
    );
}
