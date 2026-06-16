import type { ReactNode } from 'react';
import { iconsBaseUri } from '../vscode-api';
import { truncate } from './format';

export function getToolIconNode(name: string): ReactNode {
  const iconFiles: Record<string, string> = {
    bash: 'terminal.png',
    python: 'code.png',
    read: 'text.png',
    write: 'pencil.png',
    edit: 'pencil.png',
    glob: 'magnifying-glass.png',
    grep: 'magnifying-glass.png',
    list: 'folder.png',
  };
  const file = iconFiles[name.toLowerCase()] ?? 'bolt.png';
  return <img className="tool-icon-img" src={`${iconsBaseUri}/${file}`} alt={name} />;
}

export function getToolLabel(name: string, args: unknown): string {
  const argsRecord = typeof args === 'object' && args !== null ? (args as Record<string, unknown>) : {};
  switch (name.toLowerCase()) {
    case 'bash':
      return typeof argsRecord.command === 'string'
        ? truncate(argsRecord.command, 60)
        : 'Execute command';
    case 'read':
      return typeof argsRecord.path === 'string' ? `Read ${truncate(argsRecord.path, 50)}` : 'Read file';
    case 'write':
      return typeof argsRecord.path === 'string' ? `Write ${truncate(argsRecord.path, 50)}` : 'Write file';
    case 'edit':
      return typeof argsRecord.path === 'string' ? `Edit ${truncate(argsRecord.path, 50)}` : 'Edit file';
    case 'glob':
      return typeof argsRecord.pattern === 'string'
        ? `Glob ${truncate(argsRecord.pattern, 50)}`
        : 'Find files';
    case 'grep':
      return typeof argsRecord.pattern === 'string'
        ? `Grep ${truncate(argsRecord.pattern, 50)}`
        : 'Search files';
    default:
      return name;
  }
}

export function buildStatusNode(status: 'running' | 'error' | 'pending' | 'done'): ReactNode {
  if (status === 'done') return null;
  return (
    <span className={`tool-status ${status}`}>
      {status === 'pending' ? 'awaiting approval' : status}
    </span>
  );
}
