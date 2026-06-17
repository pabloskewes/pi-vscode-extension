import type { ReactNode } from 'react';
import type { SessionInfo } from '../../../shared/protocol';
import SessionList from './SessionList';

interface SessionPanelProps {
  sessions: SessionInfo[];
  currentSessionId?: string;
  onClose: () => void;
  onLoadSession: (sessionPath: string) => void;
}

export default function SessionPanel({
  sessions,
  currentSessionId,
  onClose,
  onLoadSession,
}: SessionPanelProps): ReactNode {
  return (
    <div className="session-panel" id="session-panel">
      <div className="session-header">
        <span>Sessions</span>
        <button
          className="icon-btn"
          id="btn-close-sessions"
          title="Close"
          type="button"
          onClick={onClose}
        >
          &times;
        </button>
      </div>
      <SessionList sessions={sessions} currentSessionId={currentSessionId} onLoadSession={onLoadSession} />
    </div>
  );
}
