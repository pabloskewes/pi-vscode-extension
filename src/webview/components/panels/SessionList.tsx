import type { ReactNode } from 'react';
import type { SessionInfo } from '../../../shared/protocol';

interface SessionListProps {
  sessions: SessionInfo[];
  currentSessionId?: string;
  onLoadSession: (sessionPath: string) => void;
  emptyText?: string;
  className?: string;
}

export default function SessionList({
  sessions,
  currentSessionId,
  onLoadSession,
  emptyText = 'No previous sessions',
  className = 'session-list',
}: SessionListProps): ReactNode {
  if (sessions.length === 0) {
    return <div className="session-empty">{emptyText}</div>;
  }

  return (
    <div className={className}>
      {sessions.map((session) => {
        const name = session.name?.trim() || session.id;
        const parts: string[] = [];
        if (typeof session.lastModified === 'number') {
          parts.push(formatRelativeTime(session.lastModified));
        }
        if (typeof session.messageCount === 'number') {
          parts.push(`${session.messageCount} msg${session.messageCount === 1 ? '' : 's'}`);
        }

        return (
          <div
            className={`session-item${session.id === currentSessionId ? ' active' : ''}`}
            data-path={session.path}
            key={session.path}
            onClick={() => onLoadSession(session.path)}
          >
            <span className="session-item-name">{name}</span>
            {parts.length > 0 ? <span className="session-item-meta">{parts.join(' · ')}</span> : null}
          </div>
        );
      })}
    </div>
  );
}

function formatRelativeTime(timestampMs: number): string {
  const delta = Math.max(0, Date.now() - timestampMs);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (delta < minute) return 'just now';
  if (delta < hour) {
    const value = Math.floor(delta / minute);
    return `${value}m ago`;
  }
  if (delta < day) {
    const value = Math.floor(delta / hour);
    return `${value}h ago`;
  }
  if (delta < 7 * day) {
    const value = Math.floor(delta / day);
    return `${value}d ago`;
  }

  return new Date(timestampMs).toLocaleDateString();
}
