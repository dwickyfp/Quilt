import { describe, it, expect } from 'vitest';
import { reconcilePipelineItems, folderNameFromPath } from './workspace';

const baseRepo = (): Array<Record<string, unknown>> => [
    { id: 'root', name: 'Quilt Project', type: 'project' },
    { id: 'pipelines', name: 'Pipelines', type: 'folder', parentId: 'root' },
    { id: 'j1', name: 'orders_etl', type: 'pipeline', parentId: 'pipelines' },
];

describe('reconcilePipelineItems', () => {
    it('adds a pipeline that is on disk but missing from the manifest', () => {
        const added = reconcilePipelineItems(baseRepo(), [
            { id: 'user_rfm_segmentation', name: 'User RFM Segmentation' },
        ]);
        expect(added).toEqual([
            {
                id: 'user_rfm_segmentation',
                name: 'User RFM Segmentation',
                type: 'pipeline',
                parentId: 'pipelines',
            },
        ]);
    });

    it('does not re-add a pipeline already registered in the manifest', () => {
        const added = reconcilePipelineItems(baseRepo(), [
            { id: 'j1', name: 'orders_etl' },
        ]);
        expect(added).toEqual([]);
    });

    it('returns only the orphans when some are known and some are not', () => {
        const added = reconcilePipelineItems(baseRepo(), [
            { id: 'j1', name: 'orders_etl' },
            { id: 'rfm', name: 'RFM' },
        ]);
        expect(added.map(i => i.id)).toEqual(['rfm']);
    });

    it('falls back to the project root when the pipelines folder is absent', () => {
        const repo = [{ id: 'root', name: 'Quilt Project', type: 'project' }];
        const added = reconcilePipelineItems(repo, [{ id: 'rfm', name: 'RFM' }]);
        expect(added[0].parentId).toBe('root');
    });

    it('dedupes discovered ids so a file found twice is registered once', () => {
        const added = reconcilePipelineItems(baseRepo(), [
            { id: 'rfm', name: 'RFM' },
            { id: 'rfm', name: 'RFM (dup)' },
        ]);
        expect(added).toHaveLength(1);
        expect(added[0].name).toBe('RFM');
    });

    it('returns an empty list when nothing was discovered', () => {
        expect(reconcilePipelineItems(baseRepo(), [])).toEqual([]);
    });
});

describe('folderNameFromPath', () => {
    it('returns the last segment of a POSIX path', () => {
        expect(folderNameFromPath('/Users/dwicky/quilt-samples')).toBe('quilt-samples');
    });

    it('returns the last segment of a Windows path', () => {
        expect(folderNameFromPath('C:\\Users\\dwicky\\quilt-samples')).toBe('quilt-samples');
    });

    it('ignores a trailing slash', () => {
        expect(folderNameFromPath('/Users/dwicky/quilt-samples/')).toBe('quilt-samples');
    });

    it('returns null for null/empty', () => {
        expect(folderNameFromPath(null)).toBeNull();
        expect(folderNameFromPath('')).toBeNull();
        expect(folderNameFromPath(undefined)).toBeNull();
    });
});
