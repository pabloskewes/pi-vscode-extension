import type { ReactNode } from 'react';

export function renderDiffLines(diff: string): ReactNode {
  return diff.split('\n').map((line, index) => {
    if (line.startsWith('--- ') || line.startsWith('+++ ')) {
      return null;
    }

    let className = 'diff-line diff-line-ctx';
    if (line.startsWith('@@')) {
      className = 'diff-line diff-line-hunk';
    } else if (line.startsWith('+')) {
      className = 'diff-line diff-line-add';
    } else if (line.startsWith('-')) {
      className = 'diff-line diff-line-del';
    }

    return (
      <div className={className} key={`diff-${index}`}>
        {line}
      </div>
    );
  });
}
