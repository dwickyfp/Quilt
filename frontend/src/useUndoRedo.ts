// Canvas undo/redo: a per-pipeline history of the full {nodes, edges} document
// (covers node add/delete/move, edge changes, and component settings edits).
//
// History is captured by watching the active pipeline and recording the
// previous settled snapshot whenever a *meaningful* change lands. "Meaningful"
// excludes pure selection changes and run-preview data (schema / sampleRows),
// so selecting a node or running the pipeline never pollutes history; a burst of
// changes (e.g. a drag) is coalesced into one step via a short debounce.
//
// Keyboard: Ctrl/Cmd+Z = undo; Ctrl/Cmd+Y or Ctrl/Cmd+Shift+Z = redo. Ctrl+R is
// also bound to redo (and always suppresses the webview reload).
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Node, Edge } from '@xyflow/react';

export type CanvasSnapshot = { nodes: Node<Record<string, unknown>>[]; edges: Edge[] };

const HISTORY_LIMIT = 50;
const DEBOUNCE_MS = 350;

/// A stable string of just the parts a user can edit, excluding selection
/// state and run-only data, so noise changes don't create history entries.
function meaningfulKey(s: CanvasSnapshot): string {
    const nodes = (s.nodes ?? []).map(n => {
        const d = (n.data ?? {}) as Record<string, unknown>;
        return {
            id: n.id,
            x: Math.round(n.position?.x ?? 0),
            y: Math.round(n.position?.y ?? 0),
            label: d.label,
            componentId: d.componentId,
            properties: d.properties,
            disabled: d.disabled,
        };
    });
    const edges = (s.edges ?? []).map(e => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle ?? null,
        targetHandle: e.targetHandle ?? null,
        data: e.data,
    }));
    return JSON.stringify({ nodes, edges });
}

type Stack = { past: CanvasSnapshot[]; future: CanvasSnapshot[] };

export function useUndoRedo(
    activeJobId: string,
    activePipeline: CanvasSnapshot,
    apply: (snapshot: CanvasSnapshot) => void,
) {
    const stacks = useRef<Record<string, Stack>>({});
    // Last *recorded* snapshot per job (the baseline the next change is diffed
    // against and what we push to `past`).
    const baseline = useRef<Record<string, CanvasSnapshot>>({});
    const latest = useRef<CanvasSnapshot>(activePipeline);
    const suppress = useRef(false); // true while applying an undo/redo
    const currentJob = useRef(activeJobId);
    const [, force] = useState(0);
    const rerender = useCallback(() => force(v => v + 1), []);

    const stackFor = (job: string): Stack => {
        if (!stacks.current[job]) stacks.current[job] = { past: [], future: [] };
        return stacks.current[job];
    };

    // Record history on meaningful changes (debounced).
    useEffect(() => {
        latest.current = activePipeline;
        const job = activeJobId;

        // Pipeline switched: re-baseline, never record across pipelines.
        if (currentJob.current !== job) {
            currentJob.current = job;
            baseline.current[job] = activePipeline;
            stackFor(job);
            rerender();
            return;
        }
        // This change came from our own undo/redo apply: re-baseline, skip.
        if (suppress.current) {
            suppress.current = false;
            baseline.current[job] = activePipeline;
            rerender();
            return;
        }
        const base = baseline.current[job];
        if (base === undefined) {
            baseline.current[job] = activePipeline;
            return;
        }
        if (meaningfulKey(base) === meaningfulKey(activePipeline)) {
            return; // selection / run-preview only -> not undoable
        }
        const prev = base;
        const settled = activePipeline;
        const timer = setTimeout(() => {
            const st = stackFor(job);
            st.past.push(prev);
            if (st.past.length > HISTORY_LIMIT) st.past.shift();
            st.future = [];
            baseline.current[job] = settled;
            rerender();
        }, DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [activePipeline, activeJobId, rerender]);

    const undo = useCallback(() => {
        const job = currentJob.current;
        const st = stackFor(job);
        if (!st.past.length) return;
        const restore = st.past.pop()!;
        st.future.push(latest.current);
        suppress.current = true;
        baseline.current[job] = restore;
        apply(restore);
        rerender();
    }, [apply, rerender]);

    const redo = useCallback(() => {
        const job = currentJob.current;
        const st = stackFor(job);
        if (!st.future.length) return;
        const restore = st.future.pop()!;
        st.past.push(latest.current);
        suppress.current = true;
        baseline.current[job] = restore;
        apply(restore);
        rerender();
    }, [apply, rerender]);

    // Keyboard shortcuts.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (!(e.ctrlKey || e.metaKey)) return;
            const k = e.key.toLowerCase();
            // Ctrl+R: redo + always kill the webview reload.
            if (k === 'r') {
                e.preventDefault();
                redo();
                return;
            }
            // Don't hijack Ctrl+Z/Y while editing text - let the field's own
            // undo work.
            const el = document.activeElement as HTMLElement | null;
            const typing =
                !!el &&
                (el.tagName === 'INPUT' ||
                    el.tagName === 'TEXTAREA' ||
                    el.tagName === 'SELECT' ||
                    el.isContentEditable);
            if (typing) return;
            if (k === 'z' && !e.shiftKey) {
                e.preventDefault();
                undo();
            } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
                e.preventDefault();
                redo();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [undo, redo]);

    const job = currentJob.current;
    const st = stacks.current[job];
    return {
        undo,
        redo,
        canUndo: !!st && st.past.length > 0,
        canRedo: !!st && st.future.length > 0,
    };
}
