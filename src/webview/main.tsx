import {
    Fragment,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type ClipboardEvent,
    type KeyboardEvent as ReactKeyboardEvent,
    type ReactNode,
} from 'react';
import { createRoot } from 'react-dom/client';
import { marked } from 'marked';
import type {
    ClientMessage,
    FileChangeInfo,
    FileReferenceInfo,
    ModelInfo,
    SerializedAgentState,
    ServerMessage,
    SessionInfo,
    SkillInfo,
    TabInfo,
    ToolCallPendingInfo,
    UsageSnapshotDTO,
} from '../shared/protocol';
import { UsageWidget } from './usage';

declare function acquireVsCodeApi(): {
    postMessage(message: ClientMessage): void;
    getState(): any;
    setState(state: any): void;
};

const vscode = acquireVsCodeApi();
const iconsBaseUri = document.getElementById('app')?.dataset.iconsUri ?? '';

interface WebviewState {
    messages: any[];
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
    contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null };
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

type StreamingItem =
    | {
        kind: 'tool';
        toolCallId: string;
        toolName: string;
        args: any;
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

const initialState: WebviewState = {
    messages: [],
    isStreaming: false,
    tools: [],
    streamingText: '',
    streamingThinking: '',
    isThinking: false,
    thinkingStartTime: 0,
    streamingThinkingDuration: 0,
    availableModels: [],
    recentModels: [],
    fileChanges: [],
    rollbackPoint: null,
    tabs: [],
    activeTabId: '',
    skills: [],
    queuedMessages: [],
    pendingImages: [],
};

const USER_MESSAGE_COLLAPSE_LINE_LIMIT = 8;
const USER_MESSAGE_COLLAPSE_CHAR_LIMIT = 700;

const renderer = new marked.Renderer();
let markdownRenderPrefix = 'cb';
let markdownCodeBlockId = 0;

renderer.code = function ({ text, lang }: { text: string; lang?: string | undefined }) {
    const id = `${markdownRenderPrefix}-${++markdownCodeBlockId}`;
    const langLabel = lang ? `<span class="code-lang">${escHtml(lang)}</span>` : '';
    return `<div class="code-block-wrapper">
        <div class="code-block-header">${langLabel}<button class="copy-btn" data-code-id="${id}">Copy</button></div>
        <pre class="code-block-pre" id="${id}"><code class="code-block-code">${escHtml(text)}</code></pre>
    </div>`;
};

renderer.codespan = function ({ text }: { text: string }) {
    return `<code>${escHtml(text)}</code>`;
};

marked.setOptions({
    renderer,
    breaks: true,
    gfm: true,
});

function App(): ReactNode {
    const [state, setState] = useState<WebviewState>(initialState);
    const [usage, setUsage] = useState<UsageSnapshotDTO>();
    const [usagePopoverOpen, setUsagePopoverOpen] = useState(false);
    const [sessionPanelOpen, setSessionPanelOpen] = useState(false);
    const [sessions, setSessions] = useState<SessionInfo[]>([]);
    const [currentSessionId, setCurrentSessionId] = useState<string | undefined>();
    const [streamingItems, setStreamingItems] = useState<StreamingItem[]>([]);
    const [toolApprovals, setToolApprovals] = useState<ToolCallPendingInfo[]>([]);
    const [errors, setErrors] = useState<Array<{ id: number; message: string }>>([]);
    const [modelPickerOpen, setModelPickerOpen] = useState(false);
    const [pendingModelPicker, setPendingModelPicker] = useState(false);
    const [modelSearch, setModelSearch] = useState('');
    const [lightboxSrc, setLightboxSrc] = useState('');
    const [steerToastText, setSteerToastText] = useState('');
    const [steerToastFading, setSteerToastFading] = useState(false);
    const [queuedEditingIndex, setQueuedEditingIndex] = useState(-1);
    const [queuedEditingText, setQueuedEditingText] = useState('');
    const [expandedUserMessages, setExpandedUserMessages] = useState<Record<number, boolean>>({});
    const [changedFilesOpen, setChangedFilesOpen] = useState(false);
    const [fileMenuState, setFileMenuState] = useState<{
        items: FileReferenceInfo[];
        index: number;
        query: string;
    }>({ items: [], index: 0, query: '' });
    const [slashMenuState, setSlashMenuState] = useState<{
        items: SkillInfo[];
        index: number;
    }>({ items: [], index: 0 });
    const [userHasScrolled, setUserHasScrolled] = useState(false);

    const stateRef = useLatestRef(state);
    const pendingModelPickerRef = useLatestRef(pendingModelPicker);
    const fileMenuStateRef = useLatestRef(fileMenuState);
    const steerToastTextRef = useLatestRef(steerToastText);

    const inputRef = useRef<HTMLDivElement | null>(null);
    const messagesRef = useRef<HTMLDivElement | null>(null);
    const footerModelRef = useRef<HTMLSpanElement | null>(null);
    const modelPickerRef = useRef<HTMLDivElement | null>(null);
    const modelSearchRef = useRef<HTMLInputElement | null>(null);
    const queuedEditInputRef = useRef<HTMLInputElement | null>(null);
    const isProgrammaticScrollRef = useRef(false);
    const previousTabIdRef = useRef<string | undefined>(undefined);
    const steerToastTimerRef = useRef<number | null>(null);

    const hideFileMenu = (): void => {
        setFileMenuState({ items: [], index: 0, query: '' });
    };

    const hideSlashMenu = (): void => {
        setSlashMenuState({ items: [], index: 0 });
    };

    const clearComposerInput = (): void => {
        if (inputRef.current) {
            inputRef.current.innerHTML = '';
        }
        hideFileMenu();
        hideSlashMenu();
    };

    const focusComposer = (): void => {
        inputRef.current?.focus();
    };

    const scrollToBottom = (force = false): void => {
        if (userHasScrolled && !force) return;
        const messages = messagesRef.current;
        if (!messages) return;
        isProgrammaticScrollRef.current = true;
        messages.scrollTop = messages.scrollHeight;
    };

    const dismissSteerToast = (): void => {
        if (!steerToastTextRef.current) return;
        setSteerToastFading(true);
        if (steerToastTimerRef.current) {
            window.clearTimeout(steerToastTimerRef.current);
        }
        steerToastTimerRef.current = window.setTimeout(() => {
            setSteerToastText('');
            setSteerToastFading(false);
            steerToastTimerRef.current = null;
        }, 300);
    };

    const clearSteerToastImmediately = (): void => {
        if (steerToastTimerRef.current) {
            window.clearTimeout(steerToastTimerRef.current);
            steerToastTimerRef.current = null;
        }
        setSteerToastFading(false);
        setSteerToastText('');
    };

    const showSteerToast = (text: string): void => {
        if (steerToastTimerRef.current) {
            window.clearTimeout(steerToastTimerRef.current);
            steerToastTimerRef.current = null;
        }
        setSteerToastFading(false);
        setSteerToastText(truncate(text, 80));
    };

    const updateFileMenuFromInput = (input: HTMLElement): void => {
        const beforeCursor = getComposerTextBeforeCaret(input);
        const fileMatch = beforeCursor.match(/(^|\s)@([^\s@]*)$/);

        if (!fileMatch) {
            hideFileMenu();
            return;
        }

        const query = (fileMatch[2] ?? '').toLowerCase();
        const current = fileMenuStateRef.current;
        if (query === current.query && current.items.length > 0) {
            return;
        }

        hideSlashMenu();
        setFileMenuState({ items: [], index: 0, query });
        vscode.postMessage({ type: 'searchFiles', query });
    };

    const updateSlashMenuFromInput = (input: HTMLElement): void => {
        const beforeCursor = getComposerTextBeforeCaret(input);
        const slashMatch = beforeCursor.match(/(?:^|\s)(\/\S*)$/);

        if (!slashMatch || state.skills.length === 0) {
            hideSlashMenu();
            return;
        }

        hideFileMenu();
        const query = slashMatch[1].slice(1).toLowerCase();
        const items = state.skills.filter(
            (skill) => skill.name.toLowerCase().includes(query) || skill.description.toLowerCase().includes(query)
        );

        if (items.length === 0) {
            hideSlashMenu();
            return;
        }

        setSlashMenuState((previous) => ({
            items,
            index: Math.min(previous.index, items.length - 1),
        }));
    };

    const handleComposerInput = (): void => {
        const input = inputRef.current;
        if (!input) return;
        normalizeComposerEmptyState(input);
        updateSlashMenuFromInput(input);
        updateFileMenuFromInput(input);
    };

    const handleComposerPaste = (event: ClipboardEvent<HTMLDivElement>): void => {
        const items = event.clipboardData?.items;
        let handledImage = false;

        if (items) {
            for (let index = 0; index < items.length; index++) {
                const item = items[index];
                if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
                const file = item.getAsFile();
                if (!file) continue;

                event.preventDefault();
                handledImage = true;
                const reader = new FileReader();
                reader.onload = () => {
                    setState((previous) => ({
                        ...previous,
                        pendingImages: [...previous.pendingImages, { dataUrl: reader.result as string, name: file.name }],
                    }));
                };
                reader.readAsDataURL(file);
            }
        }

        if (handledImage) return;

        const text = event.clipboardData?.getData('text/plain');
        if (!text || !inputRef.current) return;

        event.preventDefault();
        insertComposerText(inputRef.current, text);
    };

    const selectFileItem = (index: number): void => {
        const input = inputRef.current;
        if (!input) return;

        const file = fileMenuState.items[index];
        if (!file) return;

        const beforeCursor = getComposerTextBeforeCaret(input);
        const fileMatch = beforeCursor.match(/(^|\s)@([^\s@]*)$/);
        if (!fileMatch) return;

        const cursorOffset = getComposerCaretTextOffset(input);
        const afterCursor = readComposerContent(input).text.slice(cursorOffset);
        const trailingText = afterCursor && /^\s/.test(afterCursor) ? '' : ' ';
        const matchStart = beforeCursor.length - fileMatch[0].length + (fileMatch[1] ?? '').length;

        replaceComposerTextRange(input, matchStart, beforeCursor.length, createComposerFileChip(file), trailingText);
        hideFileMenu();
        focusComposer();
    };

    const selectSlashItem = (index: number): void => {
        const input = inputRef.current;
        if (!input) return;

        const skill = slashMenuState.items[index];
        if (!skill) return;

        const beforeCursor = getComposerTextBeforeCaret(input);
        const slashMatch = beforeCursor.match(/(?:^|\s)(\/\S*)$/);
        if (!slashMatch) return;

        const matchStart = beforeCursor.length - slashMatch[1].length;
        replaceComposerTextRange(input, matchStart, beforeCursor.length, `/skill:${skill.name} `);
        hideSlashMenu();
        focusComposer();
    };

    const sendMessage = (): void => {
        const payload = getComposerPayload(inputRef.current);
        if (!payload.text && state.pendingImages.length === 0 && payload.files.length === 0) {
            return;
        }

        clearComposerInput();
        const images = state.pendingImages.length > 0 ? state.pendingImages.map((image) => image.dataUrl) : undefined;
        const files = payload.files.length > 0 ? payload.files : undefined;

        setState((previous) => ({ ...previous, pendingImages: [] }));
        setUserHasScrolled(false);
        vscode.postMessage({ type: 'prompt', text: payload.text || '', images, files });
    };

    const handleSendButton = (): void => {
        if (state.isStreaming) {
            const payload = getComposerPayload(inputRef.current);
            if (payload.text) {
                vscode.postMessage({ type: 'queueMessage', text: payload.text });
                clearComposerInput();
            } else {
                vscode.postMessage({ type: 'abort' });
            }
            return;
        }

        sendMessage();
    };

    const handleSteerButton = (): void => {
        const payload = getComposerPayload(inputRef.current);
        if (!payload.text) return;

        vscode.postMessage({ type: 'steer', text: payload.text });
        clearComposerInput();
        showSteerToast(payload.text);
    };

    const handleComposerKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
        if (event.key === 'Escape' && lightboxSrc) {
            event.preventDefault();
            setLightboxSrc('');
            return;
        }

        if (fileMenuState.items.length > 0) {
            if (event.key === 'ArrowDown') {
                event.preventDefault();
                setFileMenuState((previous) => ({
                    ...previous,
                    index: Math.min(previous.index + 1, previous.items.length - 1),
                }));
                return;
            }
            if (event.key === 'ArrowUp') {
                event.preventDefault();
                setFileMenuState((previous) => ({
                    ...previous,
                    index: Math.max(previous.index - 1, 0),
                }));
                return;
            }
            if (event.key === 'Enter' || event.key === 'Tab') {
                event.preventDefault();
                selectFileItem(fileMenuState.index);
                return;
            }
            if (event.key === 'Escape') {
                event.preventDefault();
                hideFileMenu();
                return;
            }
        }

        if (slashMenuState.items.length > 0) {
            if (event.key === 'ArrowDown') {
                event.preventDefault();
                setSlashMenuState((previous) => ({
                    ...previous,
                    index: Math.min(previous.index + 1, previous.items.length - 1),
                }));
                return;
            }
            if (event.key === 'ArrowUp') {
                event.preventDefault();
                setSlashMenuState((previous) => ({
                    ...previous,
                    index: Math.max(previous.index - 1, 0),
                }));
                return;
            }
            if (event.key === 'Enter' || event.key === 'Tab') {
                event.preventDefault();
                selectSlashItem(slashMenuState.index);
                return;
            }
            if (event.key === 'Escape') {
                event.preventDefault();
                hideSlashMenu();
                return;
            }
        }

        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            if (state.isStreaming) {
                const payload = getComposerPayload(inputRef.current);
                if (!payload.text) return;

                if (event.ctrlKey || event.metaKey) {
                    vscode.postMessage({ type: 'steer', text: payload.text });
                    clearComposerInput();
                    showSteerToast(payload.text);
                } else {
                    vscode.postMessage({ type: 'queueMessage', text: payload.text });
                    clearComposerInput();
                }
                return;
            }

            sendMessage();
            return;
        }

        if (event.key === 'Enter' && event.shiftKey) {
            event.preventDefault();
            if (inputRef.current) {
                insertComposerText(inputRef.current, '\n');
            }
            return;
        }

        if (event.key === 'Escape' && state.isStreaming) {
            event.preventDefault();
            vscode.postMessage({ type: 'abort' });
        }
    };

    const handleMessagesClick = async (event: React.MouseEvent<HTMLDivElement>): Promise<void> => {
        const target = event.target as HTMLElement;
        const copyButton = target.closest('.copy-btn') as HTMLButtonElement | null;
        if (!copyButton) return;

        const codeId = copyButton.dataset.codeId;
        if (!codeId) return;

        const codeElement = document.getElementById(codeId);
        if (!codeElement) return;

        try {
            await navigator.clipboard.writeText(codeElement.textContent ?? '');
            copyButton.textContent = 'Copied!';
            window.setTimeout(() => {
                copyButton.textContent = 'Copy';
            }, 1500);
        } catch {
            copyButton.textContent = 'Failed';
            window.setTimeout(() => {
                copyButton.textContent = 'Copy';
            }, 1500);
        }
    };

    const openDiff = (filePath: string, toolCallId: string): void => {
        vscode.postMessage({ type: 'openDiff', filePath, toolCallId });
    };

    const openFile = (filePath: string): void => {
        vscode.postMessage({ type: 'openFile', filePath });
    };

    const handleToggleModelPicker = (): void => {
        if (modelPickerOpen) {
            setModelPickerOpen(false);
            setPendingModelPicker(false);
            return;
        }

        if (state.availableModels.length === 0) {
            setPendingModelPicker(true);
            vscode.postMessage({ type: 'getModels' });
            return;
        }

        setModelSearch('');
        setModelPickerOpen(true);
    };

    const closeModelPicker = (): void => {
        setModelPickerOpen(false);
        setModelSearch('');
    };

    const handleSelectModel = (provider: string, modelId: string): void => {
        vscode.postMessage({ type: 'setModel', provider, modelId });

        const matched = state.availableModels.find((model) => model.id === modelId && model.provider === provider);
        setState((previous) => ({
            ...previous,
            model: matched ? { provider, id: modelId, name: matched.name ?? modelId } : previous.model,
            recentModels: matched
                ? addToRecentModels(previous.recentModels, { provider, id: modelId, name: matched.name ?? modelId })
                : previous.recentModels,
        }));

        closeModelPicker();
    };

    const handleQueuedEditStart = (index: number): void => {
        setQueuedEditingIndex(index);
        setQueuedEditingText(state.queuedMessages[index] ?? '');
    };

    const handleQueuedEditSave = (): void => {
        const text = queuedEditingText.trim();
        if (queuedEditingIndex < 0 || !text) return;

        vscode.postMessage({ type: 'editQueuedMessage', index: queuedEditingIndex, text });
        setQueuedEditingIndex(-1);
        setQueuedEditingText('');
    };

    const handleQueuedEditCancel = (): void => {
        setQueuedEditingIndex(-1);
        setQueuedEditingText('');
    };

    useEffect(() => {
        const listener = (event: MessageEvent) => {
            const message = event.data as ServerMessage;

            switch (message.type) {
                case 'ready':
                    vscode.postMessage({ type: 'getState' });
                    vscode.postMessage({ type: 'getSkills' });
                    vscode.postMessage({ type: 'requestUsage' });
                    break;

                case 'stateSync': {
                    const tabSwitched = stateRef.current.activeTabId !== (message.state.activeTabId ?? '');
                    setState((previous) => applySerializedState(previous, message.state));
                    if (tabSwitched || !message.state.isStreaming) {
                        setStreamingItems([]);
                        setToolApprovals([]);
                        clearSteerToastImmediately();
                    }
                    setErrors([]);
                    break;
                }

                case 'agentEvent':
                    handleAgentEvent(
                        message.event,
                        setState,
                        setStreamingItems,
                        setToolApprovals,
                        setUserHasScrolled,
                        dismissSteerToast,
                        clearSteerToastImmediately
                    );
                    break;

                case 'models':
                    setState((previous) => {
                        const nextState: WebviewState = {
                            ...previous,
                            availableModels: message.models ?? [],
                        };

                        if (message.current) {
                            nextState.model = message.current;
                            nextState.recentModels = addToRecentModels(previous.recentModels, message.current);
                        }

                        if (message.thinkingLevel) {
                            nextState.thinkingLevel = message.thinkingLevel;
                        }

                        return nextState;
                    });

                    if (pendingModelPickerRef.current) {
                        setPendingModelPicker(false);
                        setModelSearch('');
                        setModelPickerOpen(true);
                    }
                    break;

                case 'sessions':
                    setSessions(message.sessions);
                    setCurrentSessionId(message.currentSessionId);
                    setSessionPanelOpen(true);
                    break;

                case 'fileChange':
                    setState((previous) => ({
                        ...previous,
                        fileChanges: [...previous.fileChanges, message.change],
                    }));
                    setStreamingItems((previous) => applyStreamingDiff(previous, message.change));
                    break;

                case 'confirmResult':
                    if (!message.confirmed) break;
                    if (message.action === 'restoreCheckpoint' && message.payload?.messageIndex !== undefined) {
                        vscode.postMessage({ type: 'restoreCheckpoint', messageIndex: message.payload.messageIndex });
                    }
                    if (message.action === 'redoCheckpoint') {
                        vscode.postMessage({ type: 'redoCheckpoint' });
                    }
                    break;

                case 'toolCallPending':
                    setToolApprovals((previous) => {
                        if (previous.some((item) => item.toolCallId === message.pending.toolCallId)) {
                            return previous;
                        }
                        return [...previous, message.pending];
                    });
                    break;

                case 'toolCallResolved':
                    setToolApprovals((previous) => previous.filter((item) => item.toolCallId !== message.toolCallId));
                    break;

                case 'skills':
                    setState((previous) => ({ ...previous, skills: message.skills }));
                    break;

                case 'fileSuggestions':
                    if (message.query !== fileMenuStateRef.current.query) break;
                    setFileMenuState((previous) => ({
                        items: message.items,
                        query: message.query,
                        index: Math.min(previous.index, Math.max(0, message.items.length - 1)),
                    }));
                    break;

                case 'usageUpdate':
                    setUsage(message.usage);
                    break;

                case 'error':
                    setErrors((previous) => [
                        ...previous,
                        { id: Date.now() + previous.length, message: message.message },
                    ]);
                    break;
            }
        };

        window.addEventListener('message', listener);
        return () => {
            window.removeEventListener('message', listener);
        };
    }, []);

    useEffect(() => {
        if (!modelPickerOpen) return undefined;

        const handleOutsideClick = (event: MouseEvent) => {
            const target = event.target as Node;
            if (modelPickerRef.current?.contains(target)) return;
            if (footerModelRef.current?.contains(target)) return;
            closeModelPicker();
        };

        document.addEventListener('click', handleOutsideClick);
        return () => {
            document.removeEventListener('click', handleOutsideClick);
        };
    }, [modelPickerOpen]);

    useEffect(() => {
        if (modelPickerOpen) {
            modelSearchRef.current?.focus();
        }
    }, [modelPickerOpen]);

    useEffect(() => {
        if (queuedEditingIndex >= 0) {
            queuedEditInputRef.current?.focus();
            queuedEditInputRef.current?.setSelectionRange(
                queuedEditInputRef.current.value.length,
                queuedEditInputRef.current.value.length
            );
        }
    }, [queuedEditingIndex]);

    useEffect(() => {
        if (queuedEditingIndex >= 0 && queuedEditingIndex >= state.queuedMessages.length) {
            setQueuedEditingIndex(-1);
            setQueuedEditingText('');
        }
    }, [queuedEditingIndex, state.queuedMessages.length]);

    useEffect(() => {
        const previousTabId = previousTabIdRef.current;
        previousTabIdRef.current = state.activeTabId;
        if (previousTabId === undefined) return;
        if (previousTabId === state.activeTabId) return;

        clearComposerInput();
        setErrors([]);
        setToolApprovals([]);
        setStreamingItems([]);
        setUserHasScrolled(false);
        window.requestAnimationFrame(() => scrollToBottom(true));
    }, [state.activeTabId]);

    useEffect(() => {
        return () => {
            if (steerToastTimerRef.current) {
                window.clearTimeout(steerToastTimerRef.current);
            }
        };
    }, []);

    useLayoutEffect(() => {
        scrollToBottom();
    }, [
        state.messages,
        state.streamingText,
        state.streamingThinking,
        state.isThinking,
        state.isStreaming,
        streamingItems,
        toolApprovals,
        errors,
        state.fileChanges,
        state.rollbackPoint,
    ]);

    const historyNodes = useMemo(() => buildHistoryNodes({
        state,
        expandedUserMessages,
        onToggleExpandedUserMessage: (index) => {
            setExpandedUserMessages((previous) => ({
                ...previous,
                [index]: !previous[index],
            }));
        },
        onRestoreCheckpoint: (turnNumber) => {
            vscode.postMessage({
                type: 'confirmAction',
                action: 'restoreCheckpoint',
                message: 'Discard all changes after this checkpoint?',
                payload: { messageIndex: turnNumber - 1 },
            });
        },
        onRedoCheckpoint: () => {
            vscode.postMessage({
                type: 'confirmAction',
                action: 'redoCheckpoint',
                message: 'Re-apply the rolled-back changes?',
            });
        },
        onOpenDiff: openDiff,
        onOpenFile: openFile,
    }), [state, expandedUserMessages]);

    const uniqueFileChanges = useMemo(() => getUniqueFileChanges(state.fileChanges), [state.fileChanges]);
    const showPreparingPlaceholder = state.isStreaming
        && !state.streamingText
        && !state.streamingThinking
        && !streamingItems.some(isRunningStreamingItem)
        && toolApprovals.length === 0;

    const contextUsageNode = useMemo(() => renderContextUsage(state.contextUsage), [state.contextUsage]);
    const filteredModels = useMemo(() => {
        const query = modelSearch.trim().toLowerCase();
        if (!query) return state.availableModels;
        return state.availableModels.filter((model) => {
            const name = (model.name ?? model.id).toLowerCase();
            const provider = model.provider.toLowerCase();
            return name.includes(query) || provider.includes(query) || model.id.toLowerCase().includes(query);
        });
    }, [modelSearch, state.availableModels]);

    return (
        <>
            <div className="header">
                <div className="tab-strip">
                    {state.tabs.map((tab) => {
                        const displayName = tab.name.length > 20 ? `${tab.name.substring(0, 18)}...` : tab.name;
                        return (
                            <div
                                key={tab.id}
                                className={`tab${tab.isActive ? ' tab-active' : ''}${tab.isStreaming ? ' tab-streaming' : ''}`}
                                data-tab-id={tab.id}
                                onClick={() => {
                                    if (tab.id !== state.activeTabId) {
                                        vscode.postMessage({ type: 'switchTab', tabId: tab.id });
                                    }
                                }}
                            >
                                <span className="tab-icon">
                                    {tab.isStreaming ? (
                                        <span className="tab-spinner" />
                                    ) : tab.hasNotification ? (
                                        <img className="tab-icon-img" src={`${iconsBaseUri}/notification.png`} alt="notification" />
                                    ) : (
                                        <img className="tab-icon-img" src={`${iconsBaseUri}/chat.png`} alt="chat" />
                                    )}
                                </span>
                                <span className="tab-name" title={tab.name}>{displayName}</span>
                                {state.tabs.length > 1 ? (
                                    <button
                                        className="tab-close"
                                        title="Close tab"
                                        type="button"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            vscode.postMessage({ type: 'closeTab', tabId: tab.id });
                                        }}
                                    >
                                        &times;
                                    </button>
                                ) : null}
                            </div>
                        );
                    })}
                </div>
                <div className="header-right">
                    <button className="icon-btn" id="btn-new-tab" title="New Agent" type="button" onClick={() => vscode.postMessage({ type: 'createTab' })}>
                        <img className="header-icon-img" src={`${iconsBaseUri}/new.png`} alt="new" />
                    </button>
                    <button className="icon-btn" id="btn-sessions" title="Sessions" type="button" onClick={() => vscode.postMessage({ type: 'getSessions' })}>
                        <img className="header-icon-img" src={`${iconsBaseUri}/list.png`} alt="sessions" />
                    </button>
                    <button className="icon-btn" id="btn-settings" title="Settings" type="button" onClick={() => vscode.postMessage({ type: 'openSettings' })}>
                        <img className="header-icon-img" src={`${iconsBaseUri}/settings.png`} alt="settings" />
                    </button>
                </div>
            </div>

            {sessionPanelOpen ? (
                <SessionPanel
                    sessions={sessions}
                    currentSessionId={currentSessionId}
                    onClose={() => setSessionPanelOpen(false)}
                    onLoadSession={(sessionPath) => vscode.postMessage({ type: 'loadSession', sessionPath })}
                />
            ) : null}

            <div
                className="messages"
                id="messages"
                ref={messagesRef}
                onClick={handleMessagesClick}
                onWheel={(event) => {
                    if (event.deltaY < 0) {
                        setUserHasScrolled(true);
                    }
                }}
                onTouchStart={() => setUserHasScrolled(true)}
                onScroll={(event) => {
                    if (isProgrammaticScrollRef.current) {
                        isProgrammaticScrollRef.current = false;
                        return;
                    }
                    const element = event.currentTarget;
                    setUserHasScrolled(!isNearBottom(element));
                }}
            >
                {historyNodes.length === 0 && !state.isStreaming ? <WelcomeMessage /> : historyNodes}

                {errors.map((error) => (
                    <div className="error-message" key={error.id}>{error.message}</div>
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

                    {streamingItems.map((item) => renderStreamingItem(item, openDiff, openFile))}

                    {toolApprovals.map((pending) => (
                        <ToolApprovalCard
                            key={pending.toolCallId}
                            pending={pending}
                            onApprove={(toolCallId) => {
                                vscode.postMessage({ type: 'approveToolCall', toolCallId });
                                setToolApprovals((previous) => previous.filter((item) => item.toolCallId !== toolCallId));
                            }}
                            onReject={(toolCallId) => {
                                vscode.postMessage({ type: 'rejectToolCall', toolCallId });
                                setToolApprovals((previous) => previous.filter((item) => item.toolCallId !== toolCallId));
                            }}
                        />
                    ))}

                    {showPreparingPlaceholder ? (
                        <div className="preparing-placeholder" id="preparing-placeholder">Preparing next moves...</div>
                    ) : null}
                </div>

                <div className="messages-spacer" />
            </div>

            <div className="scroll-btn-wrap">
                <button
                    className={`scroll-bottom-btn${userHasScrolled ? ' visible' : ''}`}
                    id="btn-scroll-bottom"
                    title="Scroll to bottom"
                    type="button"
                    onClick={() => {
                        setUserHasScrolled(false);
                        scrollToBottom(true);
                    }}
                >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                        <path d="M8 3L8 13M8 13L3 8M8 13L13 8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                </button>
            </div>

            <div className="input-container">
                {state.fileChanges.length > 0 ? (
                    <ChangedFilesSection
                        fileChanges={uniqueFileChanges}
                        rollbackPoint={state.rollbackPoint}
                        messages={state.messages}
                        open={changedFilesOpen}
                        onToggle={setChangedFilesOpen}
                        onUndo={() => {
                            let lastUserTurn = 0;
                            for (const message of state.messages) {
                                if ((message.role ?? 'unknown') === 'user') {
                                    lastUserTurn++;
                                }
                            }
                            if (lastUserTurn < 1) return;
                            vscode.postMessage({
                                type: 'confirmAction',
                                action: 'restoreCheckpoint',
                                message: 'Undo changes from the last turn?',
                                payload: { messageIndex: lastUserTurn - 1 },
                            });
                        }}
                        onRedo={() => {
                            vscode.postMessage({
                                type: 'confirmAction',
                                action: 'redoCheckpoint',
                                message: 'Re-apply the rolled-back changes?',
                            });
                        }}
                        onReviewAll={() => {
                            const seen = new Set<string>();
                            for (const change of state.fileChanges) {
                                if (seen.has(change.filePath)) continue;
                                seen.add(change.filePath);
                                vscode.postMessage({ type: 'openDiff', filePath: change.filePath, toolCallId: change.toolCallId });
                            }
                        }}
                        onOpenDiff={openDiff}
                    />
                ) : null}

                {state.queuedMessages.length > 0 ? (
                    <QueuedSection
                        queuedMessages={state.queuedMessages}
                        editingIndex={queuedEditingIndex}
                        editingText={queuedEditingText}
                        editInputRef={queuedEditInputRef}
                        onEditingTextChange={setQueuedEditingText}
                        onEditStart={handleQueuedEditStart}
                        onEditSave={handleQueuedEditSave}
                        onEditCancel={handleQueuedEditCancel}
                        onRemove={(index) => {
                            if (queuedEditingIndex === index) {
                                handleQueuedEditCancel();
                            } else if (queuedEditingIndex > index) {
                                setQueuedEditingIndex(queuedEditingIndex - 1);
                            }
                            vscode.postMessage({ type: 'removeQueuedMessage', index });
                        }}
                    />
                ) : null}

                {slashMenuState.items.length > 0 ? (
                    <div className="slash-menu" id="slash-menu">
                        {slashMenuState.items.map((skill, index) => (
                            <div
                                key={skill.name}
                                className={`slash-item${index === slashMenuState.index ? ' slash-item-active' : ''}`}
                                onMouseDown={(event) => {
                                    event.preventDefault();
                                    selectSlashItem(index);
                                }}
                            >
                                <span className="slash-item-name">/skill:{skill.name}</span>
                                {skill.description ? <span className="slash-item-desc">{skill.description}</span> : null}
                            </div>
                        ))}
                    </div>
                ) : null}

                {fileMenuState.items.length > 0 ? (
                    <>
                        <div className="slash-menu" id="file-menu">
                            {fileMenuState.items.map((item, index) => {
                                const depth = Math.max(0, item.relativePath.split('/').length - 1);
                                const dir = item.relativePath.includes('/')
                                    ? item.relativePath.split('/').slice(0, -1).join('/')
                                    : '';

                                return (
                                    <div
                                        key={`${item.relativePath}-${index}`}
                                        className={`slash-item${index === fileMenuState.index ? ' slash-item-active' : ''}`}
                                        onMouseMove={() => {
                                            if (index !== fileMenuState.index) {
                                                setFileMenuState((previous) => ({ ...previous, index }));
                                            }
                                        }}
                                        onMouseDown={(event) => {
                                            event.preventDefault();
                                            selectFileItem(index);
                                        }}
                                    >
                                        <span className="slash-item-name slash-item-name-file" style={{ paddingLeft: `${Math.min(depth * 12, 36)}px` }}>
                                            @{item.displayName}
                                        </span>
                                        <span className="slash-item-desc">{dir ? `${dir}/` : ''}{item.displayName}</span>
                                    </div>
                                );
                            })}
                        </div>

                        <div className="file-menu-tree" id="file-menu-tree">
                            {renderFileTreeCard(fileMenuState.items[fileMenuState.index])}
                        </div>
                    </>
                ) : null}

                {steerToastText ? (
                    <div className={`steer-toast${steerToastFading ? ' steer-toast-fade' : ''}`} id="steer-toast">
                        <span className="steer-toast-indicator" />
                        <span className="steer-toast-label">Steering...</span>
                        <span className="steer-toast-text">{steerToastText}</span>
                    </div>
                ) : null}

                <div className="composer-body">
                    {state.pendingImages.length > 0 ? (
                        <div className="attachment-row" id="attachment-row">
                            {state.pendingImages.map((image, index) => (
                                <span className="attachment-chip" data-index={index} key={`${image.name}-${index}`}>
                                    <img
                                        className="attachment-thumb"
                                        src={image.dataUrl}
                                        alt={image.name}
                                        title={image.name}
                                        data-index={index}
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            setLightboxSrc(image.dataUrl);
                                        }}
                                    />
                                    <button
                                        className="attachment-chip-remove"
                                        data-kind="image"
                                        data-index={index}
                                        title="Remove"
                                        type="button"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            setState((previous) => ({
                                                ...previous,
                                                pendingImages: previous.pendingImages.filter((_, imageIndex) => imageIndex !== index),
                                            }));
                                        }}
                                    >
                                        &times;
                                    </button>
                                </span>
                            ))}
                        </div>
                    ) : null}

                    <div className="input-area">
                        <div
                            id="input"
                            className="composer-editor"
                            contentEditable
                            suppressContentEditableWarning
                            role="textbox"
                            aria-multiline="true"
                            data-placeholder={state.isStreaming ? 'Type to queue a message, Ctrl+Enter to steer, Esc to stop...' : 'Ask Pi anything...'}
                            ref={inputRef}
                            onPaste={handleComposerPaste}
                            onKeyDown={handleComposerKeyDown}
                            onInput={handleComposerInput}
                        />
                    </div>
                </div>

                <div className="input-footer">
                    <span className="footer-model" ref={footerModelRef} onClick={handleToggleModelPicker}>
                        {state.model?.name ?? state.model?.id ?? ''}
                    </span>
                    <span className="footer-spacer" />
                    <UsageWidget
                        usage={usage}
                        open={usagePopoverOpen}
                        onToggle={() => setUsagePopoverOpen((previous) => !previous)}
                        onClose={() => setUsagePopoverOpen(false)}
                        onRefresh={() => vscode.postMessage({ type: 'refreshUsage' })}
                    />
                    {contextUsageNode}
                    {state.isStreaming ? (
                        <button className="abort-btn" id="btn-abort" title="Stop generation (Esc)" type="button" onClick={() => vscode.postMessage({ type: 'abort' })}>
                            &#9632; Stop
                        </button>
                    ) : null}
                    {state.isStreaming ? (
                        <button className="steer-btn" id="btn-steer" title="Steer (Ctrl+Enter)" type="button" onClick={handleSteerButton}>
                            <img className="steer-icon-img" src={`${iconsBaseUri}/chevrons.png`} alt="steer" />
                        </button>
                    ) : null}
                    <button className="send-btn" id="btn-send" title={state.isStreaming ? 'Queue' : 'Send'} type="button" onClick={handleSendButton}>
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                            <path d="M8 3L8 13M8 3L3 8M8 3L13 8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    </button>
                </div>

                {modelPickerOpen ? (
                    <ModelPicker
                        pickerRef={modelPickerRef}
                        searchRef={modelSearchRef}
                        searchValue={modelSearch}
                        filteredModels={filteredModels}
                        recentModels={state.recentModels}
                        availableModels={state.availableModels}
                        currentModel={state.model}
                        thinkingLevel={state.thinkingLevel}
                        onSearchChange={setModelSearch}
                        onSelectModel={handleSelectModel}
                        onSetThinkingLevel={(level) => {
                            vscode.postMessage({ type: 'setThinkingLevel', level });
                            setState((previous) => ({ ...previous, thinkingLevel: level }));
                        }}
                    />
                ) : null}
            </div>

            <div className="image-lightbox" id="image-lightbox" style={{ display: lightboxSrc ? '' : 'none' }} onClick={() => setLightboxSrc('')}>
                <img className="image-lightbox-img" id="image-lightbox-img" alt="" src={lightboxSrc} />
            </div>
        </>
    );
}

function WelcomeMessage(): ReactNode {
    return (
        <div className="welcome">
            <div className="welcome-icon">&pi;</div>
            <div className="welcome-title">Pi Agent</div>
            <div className="welcome-subtitle">Ask anything. Pi can read, write, and execute code for you.</div>
            <div className="welcome-hints">
                <div className="welcome-hint">Type a message to start</div>
                <div className="welcome-hint"><kbd>Ctrl+Shift+L</kbd> Focus chat</div>
                <div className="welcome-hint"><kbd>Ctrl+Shift+N</kbd> New session</div>
                <div className="welcome-hint"><kbd>Esc</kbd> Stop generation</div>
            </div>
        </div>
    );
}

function SessionPanel({
    sessions,
    currentSessionId,
    onClose,
    onLoadSession,
}: {
    sessions: SessionInfo[];
    currentSessionId?: string;
    onClose: () => void;
    onLoadSession: (sessionPath: string) => void;
}): ReactNode {
    return (
        <div className="session-panel" id="session-panel">
            {sessions.length === 0 ? (
                <div className="session-empty">No previous sessions</div>
            ) : (
                <>
                    <div className="session-header">
                        <span>Sessions</span>
                        <button className="icon-btn" id="btn-close-sessions" title="Close" type="button" onClick={onClose}>
                            &times;
                        </button>
                    </div>
                    <div className="session-list">
                        {sessions.map((session) => (
                            <div
                                className={`session-item${session.id === currentSessionId ? ' active' : ''}`}
                                data-path={session.path}
                                key={session.path}
                                onClick={() => onLoadSession(session.path)}
                            >
                                <span className="session-item-name">{session.name ?? session.id}</span>
                            </div>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}

function ChangedFilesSection({
    fileChanges,
    rollbackPoint,
    messages,
    open,
    onToggle,
    onUndo,
    onRedo,
    onReviewAll,
    onOpenDiff,
}: {
    fileChanges: FileChangeInfo[];
    rollbackPoint: number | null;
    messages: any[];
    open: boolean;
    onToggle: (open: boolean) => void;
    onUndo: () => void;
    onRedo: () => void;
    onReviewAll: () => void;
    onOpenDiff: (filePath: string, toolCallId: string) => void;
}): ReactNode {
    const count = fileChanges.length;
    void messages;

    return (
        <details className="changed-files-section" id="changed-files-bar" open={open} onToggle={(event) => onToggle((event.currentTarget as HTMLDetailsElement).open)}>
            <summary className="changed-files-summary">
                <span className="changed-files-arrow">&#9656;</span>
                <span className="changed-files-count">{count} File{count !== 1 ? 's' : ''}</span>
                <span className="changed-files-spacer" />
                {rollbackPoint !== null ? (
                    <button
                        className="changed-files-link"
                        id="btn-redo"
                        title="Redo changes"
                        type="button"
                        onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            onRedo();
                        }}
                    >
                        Redo
                    </button>
                ) : (
                    <button
                        className="changed-files-link"
                        id="btn-undo"
                        title="Undo last change"
                        type="button"
                        onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            onUndo();
                        }}
                    >
                        Undo
                    </button>
                )}
                <button
                    className="changed-files-review-btn"
                    id="btn-review-all"
                    title="Review all changes"
                    type="button"
                    onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onReviewAll();
                    }}
                >
                    Review
                </button>
            </summary>

            <div className="changed-files-list">
                {fileChanges.map((change) => {
                    const fileName = change.filePath.split('/').pop() ?? change.filePath;
                    return (
                        <div
                            className="changed-file-item"
                            data-filepath={change.filePath}
                            data-toolcallid={change.toolCallId}
                            key={change.filePath}
                            onClick={() => onOpenDiff(change.filePath, change.toolCallId)}
                        >
                            <span className="cf-icon">{getFileIcon(change.filePath)}</span>
                            <span className="cf-name">{fileName}</span>
                            <span className="cf-stats">
                                {change.addedLines > 0 ? <span className="cf-stat-add">+{change.addedLines}</span> : null}
                                {change.removedLines > 0 ? <span className="cf-stat-del">-{change.removedLines}</span> : null}
                            </span>
                        </div>
                    );
                })}
            </div>
        </details>
    );
}

function QueuedSection({
    queuedMessages,
    editingIndex,
    editingText,
    editInputRef,
    onEditingTextChange,
    onEditStart,
    onEditSave,
    onEditCancel,
    onRemove,
}: {
    queuedMessages: string[];
    editingIndex: number;
    editingText: string;
    editInputRef: React.RefObject<HTMLInputElement>;
    onEditingTextChange: (value: string) => void;
    onEditStart: (index: number) => void;
    onEditSave: () => void;
    onEditCancel: () => void;
    onRemove: (index: number) => void;
}): ReactNode {
    return (
        <details className="queued-section" id="queued-section" open>
            <summary className="queued-summary">
                <span className="queued-chevron">&#9656;</span>
                <span className="queued-count">{queuedMessages.length} Queued</span>
            </summary>
            <div className="queued-list">
                {queuedMessages.map((message, index) => {
                    if (index === editingIndex) {
                        return (
                            <div className="queued-item queued-item-editing" data-index={index} key={`queued-edit-${index}`}>
                                <span className="queued-item-icon">&#9675;</span>
                                <input
                                    className="queued-edit-input"
                                    data-index={index}
                                    type="text"
                                    value={editingText}
                                    ref={editInputRef}
                                    onChange={(event) => onEditingTextChange(event.target.value)}
                                    onKeyDown={(event) => {
                                        if (event.key === 'Enter') {
                                            event.preventDefault();
                                            onEditSave();
                                        }
                                        if (event.key === 'Escape') {
                                            event.preventDefault();
                                            onEditCancel();
                                        }
                                    }}
                                />
                                <button className="queued-edit-save" data-index={index} title="Save" type="button" onClick={onEditSave}>
                                    &#10003;
                                </button>
                                <button className="queued-edit-cancel" data-index={index} title="Cancel" type="button" onClick={onEditCancel}>
                                    &#10005;
                                </button>
                            </div>
                        );
                    }

                    return (
                        <div className="queued-item" data-index={index} key={`queued-${index}`}>
                            <span className="queued-item-icon">&#9675;</span>
                            <span className="queued-item-text">{message}</span>
                            <span className="queued-item-actions">
                                <button className="queued-item-btn queued-item-edit" data-index={index} title="Edit" type="button" onClick={() => onEditStart(index)}>
                                    <img className="queued-btn-icon" src={`${iconsBaseUri}/pencil.png`} alt="edit" />
                                </button>
                                <button className="queued-item-btn queued-item-delete" data-index={index} title="Remove" type="button" onClick={() => onRemove(index)}>
                                    <img className="queued-btn-icon" src={`${iconsBaseUri}/trash.png`} alt="remove" />
                                </button>
                            </span>
                        </div>
                    );
                })}
            </div>
        </details>
    );
}

function ModelPicker({
    pickerRef,
    searchRef,
    searchValue,
    filteredModels,
    recentModels,
    availableModels,
    currentModel,
    thinkingLevel,
    onSearchChange,
    onSelectModel,
    onSetThinkingLevel,
}: {
    pickerRef: React.RefObject<HTMLDivElement>;
    searchRef: React.RefObject<HTMLInputElement>;
    searchValue: string;
    filteredModels: ModelInfo[];
    recentModels: ModelInfo[];
    availableModels: ModelInfo[];
    currentModel?: ModelInfo;
    thinkingLevel?: string;
    onSearchChange: (value: string) => void;
    onSelectModel: (provider: string, modelId: string) => void;
    onSetThinkingLevel: (level: string) => void;
}): ReactNode {
    const query = searchValue.trim().toLowerCase();
    const groupedModels = groupModelsByProvider(availableModels);
    const recentAvailable = recentModels
        .map((recent) => availableModels.find((model) => model.id === recent.id && model.provider === recent.provider))
        .filter((model): model is ModelInfo => !!model);

    const levels = ['off', 'minimal', 'low', 'medium', 'high'];

    return (
        <div className="model-picker" id="model-picker" ref={pickerRef}>
            <input
                className="model-search"
                placeholder="Search models..."
                type="text"
                value={searchValue}
                ref={searchRef}
                onChange={(event) => onSearchChange(event.target.value)}
            />

            <div className="model-list">
                {query ? (
                    filteredModels.map((model) => (
                        <ModelItem key={`${model.provider}:${model.id}`} model={model} currentModel={currentModel} onSelectModel={onSelectModel} />
                    ))
                ) : (
                    <>
                        {recentAvailable.length > 0 ? (
                            <>
                                <div className="model-section-header">Recent</div>
                                {recentAvailable.map((model) => (
                                    <ModelItem key={`recent:${model.provider}:${model.id}`} model={model} currentModel={currentModel} onSelectModel={onSelectModel} />
                                ))}
                            </>
                        ) : null}

                        {groupedModels.map(([provider, models]) => (
                            <Fragment key={provider}>
                                <div className="model-section-header" data-provider={provider}>{provider}</div>
                                {models.map((model) => (
                                    <ModelItem key={`${provider}:${model.id}`} model={model} currentModel={currentModel} onSelectModel={onSelectModel} />
                                ))}
                            </Fragment>
                        ))}
                    </>
                )}
            </div>

            <div className="thinking-chips">
                <span className="thinking-label">Thinking:</span>
                {levels.map((level) => (
                    <button
                        className={`thinking-chip${level === thinkingLevel ? ' active' : ''}`}
                        data-level={level}
                        key={level}
                        type="button"
                        onClick={() => onSetThinkingLevel(level)}
                    >
                        {level.charAt(0).toUpperCase() + level.slice(1)}
                    </button>
                ))}
            </div>
        </div>
    );
}

function ModelItem({
    model,
    currentModel,
    onSelectModel,
}: {
    model: ModelInfo;
    currentModel?: ModelInfo;
    onSelectModel: (provider: string, modelId: string) => void;
}): ReactNode {
    const isActive = currentModel && currentModel.id === model.id && currentModel.provider === model.provider;

    return (
        <div
            className={`model-item${isActive ? ' active' : ''}`}
            data-provider={model.provider}
            data-model-id={model.id}
            data-name={(model.name ?? model.id).toLowerCase()}
            onClick={() => onSelectModel(model.provider, model.id)}
        >
            <span className="model-item-check">{isActive ? '✓' : ''}</span>
            <span className="model-item-name">{model.name ?? model.id}</span>
        </div>
    );
}

function ToolApprovalCard({
    pending,
    onApprove,
    onReject,
}: {
    pending: ToolCallPendingInfo;
    onApprove: (toolCallId: string) => void;
    onReject: (toolCallId: string) => void;
}): ReactNode {
    const parsedArgs = typeof pending.args === 'string' ? tryParseJSON(pending.args) : pending.args;
    return (
        <div className="tool-approval-card" id={`approval-${pending.toolCallId}`}>
            <div className="tool-header">
                <span className="tool-icon">{getToolIconNode(pending.toolName)}</span>
                <span className="tool-name">{getToolLabel(pending.toolName, parsedArgs)}</span>
                <span className="tool-status pending">awaiting approval</span>
            </div>
            <div className="approval-args">{formatToolArgs(parsedArgs)}</div>
            <div className="approval-actions">
                <button className="approval-btn approve" data-toolcallid={pending.toolCallId} type="button" onClick={() => onApprove(pending.toolCallId)}>
                    Approve
                </button>
                <button className="approval-btn reject" data-toolcallid={pending.toolCallId} type="button" onClick={() => onReject(pending.toolCallId)}>
                    Reject
                </button>
            </div>
        </div>
    );
}

function ThinkingBlock({
    text,
    active,
    durationSec,
    idPrefix,
    openByDefault,
}: {
    text: string;
    active: boolean;
    durationSec?: number;
    idPrefix: string;
    openByDefault?: boolean;
}): ReactNode {
    let label = 'Thought';
    if (active) {
        label = 'Thinking...';
    } else if (durationSec && durationSec > 0) {
        label = `Thought for ${durationSec} second${durationSec !== 1 ? 's' : ''}`;
    }

    return (
        <details className={`thinking-block${active ? ' active' : ''}`} open={openByDefault || active || undefined}>
            <summary className="thinking-summary">
                <span className="thinking-indicator" />
                <span className="thinking-label">{label}</span>
                <span className="thinking-chevron">&#9656;</span>
            </summary>
            <div className="thinking-content" dangerouslySetInnerHTML={{ __html: renderMarkdown(text, idPrefix) }} />
        </details>
    );
}

function UserMessageContent({
    text,
    files,
    expanded,
    onToggle,
}: {
    text: string;
    files: FileReferenceInfo[];
    expanded: boolean;
    onToggle: () => void;
}): ReactNode {
    if (files.length > 0) {
        return (
            <div className="message-content message-content-user">
                <div className="user-inline-content">{buildInlineUserNodes(text.replace(/\r\n/g, '\n'), files)}</div>
            </div>
        );
    }

    const normalizedText = text.replace(/\r\n/g, '\n');
    const collapsed = shouldCollapseUserMessage(normalizedText);

    return (
        <div className="message-content message-content-user">
            <pre className={`user-message-text${collapsed && !expanded ? ' user-message-text-collapsed' : ''}`}>{normalizedText}</pre>
            {collapsed && !expanded ? <div className="user-message-fade" /> : null}
            {collapsed ? (
                <button className="user-message-toggle" data-expanded={expanded ? 'true' : 'false'} type="button" onClick={onToggle}>
                    {expanded ? 'Show less' : 'Show more'}
                </button>
            ) : null}
        </div>
    );
}

function DiffCard({
    change,
    timestamp,
    loadingStatus,
    onOpenDiff,
}: {
    change: FileChangeInfo;
    timestamp?: number;
    loadingStatus?: 'running' | 'done' | 'error';
    onOpenDiff: (filePath: string, toolCallId: string) => void;
}): ReactNode {
    const fileName = change.filePath.split('/').pop() ?? change.filePath;
    const dirPath = change.filePath.split('/').slice(0, -1).join('/');

    return (
        <div className="tool-card-wrapper tool-card-wrapper-diff">
            <div className={`diff-card${loadingStatus === 'running' ? ' loading' : ''}`} id={`diff-${change.toolCallId}`}>
                <div className="diff-file-header" data-filepath={change.filePath} data-toolcallid={change.toolCallId} onClick={() => onOpenDiff(change.filePath, change.toolCallId)}>
                    <span className="diff-file-icon">{change.isNew ? '✚' : '✎'}</span>
                    <span className="diff-file-name">{fileName}</span>
                    {dirPath ? <span className="diff-file-dir">{dirPath}</span> : null}
                    {change.addedLines > 0 || change.removedLines > 0 ? (
                        <span className="diff-stats">
                            {change.addedLines > 0 ? <span className="diff-stat-add">+{change.addedLines}</span> : null}
                            {change.removedLines > 0 ? <span className="diff-stat-del">-{change.removedLines}</span> : null}
                        </span>
                    ) : null}
                    {change.isNew ? <span className="diff-new-badge">NEW</span> : null}
                    {loadingStatus ? <span className={`tool-status ${loadingStatus}`}>{loadingStatus}</span> : null}
                </div>

                {change.diff ? <div className="diff-view">{renderDiffLines(change.diff)}</div> : null}
            </div>

            {timestamp ? <div className="tool-footer">{formatTimestamp(timestamp)}</div> : null}
        </div>
    );
}

function ToolResultCard({
    message,
    allMessages,
    index,
    onOpenFile,
}: {
    message: any;
    allMessages: any[];
    index: number;
    onOpenFile: (filePath: string) => void;
}): ReactNode {
    const isError = message.isError ?? false;
    const toolName = message.toolName ?? '';
    const toolCallId = message.toolCallId ?? '';
    const nameLower = toolName.toLowerCase();
    const matchingCall = findToolCallInMessages(allMessages, index, toolCallId);
    const args = matchingCall?.arguments ?? matchingCall?.args ?? matchingCall?.input ?? {};
    const parsedArgs = typeof args === 'string' ? tryParseJSON(args) : args;
    const label = toolName ? getToolLabel(toolName, parsedArgs) : 'Tool Result';
    const resultContent = extractText(message);
    const isBash = nameLower === 'bash';
    const isRead = nameLower === 'read';
    const filePath = parsedArgs?.path ?? parsedArgs?.file_path ?? '';
    const hasBody = !!(resultContent || isBash) && !isRead;
    const footer = buildToolFooter(message, allMessages, index);

    if (hasBody) {
        return (
            <div className="tool-card-wrapper">
                <details className="tool-card tool-expandable">
                    <summary className="tool-header">
                        <span className="tool-icon">{getToolIconNode(toolName)}</span>
                        <span className="tool-name">{label}</span>
                        {buildStatusNode(isError ? 'error' : 'done')}
                        <span className="tool-expand-arrow">&#9656;</span>
                    </summary>
                    <div className="tool-body">
                        <pre className={`tool-result${resultContent ? '' : ' empty'}`}>{resultContent || '(no output)'}</pre>
                    </div>
                </details>
                {footer ? <div className="tool-footer">{footer}</div> : null}
            </div>
        );
    }

    return (
        <div className="tool-card-wrapper">
            <div className={`tool-card${isRead ? ' tool-clickable' : ''}`} data-filepath={filePath || undefined}>
                <div className="tool-header">
                    <span className="tool-icon">{getToolIconNode(toolName)}</span>
                    <span
                        className="tool-name"
                        style={isRead && filePath ? { cursor: 'pointer' } : undefined}
                        onClick={(event) => {
                            if (!isRead || !filePath) return;
                            event.preventDefault();
                            event.stopPropagation();
                            onOpenFile(filePath);
                        }}
                    >
                        {label}
                    </span>
                    {buildStatusNode(isError ? 'error' : 'done')}
                </div>
            </div>
            {footer ? <div className="tool-footer">{footer}</div> : null}
        </div>
    );
}

function renderStreamingItem(
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
            <div className={`diff-card${item.status === 'running' ? ' loading' : ''}`} id={`tool-${item.toolCallId}`} key={`stream-diff-loading:${item.toolCallId}`}>
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
            <details className="tool-card tool-expandable" id={`tool-${item.toolCallId}`} key={`stream-tool:${item.toolCallId}`} data-tool-name={item.toolName}>
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
                        {item.status === 'running' ? item.partialText || '(running...)' : item.resultText || '(no output)'}
                    </pre>
                </div>
            </details>
        );
    }

    return (
        <div className={`tool-card${item.isRead ? ' tool-clickable' : ''}`} id={`tool-${item.toolCallId}`} key={`stream-tool:${item.toolCallId}`} data-tool-name={item.toolName}>
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

function buildHistoryNodes({
    state,
    expandedUserMessages,
    onToggleExpandedUserMessage,
    onRestoreCheckpoint,
    onRedoCheckpoint,
    onOpenDiff,
    onOpenFile,
}: {
    state: WebviewState;
    expandedUserMessages: Record<number, boolean>;
    onToggleExpandedUserMessage: (index: number) => void;
    onRestoreCheckpoint: (turnNumber: number) => void;
    onRedoCheckpoint: () => void;
    onOpenDiff: (filePath: string, toolCallId: string) => void;
    onOpenFile: (filePath: string) => void;
}): ReactNode[] {
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
            onToggleExpanded: () => onToggleExpandedUserMessage(index),
            onRestoreCheckpoint,
            onOpenDiff,
            onOpenFile,
        });

        if (rendered) {
            nodes.push(rendered);
        }

        if (role === 'user' && dimming && !redoPlaced && state.rollbackPoint !== null) {
            nodes.push(
                <div className="redo-anchor" key={`redo-${index}`}>
                    <button className="redo-btn" title="Redo changes" type="button" onClick={onRedoCheckpoint}>Redo</button>
                </div>
            );
            redoPlaced = true;
        }
    }

    return nodes;
}

function renderHistoryMessage({
    message,
    index,
    userTurnNumber,
    state,
    dimmed,
    expanded,
    onToggleExpanded,
    onRestoreCheckpoint,
    onOpenDiff,
    onOpenFile,
}: {
    message: any;
    index: number;
    userTurnNumber?: number;
    state: WebviewState;
    dimmed: boolean;
    expanded: boolean;
    onToggleExpanded: () => void;
    onRestoreCheckpoint: (turnNumber: number) => void;
    onOpenDiff: (filePath: string, toolCallId: string) => void;
    onOpenFile: (filePath: string) => void;
}): ReactNode | null {
    const role = message.role ?? 'unknown';

    if (role === 'toolResult' || role === 'tool') {
        const toolName = message.toolName ?? '';
        if (toolName === 'edit' || toolName === 'write') {
            const matchingChange = findFileChangeForToolResult(message, state.fileChanges);
            if (matchingChange) {
                return (
                    <div className={dimmed ? 'dimmed' : undefined} key={`msg-${index}`}>
                        <DiffCard change={matchingChange} timestamp={message.timestamp} onOpenDiff={onOpenDiff} />
                    </div>
                );
            }
        }
        return (
            <div className={dimmed ? 'dimmed' : undefined} key={`msg-${index}`}>
                <ToolResultCard message={message} allMessages={state.messages} index={index} onOpenFile={onOpenFile} />
            </div>
        );
    }

    if (role === 'user') {
        const rawText = extractText(message);
        const fallback = extractUserPromptDisplay(rawText);
        const userText = message._displayText ?? fallback.userText;
        const files = Array.isArray(message._attachedFiles) ? message._attachedFiles : fallback.files;
        const normalized = normalizeInlineFileDisplay(userText, files);
        const footer = buildMessageFooter(state.messages, message, index);

        return (
            <div className={`message-group-user${dimmed ? ' dimmed' : ''}`} key={`msg-${index}`}>
                <div className="message message-user">
                    {userTurnNumber !== undefined && !state.isStreaming ? (
                        <button
                            className="checkpoint-btn"
                            title="Restore to this checkpoint"
                            data-turn={String(userTurnNumber)}
                            type="button"
                            onClick={() => onRestoreCheckpoint(userTurnNumber)}
                        >
                            &#8634;
                        </button>
                    ) : null}
                    {(normalized.text || normalized.files.length > 0) ? (
                        <UserMessageContent
                            text={normalized.text}
                            files={normalized.files}
                            expanded={expanded}
                            onToggle={onToggleExpanded}
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
            <div className="message message-assistant">
                {thinking ? (
                    <ThinkingBlock
                        text={thinking}
                        active={false}
                        durationSec={message._thinkingDurationSec}
                        idPrefix={`thinking-${index}`}
                    />
                ) : null}
                {text ? (
                    <div className="message-content" dangerouslySetInnerHTML={{ __html: renderMarkdown(text, `msg-${index}`) }} />
                ) : null}
            </div>
            {footer ? <div className="message-footer">{footer}</div> : null}
        </div>
    );
}

function renderContextUsage(contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null }): ReactNode {
    if (!contextUsage) return null;

    const tokens = contextUsage.tokens != null ? formatTokenCount(contextUsage.tokens) : null;
    const contextWindow = formatTokenCount(contextUsage.contextWindow);
    const percent = contextUsage.percent != null ? Math.round(contextUsage.percent) : null;

    if (tokens !== null && percent !== null) {
        return (
            <span className="footer-context" title={`Context: ${tokens} / ${contextWindow} tokens (${percent}%)`}>
                {tokens} / {contextWindow} · {percent}%
            </span>
        );
    }

    return (
        <span className="footer-context" title={`Context window: ${contextWindow} tokens`}>
            {contextWindow}
        </span>
    );
}

function handleAgentEvent(
    event: any,
    setState: React.Dispatch<React.SetStateAction<WebviewState>>,
    setStreamingItems: React.Dispatch<React.SetStateAction<StreamingItem[]>>,
    setToolApprovals: React.Dispatch<React.SetStateAction<ToolCallPendingInfo[]>>,
    setUserHasScrolled: React.Dispatch<React.SetStateAction<boolean>>,
    dismissSteerToast: () => void,
    clearSteerToastImmediately: () => void,
): void {
    switch (event.type) {
        case 'message_update':
            if (event.assistantMessageEvent) {
                setState((previous) => applyStreamingDelta(previous, event.assistantMessageEvent));
                if (event.assistantMessageEvent.type === 'thinking_delta' || event.assistantMessageEvent.type === 'text_delta') {
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
            break;

        case 'tool_execution_start':
            setStreamingItems((previous) => appendStreamingTool(previous, event));
            break;

        case 'tool_execution_update':
            setStreamingItems((previous) => updateStreamingTool(previous, event));
            break;

        case 'tool_execution_end':
            setStreamingItems((previous) => finishStreamingTool(previous, event));
            break;
    }
}

function applySerializedState(previous: WebviewState, serialized: SerializedAgentState): WebviewState {
    return {
        ...previous,
        messages: serialized.messages ?? [],
        isStreaming: serialized.isStreaming,
        model: serialized.model,
        thinkingLevel: serialized.thinkingLevel,
        tools: serialized.tools ?? [],
        sessionId: serialized.sessionId,
        sessionName: serialized.sessionName,
        contextUsage: serialized.contextUsage,
        fileChanges: serialized.fileChanges ?? [],
        rollbackPoint: serialized.rollbackPoint ?? null,
        tabs: serialized.tabs ?? [],
        activeTabId: serialized.activeTabId ?? '',
        streamingText: serialized.streamingText ?? '',
        streamingThinking: serialized.streamingThinking ?? '',
        isThinking: serialized.isThinking ?? false,
        thinkingStartTime: serialized.thinkingStartTime ?? 0,
        streamingThinkingDuration: serialized.streamingThinkingDuration ?? 0,
        queuedMessages: serialized.queuedMessages ?? [],
    };
}

function applyStreamingDelta(previous: WebviewState, assistantEvent: any): WebviewState {
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
                streamingThinkingDuration: previous.thinkingStartTime > 0
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

function appendStreamingTool(previous: StreamingItem[], event: any): StreamingItem[] {
    if ((event.toolName === 'edit' || event.toolName === 'write') && event.args?.path) {
        return [
            ...previous,
            {
                kind: 'diff-loading',
                toolCallId: event.toolCallId,
                path: event.args.path,
                status: 'running',
            },
        ];
    }

    const parsedArgs = typeof event.args === 'string' ? tryParseJSON(event.args) : event.args;
    const toolName = event.toolName ?? '';
    const nameLower = toolName.toLowerCase();
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
            filePath: parsedArgs?.path ?? parsedArgs?.file_path ?? '',
        },
    ];
}

function updateStreamingTool(previous: StreamingItem[], event: any): StreamingItem[] {
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

function finishStreamingTool(previous: StreamingItem[], event: any): StreamingItem[] {
    return previous.map((item) => {
        if (item.toolCallId !== event.toolCallId) {
            return item;
        }

        if (item.kind === 'diff-loading') {
            return {
                ...item,
                status: event.isError ? 'error' : 'done',
            };
        }

        if (item.kind === 'tool') {
            return {
                ...item,
                status: event.isError ? 'error' : 'done',
                resultText: extractToolResultText(event.result),
            };
        }

        return item;
    });
}

function applyStreamingDiff(previous: StreamingItem[], change: FileChangeInfo): StreamingItem[] {
    const next = previous.map((item) => {
        if (item.toolCallId !== change.toolCallId) {
            return item;
        }
        return { kind: 'diff', change } as StreamingItem;
    });

    if (next.some((item) => item.kind === 'diff' && item.change.toolCallId === change.toolCallId)) {
        return next;
    }

    return [...next, { kind: 'diff', change }];
}

function isRunningStreamingItem(item: StreamingItem): boolean {
    if (item.kind === 'diff') return false;
    return item.status === 'running';
}

function buildInlineUserNodes(text: string, files: FileReferenceInfo[]): ReactNode[] {
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
            nodes.push(<AttachedFileChip file={file} key={`file-${file.relativePath}-${index}`} />);
        });
        if (text) {
            nodes.push(<span className="user-inline-text" key="text-tail">{text}</span>);
        }
        return nodes;
    }

    let textOffset = 0;
    positionedFiles.forEach((file, index) => {
        const insertOffset = file.insertOffset ?? 0;
        const before = text.slice(textOffset, insertOffset);
        if (before) {
            nodes.push(<span className="user-inline-text" key={`text-${index}-${textOffset}`}>{before}</span>);
        }
        nodes.push(<AttachedFileChip file={file} key={`file-${file.relativePath}-${index}`} />);
        textOffset = insertOffset;
    });

    const trailingText = text.slice(textOffset);
    if (trailingText) {
        nodes.push(<span className="user-inline-text" key="text-trailing">{trailingText}</span>);
    }
    return nodes;
}

function AttachedFileChip({ file }: { file: FileReferenceInfo }): ReactNode {
    return (
        <span className="attachment-chip attachment-chip-file attachment-chip-inline attachment-chip-static" title={file.relativePath}>
            <span className="attachment-file-icon">@</span>
            <span className="attachment-chip-name">{file.displayName}</span>
        </span>
    );
}

function renderFileTreeCard(selected?: FileReferenceInfo): ReactNode {
    if (!selected) return null;
    const parts = selected.relativePath.split('/');

    return (
        <div className="file-menu-tree-card">
            <div className="file-menu-tree-title">{parts[0] ?? selected.relativePath}</div>
            <div className="file-menu-tree-lines">
                {parts.map((part, index) => (
                    <div className="file-menu-tree-line" key={`${part}-${index}`} style={{ paddingLeft: `${index * 14}px` }}>
                        <span className="file-menu-tree-icon">{index === parts.length - 1 ? '@' : '>'}</span>
                        <span className="file-menu-tree-label">{part}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

function renderDiffLines(diff: string): ReactNode {
    return diff.split('\n').map((line, index) => {
        if (line.startsWith('--- ') || line.startsWith('+++ ')) {
            return null;
        }

        let className = 'diff-line diff-line-ctx';
        if (line.startsWith('@@')) {
            className = 'diff-line diff-line-hunk';
        } else if (line.startsWith('+')) {
            className = 'diff-line diff-line-add';
        } else if (line.startsWith('-')) {
            className = 'diff-line diff-line-del';
        }

        return <div className={className} key={`diff-${index}`}>{line}</div>;
    });
}

function getComposerPayload(input: HTMLElement | null): { text: string; files: FileReferenceInfo[] } {
    if (!input) {
        return { text: '', files: [] };
    }

    const raw = readComposerContent(input);
    const leadingTrim = raw.text.length - raw.text.trimStart().length;
    const text = raw.text.trim();
    const seen = new Set<string>();
    const files: FileReferenceInfo[] = [];

    for (const file of raw.files) {
        if (seen.has(file.relativePath)) continue;
        seen.add(file.relativePath);
        const rawOffset = file.insertOffset ?? 0;
        files.push({
            relativePath: file.relativePath,
            displayName: file.displayName,
            insertOffset: Math.max(0, Math.min(text.length, rawOffset - leadingTrim)),
        });
    }

    return { text, files };
}

function readComposerContent(root: Node): { text: string; files: FileReferenceInfo[] } {
    let text = '';
    const files: FileReferenceInfo[] = [];

    const walk = (node: Node): void => {
        if (isComposerFileChip(node)) {
            files.push({
                relativePath: node.dataset.filePath ?? '',
                displayName: node.dataset.fileName ?? node.dataset.filePath ?? '',
                insertOffset: text.length,
            });
            return;
        }

        if (node.nodeType === Node.TEXT_NODE) {
            text += node.textContent ?? '';
            return;
        }

        if (isLineBreakNode(node)) {
            text += '\n';
            return;
        }

        node.childNodes.forEach(walk);
    };

    walk(root);
    return { text, files: files.filter((file) => file.relativePath) };
}

function getComposerTextBeforeCaret(input: HTMLElement): string {
    const offset = getComposerCaretTextOffset(input);
    return readComposerContent(input).text.slice(0, offset);
}

function getComposerCaretTextOffset(input: HTMLElement): number {
    const selection = window.getSelection();
    const anchorNode = selection?.anchorNode;
    if (!selection || !anchorNode || !isNodeInside(anchorNode, input)) {
        return readComposerContent(input).text.length;
    }

    let textOffset = 0;
    let found = false;
    const anchorOffset = selection.anchorOffset;

    const walk = (node: Node): void => {
        if (found) return;

        if (node === anchorNode) {
            if (node.nodeType === Node.TEXT_NODE) {
                textOffset += Math.min(anchorOffset, node.textContent?.length ?? 0);
            } else {
                const children = Array.from(node.childNodes).slice(0, anchorOffset);
                for (const child of children) {
                    textOffset += getComposerNodeTextLength(child);
                }
            }
            found = true;
            return;
        }

        if (isComposerFileChip(node)) return;

        if (node.nodeType === Node.TEXT_NODE) {
            textOffset += node.textContent?.length ?? 0;
            return;
        }

        if (isLineBreakNode(node)) {
            textOffset += 1;
            return;
        }

        node.childNodes.forEach(walk);
    };

    walk(input);
    return found ? textOffset : readComposerContent(input).text.length;
}

function getComposerNodeTextLength(node: Node): number {
    if (isComposerFileChip(node)) return 0;
    if (node.nodeType === Node.TEXT_NODE) return node.textContent?.length ?? 0;
    if (isLineBreakNode(node)) return 1;

    let length = 0;
    node.childNodes.forEach((child) => {
        length += getComposerNodeTextLength(child);
    });
    return length;
}

function replaceComposerTextRange(
    input: HTMLElement,
    startOffset: number,
    endOffset: number,
    replacement: string | Node,
    trailingText = ''
): void {
    const range = document.createRange();
    const start = findComposerTextPosition(input, startOffset);
    const end = findComposerTextPosition(input, endOffset);
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    range.deleteContents();

    if (typeof replacement === 'string') {
        const textNode = document.createTextNode(replacement);
        range.insertNode(textNode);
        setComposerCaret(textNode, textNode.length);
    } else {
        const fragment = document.createDocumentFragment();
        fragment.appendChild(replacement);
        const trailingNode = document.createTextNode(trailingText);
        fragment.appendChild(trailingNode);
        range.insertNode(fragment);
        setComposerCaret(trailingNode, trailingNode.length);
    }

    input.dispatchEvent(new Event('input', { bubbles: true }));
}

function findComposerTextPosition(root: HTMLElement, targetOffset: number): { node: Node; offset: number } {
    const target = Math.max(0, targetOffset);
    let textOffset = 0;
    let found: { node: Node; offset: number } | null = null;

    const walk = (node: Node): void => {
        if (found) return;
        if (isComposerFileChip(node)) return;

        if (node.nodeType === Node.TEXT_NODE) {
            const length = node.textContent?.length ?? 0;
            if (target <= textOffset + length) {
                found = { node, offset: Math.max(0, target - textOffset) };
                return;
            }
            textOffset += length;
            return;
        }

        if (isLineBreakNode(node)) {
            if (target <= textOffset) {
                found = { node: node.parentNode ?? root, offset: getNodeIndex(node) };
                return;
            }
            if (target <= textOffset + 1) {
                found = { node: node.parentNode ?? root, offset: getNodeIndex(node) + 1 };
                return;
            }
            textOffset += 1;
            return;
        }

        node.childNodes.forEach(walk);
    };

    walk(root);
    return found ?? { node: root, offset: root.childNodes.length };
}

function insertComposerText(input: HTMLElement, text: string): void {
    const selection = window.getSelection();
    const range = document.createRange();

    if (selection && selection.rangeCount > 0 && selection.anchorNode && isNodeInside(selection.anchorNode, input)) {
        const selectedRange = selection.getRangeAt(0);
        range.setStart(selectedRange.startContainer, selectedRange.startOffset);
        range.setEnd(selectedRange.endContainer, selectedRange.endOffset);
    } else {
        range.selectNodeContents(input);
        range.collapse(false);
    }

    range.deleteContents();
    const textNode = document.createTextNode(text);
    range.insertNode(textNode);
    setComposerCaret(textNode, textNode.length);
    input.dispatchEvent(new Event('input', { bubbles: true }));
}

function normalizeComposerEmptyState(input: HTMLElement): void {
    if (!input.querySelector('.attachment-chip-inline') && input.textContent === '') {
        input.innerHTML = '';
    }
}

function createComposerFileChip(file: FileReferenceInfo): HTMLElement {
    const chip = document.createElement('span');
    chip.className = 'attachment-chip attachment-chip-file attachment-chip-inline';
    chip.contentEditable = 'false';
    chip.dataset.filePath = file.relativePath;
    chip.dataset.fileName = file.displayName;
    chip.title = file.relativePath;
    chip.innerHTML = `
        <span class="attachment-file-icon">@</span>
        <span class="attachment-chip-name">${escHtml(file.displayName)}</span>
        <button class="attachment-chip-remove" type="button" title="Remove">&times;</button>
    `;

    chip.querySelector('.attachment-chip-remove')?.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const input = chip.closest('#input') as HTMLElement | null;
        chip.remove();
        input?.dispatchEvent(new Event('input', { bubbles: true }));
        input?.focus();
    });

    return chip;
}

function setComposerCaret(node: Node, offset: number): void {
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.setStart(node, offset);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
}

function isComposerFileChip(node: Node): node is HTMLElement {
    return node instanceof HTMLElement
        && node.classList.contains('attachment-chip-file')
        && !!node.dataset.filePath;
}

function isLineBreakNode(node: Node): boolean {
    return node instanceof HTMLBRElement;
}

function isNodeInside(node: Node, root: HTMLElement): boolean {
    return node === root || root.contains(node);
}

function getNodeIndex(node: Node): number {
    return node.parentNode ? Array.prototype.indexOf.call(node.parentNode.childNodes, node) : 0;
}

function extractToolCalls(message: any): any[] {
    if (Array.isArray(message.toolCalls) && message.toolCalls.length > 0) return message.toolCalls;
    if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) return message.tool_calls;
    if (Array.isArray(message.content)) {
        const toolCalls = message.content.filter((content: any) => content.type === 'toolCall' || content.type === 'tool_call' || content.type === 'tool_use');
        if (toolCalls.length > 0) return toolCalls;
    }
    return [];
}

function findFileChangeForToolResult(message: any, fileChanges: FileChangeInfo[]): FileChangeInfo | undefined {
    const id = message.toolCallId ?? message.tool_call_id;
    if (!id) return undefined;
    return fileChanges.find((change) => change.toolCallId === id);
}

function extractText(message: any): string {
    if (typeof message.content === 'string') return message.content;
    if (Array.isArray(message.content)) {
        return message.content
            .filter((content: any) => content.type === 'text')
            .map((content: any) => content.text)
            .join('');
    }
    return message.text ?? '';
}

function extractThinking(message: any): string {
    if (Array.isArray(message.content)) {
        return message.content
            .filter((content: any) => content.type === 'thinking')
            .map((content: any) => content.thinking ?? content.text ?? '')
            .join('');
    }
    return message.thinking ?? '';
}

function extractToolResultText(result: any): string {
    if (result === undefined || result === null) return '';
    if (typeof result === 'string') return result;
    if (Array.isArray(result)) {
        return result
            .map((item: any) => (typeof item === 'string' ? item : item?.text ?? ''))
            .filter(Boolean)
            .join('\n');
    }
    if (typeof result === 'object') {
        if (Array.isArray(result.content)) {
            const text = result.content
                .map((item: any) => (typeof item === 'string' ? item : item?.text ?? ''))
                .filter(Boolean)
                .join('\n');
            if (text) return text;
        }
        if (result.text) return result.text;
        if (result.output) return result.output;
    }
    return JSON.stringify(result, null, 2);
}

function getToolIconNode(name: string): ReactNode {
    const iconFiles: Record<string, string> = {
        bash: 'terminal.png',
        python: 'code.png',
        read: 'text.png',
        write: 'pencil.png',
        edit: 'pencil.png',
        glob: 'magnifying-glass.png',
        grep: 'magnifying-glass.png',
        list: 'folder.png',
    };
    const file = iconFiles[name.toLowerCase()] ?? 'bolt.png';
    return <img className="tool-icon-img" src={`${iconsBaseUri}/${file}`} alt={name} />;
}

function getToolLabel(name: string, args: any): string {
    switch (name.toLowerCase()) {
        case 'bash':
            return args?.command ? truncate(args.command, 60) : 'Execute command';
        case 'read':
            return args?.path ? `Read ${truncate(args.path, 50)}` : 'Read file';
        case 'write':
            return args?.path ? `Write ${truncate(args.path, 50)}` : 'Write file';
        case 'edit':
            return args?.path ? `Edit ${truncate(args.path, 50)}` : 'Edit file';
        case 'glob':
            return args?.pattern ? `Glob ${truncate(args.pattern, 50)}` : 'Find files';
        case 'grep':
            return args?.pattern ? `Grep ${truncate(args.pattern, 50)}` : 'Search files';
        default:
            return name;
    }
}

function buildStatusNode(status: 'running' | 'error' | 'pending' | 'done'): ReactNode {
    if (status === 'done') return null;
    return <span className={`tool-status ${status}`}>{status === 'pending' ? 'awaiting approval' : status}</span>;
}

function buildToolFooter(message: any, allMessages: any[], index: number): string | null {
    const parts: string[] = [];
    if (message.timestamp) {
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

function findPrecedingAssistant(messages: any[], beforeIndex: number): any | null {
    for (let index = beforeIndex - 1; index >= 0; index--) {
        if (messages[index].role === 'assistant') return messages[index];
        if (messages[index].role === 'user') return null;
    }
    return null;
}

function findToolCallInMessages(messages: any[], beforeIndex: number, toolCallId: string): any | undefined {
    if (!toolCallId) return undefined;
    for (let index = beforeIndex - 1; index >= 0; index--) {
        const message = messages[index];
        if (message.role !== 'assistant') continue;
        const toolCalls = extractToolCalls(message);
        for (const toolCall of toolCalls) {
            if ((toolCall.id ?? toolCall.toolCallId) === toolCallId) {
                return toolCall;
            }
        }
    }
    return undefined;
}

function buildMessageFooter(messages: any[], message: any, index: number): string | null {
    const role = message.role ?? 'unknown';
    if (role !== 'user' && role !== 'assistant') return null;

    const parts: string[] = [];
    if (message.timestamp) {
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
        if (message._messageEndTime && message.timestamp) {
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

function extractUserPromptDisplay(text: string): { userText: string; files: FileReferenceInfo[] } {
    const legacyPrefix = 'Attached file context:\n\n';
    const legacySeparator = '\n\nUser request:\n';
    if (text.startsWith(legacyPrefix)) {
        const separatorIndex = text.indexOf(legacySeparator);
        if (separatorIndex !== -1) {
            const fileBlock = text.slice(legacyPrefix.length, separatorIndex);
            const userText = text.slice(separatorIndex + legacySeparator.length);
            return {
                userText,
                files: extractFileReferences(fileBlock, /^BEGIN FILE: (.+)$/gm),
            };
        }
    }

    const suffixMarker = '\n\nAttached file context:\n\n';
    const suffixIndex = text.lastIndexOf(suffixMarker);
    if (suffixIndex === -1) {
        return { userText: text, files: [] };
    }

    const userText = text.slice(0, suffixIndex);
    const fileBlock = text.slice(suffixIndex + suffixMarker.length);
    const files = extractFileReferences(fileBlock, /<file path="([^"]+)">/gm);
    const normalized = stripInlineFileMarkers(userText, files);
    return {
        userText: normalized.text,
        files: normalized.files,
    };
}

function extractFileReferences(fileBlock: string, pattern: RegExp): FileReferenceInfo[] {
    const paths = [...fileBlock.matchAll(pattern)].map((match) => unescapeHtmlEntities(match[1]));
    const seen = new Set<string>();
    const files: FileReferenceInfo[] = [];

    for (const relativePath of paths) {
        if (seen.has(relativePath)) continue;
        seen.add(relativePath);
        files.push({
            relativePath,
            displayName: relativePath.split('/').pop() ?? relativePath,
        });
    }

    return files;
}

function unescapeHtmlEntities(value: string): string {
    const div = document.createElement('div');
    div.innerHTML = value;
    return div.textContent ?? value;
}

function stripInlineFileMarkers(text: string, files: FileReferenceInfo[]): { text: string; files: FileReferenceInfo[] } {
    let result = '';
    let remaining = text;
    const normalizedFiles: FileReferenceInfo[] = [];

    for (const file of files) {
        const marker = `@${file.relativePath}`;
        const markerIndex = remaining.indexOf(marker);
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

function normalizeInlineFileDisplay(text: string, files: FileReferenceInfo[]): { text: string; files: FileReferenceInfo[] } {
    if (files.length === 0) {
        return { text, files };
    }

    const hasInlineMarkers = files.some((file) => text.includes(`@${file.relativePath}`));
    const hasExplicitOffsets = files.some((file) => typeof file.insertOffset === 'number');
    if (!hasInlineMarkers && hasExplicitOffsets) {
        return { text, files };
    }

    return stripInlineFileMarkers(text, files);
}

function shouldCollapseUserMessage(text: string): boolean {
    if (text.length > USER_MESSAGE_COLLAPSE_CHAR_LIMIT) return true;
    return text.split('\n').length > USER_MESSAGE_COLLAPSE_LINE_LIMIT;
}

function renderMarkdown(text: string, prefix = 'cb'): string {
    if (!text) return '';
    markdownRenderPrefix = prefix;
    markdownCodeBlockId = 0;
    return marked.parse(text) as string;
}

function getFileIcon(filePath: string): string {
    const extension = filePath.split('.').pop()?.toLowerCase() ?? '';
    const icons: Record<string, string> = {
        ts: '🔸', tsx: '🔸',
        js: '🔹', jsx: '🔹',
        json: '🔸',
        css: '🔵', scss: '🔵',
        html: '🟠',
        md: '🔶',
        py: '🔷',
        svg: '🟡',
    };
    return icons[extension] ?? '📄';
}

function getUniqueFileChanges(fileChanges: FileChangeInfo[]): FileChangeInfo[] {
    const fileMap = new Map<string, FileChangeInfo>();
    for (const change of fileChanges) {
        fileMap.set(change.filePath, change);
    }
    return [...fileMap.values()];
}

function addToRecentModels(recentModels: ModelInfo[], model: ModelInfo): ModelInfo[] {
    const next = recentModels.filter((entry) => !(entry.id === model.id && entry.provider === model.provider));
    next.unshift({ provider: model.provider, id: model.id, name: model.name });
    return next.slice(0, 5);
}

function groupModelsByProvider(models: ModelInfo[]): Array<[string, ModelInfo[]]> {
    const order: string[] = [];
    const groups = new Map<string, ModelInfo[]>();
    for (const model of models) {
        if (!groups.has(model.provider)) {
            groups.set(model.provider, []);
            order.push(model.provider);
        }
        groups.get(model.provider)?.push(model);
    }
    return order.map((provider) => [provider, groups.get(provider) ?? []]);
}

function formatToolArgs(args: any): string {
    if (!args || typeof args !== 'object') return '';
    const entries = Object.entries(args);
    if (entries.length === 0) return '';
    return entries.map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`).join('\n');
}

function formatTimestamp(timestamp: number): string {
    const date = new Date(timestamp < 1e12 ? timestamp * 1000 : timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatTokenCount(value: number): string {
    if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
    if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
    return String(value);
}

function truncate(value: string, maxLength: number): string {
    if (value.length <= maxLength) return value;
    return `${value.slice(0, maxLength)}...`;
}

function tryParseJSON(value: string): any {
    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
}

function isNearBottom(element: HTMLElement): boolean {
    return element.scrollHeight - element.scrollTop - element.clientHeight < 50;
}

function escHtml(value: string): string {
    const div = document.createElement('div');
    div.textContent = value;
    return div.innerHTML;
}

function useLatestRef<T>(value: T): React.MutableRefObject<T> {
    const ref = useRef(value);
    useEffect(() => {
        ref.current = value;
    }, [value]);
    return ref;
}

createRoot(document.getElementById('app')!).render(<App />);
