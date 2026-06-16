import type { ReactNode } from 'react';
import type { SkillInfo } from '../../../shared/protocol';

interface SlashMenuProps {
  items: SkillInfo[];
  activeIndex: number;
  onSelectItem: (index: number) => void;
}

export default function SlashMenu({ items, activeIndex, onSelectItem }: SlashMenuProps): ReactNode {
  return (
    <div className="slash-menu" id="slash-menu">
      {items.map((skill, index) => (
        <div
          key={skill.name}
          className={`slash-item${index === activeIndex ? ' slash-item-active' : ''}`}
          onMouseDown={(event) => {
            event.preventDefault();
            onSelectItem(index);
          }}
        >
          <span className="slash-item-name">/skill:{skill.name}</span>
          {skill.description ? <span className="slash-item-desc">{skill.description}</span> : null}
        </div>
      ))}
    </div>
  );
}
