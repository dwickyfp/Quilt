import { ListTree } from 'lucide-react';
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
            <ListTree size={32} strokeWidth={1.4} className="empty-icon" />
            <div className="empty-title">Plan preview</div>
            <div className="empty-desc">
                The logical plan {PLAN_LABEL[engine]} will appear here once a pipeline passes
                validation.
            </div>
        </div>
    );
}
