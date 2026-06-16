import type { MutableRefObject, ReactNode } from 'react';
import type { FileReferenceInfo } from '../../../shared/protocol';
import FileTreeCard from './FileTreeCard';

interface FileMenuProps {
  items: FileReferenceInfo[];
  activeIndex: number;
  menuRef: MutableRefObject<HTMLDivElement | null>;
  onHoverItem: (index: number) => void;
  onSelectItem: (index: number) => void;
}

export default function FileMenu({ items, activeIndex, menuRef, onHoverItem, onSelectItem }: FileMenuProps): ReactNode {
  return (
    <>
      <div className="slash-menu" id="file-menu" ref={menuRef}>
        {items.map((item, index) => {
          const depth = Math.max(0, item.relativePath.split('/').length - 1);
          const dir = item.relativePath.includes('/')
            ? item.relativePath.split('/').slice(0, -1).join('/')
            : '';

          return (
            <div
              key={`${item.relativePath}-${index}`}
              data-file-menu-index={index}
              className={`slash-item${index === activeIndex ? ' slash-item-active' : ''}`}
              onMouseMove={() => {
                if (index !== activeIndex) {
                  onHoverItem(index);
                }
              }}
              onMouseDown={(event) => {
                event.preventDefault();
                onSelectItem(index);
              }}
            >
              <span
                className="slash-item-name slash-item-name-file"
                style={{ paddingLeft: `${Math.min(depth * 12, 36)}px` }}
              >
                @{item.displayName}
              </span>
              <span className="slash-item-desc">
                {dir ? `${dir}/` : ''}
                {item.displayName}
              </span>
            </div>
          );
        })}
      </div>

      <div className="file-menu-tree" id="file-menu-tree">
        <FileTreeCard selected={items[activeIndex]} />
      </div>
    </>
  );
}
