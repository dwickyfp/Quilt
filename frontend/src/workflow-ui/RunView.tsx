import { PlayCircle } from 'lucide-react';
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
            <PlayCircle size={32} strokeWidth={1.4} className="empty-icon" />
            <div className="empty-title">Run output</div>
            <div className="empty-desc">
                Logs, per-node row counts, and the execution trace from the {ENGINE_LABEL[engine]}{' '}
                engine will stream here when a pipeline runs.
            </div>
        </div>
    );
}
