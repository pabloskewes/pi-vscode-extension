import * as vscode from 'vscode';
import type { AgentSession, AgentSessionEvent, SessionManager, ModelRegistry } from '@earendil-works/pi-coding-agent';
import type { Model } from '@earendil-works/pi-ai';
import type { SerializedAgentState, ModelInfo, SessionInfo, ContextUsageInfo, SkillInfo } from '../shared/protocol';
import { EventRouter } from './events';
import { getAuthStorage, disposeAuthStorage } from './auth';
import { getModelRegistry, getAvailableModels, findModel, disposeModelRegistry } from './models';

export type ToolApprovalHandler = (toolCallId: string, toolName: string, args: any) => Promise<boolean>;

export class PiSessionManager {
    private _session: AgentSession | undefined;
    private _sessionManager: SessionManager | undefined;
    private _modelRegistry: ModelRegistry | undefined;
    private _unsubscribe: (() => void) | undefined;
    private _outputChannel: vscode.OutputChannel;
    private _toolApprovalHandler: ToolApprovalHandler | undefined;
    readonly events = new EventRouter();

    constructor(outputChannel: vscode.OutputChannel) {
        this._outputChannel = outputChannel;
    }

    get session(): AgentSession | undefined {
        return this._session;
    }

    get isReady(): boolean {
        return this._session !== undefined;
    }

    async initialize(): Promise<void> {
        this._outputChannel.appendLine('Initializing Pi session...');
        const { createAgentSession, SessionManager: SM } = await import('@earendil-works/pi-coding-agent');

        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
        const authStorage = await getAuthStorage();
        this._modelRegistry = await getModelRegistry();

        this._sessionManager = SM.create(cwd);

        const config = vscode.workspace.getConfiguration('pi-agent');
        const allowedTools = config.get<string[]>('allowedTools', []);

        const opts: any = {
            cwd,
            authStorage,
            modelRegistry: this._modelRegistry,
            sessionManager: this._sessionManager,
        };
        if (allowedTools.length > 0) {
            opts.allowedToolNames = allowedTools;
        }

        const { session, modelFallbackMessage } = await createAgentSession(opts);

        this._session = session;
        this._unsubscribe = session.subscribe(this.events.asSessionListener());

        if (modelFallbackMessage) {
            this._outputChannel.appendLine(`Model fallback: ${modelFallbackMessage}`);
        }

        this._applyDefaultSettings(session);
        this._installToolApprovalHook(session);
        await this._bindExtensions(session);

        const model = session.model;
        this._outputChannel.appendLine(
            `Pi session initialized. Model: ${model ? `${getProviderId(model)}/${model.id}` : 'none'}`
        );
    }

    private _applyDefaultSettings(session: AgentSession): void {
        const config = vscode.workspace.getConfiguration('pi-agent');

        const thinkingLevel = config.get<string>('thinkingLevel', 'off');
        if (thinkingLevel && thinkingLevel !== 'off') {
            session.setThinkingLevel(thinkingLevel as any);
        }

        const defaultModel = config.get<string>('defaultModel', '');
        if (defaultModel && this._modelRegistry) {
            const available = getAvailableModels(this._modelRegistry);
            const match = available.find(m => m.id === defaultModel);
            if (match) {
                const model = findModel(this._modelRegistry, match.provider, match.id);
                if (model) {
                    session.setModel(model).catch((err: any) => {
                        this._outputChannel.appendLine(`Failed to set default model: ${err.message}`);
                    });
                }
            }
        }
    }

    async prompt(text: string, imageDataUrls?: string[]): Promise<void> {
        if (!this._session) { throw new Error('Session not initialized'); }
        const images = imageDataUrls?.map(dataUrlToImageContent).filter(Boolean) as any[];
        if (images && images.length > 0) {
            await this._session.prompt(text, { images });
        } else {
            await this._session.prompt(text);
        }
    }

    async steer(text: string): Promise<void> {
        if (!this._session) { throw new Error('Session not initialized'); }
        await this._session.steer(text);
    }

    async followUp(text: string): Promise<void> {
        if (!this._session) { throw new Error('Session not initialized'); }
        await this._session.followUp(text);
    }

    async abort(): Promise<void> {
        if (!this._session) { return; }
        await this._session.abort();
    }

    async setModel(provider: string, modelId: string): Promise<void> {
        if (!this._session || !this._modelRegistry) {
            throw new Error('Session not initialized');
        }
        const model = findModel(this._modelRegistry, provider, modelId);
        if (!model) {
            throw new Error(`Model not found: ${provider}/${modelId}`);
        }
        await this._session.setModel(model);
    }

    setThinkingLevel(level: string): void {
        if (!this._session) { return; }
        this._session.setThinkingLevel(level as any);
    }

    cycleThinkingLevel(): string | undefined {
        if (!this._session) { return undefined; }
        return this._session.cycleThinkingLevel();
    }

    async newSession(): Promise<void> {
        if (!this._session) { return; }
        await this._shutdownExtensions('new_session');
        this._unsubscribe?.();
        this._session.dispose();

        const { createAgentSession } = await import('@earendil-works/pi-coding-agent');
        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
        const { SessionManager: SM } = await import('@earendil-works/pi-coding-agent');
        this._sessionManager = SM.create(cwd);

        const config = vscode.workspace.getConfiguration('pi-agent');
        const allowedTools = config.get<string[]>('allowedTools', []);

        const opts: any = {
            cwd,
            authStorage: await getAuthStorage(),
            modelRegistry: this._modelRegistry,
            sessionManager: this._sessionManager,
        };
        if (allowedTools.length > 0) {
            opts.allowedToolNames = allowedTools;
        }

        const { session } = await createAgentSession(opts);

        this._session = session;
        this._unsubscribe = session.subscribe(this.events.asSessionListener());
        this._applyDefaultSettings(session);
        this._installToolApprovalHook(session);
        await this._bindExtensions(session);
    }

    async getSessions(): Promise<SessionInfo[]> {
        const { SessionManager: SM } = await import('@earendil-works/pi-coding-agent');
        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
        const sessions = await SM.list(cwd);
        return sessions.map((s: any) => ({
            id: s.id ?? s.sessionId ?? '',
            name: s.name ?? s.sessionName,
            path: s.path ?? s.filePath ?? '',
            created: normalizeTimestamp(s.created),
            lastModified: normalizeTimestamp(s.lastModified ?? s.modifiedAt ?? s.modified),
            messageCount: typeof s.messageCount === 'number' ? s.messageCount : undefined,
            firstMessage: typeof s.firstMessage === 'string' ? s.firstMessage : undefined,
        }));
    }

    async generateSessionName(modelSetting: string): Promise<string | undefined> {
        if (!this._session || !this._sessionManager) {
            this._outputChannel.appendLine('[naming] skipped: no session or sessionManager');
            return undefined;
        }

        const currentName = this._session.sessionName?.trim();
        const sessionId = this._session.sessionId;
        if (currentName && currentName !== sessionId) {
            this._outputChannel.appendLine(`[naming] skipped: already has name "${currentName}"`);
            return currentName;
        }

        const { firstUserText, firstAssistantText } = getFirstTurnTexts(this.getMessages());
        if (!firstUserText || !firstAssistantText) {
            this._outputChannel.appendLine('[naming] skipped: no messages yet');
            return undefined;
        }

        const registry = this._modelRegistry ?? await getModelRegistry();
        const selectedModel = resolveNamingModel(registry, modelSetting) ?? this._session.model;
        if (!selectedModel) {
            this._outputChannel.appendLine('[naming] skipped: no model resolved');
            return undefined;
        }

        this._outputChannel.appendLine(`[naming] using model: ${String(selectedModel.provider)}/${selectedModel.id}`);

        const { createAgentSession, SessionManager: SM } = await import('@earendil-works/pi-coding-agent');
        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();

        const { session: namingSession } = await createAgentSession({
            cwd,
            authStorage: await getAuthStorage(),
            modelRegistry: registry,
            sessionManager: SM.inMemory(cwd),
            noTools: 'all',
        });

        try {
            await namingSession.setModel(selectedModel);
            await namingSession.prompt(buildNamingPrompt(firstUserText, firstAssistantText));
            const rawTitle = extractLastAssistantText(namingSession.messages);
            const title = sanitizeGeneratedTitle(rawTitle);
            if (!title) {
                this._outputChannel.appendLine(`[naming] empty title from model (raw: "${rawTitle}")`);
                return undefined;
            }

            this._outputChannel.appendLine(`[naming] persisting title: "${title}"`);
            this._sessionManager.appendSessionInfo(title);
            return title;
        } finally {
            namingSession.dispose();
        }
    }

    async loadSession(sessionPath: string): Promise<void> {
        if (!this._session) { return; }
        await this._shutdownExtensions('switch_session');
        this._unsubscribe?.();
        this._session.dispose();

        const { createAgentSession, SessionManager: SM } = await import('@earendil-works/pi-coding-agent');
        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
        this._sessionManager = await SM.open(sessionPath, undefined);

        const { session } = await createAgentSession({
            cwd,
            authStorage: await getAuthStorage(),
            modelRegistry: this._modelRegistry,
            sessionManager: this._sessionManager,
        });

        this._session = session;
        this._unsubscribe = session.subscribe(this.events.asSessionListener());
        this._installToolApprovalHook(session);
        await this._bindExtensions(session);
    }

    getModels(): ModelInfo[] {
        if (!this._modelRegistry) { return []; }
        return getAvailableModels(this._modelRegistry);
    }

    getCurrentModel(): ModelInfo | undefined {
        const m = this._session?.model;
        if (!m) { return undefined; }
        return {
            provider: getProviderId(m),
            id: m.id,
            name: m.name,
            reasoning: m.reasoning,
            thinkingLevelMap: m.thinkingLevelMap as Record<string, string | null> | undefined,
        };
    }

    getThinkingLevel(): string | undefined {
        return this._session?.thinkingLevel;
    }

    getAutoApproveTools(): boolean {
        return vscode.workspace.getConfiguration('pi-agent').get<boolean>('autoApproveTools', false);
    }

    setToolApprovalHandler(handler: ToolApprovalHandler | undefined): void {
        this._toolApprovalHandler = handler;
    }

    private async _bindExtensions(session: AgentSession): Promise<void> {
        const loaded = session.resourceLoader.getExtensions();
        const paths = loaded.extensions.map((ext: any) => ext.path);
        this._outputChannel.appendLine(
            `Pi extensions loaded: ${paths.length}${paths.length ? ` (${paths.map((p: string) => p.split('/').slice(-3).join('/')).join(', ')})` : ''}`,
        );
        for (const err of loaded.errors ?? []) {
            this._outputChannel.appendLine(`Pi extension load error: ${err.path}: ${err.error}`);
        }

        try {
            await session.bindExtensions({
                mode: 'rpc',
                onError: (err: any) => {
                    this._outputChannel.appendLine(
                        `Pi extension error: ${err.extensionPath ?? '<unknown>'} ${err.event ?? '<event>'}: ${err.error}`,
                    );
                    if (err.stack) {
                        this._outputChannel.appendLine(err.stack);
                    }
                },
                shutdownHandler: () => {
                    this._outputChannel.appendLine('Pi extension requested shutdown; ignored by VS Code host.');
                },
            } as any);
            this._outputChannel.appendLine('Pi extension lifecycle started.');
        } catch (err: any) {
            this._outputChannel.appendLine(`Failed to start Pi extension lifecycle: ${err.message ?? String(err)}`);
        }
    }

    private async _shutdownExtensions(reason: string): Promise<void> {
        const session = this._session;
        if (!session) return;
        try {
            await (session.extensionRunner as any).emit({ type: 'session_shutdown', reason });
            this._outputChannel.appendLine(`Pi extension lifecycle stopped: ${reason}.`);
        } catch (err: any) {
            this._outputChannel.appendLine(`Failed to stop Pi extension lifecycle: ${err.message ?? String(err)}`);
        }
    }

    private _installToolApprovalHook(session: AgentSession): void {
        try {
            const runner = session.extensionRunner;
            if (!runner) return;

            const origEmitToolCall = runner.emitToolCall.bind(runner);
            const self = this;

            runner.emitToolCall = async (event: any) => {
                const origResult = await origEmitToolCall(event);
                if (origResult?.block) return origResult;
                if (self.getAutoApproveTools()) return origResult;
                if (!self._toolApprovalHandler) return origResult;

                const approved = await self._toolApprovalHandler(
                    event.toolCallId,
                    event.toolName,
                    event.input,
                );
                if (!approved) {
                    return { block: true, reason: 'User rejected tool call' };
                }
                return origResult;
            };
        } catch {
            this._outputChannel.appendLine('Tool approval hook: extension runner not available, skipping');
        }
    }

    getSkills(): SkillInfo[] {
        if (!this._session) return [];
        try {
            const { skills } = this._session.resourceLoader.getSkills();
            return skills.map((s: any) => ({
                name: s.name,
                description: s.description ?? '',
                filePath: s.filePath ?? '',
                source: s.sourceInfo?.source ?? '',
                disableModelInvocation: s.disableModelInvocation ?? false,
            }));
        } catch {
            return [];
        }
    }

    getActiveToolNames(): string[] {
        return this._session?.getActiveToolNames() ?? [];
    }

    getMessages(): any[] {
        return this._session?.state?.messages ?? [];
    }

    setMessages(msgs: any[]): void {
        if (this._session?.state) {
            this._session.state.messages = msgs;
        }
    }

    serializeState(): SerializedAgentState {
        const s = this._session;
        if (!s) {
            return {
                messages: [],
                isStreaming: false,
                tools: [],
            };
        }
        const model = s.model;
        const modelInfo: ModelInfo | undefined = model
            ? {
                provider: getProviderId(model),
                id: model.id,
                name: model.name,
                reasoning: model.reasoning,
                thinkingLevelMap: model.thinkingLevelMap as Record<string, string | null> | undefined,
            }
            : undefined;
        return {
            messages: s.messages.map(safeSerialize),
            model: modelInfo,
            thinkingLevel: s.thinkingLevel,
            isStreaming: s.isStreaming,
            tools: s.getActiveToolNames(),
            sessionId: s.sessionId,
            sessionName: s.sessionName,
            contextUsage: this._getContextUsage(),
        };
    }

    private _getContextUsage(): ContextUsageInfo | undefined {
        const usage = this._session?.getContextUsage?.();
        if (!usage) { return undefined; }
        return {
            tokens: usage.tokens,
            contextWindow: usage.contextWindow,
            percent: usage.percent,
        };
    }

    async showModelPicker(): Promise<void> {
        const models = this.getModels();
        if (models.length === 0) {
            vscode.window.showWarningMessage('No models available. Check your Pi configuration.');
            return;
        }
        const items = models.map((m) => ({
            label: m.name ?? m.id,
            description: m.provider,
            model: m,
        }));
        const pick = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select a model',
        });
        if (pick) {
            await this.setModel(pick.model.provider, pick.model.id);
        }
    }

    async dispose(): Promise<void> {
        await this._shutdownExtensions('shutdown');
        this._unsubscribe?.();
        this._session?.dispose();
        this._session = undefined;
        this.events.clear();
    }

    static async disposeGlobal(): Promise<void> {
        disposeAuthStorage();
        disposeModelRegistry();
    }
}

function getProviderId(model: any): string {
    return String(model.provider);
}

function dataUrlToImageContent(dataUrl: string): { type: string; data: string; mimeType: string } | null {
    const match = dataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
    if (!match) return null;
    return { type: 'image', data: match[2], mimeType: match[1] };
}

function normalizeTimestamp(value: unknown): number | undefined {
    if (!value) {
        return undefined;
    }
    if (value instanceof Date) {
        return value.getTime();
    }
    if (typeof value === 'number') {
        return value;
    }
    if (typeof value === 'string') {
        const parsed = Date.parse(value);
        return Number.isNaN(parsed) ? undefined : parsed;
    }
    return undefined;
}

function getFirstTurnTexts(messages: any[]): { firstUserText: string; firstAssistantText: string } {
    const firstUser = messages.find((message) => message?.role === 'user');
    const firstAssistant = messages.find((message) => message?.role === 'assistant');
    return {
        firstUserText: extractMessageText(firstUser),
        firstAssistantText: extractMessageText(firstAssistant),
    };
}

function extractMessageText(message: any): string {
    if (!message) {
        return '';
    }

    if (typeof message.content === 'string') {
        return message.content;
    }

    if (Array.isArray(message.content)) {
        return message.content
            .filter((item: any) => item?.type === 'text' && typeof item.text === 'string')
            .map((item: any) => item.text)
            .join(' ')
            .trim();
    }

    if (typeof message.text === 'string') {
        return message.text;
    }

    return '';
}

function resolveNamingModel(registry: ModelRegistry, setting: string): Model<any> | undefined {
    const configured = setting.trim();
    const available = registry.getAvailable();
    if (available.length === 0) {
        return undefined;
    }

    if (configured.includes('/')) {
        const slash = configured.indexOf('/');
        const provider = configured.slice(0, slash).trim();
        const modelId = configured.slice(slash + 1).trim();
        if (provider && modelId) {
            return registry.find(provider, modelId) ?? available.find((model) => model.id === modelId);
        }
    }

    if (configured) {
        const exactMatches = available.filter((model) => model.id === configured);
        if (exactMatches.length === 1) {
            return exactMatches[0];
        }
        if (exactMatches.length > 1) {
            return exactMatches.find((model) => String(model.provider) === 'deepseek') ?? exactMatches[0];
        }
        const byName = available.find((model) => model.name === configured);
        if (byName) {
            return byName;
        }
    }

    return available.find((model) => String(model.provider) === 'deepseek') ?? available[0];
}

function buildNamingPrompt(firstUserText: string, firstAssistantText: string): string {
    return [
        'Generate a concise chat title in English.',
        '',
        'Rules:',
        '- 3 to 6 words',
        '- no quotes',
        '- no trailing period',
        '- capture the actual engineering task',
        '',
        `First user message: ${firstUserText}`,
        `First assistant response: ${firstAssistantText}`,
        '',
        'Title:',
    ].join('\n');
}

function extractLastAssistantText(messages: any[]): string {
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i]?.role !== 'assistant') {
            continue;
        }
        return extractMessageText(messages[i]);
    }
    return '';
}

function sanitizeGeneratedTitle(raw: string): string {
    const firstLine = raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.length > 0) ?? '';

    if (!firstLine) {
        return '';
    }

    const unquoted = firstLine.replace(/^['"`]+|['"`]+$/g, '');
    const noPeriod = unquoted.replace(/[.]+$/g, '');
    return noPeriod.slice(0, 72).trim();
}

function safeSerialize(obj: any): any {
    try {
        return JSON.parse(JSON.stringify(obj));
    } catch {
        return { _serializationFailed: true, type: obj?.type };
    }
}
