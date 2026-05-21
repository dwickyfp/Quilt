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

const nodeTypes = {
    source: SourceNode,
    transform: TransformNode,
    sink: SinkNode,
};

const DELETE_KEYS = ['Delete', 'Backspace'];

export type DropPosition = { x: number; y: number };

type Props = {
    nodes: Node<DuckleNodeData>[];
    edges: Edge[];
    onNodesChange: (changes: NodeChange[]) => void;
    onEdgesChange: (changes: EdgeChange[]) => void;
    onConnect: (connection: Connection) => void;
    onSelectionChange: (params: OnSelectionChangeParams) => void;
    onDropComponent: (component: ComponentDef, position: DropPosition) => void;
};

function CanvasInner({
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    onSelectionChange,
    onDropComponent,
}: Props) {
    const { screenToFlowPosition } = useReactFlow();

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

    return (
        <div className="canvas-dnd" onDragOver={handleDragOver} onDrop={handleDrop}>
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onSelectionChange={onSelectionChange}
                nodeTypes={nodeTypes}
                deleteKeyCode={DELETE_KEYS}
                fitView
                colorMode="dark"
            >
                <Background gap={16} />
                <MiniMap pannable zoomable />
                <Controls />
            </ReactFlow>
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
