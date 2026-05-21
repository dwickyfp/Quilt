import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { DuckleNodeData } from '../../pipeline-types';

type TransformNodeType = Node<DuckleNodeData, 'transform'>;

export default function TransformNode({ data, selected }: NodeProps<TransformNodeType>) {
    const classes =
        'node node-transform' +
        (selected ? ' is-selected' : '') +
        (data.disabled ? ' is-disabled' : '');
    return (
        <div className={classes}>
            <div className="node-kind">transform</div>
            <div className="node-label">{data.label}</div>
            {data.subtitle ? <div className="node-subtitle">{data.subtitle}</div> : null}
            {data.disabled ? <div className="node-disabled-badge">disabled</div> : null}
            <Handle type="target" position={Position.Left} />
            <Handle type="source" position={Position.Right} />
        </div>
    );
}
