import type { MutableRefObject, ReactNode } from 'react';
import type { SessionInfo, ToolCallPendingInfo } from '../../../shared/protocol';
import { isRunningStreamingItem } from '../../lib/streaming';
import type { StreamingItem, WebviewState } from '../../types';
import { buildHistoryNodes, HistoryCallbacks } from '../../lib/messages';
import StreamingItems from './StreamingItems';
import ThinkingBlock from './ThinkingBlock';
import ToolApprovalCard from './ToolApprovalCard';
import { renderMarkdown } from '../../lib/markdown';
import HomeScreen from './HomeScreen';

interface MessagesProps {
  state: WebviewState;
  streamingItems: StreamingItem[];
  toolApprovals: ToolCallPendingInfo[];
  errors: Array<{ id: number; message: string }>;
  expandedUserMessages: Record<number, boolean>;
  sessions: SessionInfo[];
  currentSessionId?: string;
  sessionPanelOpen?: boolean;
  messagesRef: MutableRefObject<HTMLDivElement | null>;
  onScroll: (event: React.UIEvent<HTMLDivElement>) => void;
  onWheel: (event: React.WheelEvent<HTMLDivElement>) => void;
  onTouchStart: () => void;
  onMessagesClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  onMessagesCopy: (event: React.ClipboardEvent<HTMLDivElement>) => void;
  onMessagesKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  onOpenDiff: (filePath: string, toolCallId: string) => void;
  onOpenFile: (filePath: string) => void;
  onApproveToolCall: (toolCallId: string) => void;
  onRejectToolCall: (toolCallId: string) => void;
  onLoadSession: (sessionPath: string) => void;
  onOpenSessions: () => void;
  onNewSession: () => void;
  historyCallbacks: HistoryCallbacks;
}

export default function Messages({
  state,
  streamingItems,
  toolApprovals,
  errors,
  expandedUserMessages,
  sessions,
  currentSessionId,
  sessionPanelOpen,
  messagesRef,
  onScroll,
  onWheel,
  onTouchStart,
  onMessagesClick,
  onMessagesCopy,
  onMessagesKeyDown,
  onOpenDiff,
  onOpenFile,
  onApproveToolCall,
  onRejectToolCall,
  onLoadSession,
  onOpenSessions,
  onNewSession,
  historyCallbacks,
}: MessagesProps): ReactNode {
  const historyNodes = buildHistoryNodes(state, expandedUserMessages, historyCallbacks);
  const showPreparingPlaceholder =
    state.isStreaming &&
    !state.streamingText &&
    !state.streamingThinking &&
    !streamingItems.some(isRunningStreamingItem) &&
    toolApprovals.length === 0;

  return (
    <div
      className="messages"
      id="messages"
      ref={messagesRef}
      onClick={onMessagesClick}
      onCopy={onMessagesCopy}
      onKeyDown={onMessagesKeyDown}
      onWheel={onWheel}
      onTouchStart={onTouchStart}
      onScroll={onScroll}
    >
      {historyNodes.length === 0 && !state.isStreaming ? (
        <HomeScreen
          sessions={sessions}
          currentSessionId={currentSessionId}
          onLoadSession={onLoadSession}
          onOpenSessions={onOpenSessions}
          onNewSession={onNewSession}
          sessionPanelOpen={sessionPanelOpen}
        />
      ) : historyNodes}

      {errors.map((error) => (
        <div className="error-message" key={error.id}>
          {error.message}
        </div>
      ))}

      <div className="streaming-message message-group-assistant" id="streaming-message">
        {state.streamingThinking || state.streamingText ? (
          <div className="message message-assistant">
            {state.streamingThinking ? (
              <ThinkingBlock
                text={state.streamingThinking}
                active={state.isThinking}
                durationSec={state.streamingThinkingDuration}
                idPrefix="streaming-thinking"
                openByDefault
              />
            ) : null}
            <div
              className="message-content"
              id="streaming-text"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(state.streamingText, 'streaming-text') }}
            />
          </div>
        ) : null}

        <StreamingItems items={streamingItems} onOpenDiff={onOpenDiff} onOpenFile={onOpenFile} />

        {toolApprovals.map((pending) => (
          <ToolApprovalCard
            key={pending.toolCallId}
            pending={pending}
            onApprove={onApproveToolCall}
            onReject={onRejectToolCall}
          />
        ))}

        {showPreparingPlaceholder ? (
          <div className="preparing-placeholder" id="preparing-placeholder">
            Preparing next moves...
          </div>
        ) : null}
      </div>

      <div className="messages-spacer" />
    </div>
  );
}
