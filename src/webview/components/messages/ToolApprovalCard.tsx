import type { ReactNode } from 'react';
import type { ToolCallPendingInfo } from '../../../shared/protocol';
import { formatToolArgs, tryParseJSON } from '../../lib/format';
import { getToolIconNode, getToolLabel } from '../../lib/tools';

interface ToolApprovalCardProps {
  pending: ToolCallPendingInfo;
  onApprove: (toolCallId: string) => void;
  onReject: (toolCallId: string) => void;
}

export default function ToolApprovalCard({ pending, onApprove, onReject }: ToolApprovalCardProps): ReactNode {
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
        <button
          className="approval-btn approve"
          data-toolcallid={pending.toolCallId}
          type="button"
          onClick={() => onApprove(pending.toolCallId)}
        >
          Approve
        </button>
        <button
          className="approval-btn reject"
          data-toolcallid={pending.toolCallId}
          type="button"
          onClick={() => onReject(pending.toolCallId)}
        >
          Reject
        </button>
      </div>
    </div>
  );
}
