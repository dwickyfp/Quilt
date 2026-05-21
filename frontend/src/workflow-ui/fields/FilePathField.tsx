import { useState } from 'react';
import type { Field } from './types';
import { isTauri, tauriOpenFile, tauriSavePath } from '../../tauri-dialog';
import FileBrowserModal from './FileBrowserModal';

type Props = {
    field: Field;
    value: string | undefined;
    onChange: (v: string) => void;
    mode: 'open' | 'save';
};

export function FilePathField({ field, value, onChange, mode }: Props) {
    const [picking, setPicking] = useState(false);
    const [modalOpen, setModalOpen] = useState(false);
    const tauri = isTauri();

    const handleBrowse = async () => {
        if (tauri) {
            setPicking(true);
            try {
                const path =
                    mode === 'open'
                        ? await tauriOpenFile({ filters: field.filters, title: field.label })
                        : await tauriSavePath({
                              filters: field.filters,
                              defaultPath: value,
                              title: field.label,
                          });
                if (path) onChange(path);
            } finally {
                setPicking(false);
            }
        } else {
            setModalOpen(true);
        }
    };

    return (
        <div className="field-path">
            <input
                type="text"
                className="field-input"
                value={value ?? ''}
                placeholder={field.placeholder ?? (mode === 'open' ? 'Path to file' : 'Output path')}
                onChange={e => onChange(e.target.value)}
                spellCheck={false}
            />
            <button
                type="button"
                className="field-path-browse"
                onClick={handleBrowse}
                disabled={picking}
                title={tauri ? 'Native OS dialog' : 'In-app file dialog (browser mode)'}
            >
                {picking ? '…' : mode === 'save' ? 'Save as…' : 'Browse…'}
            </button>

            <FileBrowserModal
                open={modalOpen}
                mode={mode}
                title={(mode === 'save' ? 'Save ' : 'Choose ') + field.label}
                initialPath={value}
                filters={field.filters}
                onConfirm={path => {
                    setModalOpen(false);
                    onChange(path);
                }}
                onCancel={() => setModalOpen(false)}
            />
        </div>
    );
}
