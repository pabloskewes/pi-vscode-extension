import type { ReactNode } from 'react';
import { renderMarkdown } from '../../lib/markdown';

interface ThinkingBlockProps {
  text: string;
  active: boolean;
  durationSec?: number;
  idPrefix: string;
  openByDefault?: boolean;
}

export default function ThinkingBlock({
  text,
  active,
  durationSec,
  idPrefix,
  openByDefault,
}: ThinkingBlockProps): ReactNode {
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
