import type { MutableRefObject, ReactNode } from 'react';
import { iconsBaseUri } from '../../vscode-api';

interface QueuedSectionProps {
  queuedMessages: string[];
  editingIndex: number;
  editingText: string;
  editInputRef: MutableRefObject<HTMLInputElement | null>;
  onEditingTextChange: (value: string) => void;
  onEditStart: (index: number) => void;
  onEditSave: () => void;
  onEditCancel: () => void;
  onRemove: (index: number) => void;
}

export default function QueuedSection({
  queuedMessages,
  editingIndex,
  editingText,
  editInputRef,
  onEditingTextChange,
  onEditStart,
  onEditSave,
  onEditCancel,
  onRemove,
}: QueuedSectionProps): ReactNode {
  return (
    <details className="queued-section" id="queued-section" open={true}>
      <summary className="queued-summary">
        <span className="queued-chevron">&#9656;</span>
        <span className="queued-count">{queuedMessages.length} Queued</span>
      </summary>
      <div className="queued-list">
        {queuedMessages.map((message, index) => {
          if (index === editingIndex) {
            return (
              <div className="queued-item queued-item-editing" data-index={index} key={`queued-edit-${index}`}>
                <span className="queued-item-icon">&#9675;</span>
                <input
                  className="queued-edit-input"
                  data-index={index}
                  type="text"
                  value={editingText}
                  ref={editInputRef}
                  onChange={(event) => onEditingTextChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      onEditSave();
                    }
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      onEditCancel();
                    }
                  }}
                />
                <button className="queued-edit-save" data-index={index} title="Save" type="button" onClick={onEditSave}>
                  &#10003;
                </button>
                <button
                  className="queued-edit-cancel"
                  data-index={index}
                  title="Cancel"
                  type="button"
                  onClick={onEditCancel}
                >
                  &#10005;
                </button>
              </div>
            );
          }

          return (
            <div className="queued-item" data-index={index} key={`queued-${index}`}>
              <span className="queued-item-icon">&#9675;</span>
              <span className="queued-item-text">{message}</span>
              <span className="queued-item-actions">
                <button
                  className="queued-item-btn queued-item-edit"
                  data-index={index}
                  title="Edit"
                  type="button"
                  onClick={() => onEditStart(index)}
                >
                  <img className="queued-btn-icon" src={`${iconsBaseUri}/pencil.png`} alt="edit" />
                </button>
                <button
                  className="queued-item-btn queued-item-delete"
                  data-index={index}
                  title="Remove"
                  type="button"
                  onClick={() => onRemove(index)}
                >
                  <img className="queued-btn-icon" src={`${iconsBaseUri}/trash.png`} alt="remove" />
                </button>
              </span>
            </div>
          );
        })}
      </div>
    </details>
  );
}
