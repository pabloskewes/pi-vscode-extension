import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import type {
  FileReferenceInfo,
  ModelInfo,
  ServerMessage,
  SessionInfo,
  ToolCallPendingInfo,
  UsageSnapshotDTO,
} from '../shared/protocol';
import Composer from './components/chrome/Composer';
import Header from './components/chrome/Header';
import ImageLightbox from './components/chrome/ImageLightbox';
import ScrollBottomButton from './components/chrome/ScrollBottomButton';
import Messages from './components/messages/Messages';
import SessionPanel from './components/panels/SessionPanel';
import { useLatestRef } from './hooks/useLatestRef';
import {
  getComposerPayload,
  getComposerTextBeforeCaret,
  getComposerCaretTextOffset,
  insertComposerText,
  normalizeComposerEmptyState,
  readComposerContent,
  replaceComposerTextRange,
  createComposerFileChip,
} from './lib/composer';
import { isNearBottom } from './lib/dom';
import { addToRecentModels } from './lib/models';
import { applySerializedState, applyStreamingDiff, handleAgentEvent } from './lib/streaming';
import type { AgentEvent, FileMenuState, SlashMenuState, StreamingItem, WebviewState } from './types';
import { vscode } from './vscode-api';

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

export default function App(): ReactNode {
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
  const [fileMenuState, setFileMenuState] = useState<FileMenuState>({
    items: [],
    index: 0,
    query: '',
  });
  const [slashMenuState, setSlashMenuState] = useState<SlashMenuState>({
    items: [],
    index: 0,
  });
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
  const fileMenuRef = useRef<HTMLDivElement | null>(null);
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
    setSteerToastText(text.length > 80 ? `${text.slice(0, 80)}...` : text);
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
      (skill) =>
        skill.name.toLowerCase().includes(query) || skill.description.toLowerCase().includes(query)
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
            pendingImages: [
              ...previous.pendingImages,
              { dataUrl: reader.result as string, name: file.name },
            ],
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

    replaceComposerTextRange(
      input,
      matchStart,
      beforeCursor.length,
      createComposerFileChip(file),
      trailingText
    );
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

  const handleSetThinkingLevel = (level: string): void => {
    vscode.postMessage({ type: 'setThinkingLevel', level });
    setState((previous) => ({ ...previous, thinkingLevel: level }));
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

    const matched = state.availableModels.find(
      (model) => model.id === modelId && model.provider === provider
    );
    setState((previous) => ({
      ...previous,
      model: matched ? { provider, id: modelId, name: matched.name ?? modelId } : previous.model,
      recentModels: matched
        ? addToRecentModels(previous.recentModels, {
            provider,
            id: modelId,
            name: matched.name ?? modelId,
          })
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
    // Some environments drop the initial 'ready' before the listener is mounted.
    // Request the same data proactively on mount as a fallback.
    vscode.postMessage({ type: 'getState' });
    vscode.postMessage({ type: 'getSkills' });
    vscode.postMessage({ type: 'requestUsage' });
  }, []);

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
          setState((previous) => applySerializedState(previous, message.state as unknown as Record<string, unknown>));
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
            message.event as AgentEvent,
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

        case 'modelChanged':
          setState((previous) => {
            const nextState: WebviewState = { ...previous };
            if (message.model) {
              nextState.model = message.model;
              nextState.recentModels = addToRecentModels(previous.recentModels, message.model);
            }
            if (message.thinkingLevel) {
              nextState.thinkingLevel = message.thinkingLevel;
            }
            return nextState;
          });
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
            vscode.postMessage({
              type: 'restoreCheckpoint',
              messageIndex: message.payload.messageIndex as number,
            });
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
          setToolApprovals((previous) =>
            previous.filter((item) => item.toolCallId !== message.toolCallId)
          );
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

  useLayoutEffect(() => {
    if (!fileMenuState.items.length) return;
    const activeItem = fileMenuRef.current?.querySelector(
      `.slash-item[data-file-menu-index="${fileMenuState.index}"]`
    ) as HTMLElement | null;
    activeItem?.scrollIntoView({ block: 'nearest' });
  }, [fileMenuState.index, fileMenuState.items]);

  const filteredModels = useMemo(() => {
    const query = modelSearch.trim().toLowerCase();
    if (!query) return state.availableModels;
    return state.availableModels.filter((model) => {
      const name = (model.name ?? model.id).toLowerCase();
      const provider = model.provider.toLowerCase();
      return name.includes(query) || provider.includes(query) || model.id.toLowerCase().includes(query);
    });
  }, [modelSearch, state.availableModels]);

  const historyCallbacks = useMemo(
    () => ({
      onToggleExpandedUserMessage: (index: number) => {
        setExpandedUserMessages((previous) => ({
          ...previous,
          [index]: !previous[index],
        }));
      },
      onRestoreCheckpoint: (turnNumber: number) => {
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
    }),
    []
  );

  const handleApproveToolCall = (toolCallId: string): void => {
    vscode.postMessage({ type: 'approveToolCall', toolCallId });
    setToolApprovals((previous) => previous.filter((item) => item.toolCallId !== toolCallId));
  };

  const handleRejectToolCall = (toolCallId: string): void => {
    vscode.postMessage({ type: 'rejectToolCall', toolCallId });
    setToolApprovals((previous) => previous.filter((item) => item.toolCallId !== toolCallId));
  };

  const handleUndo = (): void => {
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
  };

  const handleRedo = (): void => {
    vscode.postMessage({
      type: 'confirmAction',
      action: 'redoCheckpoint',
      message: 'Re-apply the rolled-back changes?',
    });
  };

  const handleReviewAll = (): void => {
    const seen = new Set<string>();
    for (const change of state.fileChanges) {
      if (seen.has(change.filePath)) continue;
      seen.add(change.filePath);
      vscode.postMessage({
        type: 'openDiff',
        filePath: change.filePath,
        toolCallId: change.toolCallId,
      });
    }
  };

  const handleRemovePendingImage = (index: number): void => {
    setState((previous) => ({
      ...previous,
      pendingImages: previous.pendingImages.filter((_, imageIndex) => imageIndex !== index),
    }));
  };

  return (
    <>
      <Header
        tabs={state.tabs}
        activeTabId={state.activeTabId}
        onSwitchTab={(tabId) => vscode.postMessage({ type: 'switchTab', tabId })}
        onCloseTab={(tabId) => vscode.postMessage({ type: 'closeTab', tabId })}
        onCreateTab={() => vscode.postMessage({ type: 'createTab' })}
        onGetSessions={() => vscode.postMessage({ type: 'getSessions' })}
        onOpenSettings={() => vscode.postMessage({ type: 'openSettings' })}
      />

      {sessionPanelOpen ? (
        <SessionPanel
          sessions={sessions}
          currentSessionId={currentSessionId}
          onClose={() => setSessionPanelOpen(false)}
          onLoadSession={(sessionPath) => vscode.postMessage({ type: 'loadSession', sessionPath })}
        />
      ) : null}

      <Messages
        state={state}
        streamingItems={streamingItems}
        toolApprovals={toolApprovals}
        errors={errors}
        expandedUserMessages={expandedUserMessages}
        messagesRef={messagesRef}
        onScroll={(event) => {
          if (isProgrammaticScrollRef.current) {
            isProgrammaticScrollRef.current = false;
            return;
          }
          const element = event.currentTarget;
          setUserHasScrolled(!isNearBottom(element));
        }}
        onWheel={(event) => {
          if (event.deltaY < 0) {
            setUserHasScrolled(true);
          }
        }}
        onTouchStart={() => setUserHasScrolled(true)}
        onMessagesClick={handleMessagesClick}
        onOpenDiff={openDiff}
        onOpenFile={openFile}
        onApproveToolCall={handleApproveToolCall}
        onRejectToolCall={handleRejectToolCall}
        historyCallbacks={historyCallbacks}
      />

      <ScrollBottomButton
        visible={userHasScrolled}
        onClick={() => {
          setUserHasScrolled(false);
          scrollToBottom(true);
        }}
      />

      <Composer
        state={state}
        usage={usage}
        usagePopoverOpen={usagePopoverOpen}
        changedFilesOpen={changedFilesOpen}
        fileMenuState={fileMenuState}
        slashMenuState={slashMenuState}
        modelPickerOpen={modelPickerOpen}
        pendingModelPicker={pendingModelPicker}
        modelSearch={modelSearch}
        steerToastText={steerToastText}
        steerToastFading={steerToastFading}
        queuedEditingIndex={queuedEditingIndex}
        queuedEditingText={queuedEditingText}
        inputRef={inputRef}
        footerModelRef={footerModelRef}
        modelPickerRef={modelPickerRef}
        modelSearchRef={modelSearchRef}
        fileMenuRef={fileMenuRef}
        queuedEditInputRef={queuedEditInputRef}
        filteredModels={filteredModels}
        onToggleChangedFiles={setChangedFilesOpen}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onReviewAll={handleReviewAll}
        onOpenDiff={openDiff}
        onRemoveQueuedMessage={(index) => {
          if (queuedEditingIndex === index) {
            handleQueuedEditCancel();
          } else if (queuedEditingIndex > index) {
            setQueuedEditingIndex(queuedEditingIndex - 1);
          }
          vscode.postMessage({ type: 'removeQueuedMessage', index });
        }}
        onQueuedEditStart={handleQueuedEditStart}
        onQueuedEditSave={handleQueuedEditSave}
        onQueuedEditCancel={handleQueuedEditCancel}
        onQueuedEditingTextChange={setQueuedEditingText}
        onSelectSlashItem={selectSlashItem}
        onHoverFileMenuItem={(index) =>
          setFileMenuState((previous) => ({ ...previous, index }))
        }
        onSelectFileItem={selectFileItem}
        onSetLightboxSrc={setLightboxSrc}
        onRemovePendingImage={handleRemovePendingImage}
        onComposerPaste={handleComposerPaste}
        onComposerKeyDown={handleComposerKeyDown}
        onComposerInput={handleComposerInput}
        onToggleModelPicker={handleToggleModelPicker}
        onModelSearchChange={setModelSearch}
        onSelectModel={handleSelectModel}
        onSetThinkingLevel={handleSetThinkingLevel}
        onToggleUsagePopover={() => setUsagePopoverOpen((previous) => !previous)}
        onCloseUsagePopover={() => setUsagePopoverOpen(false)}
        onRefreshUsage={() => vscode.postMessage({ type: 'refreshUsage' })}
        onAbort={() => vscode.postMessage({ type: 'abort' })}
        onSteer={handleSteerButton}
        onSend={handleSendButton}
      />

      <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc('')} />
    </>
  );
}
