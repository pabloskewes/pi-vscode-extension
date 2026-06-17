import type { ReactNode } from 'react';
import type { SessionInfo } from '../../../shared/protocol';
import SessionList from '../panels/SessionList';

interface HomeScreenProps {
  sessions: SessionInfo[];
  currentSessionId?: string;
  onLoadSession: (sessionPath: string) => void;
  onNewSession: () => void;
  onOpenSessions: () => void;
  sessionPanelOpen?: boolean;
}

export default function HomeScreen({
  sessions,
  currentSessionId,
  onLoadSession,
  onNewSession,
  onOpenSessions,
  sessionPanelOpen,
}: HomeScreenProps): ReactNode {
  const showSessionList = !sessionPanelOpen && sessions.length > 0;

  return (
    <div className="home-screen">
      <div className="home-header">
        <div className="home-title-row">
          <span className="home-title-icon">&pi;</span>
          <h2 className="home-title">Pi Agent</h2>
        </div>
        <button className="home-new-session-btn" type="button" onClick={onNewSession}>
          New session
        </button>
      </div>

      {sessions.length === 0 ? (
        <div className="home-empty">No sessions yet. Start a conversation below.</div>
      ) : showSessionList ? (
        <>
          <div className="home-subtitle">Sessions</div>
          <SessionList
            sessions={sessions}
            currentSessionId={currentSessionId}
            onLoadSession={onLoadSession}
            className="home-session-list"
          />
          <button className="home-see-all" type="button" onClick={onOpenSessions}>
            Open sessions panel
          </button>
        </>
      ) : null}
    </div>
  );
}
