import type { ReactNode } from 'react';
import type { FileReferenceInfo } from '../../../shared/protocol';

interface AttachedFileChipProps {
  file: FileReferenceInfo;
}

export default function AttachedFileChip({ file }: AttachedFileChipProps): ReactNode {
  return (
    <span
      className="attachment-chip attachment-chip-file attachment-chip-inline attachment-chip-static"
      title={file.relativePath}
    >
      <span className="attachment-file-icon">@</span>
      <span className="attachment-chip-name">{file.displayName}</span>
    </span>
  );
}
