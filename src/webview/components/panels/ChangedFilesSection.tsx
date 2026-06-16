import type { ReactNode } from 'react';
import type { FileChangeInfo } from '../../../shared/protocol';
import { getFileIcon } from '../../lib/files';

interface ChangedFilesSectionProps {
  fileChanges: FileChangeInfo[];
  rollbackPoint: number | null;
  open: boolean;
  onToggle: (open: boolean) => void;
  onUndo: () => void;
  onRedo: () => void;
  onReviewAll: () => void;
  onOpenDiff: (filePath: string, toolCallId: string) => void;
}

export default function ChangedFilesSection({
  fileChanges,
  rollbackPoint,
  open,
  onToggle,
  onUndo,
  onRedo,
  onReviewAll,
  onOpenDiff,
}: ChangedFilesSectionProps): ReactNode {
  const count = fileChanges.length;

  return (
    <details
      className="changed-files-section"
      id="changed-files-bar"
      open={open}
      onToggle={(event) => onToggle((event.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="changed-files-summary">
        <span className="changed-files-arrow">&#9656;</span>
        <span className="changed-files-count">
          {count} File{count !== 1 ? 's' : ''}
        </span>
        <span className="changed-files-spacer" />
        {rollbackPoint !== null ? (
          <button
            className="changed-files-link"
            id="btn-redo"
            title="Redo changes"
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onRedo();
            }}
          >
            Redo
          </button>
        ) : (
          <button
            className="changed-files-link"
            id="btn-undo"
            title="Undo last change"
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onUndo();
            }}
          >
            Undo
          </button>
        )}
        <button
          className="changed-files-review-btn"
          id="btn-review-all"
          title="Review all changes"
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onReviewAll();
          }}
        >
          Review
        </button>
      </summary>

      <div className="changed-files-list">
        {fileChanges.map((change) => {
          const fileName = change.filePath.split('/').pop() ?? change.filePath;
          return (
            <div
              className="changed-file-item"
              data-filepath={change.filePath}
              data-toolcallid={change.toolCallId}
              key={change.filePath}
              onClick={() => onOpenDiff(change.filePath, change.toolCallId)}
            >
              <span className="cf-icon">{getFileIcon(change.filePath)}</span>
              <span className="cf-name">{fileName}</span>
              <span className="cf-stats">
                {change.addedLines > 0 ? <span className="cf-stat-add">+{change.addedLines}</span> : null}
                {change.removedLines > 0 ? <span className="cf-stat-del">-{change.removedLines}</span> : null}
              </span>
            </div>
          );
        })}
      </div>
    </details>
  );
}
