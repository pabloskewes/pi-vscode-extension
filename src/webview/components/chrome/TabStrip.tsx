import type { ReactNode } from 'react';
import type { TabInfo } from '../../../shared/protocol';
import { iconsBaseUri } from '../../vscode-api';

interface TabStripProps {
  tabs: TabInfo[];
  activeTabId: string;
  onSwitchTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
}

export default function TabStrip({ tabs, activeTabId, onSwitchTab, onCloseTab }: TabStripProps): ReactNode {
  return (
    <div className="tab-strip">
      {tabs.map((tab) => {
        const displayName = tab.name.length > 20 ? `${tab.name.substring(0, 18)}...` : tab.name;
        return (
          <div
            key={tab.id}
            className={`tab${tab.isActive ? ' tab-active' : ''}${tab.isStreaming ? ' tab-streaming' : ''}`}
            data-tab-id={tab.id}
            onClick={() => {
              if (tab.id !== activeTabId) {
                onSwitchTab(tab.id);
              }
            }}
          >
            <span className="tab-icon">
              {tab.isStreaming ? (
                <span className="tab-spinner" />
              ) : tab.hasNotification ? (
                <img className="tab-icon-img" src={`${iconsBaseUri}/notification.png`} alt="notification" />
              ) : (
                <img className="tab-icon-img" src={`${iconsBaseUri}/chat.png`} alt="chat" />
              )}
            </span>
            <span className="tab-name" title={tab.name}>
              {displayName}
            </span>
            {tabs.length > 1 ? (
              <button
                className="tab-close"
                title="Close tab"
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onCloseTab(tab.id);
                }}
              >
                &times;
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
