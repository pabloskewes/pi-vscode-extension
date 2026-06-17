import type {
  ClipboardEvent,
  DragEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MutableRefObject,
  ReactNode,
} from 'react';
import type {
  FileChangeInfo,
  FileReferenceInfo,
  ModelInfo,
  SkillInfo,
  UsageSnapshotDTO,
} from '../../../shared/protocol';
import { getUniqueFileChanges } from '../../lib/files';
import ChangedFilesSection from '../panels/ChangedFilesSection';
import QueuedSection from '../panels/QueuedSection';
import SlashMenu from '../menus/SlashMenu';
import FileMenu from '../menus/FileMenu';
import ModelPicker from '../menus/ModelPicker';
import Footer from './Footer';
import type { FileMenuState, SlashMenuState, WebviewState } from '../../types';

interface ComposerProps {
  state: WebviewState;
  usage?: UsageSnapshotDTO;
  usagePopoverOpen: boolean;
  changedFilesOpen: boolean;
  composerDragOver: boolean;
  fileMenuState: FileMenuState;
  slashMenuState: SlashMenuState;
  modelPickerOpen: boolean;
  pendingModelPicker: boolean;
  modelSearch: string;
  steerToastText: string;
  steerToastFading: boolean;
  queuedEditingIndex: number;
  queuedEditingText: string;
  inputRef: MutableRefObject<HTMLDivElement | null>;
  footerModelRef: MutableRefObject<HTMLSpanElement | null>;
  modelPickerRef: MutableRefObject<HTMLDivElement | null>;
  modelSearchRef: MutableRefObject<HTMLInputElement | null>;
  fileMenuRef: MutableRefObject<HTMLDivElement | null>;
  queuedEditInputRef: MutableRefObject<HTMLInputElement | null>;
  filteredModels: ModelInfo[];
  onToggleChangedFiles: (open: boolean) => void;
  onUndo: () => void;
  onRedo: () => void;
  onReviewAll: () => void;
  onOpenDiff: (filePath: string, toolCallId: string) => void;
  onRemoveQueuedMessage: (index: number) => void;
  onQueuedEditStart: (index: number) => void;
  onQueuedEditSave: () => void;
  onQueuedEditCancel: () => void;
  onQueuedEditingTextChange: (value: string) => void;
  onSelectSlashItem: (index: number) => void;
  onHoverFileMenuItem: (index: number) => void;
  onSelectFileItem: (index: number) => void;
  onSetLightboxSrc: (src: string) => void;
  onRemovePendingImage: (index: number) => void;
  onComposerPaste: (event: ClipboardEvent<HTMLDivElement>) => void;
  onComposerCopy: (event: React.ClipboardEvent<HTMLDivElement>) => void;
  onComposerKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onComposerInput: () => void;
  onComposerDragEnter: (event: DragEvent<HTMLDivElement>) => void;
  onComposerDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onComposerDragLeave: (event: DragEvent<HTMLDivElement>) => void;
  onComposerDrop: (event: DragEvent<HTMLDivElement>) => void;
  onToggleModelPicker: () => void;
  onModelSearchChange: (value: string) => void;
  onSelectModel: (provider: string, modelId: string) => void;
  onSetThinkingLevel: (level: string) => void;
  onToggleUsagePopover: () => void;
  onCloseUsagePopover: () => void;
  onRefreshUsage: () => void;
  onAbort: () => void;
  onSteer: () => void;
  onSend: () => void;
}

export default function Composer({
  state,
  usage,
  usagePopoverOpen,
  changedFilesOpen,
  composerDragOver,
  fileMenuState,
  slashMenuState,
  modelPickerOpen,
  modelSearch,
  steerToastText,
  steerToastFading,
  queuedEditingIndex,
  queuedEditingText,
  inputRef,
  footerModelRef,
  modelPickerRef,
  modelSearchRef,
  fileMenuRef,
  queuedEditInputRef,
  filteredModels,
  onToggleChangedFiles,
  onUndo,
  onRedo,
  onReviewAll,
  onOpenDiff,
  onRemoveQueuedMessage,
  onQueuedEditStart,
  onQueuedEditSave,
  onQueuedEditCancel,
  onQueuedEditingTextChange,
  onSelectSlashItem,
  onHoverFileMenuItem,
  onSelectFileItem,
  onSetLightboxSrc,
  onRemovePendingImage,
  onComposerPaste,
  onComposerCopy,
  onComposerKeyDown,
  onComposerInput,
  onComposerDragEnter,
  onComposerDragOver,
  onComposerDragLeave,
  onComposerDrop,
  onToggleModelPicker,
  onModelSearchChange,
  onSelectModel,
  onSetThinkingLevel,
  onToggleUsagePopover,
  onCloseUsagePopover,
  onRefreshUsage,
  onAbort,
  onSteer,
  onSend,
}: ComposerProps): ReactNode {
  const uniqueFileChanges = getUniqueFileChanges(state.fileChanges);

  return (
    <div
      className={`input-container${composerDragOver ? ' composer-drag-over' : ''}`}
      onDragEnter={onComposerDragEnter}
      onDragOver={onComposerDragOver}
      onDragLeave={onComposerDragLeave}
      onDrop={onComposerDrop}
    >
      {state.fileChanges.length > 0 ? (
        <ChangedFilesSection
          fileChanges={uniqueFileChanges}
          rollbackPoint={state.rollbackPoint}
          open={changedFilesOpen}
          onToggle={onToggleChangedFiles}
          onUndo={onUndo}
          onRedo={onRedo}
          onReviewAll={onReviewAll}
          onOpenDiff={onOpenDiff}
        />
      ) : null}

      {state.queuedMessages.length > 0 ? (
        <QueuedSection
          queuedMessages={state.queuedMessages}
          editingIndex={queuedEditingIndex}
          editingText={queuedEditingText}
          editInputRef={queuedEditInputRef}
          onEditingTextChange={onQueuedEditingTextChange}
          onEditStart={onQueuedEditStart}
          onEditSave={onQueuedEditSave}
          onEditCancel={onQueuedEditCancel}
          onRemove={onRemoveQueuedMessage}
        />
      ) : null}

      {slashMenuState.items.length > 0 ? (
        <SlashMenu
          items={slashMenuState.items}
          activeIndex={slashMenuState.index}
          onSelectItem={onSelectSlashItem}
        />
      ) : null}

      {fileMenuState.items.length > 0 ? (
        <FileMenu
          items={fileMenuState.items}
          activeIndex={fileMenuState.index}
          menuRef={fileMenuRef}
          onHoverItem={onHoverFileMenuItem}
          onSelectItem={onSelectFileItem}
        />
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
                    onSetLightboxSrc(image.dataUrl);
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
                    onRemovePendingImage(index);
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
            data-placeholder={
              state.isStreaming
                ? 'Type to queue a message, Ctrl+Enter to steer, Esc to stop...'
                : 'Ask Pi anything...'
            }
            ref={inputRef}
            onPaste={onComposerPaste}
            onCopy={onComposerCopy}
            onKeyDown={onComposerKeyDown}
            onInput={onComposerInput}
          />
        </div>
      </div>

      <Footer
        model={state.model}
        isStreaming={state.isStreaming}
        usage={usage}
        usagePopoverOpen={usagePopoverOpen}
        contextUsage={state.contextUsage}
        footerModelRef={footerModelRef}
        onToggleModelPicker={onToggleModelPicker}
        onToggleUsagePopover={onToggleUsagePopover}
        onCloseUsagePopover={onCloseUsagePopover}
        onRefreshUsage={onRefreshUsage}
        onAbort={onAbort}
        onSteer={onSteer}
        onSend={onSend}
      />

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
          onSearchChange={onModelSearchChange}
          onSelectModel={onSelectModel}
          onSetThinkingLevel={onSetThinkingLevel}
        />
      ) : null}
    </div>
  );
}
