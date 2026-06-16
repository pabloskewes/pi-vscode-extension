import type { ReactNode } from 'react';

interface ScrollBottomButtonProps {
  visible: boolean;
  onClick: () => void;
}

export default function ScrollBottomButton({ visible, onClick }: ScrollBottomButtonProps): ReactNode {
  return (
    <div className="scroll-btn-wrap">
      <button
        className={`scroll-bottom-btn${visible ? ' visible' : ''}`}
        id="btn-scroll-bottom"
        title="Scroll to bottom"
        type="button"
        onClick={onClick}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path
            d="M8 3L8 13M8 13L3 8M8 13L13 8"
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
