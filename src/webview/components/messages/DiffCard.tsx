import type { ReactNode } from 'react';
import type { FileChangeInfo } from '../../../shared/protocol';
import { formatTimestamp } from '../../lib/format';
import { renderDiffLines } from '../../lib/diff';

interface DiffCardProps {
  change: FileChangeInfo;
  timestamp?: number;
  loadingStatus?: 'running' | 'done' | 'error';
  onOpenDiff: (filePath: string, toolCallId: string) => void;
}

export default function DiffCard({ change, timestamp, loadingStatus, onOpenDiff }: DiffCardProps): ReactNode {
  const fileName = change.filePath.split('/').pop() ?? change.filePath;
  const dirPath = change.filePath.split('/').slice(0, -1).join('/');

  return (
    <div className="tool-card-wrapper tool-card-wrapper-diff">
      <div
        className={`diff-card${loadingStatus === 'running' ? ' loading' : ''}`}
        id={`diff-${change.toolCallId}`}
      >
        <div
          className="diff-file-header"
          data-filepath={change.filePath}
          data-toolcallid={change.toolCallId}
          onClick={() => onOpenDiff(change.filePath, change.toolCallId)}
        >
          <span className="diff-file-icon">{change.isNew ? '✚' : '✎'}</span>
          <span className="diff-file-name">{fileName}</span>
          {dirPath ? <span className="diff-file-dir">{dirPath}</span> : null}
          {change.addedLines > 0 || change.removedLines > 0 ? (
            <span className="diff-stats">
              {change.addedLines > 0 ? <span className="diff-stat-add">+{change.addedLines}</span> : null}
              {change.removedLines > 0 ? <span className="diff-stat-del">-{change.removedLines}</span> : null}
            </span>
          ) : null}
          {change.isNew ? <span className="diff-new-badge">NEW</span> : null}
          {loadingStatus ? <span className={`tool-status ${loadingStatus}`}>{loadingStatus}</span> : null}
        </div>

        {change.diff ? <div className="diff-view">{renderDiffLines(change.diff)}</div> : null}
      </div>

      {timestamp ? <div className="tool-footer">{formatTimestamp(timestamp)}</div> : null}
    </div>
  );
}
