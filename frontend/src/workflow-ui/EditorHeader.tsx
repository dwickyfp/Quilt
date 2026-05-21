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
                                <span className="job-tab-icon" aria-hidden="true">
                                    ⌘
                                </span>
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
                                ×
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
                    +
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
                        <svg
                            width="11"
                            height="11"
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            aria-hidden="true"
                        >
                            <rect x="6" y="6" width="12" height="12" rx="1" />
                        </svg>
                        <span>Stop</span>
                    </button>
                ) : (
                    <button
                        type="button"
                        className="toolbar-button toolbar-run"
                        onClick={onRun}
                        title="Run pipeline (F5)"
                    >
                        <svg
                            width="11"
                            height="11"
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            aria-hidden="true"
                        >
                            <path d="M7 5v14l12-7L7 5z" />
                        </svg>
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
                    <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                    >
                        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                        <polyline points="17 21 17 13 7 13 7 21" />
                        <polyline points="7 3 7 8 15 8" />
                    </svg>
                </button>

                <button
                    type="button"
                    className="toolbar-icon-button"
                    onClick={onValidate}
                    title="Validate pipeline"
                    aria-label="Validate"
                >
                    <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                    >
                        <path d="M9 12l2 2 4-4" />
                        <circle cx="12" cy="12" r="9" />
                    </svg>
                </button>

                <button
                    type="button"
                    className="toolbar-icon-button"
                    onClick={onAutoLayout}
                    title="Auto-layout"
                    aria-label="Auto-layout"
                >
                    <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                    >
                        <rect x="3" y="3" width="7" height="7" rx="1" />
                        <rect x="14" y="3" width="7" height="7" rx="1" />
                        <rect x="3" y="14" width="7" height="7" rx="1" />
                        <rect x="14" y="14" width="7" height="7" rx="1" />
                    </svg>
                </button>
            </div>
        </div>
    );
}
