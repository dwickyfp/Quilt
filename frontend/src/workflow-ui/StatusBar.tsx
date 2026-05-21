import type { EngineId } from './EngineSelector';

const ENGINE_LABEL: Record<EngineId, string> = {
    duckdb: 'DuckDB',
    slothdb: 'SlothDB',
    native: 'Native',
};

type RuntimeState = 'connecting' | 'ready' | 'offline';

type Props = {
    engine: EngineId;
    runtime: RuntimeState;
    nodeCount: number;
    edgeCount: number;
    pipelineName?: string;
};

export default function StatusBar({
    engine,
    runtime,
    nodeCount,
    edgeCount,
    pipelineName,
}: Props) {
    return (
        <footer className="statusbar" role="status">
            <div className="statusbar-section">
                <span className="statusbar-label">Pipeline:</span>
                <span className="statusbar-value">{pipelineName ?? 'untitled-1'}</span>
            </div>
            <div className="statusbar-sep" />
            <div className="statusbar-section">
                <span className="statusbar-dot statusbar-dot-ok" aria-hidden="true" />
                <span>0 errors</span>
                <span className="statusbar-comma">·</span>
                <span>0 warnings</span>
            </div>
            <div className="statusbar-sep" />
            <div className="statusbar-section">
                <span>{nodeCount} nodes</span>
                <span className="statusbar-comma">·</span>
                <span>{edgeCount} edges</span>
            </div>
            <div className="statusbar-spacer" />
            <div className="statusbar-section">
                <span className="statusbar-label">Engine:</span>
                <span>{ENGINE_LABEL[engine]}</span>
            </div>
            <div className="statusbar-sep" />
            <div className="statusbar-section">
                <span className="statusbar-label">Runtime:</span>
                <span className={'statusbar-runtime statusbar-runtime-' + runtime}>{runtime}</span>
            </div>
        </footer>
    );
}
