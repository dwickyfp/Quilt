import { useState } from 'react';
import Canvas from '../canvas/Canvas';
import PlanView from './PlanView';
import RunView from './RunView';
import type { EngineId } from './EngineSelector';

type TabId = 'canvas' | 'plan' | 'run';

const TABS: { id: TabId; label: string }[] = [
    { id: 'canvas', label: 'Canvas' },
    { id: 'plan', label: 'Plan' },
    { id: 'run', label: 'Run' },
];

type Props = {
    engine: EngineId;
};

export default function EditorTabs({ engine }: Props) {
    const [active, setActive] = useState<TabId>('canvas');

    return (
        <div className="editor">
            <div className="tabbar" role="tablist" aria-label="Editor views">
                {TABS.map(t => (
                    <button
                        key={t.id}
                        type="button"
                        role="tab"
                        aria-selected={active === t.id}
                        className="tab"
                        onClick={() => setActive(t.id)}
                    >
                        {t.label}
                    </button>
                ))}
            </div>
            <div className="tab-content">
                <div className={'tab-panel' + (active === 'canvas' ? ' tab-panel-active' : '')}>
                    <Canvas />
                </div>
                <div className={'tab-panel' + (active === 'plan' ? ' tab-panel-active' : '')}>
                    <PlanView engine={engine} />
                </div>
                <div className={'tab-panel' + (active === 'run' ? ' tab-panel-active' : '')}>
                    <RunView engine={engine} />
                </div>
            </div>
        </div>
    );
}
