import type { CSSProperties, ReactNode } from 'react';
import type { ContextUsageInfo } from '../../types';
import { formatTokenCount } from '../../lib/format';

interface ContextUsageProps {
  contextUsage?: ContextUsageInfo;
}

export default function ContextUsage({ contextUsage }: ContextUsageProps): ReactNode {
  if (!contextUsage) return null;

  const tokens = contextUsage.tokens != null ? formatTokenCount(contextUsage.tokens) : null;
  const contextWindow = formatTokenCount(contextUsage.contextWindow);
  const percent = contextUsage.percent != null ? Math.round(contextUsage.percent) : null;

  if (tokens !== null && percent !== null) {
    const boundedPercent = Math.max(0, Math.min(100, percent));

    return (
      <span
        className="footer-context"
        title={`Context: ${tokens} / ${contextWindow} tokens (${percent}%)`}
        aria-label={`Context: ${tokens} / ${contextWindow} tokens (${percent}%)`}
        style={{ '--context-percent': `${boundedPercent}%` } as CSSProperties & Record<'--context-percent', string>}
      >
        <span className="footer-context-ring" />
      </span>
    );
  }

  return (
    <span
      className="footer-context footer-context-empty"
      title={`Context window: ${contextWindow} tokens`}
      aria-label={`Context window: ${contextWindow} tokens`}
    >
      <span className="footer-context-ring" />
    </span>
  );
}
