import { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
    addEdge,
    applyEdgeChanges,
    applyNodeChanges,
    type Connection,
    type Edge,
    type EdgeChange,
    type Node,
    type NodeChange,
    type OnSelectionChangeParams,
} from '@xyflow/react';
import EditorTabs from './workflow-ui/EditorTabs';
import EditorHeader, { type Job } from './workflow-ui/EditorHeader';
import EngineSelector, { type EngineId } from './workflow-ui/EngineSelector';
import Palette from './workflow-ui/Palette';
import PropertiesPanel from './workflow-ui/PropertiesPanel';
import BottomPanel from './workflow-ui/BottomPanel';
import StatusBar from './workflow-ui/StatusBar';
import type { ComponentDef, NodeKind as PaletteKind } from './workflow-ui/palette-data';
import { getDefaults, getManifest } from './workflow-ui/fields/component-manifests';
import type { DuckleNodeData } from './pipeline-types';
import type { DropPosition, NodeAction, PaneAction } from './canvas/Canvas';

type RuntimeState = 'connecting' | 'ready' | 'offline';

const INITIAL_NODES: Node<DuckleNodeData>[] = [
    {
        id: 's1',
        type: 'source',
        position: { x: 60, y: 140 },
        data: {
            label: 'CSV',
            subtitle: 'orders.csv',
            componentId: 'src.csv',
            schema: [
                { name: 'order_id', type: 'int64', nullable: false, primaryKey: true },
                { name: 'customer_id', type: 'int64', nullable: false },
                { name: 'status', type: 'string', nullable: false },
                { name: 'amount', type: 'decimal', nullable: true },
                { name: 'created_at', type: 'timestamp', nullable: false },
            ],
        },
    },
    {
        id: 't1',
        type: 'transform',
        position: { x: 340, y: 140 },
        data: {
            label: 'Filter',
            subtitle: 'status = "paid"',
            componentId: 'xf.filter',
        },
    },
    {
        id: 'k1',
        type: 'sink',
        position: { x: 620, y: 140 },
        data: {
            label: 'Parquet',
            subtitle: 'orders_paid.parquet',
            componentId: 'snk.parquet',
        },
    },
];

const INITIAL_EDGES: Edge[] = [
    { id: 'e1', source: 's1', target: 't1' },
    { id: 'e2', source: 't1', target: 'k1' },
];

const INITIAL_JOBS: Job[] = [{ id: 'j1', name: 'orders_etl', dirty: false }];

function paletteKindToFlowType(kind: PaletteKind): string {
    switch (kind) {
        case 'source':
            return 'source';
        case 'sink':
            return 'sink';
        case 'transform':
        case 'control':
        case 'quality':
        case 'custom':
            return 'transform';
    }
}

export default function App() {
    const [runtime, setRuntime] = useState<RuntimeState>('connecting');
    const [engine, setEngine] = useState<EngineId>('duckdb');
    const [nodes, setNodes] = useState<Node<DuckleNodeData>[]>(INITIAL_NODES);
    const [edges, setEdges] = useState<Edge[]>(INITIAL_EDGES);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [jobs, setJobs] = useState<Job[]>(INITIAL_JOBS);
    const [activeJobId, setActiveJobId] = useState<string>('j1');
    const [isRunning, setIsRunning] = useState<boolean>(false);
    const [renameRequest, setRenameRequest] = useState<number>(0);

    useEffect(() => {
        let cancelled = false;
        invoke<string>('ping')
            .then(reply => {
                if (!cancelled) setRuntime(reply === 'pong' ? 'ready' : 'offline');
            })
            .catch(() => {
                if (!cancelled) setRuntime('offline');
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const handleNodesChange = useCallback((changes: NodeChange[]) => {
        setNodes(ns => applyNodeChanges(changes, ns) as Node<DuckleNodeData>[]);
    }, []);

    const handleEdgesChange = useCallback((changes: EdgeChange[]) => {
        setEdges(es => applyEdgeChanges(changes, es));
    }, []);

    const handleConnect = useCallback((connection: Connection) => {
        setEdges(es => addEdge(connection, es));
    }, []);

    const handleSelectionChange = useCallback((params: OnSelectionChangeParams) => {
        setSelectedId(params.nodes[0]?.id ?? null);
    }, []);

    const handleUpdateNode = useCallback((id: string, patch: Partial<DuckleNodeData>) => {
        setNodes(ns =>
            ns.map(n => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)),
        );
    }, []);

    const selectedNode = useMemo(
        () => nodes.find(n => n.id === selectedId) ?? null,
        [nodes, selectedId],
    );

    const handleNewJob = useCallback(() => {
        const id = 'j' + (jobs.length + 1);
        setJobs(js => [...js, { id, name: 'untitled-' + (js.length + 1), dirty: false }]);
        setActiveJobId(id);
    }, [jobs.length]);

    const handleCloseJob = useCallback(
        (id: string) => {
            setJobs(js => js.filter(j => j.id !== id));
            if (activeJobId === id) {
                setActiveJobId(jobs[0]?.id ?? '');
            }
        },
        [activeJobId, jobs],
    );

    const handleRun = useCallback(() => {
        setIsRunning(true);
        // Real execution wires up in Option C.
        setTimeout(() => setIsRunning(false), 2000);
    }, []);

    const handleStop = useCallback(() => setIsRunning(false), []);

    const handleSave = useCallback(() => {
        setJobs(js => js.map(j => (j.id === activeJobId ? { ...j, dirty: false } : j)));
    }, [activeJobId]);

    const handleValidate = useCallback(() => {
        // Real validation lands in Option B.
    }, []);

    const handleAutoLayout = useCallback(() => {
        // Real layout solver lands later; basic horizontal stack for now.
        setNodes(ns =>
            ns.map((n, i) => ({
                ...n,
                position: { x: 60 + i * 280, y: 140 },
            })),
        );
    }, []);

    const handleDropComponent = useCallback(
        (component: ComponentDef, position: DropPosition) => {
            const id = 'n_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
            const manifest = getManifest(component.id);
            const flowType = paletteKindToFlowType(component.kind);
            const newNode: Node<DuckleNodeData> = {
                id,
                type: flowType,
                position,
                data: {
                    label: component.label,
                    subtitle: component.summary,
                    componentId: component.id,
                    properties: manifest ? getDefaults(manifest) : {},
                },
            };
            setNodes(ns => [...ns, newNode]);
            setSelectedId(id);
            setJobs(js => js.map(j => (j.id === activeJobId ? { ...j, dirty: true } : j)));
        },
        [activeJobId],
    );

    const markDirty = useCallback(() => {
        setJobs(js => js.map(j => (j.id === activeJobId ? { ...j, dirty: true } : j)));
    }, [activeJobId]);

    const nodeAutodetectAvailable = useCallback(
        (nodeId: string) => {
            const node = nodes.find(n => n.id === nodeId);
            if (!node) return false;
            const manifest = getManifest(node.data.componentId);
            return Boolean(manifest?.autodetect);
        },
        [nodes],
    );

    const handleNodeAction = useCallback(
        (action: NodeAction, nodeId: string) => {
            const node = nodes.find(n => n.id === nodeId);
            if (!node) return;

            switch (action) {
                case 'rename':
                    setSelectedId(nodeId);
                    setRenameRequest(n => n + 1);
                    break;

                case 'duplicate': {
                    const dupId =
                        'n_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
                    const copy: Node<DuckleNodeData> = {
                        ...node,
                        id: dupId,
                        position: { x: node.position.x + 40, y: node.position.y + 40 },
                        data: { ...node.data, label: node.data.label + ' (copy)' },
                        selected: false,
                    };
                    setNodes(ns => [...ns, copy]);
                    setSelectedId(dupId);
                    markDirty();
                    break;
                }

                case 'toggle-disable':
                    setNodes(ns =>
                        ns.map(n =>
                            n.id === nodeId
                                ? {
                                      ...n,
                                      data: { ...n.data, disabled: !n.data.disabled },
                                  }
                                : n,
                        ),
                    );
                    markDirty();
                    break;

                case 'autodetect': {
                    const manifest = getManifest(node.data.componentId);
                    if (!manifest?.autodetect) return;
                    void manifest.autodetect().then(result => {
                        setNodes(ns =>
                            ns.map(n =>
                                n.id === nodeId
                                    ? {
                                          ...n,
                                          data: {
                                              ...n.data,
                                              schema: result.columns,
                                              sampleRows: result.sampleRows,
                                          },
                                      }
                                    : n,
                            ),
                        );
                        markDirty();
                    });
                    break;
                }

                case 'run-from-here':
                    // Real partial-graph execution lands with the runtime.
                    break;

                case 'copy-id':
                    void navigator.clipboard?.writeText(nodeId);
                    break;

                case 'delete':
                    setNodes(ns => ns.filter(n => n.id !== nodeId));
                    setEdges(es => es.filter(e => e.source !== nodeId && e.target !== nodeId));
                    if (selectedId === nodeId) setSelectedId(null);
                    markDirty();
                    break;
            }
        },
        [nodes, selectedId, markDirty],
    );

    const handlePaneAction = useCallback(
        (action: PaneAction) => {
            switch (action) {
                case 'auto-layout':
                    handleAutoLayout();
                    break;
                case 'select-all':
                    setNodes(ns => ns.map(n => ({ ...n, selected: true })));
                    break;
                case 'paste':
                    break;
            }
        },
        [handleAutoLayout],
    );

    return (
        <div className="app">
            <header className="topbar">
                <div className="brand">
                    <span className="brand-mark">◇</span> Duckle
                </div>
                <div className="topbar-sep" aria-hidden="true" />
                <EngineSelector value={engine} onChange={setEngine} />
                <div className="topbar-spacer" />
                <div className="status" data-state={runtime}>
                    <span className="status-dot" /> runtime: {runtime}
                </div>
            </header>

            <main className="workspace">
                <Palette />
                <section className="canvas-shell">
                    <EditorHeader
                        jobs={jobs}
                        activeJobId={activeJobId}
                        isRunning={isRunning}
                        onSelectJob={setActiveJobId}
                        onCloseJob={handleCloseJob}
                        onNewJob={handleNewJob}
                        onRun={handleRun}
                        onStop={handleStop}
                        onSave={handleSave}
                        onValidate={handleValidate}
                        onAutoLayout={handleAutoLayout}
                    />
                    <EditorTabs
                        engine={engine}
                        nodes={nodes}
                        edges={edges}
                        onNodesChange={handleNodesChange}
                        onEdgesChange={handleEdgesChange}
                        onConnect={handleConnect}
                        onSelectionChange={handleSelectionChange}
                        onDropComponent={handleDropComponent}
                        onNodeAction={handleNodeAction}
                        onPaneAction={handlePaneAction}
                        nodeAutodetectAvailable={nodeAutodetectAvailable}
                    />
                </section>
                <PropertiesPanel
                    selected={selectedNode}
                    allNodes={nodes}
                    edges={edges}
                    onUpdate={handleUpdateNode}
                    focusNameRequest={renameRequest}
                />
            </main>

            <BottomPanel />

            <StatusBar
                engine={engine}
                runtime={runtime}
                nodeCount={nodes.length}
                edgeCount={edges.length}
            />
        </div>
    );
}
