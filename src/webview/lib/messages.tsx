import type { ReactNode } from 'react';
import { buildInlineFileMarker } from '../../shared/file-markers';
import type { FileChangeInfo, FileReferenceInfo } from '../../shared/protocol';
import { USER_MESSAGE_COLLAPSE_CHAR_LIMIT, USER_MESSAGE_COLLAPSE_LINE_LIMIT } from '../constants';
import type { ChatMessage, WebviewState } from '../types';
import AttachedFileChip from '../components/messages/AttachedFileChip';
import DiffCard from '../components/messages/DiffCard';
import ThinkingBlock from '../components/messages/ThinkingBlock';
import ToolResultCard from '../components/messages/ToolResultCard';
import UserMessageContent from '../components/messages/UserMessageContent';
import { renderMarkdown } from './markdown';
import { extractToolResultText, formatTimestamp } from './format';
import { getToolLabel } from './tools';

export function extractText(message: ChatMessage): string {
  if (typeof message.content === 'string') return message.content;
  if (Array.isArray(message.content)) {
    return message.content
      .filter((content) => content.type === 'text')
      .map((content) => content.text)
      .filter((text): text is string => typeof text === 'string')
      .join('');
  }
  return typeof message.text === 'string' ? message.text : '';
}

export function extractThinking(message: ChatMessage): string {
  if (Array.isArray(message.content)) {
    return message.content
      .filter((content) => content.type === 'thinking')
      .map((content) => content.thinking ?? content.text ?? '')
      .filter((text): text is string => typeof text === 'string')
      .join('');
  }
  return typeof message.thinking === 'string' ? message.thinking : '';
}

export function extractToolCalls(message: ChatMessage): Array<Record<string, unknown>> {
  if (Array.isArray(message.toolCalls) && message.toolCalls.length > 0) {
    return message.toolCalls.map((tc) => tc as Record<string, unknown>);
  }
  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
    return message.tool_calls.map((tc) => tc as Record<string, unknown>);
  }
  if (Array.isArray(message.content)) {
    const toolCalls = message.content.filter(
      (content) => content.type === 'toolCall' || content.type === 'tool_call' || content.type === 'tool_use'
    );
    if (toolCalls.length > 0) return toolCalls.map((tc) => tc as unknown as Record<string, unknown>);
  }
  return [];
}

export function findFileChangeForToolResult(
  message: ChatMessage,
  fileChanges: FileChangeInfo[]
): FileChangeInfo | undefined {
  const id = typeof message.toolCallId === 'string'
    ? message.toolCallId
    : typeof message.tool_call_id === 'string'
      ? message.tool_call_id
      : undefined;
  if (!id) return undefined;
  return fileChanges.find((change) => change.toolCallId === id);
}

export function findToolCallInMessages(
  messages: ChatMessage[],
  beforeIndex: number,
  toolCallId: string
): Record<string, unknown> | undefined {
  if (!toolCallId) return undefined;
  for (let index = beforeIndex - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role !== 'assistant') continue;
    const toolCalls = extractToolCalls(message);
    for (const toolCall of toolCalls) {
      const id =
        typeof toolCall.id === 'string'
          ? toolCall.id
          : typeof toolCall.toolCallId === 'string'
            ? toolCall.toolCallId
            : undefined;
      if (id === toolCallId) {
        return toolCall;
      }
    }
  }
  return undefined;
}

export function findPrecedingAssistant(messages: ChatMessage[], beforeIndex: number): ChatMessage | null {
  for (let index = beforeIndex - 1; index >= 0; index--) {
    if (messages[index].role === 'assistant') return messages[index];
    if (messages[index].role === 'user') return null;
  }
  return null;
}

export function buildToolFooter(
  message: ChatMessage,
  allMessages: ChatMessage[],
  index: number
): string | null {
  const parts: string[] = [];
  if (typeof message.timestamp === 'number') {
    parts.push(formatTimestamp(message.timestamp));
  }

  const precedingAssistant = findPrecedingAssistant(allMessages, index);
  if (precedingAssistant?.usage) {
    const usage = precedingAssistant.usage;
    if (usage.input > 0) parts.push(`${usage.input.toLocaleString()} in`);
    if (usage.output > 0) parts.push(`${usage.output.toLocaleString()} out`);
  }

  return parts.length > 0 ? parts.join(' · ') : null;
}

export function buildMessageFooter(
  messages: ChatMessage[],
  message: ChatMessage,
  index: number
): string | null {
  const role = message.role ?? 'unknown';
  if (role !== 'user' && role !== 'assistant') return null;

  const parts: string[] = [];
  if (typeof message.timestamp === 'number') {
    parts.push(formatTimestamp(message.timestamp));
  }

  if (role === 'user') {
    for (let nextIndex = index + 1; nextIndex < messages.length; nextIndex++) {
      const next = messages[nextIndex];
      if (next.role === 'assistant' && next.usage && next.usage.input > 0) {
        parts.push(`${next.usage.input.toLocaleString()} input tokens`);
        break;
      }
      if (next.role === 'user') {
        break;
      }
    }
  }

  if (role === 'assistant') {
    if (typeof message._messageEndTime === 'number' && typeof message.timestamp === 'number') {
      const startMs = message.timestamp < 1e12 ? message.timestamp * 1000 : message.timestamp;
      const durationSec = (message._messageEndTime - startMs) / 1000;
      const usage = message.usage;
      if (usage && usage.output > 0 && durationSec > 0) {
        parts.push(`${(usage.output / durationSec).toFixed(1)} tok/s`);
      }
    }

    if (message.usage && message.usage.output > 0) {
      parts.push(`${message.usage.output.toLocaleString()} output tokens`);
    }
  }

  return parts.length > 0 ? parts.join(' · ') : null;
}

export function extractUserPromptDisplay(text: string): {
  userText: string;
  files: FileReferenceInfo[];
} {
  const fileBlockIndex = text.search(/(?:^|\n\n)<file\s+name="/);
  if (fileBlockIndex === -1) {
    return { userText: text, files: [] };
  }

  const userText = text.slice(0, fileBlockIndex).replace(/\n\n$/, '');
  const fileBlock = text.slice(fileBlockIndex).trimStart();
  const files = extractFileReferences(fileBlock, /<file\s+name="([^"]+)"(?:\s+lines="([^"]+)")?[^>]*>/gm);
  const normalized = stripInlineFileMarkers(userText, files);
  return {
    userText: normalized.text,
    files: normalized.files,
  };
}

export function extractFileReferences(fileBlock: string, pattern: RegExp): FileReferenceInfo[] {
  const seen = new Set<string>();
  const files: FileReferenceInfo[] = [];

  for (const match of fileBlock.matchAll(pattern)) {
    const path = unescapeHtmlEntities(match[1]);
    const lines = match[2] ?? '';
    const dedupeKey = lines ? `${path}#${lines}` : path;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const [startLineToken, endLineToken] = lines.split('-');
    const startLine = parseLineNumber(startLineToken);
    const endLine = parseLineNumber(endLineToken ?? startLineToken);
    const fileName = path.split('/').pop() ?? path;
    const displayName = startLine
      ? `${fileName}:${startLine === endLine || !endLine ? String(startLine) : `${startLine}-${endLine}`}`
      : fileName;

    files.push({
      kind: 'file',
      relativePath: path,
      absolutePath: isAbsolutePath(path) ? path : undefined,
      displayName,
      startLine,
      endLine,
    });
  }

  return files;
}

export function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path);
}

export function unescapeHtmlEntities(value: string): string {
  const div = document.createElement('div');
  div.innerHTML = value;
  return div.textContent ?? value;
}

function parseLineNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function stripInlineFileMarkers(
  text: string,
  files: FileReferenceInfo[]
): { text: string; files: FileReferenceInfo[] } {
  let result = '';
  let remaining = text;
  const normalizedFiles: FileReferenceInfo[] = [];

  for (const file of files) {
    const markers = [
      buildInlineFileMarker(file),
      buildInlineFileMarker({ ...file, absolutePath: undefined }),
      `@${file.relativePath}`,
    ];
    let marker = '';
    let markerIndex = -1;
    for (const candidate of markers) {
      const candidateIndex = remaining.indexOf(candidate);
      if (candidateIndex !== -1) {
        marker = candidate;
        markerIndex = candidateIndex;
        break;
      }
    }
    if (markerIndex === -1) {
      normalizedFiles.push(file);
      continue;
    }

    const beforeMarker = remaining.slice(0, markerIndex);
    result += beforeMarker;
    normalizedFiles.push({
      ...file,
      insertOffset: result.length,
    });

    remaining = remaining.slice(markerIndex + marker.length);
    if (result.endsWith(' ') && remaining.startsWith(' ')) {
      remaining = remaining.slice(1);
    }
  }

  result += remaining;
  return { text: result, files: normalizedFiles };
}

export function normalizeInlineFileDisplay(
  text: string,
  files: FileReferenceInfo[]
): { text: string; files: FileReferenceInfo[] } {
  if (files.length === 0) {
    return { text, files };
  }

  const hasInlineMarkers = files.some((file) =>
    text.includes(`@${file.relativePath}`) ||
    text.includes(buildInlineFileMarker({ ...file, absolutePath: undefined })) ||
    (file.absolutePath ? text.includes(buildInlineFileMarker(file)) : false)
  );
  const hasExplicitOffsets = files.some((file) => typeof file.insertOffset === 'number');
  if (!hasInlineMarkers && hasExplicitOffsets) {
    return { text, files };
  }

  return stripInlineFileMarkers(text, files);
}

export function shouldCollapseUserMessage(text: string): boolean {
  if (text.length > USER_MESSAGE_COLLAPSE_CHAR_LIMIT) return true;
  return text.split('\n').length > USER_MESSAGE_COLLAPSE_LINE_LIMIT;
}

export function buildInlineUserNodes(text: string, files: FileReferenceInfo[], filesClickable = false): ReactNode[] {
  const positionedFiles = files
    .filter((file) => typeof file.insertOffset === 'number')
    .map((file) => ({
      ...file,
      insertOffset: Math.max(0, Math.min(text.length, file.insertOffset ?? 0)),
    }))
    .sort((left, right) => (left.insertOffset ?? 0) - (right.insertOffset ?? 0));

  const nodes: ReactNode[] = [];
  if (positionedFiles.length === 0) {
    files.forEach((file, index) => {
      nodes.push(<AttachedFileChip file={file} clickable={filesClickable} key={`file-${file.relativePath}-${index}`} />);
    });
    if (text) {
      nodes.push(
        <span className="user-inline-text" key="text-tail">
          {text}
        </span>
      );
    }
    return nodes;
  }

  let textOffset = 0;
  positionedFiles.forEach((file, index) => {
    const insertOffset = file.insertOffset ?? 0;
    const before = text.slice(textOffset, insertOffset);
    if (before) {
      nodes.push(
        <span className="user-inline-text" key={`text-${index}-${textOffset}`}>
          {before}
        </span>
      );
    }
    nodes.push(<AttachedFileChip file={file} clickable={filesClickable} key={`file-${file.relativePath}-${index}`} />);
    textOffset = insertOffset;
  });

  const trailingText = text.slice(textOffset);
  if (trailingText) {
    nodes.push(
      <span className="user-inline-text" key="text-trailing">
        {trailingText}
      </span>
    );
  }
  return nodes;
}

export interface HistoryCallbacks {
  onToggleExpandedUserMessage: (index: number) => void;
  onRestoreCheckpoint: (turnNumber: number) => void;
  onRedoCheckpoint: () => void;
  onOpenDiff: (filePath: string, toolCallId: string) => void;
  onOpenFile: (filePath: string, startLine?: number, endLine?: number) => void;
}

export function buildHistoryNodes(
  state: WebviewState,
  expandedUserMessages: Record<number, boolean>,
  callbacks: HistoryCallbacks
): ReactNode[] {
  const nodes: ReactNode[] = [];
  let userMessageCount = 0;
  let dimming = false;
  let redoPlaced = false;

  for (let index = 0; index < state.messages.length; index++) {
    const message = state.messages[index];
    const role = message.role ?? 'unknown';

    if (role === 'user') {
      userMessageCount++;
      if (state.rollbackPoint !== null && userMessageCount > state.rollbackPoint) {
        dimming = true;
      }
    }

    const rendered = renderHistoryMessage({
      message,
      index,
      userTurnNumber: role === 'user' ? userMessageCount : undefined,
      state,
      dimmed: dimming,
      expanded: !!expandedUserMessages[index],
      callbacks,
    });

    if (rendered) {
      nodes.push(rendered);
    }

    if (role === 'user' && dimming && !redoPlaced && state.rollbackPoint !== null) {
      nodes.push(
        <div className="redo-anchor" key={`redo-${index}`}>
          <button className="redo-btn" title="Redo changes" type="button" onClick={callbacks.onRedoCheckpoint}>
            Redo
          </button>
        </div>
      );
      redoPlaced = true;
    }
  }

  return nodes;
}

interface RenderHistoryMessageOptions {
  message: ChatMessage;
  index: number;
  userTurnNumber?: number;
  state: WebviewState;
  dimmed: boolean;
  expanded: boolean;
  callbacks: HistoryCallbacks;
}

export function renderHistoryMessage(options: RenderHistoryMessageOptions): ReactNode | null {
  const { message, index, userTurnNumber, state, dimmed, expanded, callbacks } = options;
  const role = message.role ?? 'unknown';

  if (role === 'toolResult' || role === 'tool') {
    const toolName = typeof message.toolName === 'string' ? message.toolName : '';
    if (toolName === 'edit' || toolName === 'write') {
      const matchingChange = findFileChangeForToolResult(message, state.fileChanges);
      if (matchingChange) {
        return (
          <div className={dimmed ? 'dimmed' : undefined} key={`msg-${index}`}>
            <DiffCard change={matchingChange} timestamp={message.timestamp} onOpenDiff={callbacks.onOpenDiff} />
          </div>
        );
      }
    }
    return (
      <div className={dimmed ? 'dimmed' : undefined} key={`msg-${index}`}>
        <ToolResultCard
          message={message}
          allMessages={state.messages}
          index={index}
          onOpenFile={callbacks.onOpenFile}
        />
      </div>
    );
  }

  if (role === 'user') {
    const rawText = extractText(message);
    const fallback = extractUserPromptDisplay(rawText);
    const userText = typeof message._displayText === 'string' ? message._displayText : fallback.userText;
    const files = Array.isArray(message._attachedFiles) ? message._attachedFiles : fallback.files;
    const normalized = normalizeInlineFileDisplay(userText, files);
    const footer = buildMessageFooter(state.messages, message, index);

    return (
        <div className={`message-group-user${dimmed ? ' dimmed' : ''}`} key={`msg-${index}`}>
        <div className="message message-user" tabIndex={0}>
          {userTurnNumber !== undefined && !state.isStreaming ? (
            <button
              className="checkpoint-btn"
              title="Restore to this checkpoint"
              data-turn={String(userTurnNumber)}
              type="button"
              onClick={() => callbacks.onRestoreCheckpoint(userTurnNumber)}
            >
              &#8634;
            </button>
          ) : null}
          {normalized.text || normalized.files.length > 0 ? (
            <UserMessageContent
              text={normalized.text}
              files={normalized.files}
              expanded={expanded}
              onToggle={() => callbacks.onToggleExpandedUserMessage(index)}
              filesClickable
            />
          ) : null}
        </div>
        {footer ? <div className="message-footer">{footer}</div> : null}
      </div>
    );
  }

  const thinking = extractThinking(message);
  const text = extractText(message);
  if (!thinking && !text) {
    return null;
  }

  const footer = buildMessageFooter(state.messages, message, index);
  return (
    <div className={`message-group-assistant${dimmed ? ' dimmed' : ''}`} key={`msg-${index}`}>
      <div className="message message-assistant" tabIndex={0}>
        {thinking ? (
          <ThinkingBlock
            text={thinking}
            active={false}
            durationSec={message._thinkingDurationSec}
            idPrefix={`thinking-${index}`}
          />
        ) : null}
        {text ? (
          <div
            className="message-content"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(text, `msg-${index}`) }}
          />
        ) : null}
      </div>
      {footer ? <div className="message-footer">{footer}</div> : null}
    </div>
  );
}
