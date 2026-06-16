import type { ReactNode } from 'react';
import type { FileReferenceInfo } from '../../../shared/protocol';
import { shouldCollapseUserMessage } from '../../lib/messages';
import { buildInlineUserNodes } from '../../lib/messages';

interface UserMessageContentProps {
  text: string;
  files: FileReferenceInfo[];
  expanded: boolean;
  onToggle: () => void;
}

export default function UserMessageContent({
  text,
  files,
  expanded,
  onToggle,
}: UserMessageContentProps): ReactNode {
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
      <pre className={`user-message-text${collapsed && !expanded ? ' user-message-text-collapsed' : ''}`}>
        {normalizedText}
      </pre>
      {collapsed && !expanded ? <div className="user-message-fade" /> : null}
      {collapsed ? (
        <button
          className="user-message-toggle"
          data-expanded={expanded ? 'true' : 'false'}
          type="button"
          onClick={onToggle}
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      ) : null}
    </div>
  );
}
