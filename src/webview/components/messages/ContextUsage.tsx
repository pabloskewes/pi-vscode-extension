import type { ReactNode } from 'react';
import type { ContextUsageInfo } from '../../types';
import { formatTokenCount } from '../../lib/format';

interface ContextUsageProps {
  contextUsage?: ContextUsageInfo;
}

const RING_SIZE = 20;
const RING_RADIUS = 8;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export default function ContextUsage({ contextUsage }: ContextUsageProps): ReactNode {
  if (!contextUsage) return null;

  const tokens = contextUsage.tokens != null ? formatTokenCount(contextUsage.tokens) : null;
  const contextWindow = formatTokenCount(contextUsage.contextWindow);
  const percent = contextUsage.percent != null ? Math.round(contextUsage.percent) : null;
  const boundedPercent = percent != null ? Math.max(0, Math.min(100, percent)) : null;
  const dashOffset =
    boundedPercent != null
      ? RING_CIRCUMFERENCE - (boundedPercent / 100) * RING_CIRCUMFERENCE
      : RING_CIRCUMFERENCE;

  const detail =
    tokens !== null && percent !== null
      ? `Context: ${tokens} / ${contextWindow} tokens (${percent}%)`
      : `Context window: ${contextWindow} tokens`;

  return (
    <span className="footer-context" title={detail} aria-label={detail}>
      <svg
        className="footer-context-ring"
        width={RING_SIZE}
        height={RING_SIZE}
        viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
        aria-hidden="true"
      >
        <circle
          className="footer-context-track"
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
        />
        <circle
          className="footer-context-progress"
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={dashOffset}
        />
      </svg>
    </span>
  );
}
