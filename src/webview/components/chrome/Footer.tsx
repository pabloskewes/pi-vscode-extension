import type { MutableRefObject, ReactNode } from 'react';
import type { ModeInfo, ModelInfo, UsageSnapshotDTO } from '../../../shared/protocol';
import { iconsBaseUri } from '../../vscode-api';
import ContextUsage from '../messages/ContextUsage';
import { UsageWidget } from '../../usage';
import ModeSelector from '../menus/ModeSelector';

interface FooterProps {
  model?: ModelInfo;
  modes: ModeInfo[];
  currentMode?: string;
  isStreaming: boolean;
  usage?: UsageSnapshotDTO;
  usagePopoverOpen: boolean;
  contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null };
  footerModelRef: MutableRefObject<HTMLSpanElement | null>;
  onToggleModelPicker: () => void;
  onToggleUsagePopover: () => void;
  onCloseUsagePopover: () => void;
  onRefreshUsage: () => void;
  onModeChange: (mode: string) => void;
  onAbort: () => void;
  onSteer: () => void;
  onSend: () => void;
}

export default function Footer({
  model,
  modes,
  currentMode,
  isStreaming,
  usage,
  usagePopoverOpen,
  contextUsage,
  footerModelRef,
  onToggleModelPicker,
  onToggleUsagePopover,
  onCloseUsagePopover,
  onRefreshUsage,
  onModeChange,
  onAbort,
  onSteer,
  onSend,
}: FooterProps): ReactNode {
  return (
    <div className="input-footer">
      <ModeSelector modes={modes} currentMode={currentMode} onChange={onModeChange} />
      <span className="footer-model" ref={footerModelRef} onClick={onToggleModelPicker}>
        {model?.name ?? model?.id ?? ''}
      </span>
      <UsageWidget
        usage={usage}
        open={usagePopoverOpen}
        onToggle={onToggleUsagePopover}
        onClose={onCloseUsagePopover}
        onRefresh={onRefreshUsage}
      />
      <ContextUsage contextUsage={contextUsage} />
      {isStreaming ? (
        <button
          className="abort-btn"
          id="btn-abort"
          title="Stop generation (Esc)"
          type="button"
          onClick={onAbort}
        >
          &#9632; Stop
        </button>
      ) : null}
      {isStreaming ? (
        <button className="steer-btn" id="btn-steer" title="Steer (Ctrl+Enter)" type="button" onClick={onSteer}>
          <img className="steer-icon-img" src={`${iconsBaseUri}/chevrons.png`} alt="steer" />
        </button>
      ) : null}
      <button className="send-btn" id="btn-send" title={isStreaming ? 'Queue' : 'Send'} type="button" onClick={onSend}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path
            d="M8 3L8 13M8 3L3 8M8 3L13 8"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}
