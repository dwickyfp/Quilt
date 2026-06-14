import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Tooltip from './Tooltip';
import {
    CircleCheck,
    Clipboard,
    Download,
    FileCode,
    Gauge,
    LayoutGrid,
    MoreHorizontal,
    Play,
    Plus,
    Save,
    Square,
    Upload,
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
    onCopySql: () => void;
    onExportJson: () => void;
    onExportSqlFile: () => void;
    onImportJson: () => void;
    profileMode: boolean;
    onToggleProfile: () => void;
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
    onCopySql,
    onExportJson,
    onExportSqlFile,
    onImportJson,
    profileMode,
    onToggleProfile,
}: Props) {
    const { t } = useTranslation();
    const [moreOpen, setMoreOpen] = useState(false);
    const moreRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!moreOpen) return;
        const onClick = (e: MouseEvent) => {
            if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
                setMoreOpen(false);
            }
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setMoreOpen(false);
        };
        document.addEventListener('mousedown', onClick);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onClick);
            document.removeEventListener('keydown', onKey);
        };
    }, [moreOpen]);

    const fire = (fn: () => void) => () => {
        setMoreOpen(false);
        fn();
    };

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
                                        aria-label={t('header.unsavedChanges')}
                                    />
                                ) : null}
                            </button>
                            <button
                                type="button"
                                className="job-tab-close"
                                onClick={() => onCloseJob(job.id)}
                                aria-label={t('header.closeTab', { name: job.name })}
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
                    title={t('header.newPipeline')}
                    aria-label={t('header.newPipeline')}
                >
                    <Plus size={14} />
                </button>
            </div>

            <div className="toolbar">
                {isRunning ? (
                    <Tooltip label={t('header.stopTooltip')}>
                        <button
                            type="button"
                            className="toolbar-button toolbar-stop"
                            onClick={onStop}
                            aria-label={t('header.stop')}
                        >
                            <Square size={11} fill="currentColor" />
                            <span>{t('header.stop')}</span>
                        </button>
                    </Tooltip>
                ) : (
                    <Tooltip label={t('header.runTooltip')}>
                        <button
                            type="button"
                            className="toolbar-button toolbar-run"
                            onClick={onRun}
                            aria-label={t('header.run')}
                        >
                            <Play size={11} fill="currentColor" />
                            <span>{t('header.run')}</span>
                        </button>
                    </Tooltip>
                )}

                <div className="toolbar-sep" />

                <Tooltip label={t('header.saveTooltip')}>
                    <button
                        type="button"
                        className="toolbar-icon-button"
                        onClick={onSave}
                        aria-label={t('header.save')}
                    >
                        <Save size={14} />
                    </button>
                </Tooltip>

                <Tooltip label={t('header.validateTooltip')}>
                    <button
                        type="button"
                        className="toolbar-icon-button"
                        onClick={onValidate}
                        aria-label={t('header.validate')}
                    >
                        <CircleCheck size={14} />
                    </button>
                </Tooltip>

                <Tooltip label={t('header.autoLayout')}>
                    <button
                        type="button"
                        className="toolbar-icon-button"
                        onClick={onAutoLayout}
                        aria-label={t('header.autoLayout')}
                    >
                        <LayoutGrid size={14} />
                    </button>
                </Tooltip>

                <Tooltip label={t('header.profileTooltip')}>
                    <button
                        type="button"
                        className={'toolbar-icon-button' + (profileMode ? ' is-active' : '')}
                        onClick={onToggleProfile}
                        aria-label={t('header.profile')}
                        aria-pressed={profileMode}
                    >
                        <Gauge size={14} />
                    </button>
                </Tooltip>

                <div className="toolbar-more" ref={moreRef}>
                    <Tooltip label={t('header.moreTooltip')}>
                        <button
                            type="button"
                            className={
                                'toolbar-icon-button' + (moreOpen ? ' is-active' : '')
                            }
                            onClick={() => setMoreOpen(o => !o)}
                            aria-label={t('header.more')}
                            aria-expanded={moreOpen}
                        >
                            <MoreHorizontal size={14} />
                        </button>
                    </Tooltip>
                    {moreOpen ? (
                        <div className="toolbar-more-menu" role="menu">
                            <button
                                type="button"
                                role="menuitem"
                                className="toolbar-more-item"
                                onClick={fire(onCopySql)}
                            >
                                <Clipboard size={13} />
                                <div>
                                    <div>{t('header.copySql')}</div>
                                    <div className="toolbar-more-desc">
                                        {t('header.copySqlDesc')}
                                    </div>
                                </div>
                            </button>
                            <button
                                type="button"
                                role="menuitem"
                                className="toolbar-more-item"
                                onClick={fire(onExportSqlFile)}
                            >
                                <FileCode size={13} />
                                <div>
                                    <div>{t('header.exportSql')}</div>
                                    <div className="toolbar-more-desc">
                                        {t('header.exportSqlDesc')}
                                    </div>
                                </div>
                            </button>
                            <button
                                type="button"
                                role="menuitem"
                                className="toolbar-more-item"
                                onClick={fire(onExportJson)}
                            >
                                <Download size={13} />
                                <div>
                                    <div>{t('header.exportJson')}</div>
                                    <div className="toolbar-more-desc">
                                        {t('header.exportJsonDesc')}
                                    </div>
                                </div>
                            </button>
                            <button
                                type="button"
                                role="menuitem"
                                className="toolbar-more-item"
                                onClick={fire(onImportJson)}
                            >
                                <Upload size={13} />
                                <div>
                                    <div>{t('header.importJson')}</div>
                                    <div className="toolbar-more-desc">
                                        {t('header.importJsonDesc')}
                                    </div>
                                </div>
                            </button>
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    );
}
