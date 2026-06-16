import type { MutableRefObject, ReactNode } from 'react';
import type { ModelInfo, UsageSnapshotDTO } from '../../../shared/protocol';
import { iconsBaseUri } from '../../vscode-api';
import ContextUsage from '../messages/ContextUsage';
import { UsageWidget } from '../../usage';

interface FooterProps {
  model?: ModelInfo;
  isStreaming: boolean;
  usage?: UsageSnapshotDTO;
  usagePopoverOpen: boolean;
  contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null };
  footerModelRef: MutableRefObject<HTMLSpanElement | null>;
  onToggleModelPicker: () => void;
  onToggleUsagePopover: () => void;
  onCloseUsagePopover: () => void;
  onRefreshUsage: () => void;
  onAbort: () => void;
  onSteer: () => void;
  onSend: () => void;
}

export default function Footer({
  model,
  isStreaming,
  usage,
  usagePopoverOpen,
  contextUsage,
  footerModelRef,
  onToggleModelPicker,
  onToggleUsagePopover,
  onCloseUsagePopover,
  onRefreshUsage,
  onAbort,
  onSteer,
  onSend,
}: FooterProps): ReactNode {
  return (
    <div className="input-footer">
      <span className="footer-model" ref={footerModelRef} onClick={onToggleModelPicker}>
        {model?.name ?? model?.id ?? ''}
      </span>
      <span className="footer-spacer" />
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
