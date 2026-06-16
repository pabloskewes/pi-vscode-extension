import type { FileChangeInfo, FileReferenceInfo } from '../../shared/protocol';

export function getFileIcon(filePath: string): string {
  const extension = filePath.split('.').pop()?.toLowerCase() ?? '';
  const icons: Record<string, string> = {
    ts: '🔸',
    tsx: '🔸',
    js: '🔹',
    jsx: '🔹',
    json: '🔸',
    css: '🔵',
    scss: '🔵',
    html: '🟠',
    md: '🔶',
    py: '🔷',
    svg: '🟡',
  };
  return icons[extension] ?? '📄';
}

export function getUniqueFileChanges(fileChanges: FileChangeInfo[]): FileChangeInfo[] {
  const fileMap = new Map<string, FileChangeInfo>();
  for (const change of fileChanges) {
    fileMap.set(change.filePath, change);
  }
  return [...fileMap.values()];
}
