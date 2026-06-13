// Column-origin lineage panel: for the selected node, show where each output
// column came from by tracing it back through the pipeline to its source. Thin
// React shell over the DOM-free pure core in lineage.ts (which is unit-tested);
// this component only adapts the canvas node/edge shapes and renders.

import { useMemo } from 'react';
import type { Node, Edge } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import type { QuiltNodeData } from '../pipeline-types';
import {
    buildLineage,
    traceColumn,
    type LineageNodeInput,
    type LineageEdgeInput,
} from './lineage';

type Props = {
    selected: Node<QuiltNodeData> | null;
    allNodes: Node<QuiltNodeData>[];
    edges: Edge[];
    columns: { name: string }[];
};

function toLineageNodes(nodes: Node<QuiltNodeData>[]): LineageNodeInput[] {
    return nodes.map(n => ({
        id: n.id,
        data: {
            componentId: n.data.componentId,
            properties: n.data.properties,
            schema: (n.data.schema ?? []).map(c => ({ name: c.name })),
        },
    }));
}

function toLineageEdges(edges: Edge[]): LineageEdgeInput[] {
    return edges.map(e => ({
        id: e.id,
        source: e.source,
        target: e.target,
        // Canvas edges carry the connection kind on edge.data.connectionType;
        // the lookup port is also identifiable via targetHandle.
        connectionType: (e.data as { connectionType?: string } | undefined)?.connectionType,
        targetHandle: e.targetHandle ?? undefined,
    }));
}

export default function LineagePanel({ selected, allNodes, edges, columns }: Props) {
    const { t } = useTranslation();

    const lineage = useMemo(
        () => buildLineage(toLineageNodes(allNodes), toLineageEdges(edges)),
        [allNodes, edges],
    );

    const nameById = useMemo(() => {
        const m = new Map<string, string>();
        for (const n of allNodes) m.set(n.id, n.data.label || n.data.componentId || n.id);
        return m;
    }, [allNodes]);

    if (!selected || columns.length === 0) {
        return <div className="lineage-empty">{t('lineage.empty', 'No columns to trace yet.')}</div>;
    }

    return (
        <div className="lineage-panel">
            <div className="lineage-hint">
                {t('lineage.hint', 'Where each output column originates, traced back through the pipeline.')}
            </div>
            <ul className="lineage-list">
                {columns.map(col => {
                    const path = traceColumn(lineage, selected.id, col.name);
                    // path[0] is the selected node/column; the rest is the trail
                    // back to the source. The final entry is the ultimate origin.
                    const origin = path[path.length - 1];
                    const sameAsSelf = origin.nodeId === selected.id && origin.column === col.name;
                    return (
                        <li key={col.name} className="lineage-row">
                            <span className="lineage-col">{col.name}</span>
                            {sameAsSelf ? (
                                <span className="lineage-origin lineage-origin-self">
                                    {t('lineage.createdHere', 'created here')}
                                </span>
                            ) : (
                                <span className="lineage-origin">
                                    {'\u2190'} {nameById.get(origin.nodeId) ?? origin.nodeId}
                                    {origin.column !== col.name ? `.${origin.column}` : ''}
                                    {path.length > 2 ? (
                                        <span className="lineage-hops">
                                            {' '}
                                            ({path.length - 1} {t('lineage.hops', 'hops')})
                                        </span>
                                    ) : null}
                                </span>
                            )}
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
