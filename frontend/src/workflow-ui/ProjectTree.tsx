import { useEffect, useMemo, useRef, useState } from 'react';
import type { RepoItem, RepoItemType } from '../repo-types';
import { useContextMenu, type MenuItem } from './ContextMenu';

type Props = {
    items: RepoItem[];
    activeJobId: string;
    openJobIds: Set<string>;
    onOpenPipeline: (id: string) => void;
    onNewPipeline: (parentId: string) => void;
    onNewFolder: (parentId: string) => void;
    onRename: (id: string, newName: string) => void;
    onDuplicate: (id: string) => void;
    onDelete: (id: string) => void;
};

const TYPE_ICONS: Record<RepoItemType, string> = {
    project: '◆',
    folder: '▸',
    pipeline: '⋈',
    connection: '⌬',
    context: '⌗',
    routine: 'ƒ',
    doc: '✎',
};

const TYPE_LABEL: Record<RepoItemType, string> = {
    project: 'Project',
    folder: 'Folder',
    pipeline: 'Pipeline',
    connection: 'Connection',
    context: 'Context',
    routine: 'Routine',
    doc: 'Document',
};

export default function ProjectTree(props: Props) {
    const {
        items,
        activeJobId,
        openJobIds,
        onOpenPipeline,
        onNewPipeline,
        onNewFolder,
        onRename,
        onDuplicate,
        onDelete,
    } = props;

    const [expanded, setExpanded] = useState<Set<string>>(
        () => new Set(items.filter(i => i.type === 'project' || i.type === 'folder').map(i => i.id)),
    );
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [draftName, setDraftName] = useState('');
    const menu = useContextMenu();

    const childrenOf = useMemo(() => {
        const map = new Map<string, RepoItem[]>();
        for (const item of items) {
            const key = item.parentId ?? '__root__';
            const list = map.get(key) ?? [];
            list.push(item);
            map.set(key, list);
        }
        for (const [, list] of map) {
            list.sort((a, b) => {
                const folderFirst = (b.type === 'folder' ? 1 : 0) - (a.type === 'folder' ? 1 : 0);
                if (folderFirst !== 0) return folderFirst;
                return a.name.localeCompare(b.name);
            });
        }
        return map;
    }, [items]);

    const startRename = (id: string) => {
        const item = items.find(i => i.id === id);
        if (!item || item.type === 'project') return;
        setRenamingId(id);
        setDraftName(item.name);
    };

    const commitRename = () => {
        if (!renamingId) return;
        const trimmed = draftName.trim();
        if (trimmed && trimmed !== items.find(i => i.id === renamingId)?.name) {
            onRename(renamingId, trimmed);
        }
        setRenamingId(null);
    };

    const cancelRename = () => setRenamingId(null);

    const toggle = (id: string) => {
        setExpanded(s => {
            const next = new Set(s);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const buildFolderMenu = (item: RepoItem): MenuItem[] => [
        { kind: 'header', key: 'h', label: TYPE_LABEL[item.type] + ': ' + item.name },
        {
            kind: 'item',
            key: 'new-pipeline',
            label: 'New pipeline…',
            icon: '⋈',
            onClick: () => onNewPipeline(item.id),
        },
        {
            kind: 'item',
            key: 'new-folder',
            label: 'New folder',
            icon: '▸',
            onClick: () => onNewFolder(item.id),
        },
        { kind: 'separator', key: 's1' },
        {
            kind: 'item',
            key: 'rename',
            label: 'Rename',
            icon: '✎',
            shortcut: 'F2',
            onClick: () => startRename(item.id),
            disabled: item.type === 'project',
        },
        {
            kind: 'item',
            key: 'delete',
            label: 'Delete',
            icon: '✕',
            shortcut: 'Del',
            onClick: () => onDelete(item.id),
            danger: true,
            disabled: item.type === 'project',
        },
    ];

    const buildItemMenu = (item: RepoItem): MenuItem[] => [
        { kind: 'header', key: 'h', label: TYPE_LABEL[item.type] + ': ' + item.name },
        {
            kind: 'item',
            key: 'open',
            label: 'Open',
            icon: '↗',
            shortcut: 'Enter',
            onClick: () => onOpenPipeline(item.id),
            disabled: item.type !== 'pipeline',
        },
        {
            kind: 'item',
            key: 'duplicate',
            label: 'Duplicate',
            icon: '⎘',
            shortcut: 'Ctrl+D',
            onClick: () => onDuplicate(item.id),
        },
        { kind: 'separator', key: 's1' },
        {
            kind: 'item',
            key: 'rename',
            label: 'Rename',
            icon: '✎',
            shortcut: 'F2',
            onClick: () => startRename(item.id),
        },
        {
            kind: 'item',
            key: 'delete',
            label: 'Delete',
            icon: '✕',
            shortcut: 'Del',
            onClick: () => onDelete(item.id),
            danger: true,
        },
    ];

    const onItemContextMenu = (e: React.MouseEvent, item: RepoItem) => {
        const itemsArr =
            item.type === 'folder' || item.type === 'project'
                ? buildFolderMenu(item)
                : buildItemMenu(item);
        menu.open(e, itemsArr);
    };

    const renderNode = (item: RepoItem, depth: number): React.ReactNode => {
        const isContainer = item.type === 'project' || item.type === 'folder';
        const isExpanded = isContainer ? expanded.has(item.id) : false;
        const children = childrenOf.get(item.id) ?? [];
        const isActive = item.type === 'pipeline' && item.id === activeJobId;
        const isOpen = item.type === 'pipeline' && openJobIds.has(item.id);
        const isRenaming = renamingId === item.id;

        const onClick = () => {
            if (isRenaming) return;
            if (isContainer) toggle(item.id);
            else if (item.type === 'pipeline') onOpenPipeline(item.id);
        };
        const onDoubleClick = () => {
            if (item.type === 'pipeline') onOpenPipeline(item.id);
        };

        return (
            <div key={item.id} className="repo-node-wrap">
                <div
                    className={
                        'repo-node' +
                        (isActive ? ' is-active' : '') +
                        (isOpen ? ' is-open' : '') +
                        ' is-' + item.type
                    }
                    style={{ paddingLeft: 8 + depth * 14 }}
                    onClick={onClick}
                    onDoubleClick={onDoubleClick}
                    onContextMenu={e => onItemContextMenu(e, item)}
                    title={item.name}
                >
                    <span className="repo-chevron" aria-hidden="true">
                        {isContainer ? (isExpanded ? '▾' : '▸') : ''}
                    </span>
                    <span className={'repo-icon repo-icon-' + item.type} aria-hidden="true">
                        {TYPE_ICONS[item.type]}
                    </span>
                    {isRenaming ? (
                        <RenameInput
                            value={draftName}
                            onChange={setDraftName}
                            onCommit={commitRename}
                            onCancel={cancelRename}
                        />
                    ) : (
                        <span className="repo-label">{item.name}</span>
                    )}
                    {item.type === 'pipeline' && isOpen && !isRenaming ? (
                        <span className="repo-open-dot" aria-label="open in editor" />
                    ) : null}
                    {item.type === 'folder' && children.length > 0 && !isRenaming ? (
                        <span className="repo-count">{children.length}</span>
                    ) : null}
                </div>
                {isContainer && isExpanded
                    ? children.map(child => renderNode(child, depth + 1))
                    : null}
            </div>
        );
    };

    const roots = items.filter(i => !i.parentId);

    return (
        <div className="repo-tree">
            <div className="repo-tree-actions">
                <button
                    type="button"
                    className="repo-action-button"
                    onClick={() => onNewPipeline('pipelines')}
                    title="New pipeline"
                >
                    <span aria-hidden="true">+</span> Pipeline
                </button>
                <button
                    type="button"
                    className="repo-action-button"
                    onClick={() => onNewFolder('root')}
                    title="New folder"
                >
                    <span aria-hidden="true">▸</span> Folder
                </button>
            </div>
            <div className="repo-tree-body" onContextMenu={e => e.preventDefault()}>
                {roots.map(r => renderNode(r, 0))}
            </div>
            {menu.element}
        </div>
    );
}

type RenameInputProps = {
    value: string;
    onChange: (v: string) => void;
    onCommit: () => void;
    onCancel: () => void;
};

function RenameInput({ value, onChange, onCommit, onCancel }: RenameInputProps) {
    const ref = useRef<HTMLInputElement>(null);
    useEffect(() => {
        ref.current?.focus();
        ref.current?.select();
    }, []);
    return (
        <input
            ref={ref}
            type="text"
            className="repo-rename-input"
            value={value}
            onChange={e => onChange(e.target.value)}
            onKeyDown={e => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    onCommit();
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    onCancel();
                }
                e.stopPropagation();
            }}
            onBlur={onCommit}
            onClick={e => e.stopPropagation()}
            spellCheck={false}
        />
    );
}
