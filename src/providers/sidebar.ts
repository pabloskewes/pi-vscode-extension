import * as vscode from 'vscode';
import * as path from 'path';
import { PiSessionManager } from '../pi/session';
import type { ClientMessage, FileReferenceInfo, ResolvedFileReference, ServerMessage, TabInfo } from '../shared/protocol';
import { DiffManager } from './diff';
import { CheckpointManager } from './checkpoint';
import { UsageBridge } from './usage-bridge';

const FILE_SEARCH_RESULT_LIMIT = 24;
const FILE_CONTEXT_MAX_FILES = 6;
const FILE_CONTEXT_MAX_CHARS_PER_FILE = 20000;
const FILE_CONTEXT_MAX_TOTAL_CHARS = 60000;

interface MessageMeta {
    thinkingDurationSec: number;
    messageEndTime: number;
}

interface PendingApproval {
    resolve: (approved: boolean) => void;
}

interface TabState {
    id: string;
    name: string;
    session: PiSessionManager;
    diffManager: DiffManager;
    checkpointManager: CheckpointManager;
    turnCounter: number;
    suspendedMessages: any[];
    streamingText: string;
    streamingThinking: string;
    isThinking: boolean;
    thinkingStartTime: number;
    streamingThinkingDuration: number;
    agentStartTime: number;
    messageMeta: Map<number, MessageMeta>;
    hasNotification: boolean;
    pendingApprovals: Map<string, PendingApproval>;
    queuedMessages: string[];
    isStreaming: boolean;
    userPromptDisplay: Map<number, { text: string; files: FileReferenceInfo[] }>;
}

let tabIdCounter = 0;
function nextTabId(): string {
    return `tab-${++tabIdCounter}`;
}

function makeTabState(
    id: string,
    session: PiSessionManager,
    diffManager: DiffManager,
    checkpointManager: CheckpointManager,
): TabState {
    return {
        id,
        name: 'New Agent',
        session,
        diffManager,
        checkpointManager,
        turnCounter: 0,
        suspendedMessages: [],
        streamingText: '',
        streamingThinking: '',
        isThinking: false,
        thinkingStartTime: 0,
        streamingThinkingDuration: 0,
        agentStartTime: 0,
        messageMeta: new Map(),
        hasNotification: false,
        pendingApprovals: new Map(),
        queuedMessages: [],
        isStreaming: false,
        userPromptDisplay: new Map(),
    };
}

export class SidebarProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private _extensionUri: vscode.Uri;
    private _outputChannel: vscode.OutputChannel;

    private _tabs = new Map<string, TabState>();
    private _activeTabId = '';
    private _tabSubscriptions = new Map<string, (() => void)[]>();
    private _usageBridge: UsageBridge;
    private _workspaceFilesCache: FileReferenceInfo[] | undefined;

    constructor(
        extensionUri: vscode.Uri,
        initialSession: PiSessionManager,
        initialDiffManager: DiffManager,
        initialCheckpointManager: CheckpointManager,
        outputChannel: vscode.OutputChannel,
    ) {
        this._extensionUri = extensionUri;
        this._outputChannel = outputChannel;
        this._usageBridge = new UsageBridge(outputChannel);

        const id = nextTabId();
        const tab = makeTabState(id, initialSession, initialDiffManager, initialCheckpointManager);
        this._tabs.set(id, tab);
        this._activeTabId = id;
        this._subscribeTab(tab);

        this._usageBridge.onUpdate((usage) => {
            this._post({ type: 'usageUpdate', usage });
        });
    }

    private get _activeTab(): TabState {
        return this._tabs.get(this._activeTabId)!;
    }

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ): void {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri],
        };

        webviewView.webview.html = this._getHtml(webviewView.webview);

        webviewView.webview.onDidReceiveMessage((msg: ClientMessage) => {
            this._handleMessage(msg);
        });

        webviewView.onDidDispose(() => {
            for (const [, unsubs] of this._tabSubscriptions) {
                for (const unsub of unsubs) unsub();
            }
            this._tabSubscriptions.clear();
            this._usageBridge.dispose();
        });

        this._post({ type: 'ready' });
        this.sendStateSync();
    }

    private _subscribeTab(tab: TabState): void {
        const unsubs: (() => void)[] = [];

        unsubs.push(
            tab.session.events.onAll((event) => {
                this._handleTabEvent(tab, event);
            }),
        );

        unsubs.push(
            tab.diffManager.onFileChange((change) => {
                if (tab.id === this._activeTabId) {
                    this._post({ type: 'fileChange', change });
                }
            }),
        );

        tab.session.setToolApprovalHandler(async (toolCallId, toolName, args) => {
            return this._requestToolApproval(tab, toolCallId, toolName, args);
        });

        if (tab.id === this._activeTabId) {
            this._usageBridge.attach(tab.session.session);
        }

        this._tabSubscriptions.set(tab.id, unsubs);
    }

    private _unsubscribeTab(tabId: string): void {
        const unsubs = this._tabSubscriptions.get(tabId);
        if (unsubs) {
            for (const unsub of unsubs) unsub();
            this._tabSubscriptions.delete(tabId);
        }
    }

    private _handleTabEvent(tab: TabState, event: any): void {
        const isActive = tab.id === this._activeTabId;

        if (event.type === 'agent_start') {
            tab.isStreaming = true;
            tab.streamingText = '';
            tab.streamingThinking = '';
            tab.isThinking = false;
            tab.thinkingStartTime = 0;
            tab.streamingThinkingDuration = 0;
            tab.agentStartTime = Date.now();
            if (isActive) {
                vscode.commands.executeCommand('setContext', 'pi-agent.isStreaming', true);
            }
        }

        if (event.type === 'message_end' && event.message?.role === 'assistant') {
            const msgs = tab.session.getMessages();
            let assistantOrdinal = 0;
            let lastOrdinal = -1;
            for (let i = 0; i < msgs.length; i++) {
                if (msgs[i].role === 'assistant') {
                    lastOrdinal = assistantOrdinal;
                    assistantOrdinal++;
                }
            }
            if (lastOrdinal >= 0) {
                tab.messageMeta.set(lastOrdinal, {
                    thinkingDurationSec: tab.streamingThinkingDuration,
                    messageEndTime: Date.now(),
                });
            }
            tab.streamingThinkingDuration = 0;
        }

        if (event.type === 'agent_end') {
            tab.isStreaming = false;
            tab.streamingText = '';
            tab.streamingThinking = '';
            tab.isThinking = false;
            tab.thinkingStartTime = 0;
            tab.streamingThinkingDuration = 0;
            tab.agentStartTime = 0;
            if (isActive) {
                vscode.commands.executeCommand('setContext', 'pi-agent.isStreaming', false);
            } else {
                tab.hasNotification = true;
            }

            if (tab.queuedMessages.length > 0) {
                const text = tab.queuedMessages.shift()!;
                if (tab.checkpointManager.rollbackPoint !== null) {
                    tab.checkpointManager.discardSuspended();
                    tab.diffManager.discardSuspended();
                    tab.suspendedMessages = [];
                }
                tab.turnCounter++;
                const turnIdx = tab.turnCounter;
                tab.checkpointManager.startTurn(turnIdx);
                tab.diffManager.setCurrentTurn(turnIdx);
                tab.session.followUp(text);
            }
        }

        if (event.type === 'message_update' && event.assistantMessageEvent) {
            const ae = event.assistantMessageEvent;
            switch (ae.type) {
                case 'thinking_start':
                    tab.isThinking = true;
                    tab.streamingThinking = '';
                    tab.thinkingStartTime = Date.now();
                    tab.streamingThinkingDuration = 0;
                    break;
                case 'thinking_delta':
                    tab.streamingThinking += ae.delta ?? '';
                    break;
                case 'thinking_end':
                    tab.isThinking = false;
                    if (tab.thinkingStartTime > 0) {
                        tab.streamingThinkingDuration = Math.round(
                            (Date.now() - tab.thinkingStartTime) / 1000
                        );
                    }
                    break;
                case 'text_delta':
                    tab.streamingText += ae.delta ?? '';
                    break;
            }
        }

        this._updateTabName(tab);

        if (isActive) {
            this._post({ type: 'agentEvent', event: safeSerialize(event) });

            if (
                event.type === 'agent_start' ||
                event.type === 'agent_end' ||
                event.type === 'message_end' ||
                event.type === 'turn_end'
            ) {
                this.sendStateSync();
            }
        } else if (event.type === 'agent_start' || event.type === 'agent_end') {
            this.sendStateSync();
        }
    }

    private _updateTabName(tab: TabState): void {
        const sessionName = tab.session.session?.sessionName;
        if (sessionName && tab.name !== sessionName) {
            tab.name = sessionName;
        }
    }

    sendStateSync(): void {
        const tab = this._activeTab;
        if (!tab) return;

        const state = tab.session.serializeState();
        state.isStreaming = tab.isStreaming;
        if (tab.suspendedMessages.length > 0) {
            state.messages = [
                ...state.messages,
                ...tab.suspendedMessages.map((m: any) => safeSerialize(m)),
            ];
        }
        state.fileChanges = tab.diffManager.fileChanges;
        state.rollbackPoint = tab.checkpointManager.rollbackPoint;
        state.tabs = this._getTabInfos();
        state.activeTabId = this._activeTabId;
        state.streamingText = tab.streamingText;
        state.streamingThinking = tab.streamingThinking;
        state.isThinking = tab.isThinking;
        state.thinkingStartTime = tab.thinkingStartTime;
        state.streamingThinkingDuration = tab.streamingThinkingDuration;
        if (tab.queuedMessages.length > 0) {
            state.queuedMessages = tab.queuedMessages;
        }
        let assistantOrdinal = 0;
        let userOrdinal = 0;
        for (let i = 0; i < state.messages.length; i++) {
            if (state.messages[i].role === 'user') {
                userOrdinal++;
                const display = tab.userPromptDisplay.get(userOrdinal);
                if (display) {
                    state.messages[i]._displayText = display.text;
                    state.messages[i]._attachedFiles = display.files;
                }
            }
            if (state.messages[i].role === 'assistant') {
                const meta = tab.messageMeta.get(assistantOrdinal);
                if (meta) {
                    state.messages[i]._thinkingDurationSec = meta.thinkingDurationSec;
                    state.messages[i]._messageEndTime = meta.messageEndTime;
                }
                assistantOrdinal++;
            }
        }
        this._post({ type: 'stateSync', state });
    }

    private _getTabInfos(): TabInfo[] {
        return [...this._tabs.entries()].map(([id, tab]) => ({
            id,
            name: tab.name,
            isActive: id === this._activeTabId,
            isStreaming: tab.isStreaming,
            hasNotification: tab.hasNotification,
        }));
    }

    private _post(message: ServerMessage): void {
        this._view?.webview.postMessage(message);
    }

    private async _handleMessage(msg: ClientMessage): Promise<void> {
        try {
            const tab = this._activeTab;

            switch (msg.type) {
                case 'prompt': {
                    if (tab.checkpointManager.rollbackPoint !== null) {
                        tab.checkpointManager.discardSuspended();
                        tab.diffManager.discardSuspended();
                        tab.suspendedMessages = [];
                    }
                    tab.turnCounter++;
                    const turnIdx = tab.turnCounter;
                    tab.checkpointManager.startTurn(turnIdx);
                    tab.diffManager.setCurrentTurn(turnIdx);
                    tab.userPromptDisplay.set(turnIdx, { text: msg.text, files: msg.files ?? [] });
                    const promptText = await this._buildPromptText(msg.text, msg.files ?? []);
                    await tab.session.prompt(promptText, msg.images);
                    break;
                }
                case 'steer':
                    await tab.session.steer(msg.text);
                    break;
                case 'queueMessage':
                    tab.queuedMessages.push(msg.text);
                    this.sendStateSync();
                    break;
                case 'editQueuedMessage':
                    if (msg.index >= 0 && msg.index < tab.queuedMessages.length && msg.text.trim()) {
                        tab.queuedMessages[msg.index] = msg.text.trim();
                    }
                    this.sendStateSync();
                    break;
                case 'removeQueuedMessage':
                    if (msg.index >= 0 && msg.index < tab.queuedMessages.length) {
                        tab.queuedMessages.splice(msg.index, 1);
                    }
                    this.sendStateSync();
                    break;
                case 'cancelQueue':
                    tab.queuedMessages = [];
                    this.sendStateSync();
                    break;
                case 'followUp':
                    await tab.session.followUp(msg.text);
                    break;
                case 'abort':
                    await tab.session.abort();
                    break;
                case 'getModels': {
                    const models = tab.session.getModels();
                    const current = tab.session.getCurrentModel();
                    const thinkingLevel = tab.session.getThinkingLevel();
                    this._post({ type: 'models', models, current, thinkingLevel });
                    break;
                }
                case 'setModel':
                    await tab.session.setModel(msg.provider, msg.modelId);
                    this.sendStateSync();
                    break;
                case 'setThinkingLevel':
                    tab.session.setThinkingLevel(msg.level);
                    this.sendStateSync();
                    break;
                case 'newSession':
                    await tab.session.newSession();
                    tab.diffManager.clearAll();
                    tab.checkpointManager.clearAll();
                    tab.turnCounter = 0;
                    tab.suspendedMessages = [];
                    tab.name = 'New Agent';
                    tab.isStreaming = false;
                    tab.streamingText = '';
                    tab.streamingThinking = '';
                    tab.isThinking = false;
                    tab.thinkingStartTime = 0;
                    tab.streamingThinkingDuration = 0;
                    tab.agentStartTime = 0;
                    tab.messageMeta.clear();
                    tab.userPromptDisplay.clear();
                    tab.queuedMessages = [];
                    this._usageBridge.attach(tab.session.session);
                    this.sendStateSync();
                    break;
                case 'loadSession':
                    await tab.session.loadSession(msg.sessionPath);
                    tab.diffManager.clearAll();
                    tab.checkpointManager.clearAll();
                    tab.turnCounter = 0;
                    tab.suspendedMessages = [];
                    tab.isStreaming = false;
                    tab.streamingText = '';
                    tab.streamingThinking = '';
                    tab.isThinking = false;
                    tab.thinkingStartTime = 0;
                    tab.streamingThinkingDuration = 0;
                    tab.agentStartTime = 0;
                    tab.messageMeta.clear();
                    tab.userPromptDisplay.clear();
                    tab.queuedMessages = [];
                    this._updateTabName(tab);
                    this._usageBridge.attach(tab.session.session);
                    this.sendStateSync();
                    break;
                case 'getSessions': {
                    const sessions = await tab.session.getSessions();
                    const currentId = tab.session.session?.sessionId;
                    this._post({ type: 'sessions', sessions, currentSessionId: currentId });
                    break;
                }
                case 'getState':
                    this.sendStateSync();
                    break;
                case 'getSkills': {
                    const skills = tab.session.getSkills();
                    this._post({ type: 'skills', skills });
                    break;
                }
                case 'searchFiles': {
                    const items = await this._searchFiles(msg.query);
                    this._post({ type: 'fileSuggestions', query: msg.query, items });
                    break;
                }
                case 'resolveFileReferences': {
                    this._outputChannel.appendLine(`[PI-DEBUG] resolveFileReferences tokens: ${JSON.stringify(msg.tokens)}`);
                    const items = await this._resolveFileReferences(msg.tokens);
                    this._outputChannel.appendLine(`[PI-DEBUG] resolveFileReferences resolved: ${JSON.stringify(items.map(i => ({ t: i.token, k: i.kind, f: i.file?.relativePath ?? null })))}`);
                    this._post({ type: 'resolvedFileReferences', requestId: msg.requestId, items });
                    break;
                }
                case 'resolveDroppedFiles': {
                    const items = await this._resolveFileReferences(msg.paths);
                    this._post({ type: 'resolvedDroppedFiles', requestId: msg.requestId, items });
                    break;
                }
                case 'approveToolCall':
                    this._resolveToolApproval(tab, msg.toolCallId, true);
                    break;
                case 'rejectToolCall':
                    this._resolveToolApproval(tab, msg.toolCallId, false);
                    break;
                case 'openFile': {
                    const fileUri = vscode.Uri.file(msg.filePath);
                    try {
                        const doc = await vscode.workspace.openTextDocument(fileUri);
                        await vscode.window.showTextDocument(doc, { preview: true });
                    } catch { /* file may not exist */ }
                    break;
                }
                case 'openDiff':
                    await tab.diffManager.openDiff(msg.filePath, msg.toolCallId);
                    break;
                case 'undoFileChange':
                    await tab.diffManager.undoFileChange(msg.filePath, msg.toolCallId);
                    this.sendStateSync();
                    break;
                case 'restoreCheckpoint': {
                    const restored = await tab.checkpointManager.restoreCheckpoint(msg.messageIndex);
                    tab.diffManager.suspendChangesAfter(msg.messageIndex);

                    const allMsgs = tab.session.getMessages();
                    const cutoff = this._findCutoffIndex(allMsgs, msg.messageIndex);
                    if (cutoff >= 0 && cutoff < allMsgs.length) {
                        tab.suspendedMessages = allMsgs.slice(cutoff);
                        tab.session.setMessages(allMsgs.slice(0, cutoff));
                    }

                    if (restored.length > 0) {
                        vscode.window.showInformationMessage(
                            `Restored ${restored.length} file(s) to checkpoint.`
                        );
                    }
                    this.sendStateSync();
                    break;
                }
                case 'redoCheckpoint': {
                    const redone = await tab.checkpointManager.redoCheckpoint();
                    tab.diffManager.redoChanges();

                    if (tab.suspendedMessages.length > 0) {
                        const current = tab.session.getMessages();
                        tab.session.setMessages([...current, ...tab.suspendedMessages]);
                        tab.suspendedMessages = [];
                    }

                    if (redone.length > 0) {
                        vscode.window.showInformationMessage(
                            `Re-applied ${redone.length} file(s).`
                        );
                    }
                    this.sendStateSync();
                    break;
                }
                case 'confirmAction': {
                    const answer = await vscode.window.showWarningMessage(
                        msg.message,
                        { modal: true },
                        'Yes',
                    );
                    this._post({
                        type: 'confirmResult',
                        action: msg.action,
                        confirmed: answer === 'Yes',
                        payload: msg.payload,
                    });
                    break;
                }
                case 'createTab':
                    await this._createTab();
                    break;
                case 'closeTab':
                    await this._closeTab(msg.tabId);
                    break;
                case 'switchTab':
                    this._switchTab(msg.tabId);
                    break;
                case 'openSettings':
                    vscode.commands.executeCommand('pi-agent.openSettings');
                    break;
                case 'requestUsage':
                    if (this._usageBridge.latest) {
                        this._post({ type: 'usageUpdate', usage: this._usageBridge.latest });
                    }
                    break;
                case 'refreshUsage':
                    await this._usageBridge.refresh();
                    break;
                case '__debug':
                    void this._handleDebug(msg.event, msg.data);
                    break;
            }
        } catch (err: any) {
            this._post({ type: 'error', message: err.message ?? String(err) });
        }
    }

    private async _searchFiles(query: string): Promise<FileReferenceInfo[]> {
        const normalizedQuery = query.trim().toLowerCase();
        const files = await this._getWorkspaceFiles();
        const ranked = files
            .filter((file) => {
                if (!normalizedQuery) return true;
                return file.relativePath.toLowerCase().includes(normalizedQuery)
                    || file.displayName.toLowerCase().includes(normalizedQuery);
            })
            .sort((a, b) => this._compareFileMatches(a.relativePath, b.relativePath, normalizedQuery))
            .slice(0, FILE_SEARCH_RESULT_LIMIT);

        return ranked;
    }

    private async _resolveFileReferences(tokens: string[]): Promise<ResolvedFileReference[]> {
        const files = await this._getWorkspaceFiles();
        const byAbsolute = new Map<string, FileReferenceInfo>();
        const byRelative = new Map<string, FileReferenceInfo>();

        for (const file of files) {
            if (file.absolutePath) {
                byAbsolute.set(this._normalizeLookupKey(file.absolutePath), file);
            }
            byRelative.set(this._normalizeLookupKey(file.relativePath), file);
        }

        const resolved: ResolvedFileReference[] = [];
        for (const token of tokens) {
            const candidate = token.trim();
            if (!candidate) {
                resolved.push({ token, kind: 'unresolved', file: null });
                continue;
            }

            const normalized = this._normalizeLookupKey(candidate);
            const inWorkspace = byAbsolute.get(normalized) ?? byRelative.get(normalized);
            if (inWorkspace) {
                resolved.push({ token, kind: 'workspace', file: inWorkspace });
                continue;
            }

            const uri = this._toUriFromPathCandidate(candidate);
            if (uri && await this._isRegularFile(uri)) {
                const file = this._toFileReference(uri, candidate);
                const kind = this._isWorkspaceFileReference(file) ? 'workspace' : 'external';
                resolved.push({ token, kind, file });
                continue;
            }

            resolved.push({ token, kind: 'unresolved', file: null });
        }

        return resolved;
    }

    private async _getWorkspaceFiles(): Promise<FileReferenceInfo[]> {
        if (this._workspaceFilesCache) {
            return this._workspaceFilesCache;
        }

        const excludes = '**/{.git,node_modules,dist,out,coverage,.next,.turbo,build}/**';
        const uris = await vscode.workspace.findFiles('**/*', excludes, 2000);
        this._workspaceFilesCache = uris
            .map((uri) => {
                const relativePath = vscode.workspace.asRelativePath(uri, false);
                return {
                    relativePath,
                    absolutePath: uri.fsPath,
                    displayName: relativePath.split('/').pop() ?? relativePath,
                };
            })
            .filter((file) => file.relativePath.length > 0)
            .sort((a, b) => a.relativePath.localeCompare(b.relativePath));
        return this._workspaceFilesCache;
    }

    private _normalizeLookupKey(value: string): string {
        return value.replace(/\\/g, '/').toLowerCase();
    }

    private _toUriFromPathCandidate(candidate: string): vscode.Uri | undefined {
        const trimmed = candidate.trim();
        if (!trimmed) return undefined;

        if (trimmed.startsWith('file://')) {
            try {
                return vscode.Uri.parse(trimmed);
            } catch {
                return undefined;
            }
        }

        if (path.isAbsolute(trimmed)) {
            return vscode.Uri.file(trimmed);
        }

        return undefined;
    }

    private async _isRegularFile(uri: vscode.Uri): Promise<boolean> {
        try {
            const stat = await vscode.workspace.fs.stat(uri);
            return (stat.type & vscode.FileType.Directory) === 0;
        } catch {
            return false;
        }
    }

    private _toFileReference(uri: vscode.Uri, fallbackPath?: string): FileReferenceInfo {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
        const relativePath = workspaceFolder
            ? vscode.workspace.asRelativePath(uri, false)
            : (fallbackPath?.trim() || uri.fsPath);

        return {
            relativePath,
            absolutePath: uri.fsPath,
            displayName: path.basename(uri.fsPath) || relativePath,
        };
    }

    private _isWorkspaceFileReference(file: FileReferenceInfo): boolean {
        if (!file.absolutePath) return false;
        return !!vscode.workspace.getWorkspaceFolder(vscode.Uri.file(file.absolutePath));
    }

    private _compareFileMatches(a: string, b: string, query: string): number {
        if (!query) {
            return a.localeCompare(b);
        }

        const score = (value: string): number => {
            const lower = value.toLowerCase();
            const base = lower.split('/').pop() ?? lower;
            if (base === query) return 0;
            if (base.startsWith(query)) return 1;
            if (lower.startsWith(query)) return 2;
            return 3;
        };

        const scoreA = score(a);
        const scoreB = score(b);
        if (scoreA !== scoreB) return scoreA - scoreB;
        return a.localeCompare(b);
    }

    private async _buildPromptText(text: string, files: FileReferenceInfo[]): Promise<string> {
        if (!files.length) {
            return text;
        }

        const sections: string[] = [];
        let totalChars = 0;
        const promptFiles = files
            .map((file) => {
                const uri = this._resolveFileReference(file);
                return uri ? { ...file, absolutePath: uri.fsPath } : undefined;
            })
            .filter((file): file is FileReferenceInfo & { absolutePath: string } => !!file);

        if (!promptFiles.length) {
            return text;
        }

        for (const file of promptFiles.slice(0, FILE_CONTEXT_MAX_FILES)) {
            const uri = vscode.Uri.file(file.absolutePath);
            try {
                const bytes = await vscode.workspace.fs.readFile(uri);
                let content = new TextDecoder().decode(bytes);
                let note = '';
                if (content.length > FILE_CONTEXT_MAX_CHARS_PER_FILE) {
                    content = content.slice(0, FILE_CONTEXT_MAX_CHARS_PER_FILE);
                    note = `\n[truncated after ${FILE_CONTEXT_MAX_CHARS_PER_FILE} chars]`;
                }

                const remaining = FILE_CONTEXT_MAX_TOTAL_CHARS - totalChars;
                if (remaining <= 0) {
                    sections.push('<attachments-note>Additional attached files were omitted after reaching the total context limit.</attachments-note>');
                    break;
                }

                if (content.length > remaining) {
                    content = content.slice(0, remaining);
                    note = `\n[truncated after reaching total context limit of ${FILE_CONTEXT_MAX_TOTAL_CHARS} chars]`;
                }

                totalChars += content.length;
                sections.push(`<file path="${this._escapeXmlAttribute(file.absolutePath)}">\n${content}${note}\n</file>`);
            } catch {
                sections.push(`<file path="${this._escapeXmlAttribute(file.absolutePath)}">\n[unreadable or missing at send time]\n</file>`);
            }
        }

        const fileContext = `Attached file context:\n\n${sections.join('\n\n')}`;
        const userRequest = this._insertFileMarkers(text, promptFiles);
        return userRequest.trim()
            ? `${userRequest}\n\n${fileContext}`
            : fileContext;
    }

    private _insertFileMarkers(text: string, files: FileReferenceInfo[]): string {
        const positionedFiles = files
            .filter((file) => typeof file.insertOffset === 'number')
            .map((file) => ({ ...file, insertOffset: Math.max(0, Math.min(text.length, file.insertOffset ?? 0)) }))
            .sort((a, b) => (a.insertOffset ?? 0) - (b.insertOffset ?? 0));

        if (!positionedFiles.length) {
            return text;
        }

        let result = '';
        let textOffset = 0;
        for (const file of positionedFiles) {
            const insertOffset = file.insertOffset ?? 0;
            result += text.slice(textOffset, insertOffset);
            const marker = `[[file:${file.absolutePath ?? file.relativePath}]]`;
            const needsLeadingSpace = result.length > 0 && !/\s$/.test(result);
            const needsTrailingSpace = !!text[insertOffset] && !/^\s/.test(text.slice(insertOffset, insertOffset + 1));
            result += `${needsLeadingSpace ? ' ' : ''}${marker}${needsTrailingSpace ? ' ' : ''}`;
            textOffset = insertOffset;
        }
        result += text.slice(textOffset);
        return result;
    }

    private _resolveFileReference(file: FileReferenceInfo): vscode.Uri | undefined {
        if (file.absolutePath) {
            return vscode.Uri.file(file.absolutePath);
        }

        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!root) {
            return undefined;
        }
        return vscode.Uri.joinPath(vscode.Uri.file(root), file.relativePath);
    }

    private _escapeXmlAttribute(value: string): string {
        return value
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    private _requestToolApproval(tab: TabState, toolCallId: string, toolName: string, args: any): Promise<boolean> {
        return new Promise<boolean>((resolve) => {
            tab.pendingApprovals.set(toolCallId, { resolve });

            if (tab.id === this._activeTabId) {
                this._post({
                    type: 'toolCallPending',
                    pending: { toolCallId, toolName, args: safeSerialize(args) },
                });
            }
        });
    }

    private _resolveToolApproval(tab: TabState, toolCallId: string, approved: boolean): void {
        const pending = tab.pendingApprovals.get(toolCallId);
        if (pending) {
            tab.pendingApprovals.delete(toolCallId);
            pending.resolve(approved);
            if (tab.id === this._activeTabId) {
                this._post({ type: 'toolCallResolved', toolCallId });
            }
        }
    }

    private async _createTab(): Promise<void> {
        const newSession = new PiSessionManager(this._outputChannel);
        await newSession.initialize();

        const newCheckpoint = new CheckpointManager();
        const newDiff = new DiffManager(newSession, newCheckpoint);

        const id = nextTabId();
        const tab = makeTabState(id, newSession, newDiff, newCheckpoint);
        this._tabs.set(id, tab);
        this._subscribeTab(tab);

        this._activeTabId = id;
        this.sendStateSync();
    }

    private async _closeTab(tabId: string): Promise<void> {
        if (this._tabs.size <= 1) return;

        const tab = this._tabs.get(tabId);
        if (!tab) return;

        const wasActive = tabId === this._activeTabId;

        this._unsubscribeTab(tabId);
        tab.diffManager.dispose();
        tab.checkpointManager.dispose();
        await tab.session.dispose();
        this._tabs.delete(tabId);

        if (wasActive) {
            this._activeTabId = this._tabs.keys().next().value!;
        }

        this.sendStateSync();
    }

    private _switchTab(tabId: string): void {
        if (!this._tabs.has(tabId) || tabId === this._activeTabId) return;

        this._activeTabId = tabId;

        const tab = this._activeTab;
        tab.hasNotification = false;
        vscode.commands.executeCommand('setContext', 'pi-agent.isStreaming', tab.isStreaming);

        this._usageBridge.attach(tab.session.session);

        this.sendStateSync();
    }

    private _findCutoffIndex(messages: any[], rollbackPoint: number): number {
        let userMsgCount = 0;
        for (let i = 0; i < messages.length; i++) {
            if (messages[i].role === 'user') {
                userMsgCount++;
                if (userMsgCount > rollbackPoint) {
                    return i;
                }
            }
        }
        return -1;
    }

    private _getHtml(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'out', 'webview', 'main.js')
        );
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'out', 'webview', 'styles', 'main.css')
        );
        const iconsUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'icons')
        );
        const nonce = getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy"
          content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} data:; script-src 'nonce-${nonce}';">
    <link rel="stylesheet" href="${styleUri}">
    <title>Pi Agent</title>
</head>
<body>
    <div id="app" data-icons-uri="${iconsUri}"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }
    private async _handleDebug(event: string, data: unknown): Promise<void> {
        const timestamp = new Date().toISOString();
        const payload = JSON.stringify(data);
        const line = `[${timestamp}] [PI-DEBUG] ${event} ${payload}`;

        this._outputChannel.appendLine(line);

        try {
            const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (wsRoot) {
                const debugDir = path.join(wsRoot, '.vscode');
                await vscode.workspace.fs.createDirectory(vscode.Uri.file(debugDir));
                const logPath = path.join(debugDir, 'interaction-debug.log');
                const fs = await import('fs');
                fs.appendFileSync(logPath, line + '\n');
            }
        } catch {
            // silently ignore file write failures
        }
    }
}

function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

function safeSerialize(obj: any): any {
    try {
        return JSON.parse(JSON.stringify(obj));
    } catch {
        return { type: obj?.type, _serializationFailed: true };
    }
}
