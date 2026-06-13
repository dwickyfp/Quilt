import { describe, it, expect } from 'vitest';
import {
    extractComponent,
    instantiateComponent,
    type CompNode,
    type CompEdge,
} from './component-def';

const n = (id: string, componentId: string, properties: Record<string, unknown> = {}): CompNode => ({
    id,
    data: { componentId, properties },
});
const e = (source: string, target: string, targetHandle?: string): CompEdge => ({
    id: `${source}->${target}`,
    source,
    target,
    targetHandle,
});

describe('extractComponent', () => {
    it('derives input ports from edges entering the selection from outside', () => {
        // ext -> a -> b ; selection = {a, b}. The ext->a edge is an inbound boundary.
        const nodes = [n('ext', 'src.csv'), n('a', 'xf.filter'), n('b', 'xf.sort')];
        const edges = [e('ext', 'a'), e('a', 'b')];
        const def = extractComponent(nodes, edges, ['a', 'b']);
        expect(def.inputs).toEqual([{ node: 'a', handle: undefined }]);
        // internal edge a->b is preserved
        expect(def.edges).toEqual([{ id: 'a->b', source: 'a', target: 'b', targetHandle: undefined }]);
    });

    it('derives output ports from edges leaving the selection to outside', () => {
        // a -> b -> ext ; selection = {a, b}. b->ext is an outbound boundary.
        const nodes = [n('a', 'xf.filter'), n('b', 'xf.sort'), n('ext', 'snk.csv')];
        const edges = [e('a', 'b'), e('b', 'ext')];
        const def = extractComponent(nodes, edges, ['a', 'b']);
        expect(def.outputs).toEqual([{ node: 'b' }]);
    });

    it('only includes selected nodes in the component body', () => {
        const nodes = [n('a', 'xf.filter'), n('b', 'xf.sort'), n('ext', 'snk.csv')];
        const edges = [e('a', 'b'), e('b', 'ext')];
        const def = extractComponent(nodes, edges, ['a', 'b']);
        expect(def.nodes.map(x => x.id).sort()).toEqual(['a', 'b']);
    });
});

describe('instantiateComponent', () => {
    const def = {
        nodes: [n('a', 'xf.filter', { expr: '${minAmount}' }), n('b', 'xf.sort')],
        edges: [{ id: 'a->b', source: 'a', target: 'b', targetHandle: undefined }],
        inputs: [{ node: 'a', handle: undefined as string | undefined }],
        outputs: [{ node: 'b' }],
        params: [{ key: 'minAmount', node: 'a', prop: 'expr' }],
    };

    it('namespaces node ids with the instance prefix to avoid collisions', () => {
        const inst = instantiateComponent(def, 'c1', {});
        expect(inst.nodes.map(x => x.id).sort()).toEqual(['c1__a', 'c1__b']);
        // internal edge is rewired to the namespaced ids
        expect(inst.edges).toEqual([
            { id: 'c1__a->b', source: 'c1__a', target: 'c1__b', targetHandle: undefined },
        ]);
    });

    it('substitutes params into the targeted inner node prop', () => {
        const inst = instantiateComponent(def, 'c1', { minAmount: '100' });
        const a = inst.nodes.find(x => x.id === 'c1__a');
        expect(a?.data.properties?.expr).toBe('100');
    });

    it('maps boundary ports to the namespaced inner nodes', () => {
        const inst = instantiateComponent(def, 'c1', {});
        expect(inst.inputs).toEqual([{ node: 'c1__a', handle: undefined }]);
        expect(inst.outputs).toEqual([{ node: 'c1__b' }]);
    });

    it('round-trips: extract then instantiate preserves internal topology', () => {
        const nodes = [n('ext', 'src.csv'), n('a', 'xf.filter'), n('b', 'xf.sort'), n('out', 'snk.csv')];
        const edges = [e('ext', 'a'), e('a', 'b'), e('b', 'out')];
        const extracted = extractComponent(nodes, edges, ['a', 'b']);
        const inst = instantiateComponent(extracted, 'x', {});
        // one internal edge, rewired under the x__ namespace
        expect(inst.edges).toEqual([
            { id: 'x__a->b', source: 'x__a', target: 'x__b', targetHandle: undefined },
        ]);
    });
});
