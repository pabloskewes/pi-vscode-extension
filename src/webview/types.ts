import type {
  FileChangeInfo,
  FileReferenceInfo,
  ModelInfo,
  SkillInfo,
  TabInfo,
  ToolCallPendingInfo,
} from '../shared/protocol';

export interface WebviewState {
  messages: ChatMessage[];
  isStreaming: boolean;
  model?: ModelInfo;
  thinkingLevel?: string;
  tools: string[];
  sessionId?: string;
  sessionName?: string;
  streamingText: string;
  streamingThinking: string;
  isThinking: boolean;
  thinkingStartTime: number;
  streamingThinkingDuration: number;
  contextUsage?: ContextUsageInfo;
  fileChanges: FileChangeInfo[];
  rollbackPoint: number | null;
  availableModels: ModelInfo[];
  recentModels: ModelInfo[];
  tabs: TabInfo[];
  activeTabId: string;
  skills: SkillInfo[];
  queuedMessages: string[];
  pendingImages: Array<{ dataUrl: string; name: string }>;
}

export interface ContextUsageInfo {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
}

export type StreamingItem =
  | {
      kind: 'tool';
      toolCallId: string;
      toolName: string;
      args: unknown;
      status: 'running' | 'done' | 'error';
      partialText: string;
      resultText: string;
      isRead: boolean;
      filePath: string;
    }
  | {
      kind: 'diff-loading';
      toolCallId: string;
      path: string;
      status: 'running' | 'done' | 'error';
    }
  | {
      kind: 'diff';
      change: FileChangeInfo;
    };

export interface ComposerPayload {
  text: string;
  files: FileReferenceInfo[];
}

export interface FileMenuState {
  items: FileReferenceInfo[];
  index: number;
  query: string;
}

export interface SlashMenuState {
  items: SkillInfo[];
  index: number;
}

export interface ChatMessageContentItem {
  type: 'text' | 'thinking' | 'toolCall' | 'tool_call' | 'tool_use';
  text?: string;
  thinking?: string;
}

export interface ChatMessageToolCall {
  id?: string;
  toolCallId?: string;
  tool_call_id?: string;
  name?: string;
  toolName?: string;
  arguments?: unknown;
  args?: unknown;
  input?: unknown;
}

export interface ChatMessage {
  role?: 'user' | 'assistant' | 'tool' | 'toolResult' | string;
  content?: string | ChatMessageContentItem[];
  text?: string;
  thinking?: string;
  toolName?: string;
  toolCallId?: string;
  tool_call_id?: string;
  toolCalls?: ChatMessageToolCall[];
  tool_calls?: ChatMessageToolCall[];
  timestamp?: number;
  isError?: boolean;
  _displayText?: string;
  _attachedFiles?: FileReferenceInfo[];
  _thinkingDurationSec?: number;
  _messageEndTime?: number;
  usage?: { input: number; output: number };
  [key: string]: unknown;
}

export interface AssistantMessageEventThinkingStart {
  type: 'thinking_start';
}

export interface AssistantMessageEventThinkingDelta {
  type: 'thinking_delta';
  delta?: string;
}

export interface AssistantMessageEventThinkingEnd {
  type: 'thinking_end';
}

export interface AssistantMessageEventTextDelta {
  type: 'text_delta';
  delta?: string;
}

export type AssistantMessageEvent =
  | AssistantMessageEventThinkingStart
  | AssistantMessageEventThinkingDelta
  | AssistantMessageEventThinkingEnd
  | AssistantMessageEventTextDelta;

export interface AgentMessageUpdateEvent {
  type: 'message_update';
  assistantMessageEvent?: AssistantMessageEvent;
}

export interface AgentStartEvent {
  type: 'agent_start';
}

export interface AgentEndEvent {
  type: 'agent_end';
}

export interface StreamingToolStartEvent {
  type: 'tool_execution_start';
  toolCallId: string;
  toolName: string;
  args?: unknown;
}

export interface StreamingToolUpdateEvent {
  type: 'tool_execution_update';
  toolCallId: string;
  partialResult?: unknown;
}

export interface StreamingToolEndEvent {
  type: 'tool_execution_end';
  toolCallId: string;
  isError?: boolean;
  result?: unknown;
}

export type AgentEvent =
  | AgentMessageUpdateEvent
  | AgentStartEvent
  | AgentEndEvent
  | StreamingToolStartEvent
  | StreamingToolUpdateEvent
  | StreamingToolEndEvent;
