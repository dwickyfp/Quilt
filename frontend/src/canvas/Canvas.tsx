import { useCallback } from 'react';
import {
    ReactFlow,
    ReactFlowProvider,
    Background,
    Controls,
    MiniMap,
    useReactFlow,
    type Connection,
    type Edge,
    type EdgeChange,
    type Node,
    type NodeChange,
    type OnSelectionChangeParams,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import SourceNode from './nodes/SourceNode';
import TransformNode from './nodes/TransformNode';
import SinkNode from './nodes/SinkNode';
import type { DuckleNodeData } from '../pipeline-types';
import type { ComponentDef } from '../workflow-ui/palette-data';
import { useContextMenu, type MenuItem } from '../workflow-ui/ContextMenu';

const nodeTypes = {
    source: SourceNode,
    transform: TransformNode,
    sink: SinkNode,
};

const DELETE_KEYS = ['Delete', 'Backspace'];

export type DropPosition = { x: number; y: number };

export type NodeAction =
    | 'rename'
    | 'duplicate'
    | 'toggle-disable'
    | 'autodetect'
    | 'run-from-here'
    | 'copy-id'
    | 'delete';

export type PaneAction = 'paste' | 'select-all' | 'auto-layout' | 'fit-view';

type Props = {
    nodes: Node<DuckleNodeData>[];
    edges: Edge[];
    onNodesChange: (changes: NodeChange[]) => void;
    onEdgesChange: (changes: EdgeChange[]) => void;
    onConnect: (connection: Connection) => void;
    onSelectionChange: (params: OnSelectionChangeParams) => void;
    onDropComponent: (component: ComponentDef, position: DropPosition) => void;
    onNodeAction: (action: NodeAction, nodeId: string) => void;
    onPaneAction: (action: PaneAction) => void;
    nodeAutodetectAvailable: (nodeId: string) => boolean;
};

function CanvasInner({
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    onSelectionChange,
    onDropComponent,
    onNodeAction,
    onPaneAction,
    nodeAutodetectAvailable,
}: Props) {
    const { screenToFlowPosition } = useReactFlow();
    const menu = useContextMenu();

    const handleDragOver = useCallback((e: React.DragEvent) => {
        if (e.dataTransfer.types.includes('application/duckle-component')) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
        }
    }, []);

    const handleDrop = useCallback(
        (e: React.DragEvent) => {
            e.preventDefault();
            const raw = e.dataTransfer.getData('application/duckle-component');
            if (!raw) return;
            try {
                const component = JSON.parse(raw) as ComponentDef;
                const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
                onDropComponent(component, position);
            } catch (err) {
                console.error('Failed to parse dropped component', err);
            }
        },
        [onDropComponent, screenToFlowPosition],
    );

    const handleNodeContextMenu = useCallback(
        (e: React.MouseEvent, node: Node<DuckleNodeData>) => {
            const isDisabled = node.data.disabled === true;
            const autodetect = nodeAutodetectAvailable(node.id);
            const items: MenuItem[] = [
                {
                    kind: 'header',
                    key: 'header',
                    label: node.data.label + '  #' + node.id.slice(0, 6),
                },
                {
                    kind: 'item',
                    key: 'rename',
                    label: 'Rename',
                    icon: '✎',
                    shortcut: 'F2',
                    onClick: () => onNodeAction('rename', node.id),
                },
                {
                    kind: 'item',
                    key: 'duplicate',
                    label: 'Duplicate',
                    icon: '⎘',
                    shortcut: 'Ctrl+D',
                    onClick: () => onNodeAction('duplicate', node.id),
                },
                {
                    kind: 'item',
                    key: 'toggle-disable',
                    label: isDisabled ? 'Enable' : 'Disable',
                    icon: isDisabled ? '◉' : '◯',
                    onClick: () => onNodeAction('toggle-disable', node.id),
                },
                { kind: 'separator', key: 's1' },
                {
                    kind: 'item',
                    key: 'run',
                    label: 'Run from here',
                    icon: '▶',
                    onClick: () => onNodeAction('run-from-here', node.id),
                    disabled: isDisabled,
                },
                {
                    kind: 'item',
                    key: 'autodetect',
                    label: 'Auto-detect schema',
                    icon: '⟲',
                    onClick: () => onNodeAction('autodetect', node.id),
                    disabled: !autodetect,
                },
                { kind: 'separator', key: 's2' },
                {
                    kind: 'item',
                    key: 'copy-id',
                    label: 'Copy ID',
                    icon: '⎘',
                    onClick: () => onNodeAction('copy-id', node.id),
                },
                {
                    kind: 'item',
                    key: 'delete',
                    label: 'Delete',
                    icon: '✕',
                    shortcut: 'Del',
                    onClick: () => onNodeAction('delete', node.id),
                    danger: true,
                },
            ];
            menu.open(e, items);
        },
        [menu, onNodeAction, nodeAutodetectAvailable],
    );

    const handlePaneContextMenu = useCallback(
        (e: React.MouseEvent | MouseEvent) => {
            const items: MenuItem[] = [
                { kind: 'header', key: 'header', label: 'Canvas' },
                {
                    kind: 'item',
                    key: 'fit',
                    label: 'Fit to view',
                    icon: '⤧',
                    shortcut: 'Ctrl+0',
                    onClick: () => onPaneAction('fit-view'),
                },
                {
                    kind: 'item',
                    key: 'layout',
                    label: 'Auto-layout',
                    icon: '⊞',
                    onClick: () => onPaneAction('auto-layout'),
                },
                { kind: 'separator', key: 's1' },
                {
                    kind: 'item',
                    key: 'select-all',
                    label: 'Select all',
                    icon: '⌘',
                    shortcut: 'Ctrl+A',
                    onClick: () => onPaneAction('select-all'),
                },
                {
                    kind: 'item',
                    key: 'paste',
                    label: 'Paste',
                    icon: '⎘',
                    shortcut: 'Ctrl+V',
                    onClick: () => onPaneAction('paste'),
                    disabled: true,
                },
            ];
            menu.open(e, items);
        },
        [menu, onPaneAction],
    );

    return (
        <div className="canvas-dnd" onDragOver={handleDragOver} onDrop={handleDrop}>
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onSelectionChange={onSelectionChange}
                onNodeContextMenu={handleNodeContextMenu}
                onPaneContextMenu={handlePaneContextMenu}
                nodeTypes={nodeTypes}
                deleteKeyCode={DELETE_KEYS}
                fitView
                colorMode="dark"
            >
                <Background gap={16} />
                <MiniMap pannable zoomable />
                <Controls />
            </ReactFlow>
            {menu.element}
        </div>
    );
}

export default function Canvas(props: Props) {
    return (
        <ReactFlowProvider>
            <CanvasInner {...props} />
        </ReactFlowProvider>
    );
}
