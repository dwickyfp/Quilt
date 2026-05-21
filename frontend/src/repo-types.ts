export type RepoItemType =
    | 'project'
    | 'folder'
    | 'pipeline'
    | 'connection'
    | 'context'
    | 'routine'
    | 'doc';

export type RepoItem = {
    id: string;
    name: string;
    type: RepoItemType;
    parentId?: string;
    icon?: string;
};
