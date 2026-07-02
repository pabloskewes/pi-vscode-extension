import type { ReactNode } from 'react';
import type { FileReferenceInfo } from '../../../shared/protocol';

interface AttachedFileChipProps {
  file: FileReferenceInfo;
  clickable?: boolean;
}

export default function AttachedFileChip({ file, clickable = false }: AttachedFileChipProps): ReactNode {
  return (
    <span
      className="attachment-chip attachment-chip-file attachment-chip-inline attachment-chip-static"
      title={file.relativePath}
      data-file-kind={file.kind ?? 'file'}
      data-file-path={file.relativePath}
      data-absolute-path={file.absolutePath}
      data-file-name={file.displayName}
      data-start-line={file.startLine}
      data-end-line={file.endLine}
      data-clickable={clickable ? 'true' : undefined}
      role={clickable ? 'link' : undefined}
      tabIndex={clickable ? 0 : undefined}
    >
      <span className="attachment-file-icon">{file.kind === 'directory' ? '/' : '@'}</span>
      <span className="attachment-chip-name">{file.displayName}</span>
    </span>
  );
}
