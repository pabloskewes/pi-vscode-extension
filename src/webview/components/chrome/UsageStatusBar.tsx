import type { ReactNode } from 'react';
import type { UsageSnapshotDTO } from '../../../shared/protocol';
import { UsageWidget } from '../../usage';

interface UsageStatusBarProps {
  usage?: UsageSnapshotDTO;
  popoverOpen: boolean;
  onTogglePopover: () => void;
  onClosePopover: () => void;
  onRefresh: () => void;
}

export default function UsageStatusBar({
  usage,
  popoverOpen,
  onTogglePopover,
  onClosePopover,
  onRefresh,
}: UsageStatusBarProps): ReactNode {
  if (!usage?.available) {
    return null;
  }

  return (
    <div className="usage-status-bar" id="usage-status-bar">
      <UsageWidget
        usage={usage}
        open={popoverOpen}
        onToggle={onTogglePopover}
        onClose={onClosePopover}
        onRefresh={onRefresh}
      />
      <span className="usage-status-hint">API usage</span>
    </div>
  );
}
