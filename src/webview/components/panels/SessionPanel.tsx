import type { ReactNode } from 'react';
import type { SessionInfo } from '../../../shared/protocol';

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
      {sessions.length === 0 ? (
        <div className="session-empty">No previous sessions</div>
      ) : (
        <>
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
          <div className="session-list">
            {sessions.map((session) => (
              <div
                className={`session-item${session.id === currentSessionId ? ' active' : ''}`}
                data-path={session.path}
                key={session.path}
                onClick={() => onLoadSession(session.path)}
              >
                <span className="session-item-name">{session.name ?? session.id}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
