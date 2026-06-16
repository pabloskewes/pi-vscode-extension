import type { ReactNode } from 'react';
import type { ChatMessage } from '../../types';
import {
  buildToolFooter,
  extractText,
  extractToolCalls,
  findToolCallInMessages,
} from '../../lib/messages';
import { tryParseJSON } from '../../lib/format';
import { getToolIconNode, getToolLabel, buildStatusNode } from '../../lib/tools';

interface ToolResultCardProps {
  message: ChatMessage;
  allMessages: ChatMessage[];
  index: number;
  onOpenFile: (filePath: string) => void;
}

export default function ToolResultCard({
  message,
  allMessages,
  index,
  onOpenFile,
}: ToolResultCardProps): ReactNode {
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
  const argsRecord = typeof parsedArgs === 'object' && parsedArgs !== null
    ? (parsedArgs as Record<string, unknown>)
    : {};
  const filePath =
    typeof argsRecord.path === 'string'
      ? argsRecord.path
      : typeof argsRecord.file_path === 'string'
        ? argsRecord.file_path
        : '';
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
