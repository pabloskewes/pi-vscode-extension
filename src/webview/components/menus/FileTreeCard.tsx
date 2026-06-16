import type { ReactNode } from 'react';
import type { FileReferenceInfo } from '../../../shared/protocol';

interface FileTreeCardProps {
  selected?: FileReferenceInfo;
}

export default function FileTreeCard({ selected }: FileTreeCardProps): ReactNode {
  if (!selected) return null;
  const parts = selected.relativePath.split('/');

  return (
    <div className="file-menu-tree-card">
      <div className="file-menu-tree-title">{parts[0] ?? selected.relativePath}</div>
      <div className="file-menu-tree-lines">
        {parts.map((part, index) => (
          <div
            className="file-menu-tree-line"
            key={`${part}-${index}`}
            style={{ paddingLeft: `${index * 14}px` }}
          >
            <span className="file-menu-tree-icon">{index === parts.length - 1 ? '@' : '>'}</span>
            <span className="file-menu-tree-label">{part}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
