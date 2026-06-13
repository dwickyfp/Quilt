import { useTranslation } from 'react-i18next';
import { Bug } from 'lucide-react';
import { openExternal } from '../tauri-io';

const DISCORD_INVITE = 'https://discord.gg/VbSVt7Etx';

type RuntimeState = 'connecting' | 'ready' | 'offline';

type Props = {
    runtime: RuntimeState;
    nodeCount: number;
    edgeCount: number;
    errorCount: number;
    warningCount: number;
    pipelineName?: string;
};

export default function StatusBar({
    runtime,
    nodeCount,
    edgeCount,
    errorCount,
    warningCount,
    pipelineName,
}: Props) {
    const { t } = useTranslation();
    const dotClass =
        errorCount > 0
            ? 'statusbar-dot-error'
            : warningCount > 0
              ? 'statusbar-dot-warn'
              : 'statusbar-dot-ok';
    return (
        <footer className="statusbar" role="status">
            <div className="statusbar-section">
                <span className="statusbar-label">{t('status.pipelineLabel')}</span>
                <span className="statusbar-value">{pipelineName ?? t('status.untitled')}</span>
            </div>
            <div className="statusbar-sep" />
            <div className="statusbar-section">
                <span className={'statusbar-dot ' + dotClass} aria-hidden="true" />
                <span>
                    {errorCount} {errorCount === 1 ? t('status.error') : t('status.errors')}
                </span>
                <span className="statusbar-comma">·</span>
                <span>
                    {warningCount} {warningCount === 1 ? t('status.warning') : t('status.warnings')}
                </span>
            </div>
            <div className="statusbar-sep" />
            <div className="statusbar-section">
                <span>{nodeCount} {t('status.nodes')}</span>
                <span className="statusbar-comma">·</span>
                <span>{edgeCount} {t('status.edges')}</span>
            </div>
            <div className="statusbar-spacer" />
            <div className="statusbar-section">
                <span className="statusbar-label">{t('status.engineLabel')}</span>
                <span>DuckDB</span>
            </div>
            <div className="statusbar-sep" />
            <div className="statusbar-section">
                <span className="statusbar-label">{t('status.runtimeLabel')}</span>
                <span className={'statusbar-runtime statusbar-runtime-' + runtime}>{runtime}</span>
            </div>
            <div className="statusbar-sep" />
            <button
                type="button"
                className="statusbar-support"
                title={t('status.support', { defaultValue: 'Report a bug or get help on our Discord' })}
                onClick={() => void openExternal(DISCORD_INVITE)}
            >
                <Bug size={11} aria-hidden="true" />
                {t('status.reportBug', { defaultValue: 'Report a bug' })}
            </button>
        </footer>
    );
}
