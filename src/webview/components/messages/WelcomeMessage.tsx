import type { ReactNode } from 'react';

export default function WelcomeMessage(): ReactNode {
  return (
    <div className="welcome">
      <div className="welcome-icon">&pi;</div>
      <div className="welcome-title">Pi Agent</div>
      <div className="welcome-subtitle">Ask anything. Pi can read, write, and execute code for you.</div>
      <div className="welcome-hints">
        <div className="welcome-hint">Type a message to start</div>
        <div className="welcome-hint">
          <kbd>Ctrl+Shift+L</kbd> Focus chat
        </div>
        <div className="welcome-hint">
          <kbd>Ctrl+Shift+N</kbd> New session
        </div>
        <div className="welcome-hint">
          <kbd>Esc</kbd> Stop generation
        </div>
      </div>
    </div>
  );
}
