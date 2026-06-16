import type { ReactNode } from 'react';
import type { TabInfo } from '../../../shared/protocol';
import { iconsBaseUri } from '../../vscode-api';
import TabStrip from './TabStrip';

interface HeaderProps {
  tabs: TabInfo[];
  activeTabId: string;
  onSwitchTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onCreateTab: () => void;
  onGetSessions: () => void;
  onOpenSettings: () => void;
}

export default function Header({
  tabs,
  activeTabId,
  onSwitchTab,
  onCloseTab,
  onCreateTab,
  onGetSessions,
  onOpenSettings,
}: HeaderProps): ReactNode {
  return (
    <div className="header">
      <TabStrip tabs={tabs} activeTabId={activeTabId} onSwitchTab={onSwitchTab} onCloseTab={onCloseTab} />
      <div className="header-right">
        <button
          className="icon-btn"
          id="btn-new-tab"
          title="New Agent"
          type="button"
          onClick={onCreateTab}
        >
          <img className="header-icon-img" src={`${iconsBaseUri}/new.png`} alt="new" />
        </button>
        <button
          className="icon-btn"
          id="btn-sessions"
          title="Sessions"
          type="button"
          onClick={onGetSessions}
        >
          <img className="header-icon-img" src={`${iconsBaseUri}/list.png`} alt="sessions" />
        </button>
        <button
          className="icon-btn"
          id="btn-settings"
          title="Settings"
          type="button"
          onClick={onOpenSettings}
        >
          <img className="header-icon-img" src={`${iconsBaseUri}/settings.png`} alt="settings" />
        </button>
      </div>
    </div>
  );
}
