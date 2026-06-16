import type { ReactNode } from 'react';
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
    return (
      <span className="footer-context" title={`Context: ${tokens} / ${contextWindow} tokens (${percent}%)`}>
        {tokens} / {contextWindow} · {percent}%
      </span>
    );
  }

  return (
    <span className="footer-context" title={`Context window: ${contextWindow} tokens`}>
      {contextWindow}
    </span>
  );
}
