export interface ContextUsageInfo {
    tokens: number | null;
    contextWindow: number;
    percent: number | null;
}

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
    lastModified?: number;
}

export interface FileReferenceInfo {
    relativePath: string;
    absolutePath?: string;
    displayName: string;
    insertOffset?: number;
}

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
    | { type: 'getState' }
    | { type: 'approveToolCall'; toolCallId: string }
    | { type: 'rejectToolCall'; toolCallId: string }
    | { type: 'openFile'; filePath: string }
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
    | { type: 'searchFiles'; query: string }
    | { type: 'queueMessage'; text: string }
    | { type: 'editQueuedMessage'; index: number; text: string }
    | { type: 'removeQueuedMessage'; index: number }
    | { type: 'cancelQueue' }
    | { type: 'requestUsage' }
    | { type: 'refreshUsage' };

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
    | { type: 'agentEvent'; event: any }
    | { type: 'models'; models: ModelInfo[]; current?: ModelInfo; thinkingLevel?: string }
    | { type: 'modelChanged'; model: ModelInfo; thinkingLevel?: string }
    | { type: 'sessions'; sessions: SessionInfo[]; currentSessionId?: string }
    | { type: 'sessionChanged'; sessionId: string }
    | { type: 'fileChange'; change: FileChangeInfo }
    | { type: 'confirmResult'; action: string; confirmed: boolean; payload?: any }
    | { type: 'toolCallPending'; pending: ToolCallPendingInfo }
    | { type: 'toolCallResolved'; toolCallId: string }
    | { type: 'skills'; skills: SkillInfo[] }
    | { type: 'fileSuggestions'; query: string; items: FileReferenceInfo[] }
    | { type: 'usageUpdate'; usage: UsageSnapshotDTO }
    | { type: 'error'; message: string };

// Extension -> Settings webview messages
export type SettingsServerMessage =
    | { type: 'settings'; data: SettingsData }
    | { type: 'settingChanged'; key: string; value: any }
    | { type: 'skills'; skills: SkillInfo[] }
    | { type: 'error'; message: string };
