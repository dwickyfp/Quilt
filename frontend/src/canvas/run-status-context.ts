import { createContext, useContext } from 'react';
import type { NodeRunStatus } from '../tauri-bridge';

export type RunStatusMap = Record<string, NodeRunStatus>;

export const RunStatusContext = createContext<RunStatusMap>({});

export function useRunStatus(nodeId: string): NodeRunStatus | undefined {
    return useContext(RunStatusContext)[nodeId];
}

/** Profiler overlay state (feature A3): heat tint + per-node metric badges. */
export type ProfileState = {
    /** When true, nodes are tinted by execution-duration heat + show a badge. */
    enabled: boolean;
    /** Max duration_ms across all nodes in the current run (heat scale max). */
    maxDuration: number;
};

export const ProfileContext = createContext<ProfileState>({
    enabled: false,
    maxDuration: 0,
});

export function useProfile(): ProfileState {
    return useContext(ProfileContext);
}
