import type { Dispatch, ReactNode, SetStateAction } from 'react';
import type { CompletionSound, FileChangeInfo, ToolCallPendingInfo } from '../../shared/protocol';
import DiffCard from '../components/messages/DiffCard';
import ToolResultCard from '../components/messages/ToolResultCard';
import type {
  AgentEvent,
  AssistantMessageEvent,
  ChatMessage,
  StreamingItem,
  StreamingToolEndEvent,
  StreamingToolStartEvent,
  StreamingToolUpdateEvent,
  WebviewState,
} from '../types';
import { extractToolResultText, tryParseJSON } from './format';
import { getToolIconNode, getToolLabel } from './tools';
import { playCompletionSound } from './sound';

export function handleAgentEvent(
  event: AgentEvent,
  setState: Dispatch<SetStateAction<WebviewState>>,
  setStreamingItems: Dispatch<SetStateAction<StreamingItem[]>>,
  setToolApprovals: Dispatch<SetStateAction<ToolCallPendingInfo[]>>,
  setUserHasScrolled: Dispatch<SetStateAction<boolean>>,
  dismissSteerToast: () => void,
  clearSteerToastImmediately: () => void,
  completionSound: CompletionSound
): void {
  switch (event.type) {
    case 'message_update':
      if (event.assistantMessageEvent) {
        setState((previous) => applyStreamingDelta(previous, event.assistantMessageEvent!));
        if (
          event.assistantMessageEvent.type === 'thinking_delta' ||
          event.assistantMessageEvent.type === 'text_delta'
        ) {
          dismissSteerToast();
        }
      }
      break;

    case 'agent_start':
      setState((previous) => ({
        ...previous,
        isStreaming: true,
        streamingText: '',
        streamingThinking: '',
        isThinking: false,
        thinkingStartTime: 0,
        streamingThinkingDuration: 0,
      }));
      setStreamingItems([]);
      setToolApprovals([]);
      setUserHasScrolled(false);
      break;

    case 'agent_end':
      setState((previous) => ({
        ...previous,
        isStreaming: false,
        streamingText: '',
        streamingThinking: '',
        isThinking: false,
      }));
      setStreamingItems([]);
      setToolApprovals([]);
      clearSteerToastImmediately();
      playCompletionSound(completionSound);
      break;

    case 'tool_execution_start':
      setStreamingItems((previous) => appendStreamingTool(previous, event as StreamingToolStartEvent));
      break;

    case 'tool_execution_update':
      setStreamingItems((previous) => updateStreamingTool(previous, event as StreamingToolUpdateEvent));
      break;

    case 'tool_execution_end':
      setStreamingItems((previous) => finishStreamingTool(previous, event as StreamingToolEndEvent));
      break;
  }
}

export function applySerializedState(
  previous: WebviewState,
  serialized: Record<string, unknown>
): WebviewState {
  return {
    ...previous,
    messages: Array.isArray(serialized.messages) ? (serialized.messages as ChatMessage[]) : [],
    isStreaming: Boolean(serialized.isStreaming),
    model: serialized.model as WebviewState['model'],
    thinkingLevel: typeof serialized.thinkingLevel === 'string' ? serialized.thinkingLevel : previous.thinkingLevel,
    tools: Array.isArray(serialized.tools) ? (serialized.tools as string[]) : [],
    sessionId: typeof serialized.sessionId === 'string' ? serialized.sessionId : previous.sessionId,
    sessionName: typeof serialized.sessionName === 'string' ? serialized.sessionName : previous.sessionName,
    contextUsage: serialized.contextUsage as WebviewState['contextUsage'],
    fileChanges: Array.isArray(serialized.fileChanges) ? (serialized.fileChanges as FileChangeInfo[]) : [],
    rollbackPoint:
      typeof serialized.rollbackPoint === 'number' || serialized.rollbackPoint === null
        ? (serialized.rollbackPoint as number | null)
        : null,
    tabs: Array.isArray(serialized.tabs) ? (serialized.tabs as WebviewState['tabs']) : [],
    activeTabId: typeof serialized.activeTabId === 'string' ? serialized.activeTabId : '',
    streamingText: typeof serialized.streamingText === 'string' ? serialized.streamingText : '',
    streamingThinking: typeof serialized.streamingThinking === 'string' ? serialized.streamingThinking : '',
    isThinking: Boolean(serialized.isThinking),
    thinkingStartTime: typeof serialized.thinkingStartTime === 'number' ? serialized.thinkingStartTime : 0,
    streamingThinkingDuration:
      typeof serialized.streamingThinkingDuration === 'number' ? serialized.streamingThinkingDuration : 0,
    queuedMessages: Array.isArray(serialized.queuedMessages)
      ? (serialized.queuedMessages as string[])
      : [],
    completionSound: isCompletionSound(serialized.completionSound)
      ? serialized.completionSound
      : previous.completionSound,
  };
}

function isCompletionSound(value: unknown): value is CompletionSound {
  return value === 'off' || value === 'chime' || value === 'subtle';
}

export function applyStreamingDelta(
  previous: WebviewState,
  assistantEvent: AssistantMessageEvent
): WebviewState {
  switch (assistantEvent.type) {
    case 'thinking_start':
      return {
        ...previous,
        isThinking: true,
        streamingThinking: '',
        thinkingStartTime: Date.now(),
        streamingThinkingDuration: 0,
      };

    case 'thinking_delta':
      return {
        ...previous,
        streamingThinking: previous.streamingThinking + (assistantEvent.delta ?? ''),
      };

    case 'thinking_end':
      return {
        ...previous,
        isThinking: false,
        streamingThinkingDuration:
          previous.thinkingStartTime > 0
            ? Math.round((Date.now() - previous.thinkingStartTime) / 1000)
            : previous.streamingThinkingDuration,
      };

    case 'text_delta':
      return {
        ...previous,
        streamingText: previous.streamingText + (assistantEvent.delta ?? ''),
      };

    default:
      return previous;
  }
}

export function appendStreamingTool(
  previous: StreamingItem[],
  event: StreamingToolStartEvent
): StreamingItem[] {
  const args = event.args as Record<string, unknown> | undefined;
  if ((event.toolName === 'edit' || event.toolName === 'write') && typeof args?.path === 'string') {
    return [
      ...previous,
      {
        kind: 'diff-loading',
        toolCallId: event.toolCallId,
        path: args.path,
        status: 'running',
      },
    ];
  }

  const parsedArgs = tryParseJSON(typeof event.args === 'string' ? event.args : JSON.stringify(event.args));
  const toolName = event.toolName ?? '';
  const nameLower = toolName.toLowerCase();
  const parsedArgsRecord = typeof parsedArgs === 'object' && parsedArgs !== null
    ? (parsedArgs as Record<string, unknown>)
    : {};
  return [
    ...previous,
    {
      kind: 'tool',
      toolCallId: event.toolCallId,
      toolName,
      args: parsedArgs,
      status: 'running',
      partialText: '',
      resultText: '',
      isRead: nameLower === 'read',
      filePath:
        typeof parsedArgsRecord.path === 'string'
          ? parsedArgsRecord.path
          : typeof parsedArgsRecord.file_path === 'string'
            ? parsedArgsRecord.file_path
            : '',
    },
  ];
}

export function updateStreamingTool(
  previous: StreamingItem[],
  event: StreamingToolUpdateEvent
): StreamingItem[] {
  return previous.map((item) => {
    if (item.kind !== 'tool' || item.toolCallId !== event.toolCallId) {
      return item;
    }

    const text = extractToolResultText(event.partialResult);
    if (!text) return item;

    return {
      ...item,
      partialText: text,
    };
  });
}

export function finishStreamingTool(
  previous: StreamingItem[],
  event: StreamingToolEndEvent
): StreamingItem[] {
  return previous.map((item) => {
    if (item.kind === 'diff' || item.toolCallId !== event.toolCallId) {
      return item;
    }

    if (item.kind === 'diff-loading') {
      return {
        ...item,
        status: event.isError ? 'error' : 'done',
      };
    }

    return {
      ...item,
      status: event.isError ? 'error' : 'done',
      resultText: extractToolResultText(event.result),
    };
  });
}

export function applyStreamingDiff(
  previous: StreamingItem[],
  change: FileChangeInfo
): StreamingItem[] {
  const next = previous.map((item) => {
    if (item.kind === 'diff' || item.toolCallId !== change.toolCallId) {
      return item;
    }
    return { kind: 'diff', change } as StreamingItem;
  });

  if (next.some((item) => item.kind === 'diff' && item.change.toolCallId === change.toolCallId)) {
    return next;
  }

  return [...next, { kind: 'diff', change }];
}

export function isRunningStreamingItem(item: StreamingItem): boolean {
  if (item.kind === 'diff') return false;
  return item.status === 'running';
}

export function renderStreamingItem(
  item: StreamingItem,
  onOpenDiff: (filePath: string, toolCallId: string) => void,
  onOpenFile: (filePath: string) => void
): ReactNode {
  if (item.kind === 'diff') {
    return <DiffCard key={`stream-diff:${item.change.toolCallId}`} change={item.change} onOpenDiff={onOpenDiff} />;
  }

  if (item.kind === 'diff-loading') {
    const fileName = item.path.split('/').pop() ?? item.path;
    return (
      <div
        className={`diff-card${item.status === 'running' ? ' loading' : ''}`}
        id={`tool-${item.toolCallId}`}
        key={`stream-diff-loading:${item.toolCallId}`}
      >
        <div className="diff-file-header">
          <span className="diff-file-icon">&#9998;</span>
          <span className="diff-file-name">{fileName}</span>
          <span className={`tool-status ${item.status}`}>{item.status}</span>
        </div>
      </div>
    );
  }

  const label = getToolLabel(item.toolName, item.args);
  const hasBody = !!(item.status === 'running' ? item.partialText : item.resultText || item.toolName.toLowerCase() === 'bash');

  if ((item.status !== 'running' && hasBody) || (item.status === 'error' && hasBody)) {
    return (
      <details
        className="tool-card tool-expandable"
        id={`tool-${item.toolCallId}`}
        key={`stream-tool:${item.toolCallId}`}
        data-tool-name={item.toolName}
      >
        <summary className="tool-header">
          <span className="tool-icon">{getToolIconNode(item.toolName)}</span>
          <span
            className="tool-name"
            style={item.isRead && item.filePath ? { cursor: 'pointer' } : undefined}
            onClick={(event) => {
              if (!item.isRead || !item.filePath) return;
              event.preventDefault();
              event.stopPropagation();
              onOpenFile(item.filePath);
            }}
          >
            {label}
          </span>
          {item.status === 'error' ? <span className="tool-status error">error</span> : null}
          <span className="tool-expand-arrow">&#9656;</span>
        </summary>
        <div className="tool-body">
          <pre className={`tool-result${item.resultText || item.partialText ? '' : ' empty'}`}>
            {item.resultText || item.partialText || '(no output)'}
          </pre>
        </div>
      </details>
    );
  }

  return (
    <div
      className={`tool-card${item.isRead ? ' tool-clickable' : ''}`}
      id={`tool-${item.toolCallId}`}
      key={`stream-tool:${item.toolCallId}`}
      data-tool-name={item.toolName}
    >
      <div className="tool-header">
        <span className="tool-icon">{getToolIconNode(item.toolName)}</span>
        <span
          className="tool-name"
          style={item.isRead && item.filePath ? { cursor: 'pointer' } : undefined}
          onClick={(event) => {
            if (!item.isRead || !item.filePath) return;
            event.preventDefault();
            event.stopPropagation();
            onOpenFile(item.filePath);
          }}
        >
          {label}
        </span>
        {item.status === 'running' ? <span className="tool-status running">running</span> : null}
        {item.status === 'error' ? <span className="tool-status error">error</span> : null}
      </div>
      {item.status === 'running' && item.partialText ? <pre className="tool-result">{item.partialText}</pre> : null}
    </div>
  );
}
