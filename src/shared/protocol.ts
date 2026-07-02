export interface ContextUsageInfo {
    tokens: number | null;
    contextWindow: number;
    percent: number | null;
}

export type CompletionSound = 'off' | 'chime' | 'subtle';

export interface SettingsData {
    apiProvider: string;
    apiBaseUrl: string;
    apiKeySet: boolean;
    authMethod: 'env' | 'pi-login' | 'manual' | 'none';
    defaultModel: string;
    thinkingLevel: string;
    autoApproveTools: boolean;
    allowedTools: string[];
    autoSaveSessions: boolean;
    sessionStoragePath: string;
    contextUsageWarningThreshold: number;
    completionSound: CompletionSound;
    sessionNamingModel: string;
}

export interface ToolCallPendingInfo {
    toolCallId: string;
    toolName: string;
    args: any;
}

export interface FileChangeInfo {
    filePath: string;
    toolCallId: string;
    toolName: string;
    isNew: boolean;
    diff?: string;
    addedLines: number;
    removedLines: number;
    turnIndex: number;
}

export interface TabInfo {
    id: string;
    name: string;
    isActive: boolean;
    isStreaming: boolean;
    hasNotification: boolean;
}

export interface SerializedAgentState {
    messages: any[];
    model?: ModelInfo;
    thinkingLevel?: string;
    isStreaming: boolean;
    streamingMessage?: any;
    errorMessage?: string;
    tools: string[];
    sessionId?: string;
    sessionName?: string;
    contextUsage?: ContextUsageInfo;
    fileChanges?: FileChangeInfo[];
    rollbackPoint?: number | null;
    tabs?: TabInfo[];
    activeTabId?: string;
    streamingText?: string;
    streamingThinking?: string;
    isThinking?: boolean;
    thinkingStartTime?: number;
    streamingThinkingDuration?: number;
    queuedMessages?: string[];
    completionSound?: CompletionSound;
}

export interface ModelInfo {
    provider: string;
    id: string;
    name?: string;
    reasoning?: boolean;
    thinkingLevelMap?: Record<string, string | null>;
}

export interface SkillInfo {
    name: string;
    description: string;
    filePath: string;
    source: string;
    disableModelInvocation: boolean;
}

export interface ModeInfo {
    name: string;
    label?: string;
    description?: string;
    readOnly?: boolean;
}

export interface ModesState {
    available: ModeInfo[];
    current?: string;
    installed: boolean;
}

export interface UsageWindowDTO {
    key: string;
    label: string;
    usedPercent: number;
    resetAt?: number;
    unavailableReason?: string;
}

export interface UsageBalanceDTO {
    label: string;
    remaining: number | null;
    unit: string;
}

export interface UsageProviderDTO {
    id: string;
    label: string;
    status: 'live' | 'cached' | 'stale' | 'local' | 'unavailable';
    windows: UsageWindowDTO[];
    balances: UsageBalanceDTO[];
    planName?: string;
    diagnostic: string;
    diagnostics: string[];
    fetchedAt: number;
}

export interface UsagePeriodRowDTO {
    key: string;
    sessionCount: number;
    messageCount: number;
    cost: number;
    tokens: number;
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
}

export interface UsagePeriodDTO {
    key: string;
    total: UsagePeriodRowDTO;
    providers: UsagePeriodRowDTO[];
    modelsByProvider: Record<string, UsagePeriodRowDTO[]>;
}

export interface UsageSnapshotDTO {
    available: boolean;
    currentProviderId: string | null;
    currentModelLabel?: string;
    providers: UsageProviderDTO[];
    periods: UsagePeriodDTO[];
    diagnostics: string[];
    generatedAt: number;
    loading: boolean;
}

export interface SessionInfo {
    id: string;
    name?: string;
    path: string;
    created?: number;
    lastModified?: number;
    messageCount?: number;
    firstMessage?: string;
}

export interface FileReferenceInfo {
    kind?: 'file' | 'directory';
    relativePath: string;
    absolutePath?: string;
    displayName: string;
    insertOffset?: number;
    selectionId?: string;
    startLine?: number;
    endLine?: number;
}

export interface EditorSelectionInfo {
    id: string;
    relativePath: string;
    absolutePath?: string;
    displayName: string;
    startLine: number;
    endLine: number;
}

export interface ResolvedFileReference {
    token: string;
    kind: 'workspace' | 'external' | 'unresolved';
    file: FileReferenceInfo | null;
}

export interface DebugBridgeLogEntry {
    seq: number;
    timestamp: number;
    level: 'log' | 'info' | 'warn' | 'error';
    text: string;
    args: unknown[];
}

export type DebugBridgeRequest =
    | { kind: 'evaluate'; requestId: string; code: string }
    | { kind: 'simulateDrop'; requestId: string; path: string; selector?: string };

export type DebugBridgeClientEvent =
    | { kind: 'ready'; href: string; title: string }
    | { kind: 'log'; level: DebugBridgeLogEntry['level']; args: unknown[]; timestamp: number }
    | { kind: 'pageError'; message: string; stack?: string; source?: string; lineno?: number; colno?: number; timestamp: number }
    | { kind: 'unhandledRejection'; reason: unknown; timestamp: number }
    | { kind: 'response'; requestId: string; ok: true; result: unknown }
    | { kind: 'response'; requestId: string; ok: false; error: { message: string; stack?: string } };

// Webview -> Extension messages
export type ClientMessage =
    | { type: 'prompt'; text: string; images?: string[]; files?: FileReferenceInfo[] }
    | { type: 'steer'; text: string }
    | { type: 'followUp'; text: string }
    | { type: 'abort' }
    | { type: 'getModels' }
    | { type: 'setModel'; provider: string; modelId: string }
    | { type: 'setThinkingLevel'; level: string }
    | { type: 'newSession' }
    | { type: 'loadSession'; sessionPath: string }
    | { type: 'getSessions' }
    | { type: 'getSessionsSnapshot' }
    | { type: 'getState' }
    | { type: 'approveToolCall'; toolCallId: string }
    | { type: 'rejectToolCall'; toolCallId: string }
    | { type: 'openFile'; filePath: string; startLine?: number; endLine?: number }
    | { type: 'openDiff'; filePath: string; toolCallId: string }
    | { type: 'undoFileChange'; filePath: string; toolCallId: string }
    | { type: 'restoreCheckpoint'; messageIndex: number }
    | { type: 'redoCheckpoint' }
    | { type: 'confirmAction'; action: string; message: string; payload?: any }
    | { type: 'createTab' }
    | { type: 'closeTab'; tabId: string }
    | { type: 'switchTab'; tabId: string }
    | { type: 'openSettings' }
    | { type: 'getSkills' }
    | { type: 'getModes' }
    | { type: 'setMode'; mode: string }
    | { type: 'searchFiles'; query: string }
    | { type: 'resolveFileReferences'; requestId: string; tokens: string[] }
    | { type: 'resolveDroppedFiles'; requestId: string; paths: string[] }
    | { type: 'editorSelectionAdded'; selectionId: string }
    | { type: 'queueMessage'; text: string }
    | { type: 'editQueuedMessage'; index: number; text: string }
    | { type: 'removeQueuedMessage'; index: number }
    | { type: 'cancelQueue' }
    | { type: 'requestUsage' }
    | { type: 'refreshUsage' }
    | { type: '__debugBridge'; message: DebugBridgeClientEvent };

// Settings webview -> Extension messages
export type SettingsClientMessage =
    | { type: 'getSettings' }
    | { type: 'updateSetting'; key: string; value: any }
    | { type: 'setApiKey'; provider: string; key: string }
    | { type: 'clearApiKey'; provider: string }
    | { type: 'getSkills' };

// Extension -> Webview messages
export type ServerMessage =
    | { type: 'ready' }
    | { type: 'stateSync'; state: SerializedAgentState }
    | { type: 'addEditorSelection'; selection: EditorSelectionInfo }
    | { type: 'agentEvent'; event: any }
    | { type: 'models'; models: ModelInfo[]; current?: ModelInfo; thinkingLevel?: string }
    | { type: 'modelChanged'; model: ModelInfo; thinkingLevel?: string }
    | { type: 'sessions'; sessions: SessionInfo[]; currentSessionId?: string }
    | { type: 'sessionsSnapshot'; sessions: SessionInfo[]; currentSessionId?: string }
    | { type: 'sessionChanged'; sessionId: string }
    | { type: 'fileChange'; change: FileChangeInfo }
    | { type: 'confirmResult'; action: string; confirmed: boolean; payload?: any }
    | { type: 'toolCallPending'; pending: ToolCallPendingInfo }
    | { type: 'toolCallResolved'; toolCallId: string }
    | { type: 'skills'; skills: SkillInfo[] }
    | { type: 'modes'; modes: ModeInfo[]; current?: string; installed: boolean }
    | { type: 'fileSuggestions'; query: string; items: FileReferenceInfo[] }
    | { type: 'resolvedFileReferences'; requestId: string; items: ResolvedFileReference[] }
    | { type: 'resolvedDroppedFiles'; requestId: string; items: ResolvedFileReference[] }
    | { type: 'usageUpdate'; usage: UsageSnapshotDTO }
    | { type: '__debugBridgeRequest'; request: DebugBridgeRequest }
    | { type: 'error'; message: string };

// Extension -> Settings webview messages
export type SettingsServerMessage =
    | { type: 'settings'; data: SettingsData }
    | { type: 'settingChanged'; key: string; value: any }
    | { type: 'skills'; skills: SkillInfo[] }
    | { type: 'error'; message: string };
