import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ModeInfo } from '../../../shared/protocol';

interface ModeSelectorProps {
  modes: ModeInfo[];
  currentMode?: string;
  onChange: (mode: string) => void;
}

export default function ModeSelector({ modes, currentMode, onChange }: ModeSelectorProps): ReactNode {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const current = modes.find((m) => m.name === currentMode);
  const label = current?.label ?? current?.name ?? 'Mode';

  useEffect(() => {
    if (!open) return undefined;

    const handleClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('click', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('click', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  if (modes.length === 0) {
    return null;
  }

  return (
    <div className="mode-selector" ref={containerRef}>
      <button
        className={`mode-selector-trigger${current?.readOnly ? ' mode-readonly' : ''}`}
        type="button"
        title={current?.description ?? 'Select agent mode'}
        onClick={() => setOpen((previous) => !previous)}
      >
        <span className="mode-selector-dot" />
        <span className="mode-selector-label">{label}</span>
        <span className="mode-selector-chevron">▾</span>
      </button>

      {open ? (
        <div className="mode-selector-menu">
          {modes.map((mode) => {
            const isActive = mode.name === currentMode;
            return (
              <button
                key={mode.name}
                className={`mode-selector-item${isActive ? ' active' : ''}`}
                type="button"
                title={mode.description ?? mode.name}
                onClick={() => {
                  if (!isActive) {
                    onChange(mode.name);
                  }
                  setOpen(false);
                }}
              >
                <span className="mode-selector-check">{isActive ? '✓' : ''}</span>
                <span className="mode-selector-item-content">
                  <span className="mode-selector-item-name">
                    {mode.label ?? mode.name}
                    {mode.readOnly ? <span className="mode-readonly-badge">read-only</span> : null}
                  </span>
                  {mode.description ? (
                    <span className="mode-selector-item-desc">{mode.description}</span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
