import {
    CircleCheck,
    LayoutGrid,
    Play,
    Plus,
    Save,
    Square,
    Workflow,
    X,
} from 'lucide-react';

export type Job = {
    id: string;
    name: string;
    dirty: boolean;
};

type Props = {
    jobs: Job[];
    activeJobId: string;
    isRunning: boolean;
    onSelectJob: (id: string) => void;
    onCloseJob: (id: string) => void;
    onNewJob: () => void;
    onRun: () => void;
    onStop: () => void;
    onSave: () => void;
    onValidate: () => void;
    onAutoLayout: () => void;
};

export default function EditorHeader({
    jobs,
    activeJobId,
    isRunning,
    onSelectJob,
    onCloseJob,
    onNewJob,
    onRun,
    onStop,
    onSave,
    onValidate,
    onAutoLayout,
}: Props) {
    return (
        <div className="editor-header">
            <div className="job-tabs" role="tablist" aria-label="Open pipelines">
                {jobs.map(job => {
                    const isActive = job.id === activeJobId;
                    return (
                        <div
                            key={job.id}
                            className={'job-tab' + (isActive ? ' is-active' : '')}
                            role="tab"
                            aria-selected={isActive}
                        >
                            <button
                                type="button"
                                className="job-tab-button"
                                onClick={() => onSelectJob(job.id)}
                            >
                                <Workflow size={12} className="job-tab-icon" aria-hidden="true" />
                                <span className="job-tab-name">{job.name}</span>
                                {job.dirty ? (
                                    <span
                                        className="job-tab-dirty"
                                        aria-label="unsaved changes"
                                    />
                                ) : null}
                            </button>
                            <button
                                type="button"
                                className="job-tab-close"
                                onClick={() => onCloseJob(job.id)}
                                aria-label={'Close ' + job.name}
                            >
                                <X size={12} />
                            </button>
                        </div>
                    );
                })}
                <button
                    type="button"
                    className="job-tab-new"
                    onClick={onNewJob}
                    title="New pipeline"
                    aria-label="New pipeline"
                >
                    <Plus size={14} />
                </button>
            </div>

            <div className="toolbar">
                {isRunning ? (
                    <button
                        type="button"
                        className="toolbar-button toolbar-stop"
                        onClick={onStop}
                        title="Stop pipeline (F6)"
                    >
                        <Square size={11} fill="currentColor" />
                        <span>Stop</span>
                    </button>
                ) : (
                    <button
                        type="button"
                        className="toolbar-button toolbar-run"
                        onClick={onRun}
                        title="Run pipeline (F5)"
                    >
                        <Play size={11} fill="currentColor" />
                        <span>Run</span>
                    </button>
                )}

                <div className="toolbar-sep" />

                <button
                    type="button"
                    className="toolbar-icon-button"
                    onClick={onSave}
                    title="Save (Ctrl+S)"
                    aria-label="Save"
                >
                    <Save size={14} />
                </button>

                <button
                    type="button"
                    className="toolbar-icon-button"
                    onClick={onValidate}
                    title="Validate pipeline"
                    aria-label="Validate"
                >
                    <CircleCheck size={14} />
                </button>

                <button
                    type="button"
                    className="toolbar-icon-button"
                    onClick={onAutoLayout}
                    title="Auto-layout"
                    aria-label="Auto-layout"
                >
                    <LayoutGrid size={14} />
                </button>
            </div>
        </div>
    );
}
