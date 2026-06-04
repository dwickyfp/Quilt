import { useContext, useMemo } from 'react';
import { Workflow } from 'lucide-react';
import type { Field } from './types';
import { FieldContext } from './FieldContext';

type Props = {
    field: Field;
    value: string | undefined;
    onChange: (v: string) => void;
};

// Picker for a workspace pipeline (Run Job's child pipeline). Stores the
// pipeline's repo id, which run-resolve.ts maps to the on-disk pipeline
// file before the engine reads it - keeping the saved reference portable
// across machines and workspace moves. A value that isn't a known pipeline
// id (e.g. a hand-typed path from before this picker existed) is preserved
// as an extra option so older configs keep working.
export function PipelineRefField({ value, onChange }: Props) {
    const { repoItems } = useContext(FieldContext);

    const pipelines = useMemo(
        () => repoItems.filter(i => i.type === 'pipeline'),
        [repoItems],
    );

    if (pipelines.length === 0) {
        return (
            <div className="field-ref-empty">
                <Workflow size={12} />
                <span>
                    No pipelines in this workspace yet. Create one in the{' '}
                    <b>Pipelines</b> folder.
                </span>
            </div>
        );
    }

    const known = pipelines.some(p => p.id === value);
    const isLegacyPath = !!value && !known;

    return (
        <select
            className="field-input field-select"
            value={value ?? ''}
            onChange={e => onChange(e.target.value)}
        >
            <option value="">- pick a pipeline -</option>
            {pipelines.map(p => (
                <option key={p.id} value={p.id}>
                    {p.name}
                </option>
            ))}
            {isLegacyPath ? <option value={value}>{value}</option> : null}
        </select>
    );
}
