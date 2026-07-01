import { Fragment, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { UsageSnapshotDTO } from '../shared/protocol';

interface UsageWidgetProps {
    usage?: UsageSnapshotDTO;
    open: boolean;
    onToggle: () => void;
    onClose: () => void;
    onRefresh: () => void;
}

const PERIOD_LABELS: Record<string, string> = {
    today: 'Today',
    thisWeek: 'This Week',
    lastWeek: 'Last Week',
    allTime: 'All Time',
};

export function UsageWidget({ usage, open, onToggle, onClose, onRefresh }: UsageWidgetProps): ReactNode {
    const [activePeriod, setActivePeriod] = useState('thisWeek');

    if (!usage?.available) {
        return null;
    }

    const primary = pickPrimaryProvider(usage);
    if (!primary) {
        return null;
    }

    const fiveHour = primary.windows.find((window) => window.key === 'fiveHour');
    if (!fiveHour || fiveHour.unavailableReason) {
        return null;
    }

    return (
        <>
            <div className="usage-bar-slot" id="usage-bar-slot">
                <UsageChip
                    title={`${primary.label} 5h: ${Math.max(0, 100 - fiveHour.usedPercent)}% left${formatResetShort(fiveHour.resetAt) ? `, resets in ${formatResetShort(fiveHour.resetAt)}` : ''}`}
                    onActivate={onToggle}
                >
                    {statusDot(primary.status)}
                    <span className="usage-chip-label">5h</span>
                    <MiniBar usedPercent={fiveHour.usedPercent} />
                    <span className="usage-chip-pct">{Math.max(0, 100 - fiveHour.usedPercent)}%</span>
                    {formatResetShort(fiveHour.resetAt) ? (
                        <span className="usage-chip-reset">{formatResetShort(fiveHour.resetAt)}</span>
                    ) : null}
                </UsageChip>

                <button className="usage-refresh-btn" title="Refresh usage" type="button" onClick={onRefresh}>
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                        <path d="M13 3v4H9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M13 7a5 5 0 1 0 1 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                </button>
            </div>

            {open ? (
                <div className="usage-popover" id="usage-popover">
                    <div className="usage-popover-header">
                        <div className="usage-popover-header-left">
                            <span className="usage-popover-title">Usage</span>
                        </div>
                        <div className="usage-popover-actions">
                            <button className="usage-popover-refresh" type="button" onClick={onRefresh}>Refresh</button>
                            <button className="usage-popover-close" type="button" onClick={onClose}>&times;</button>
                        </div>
                    </div>
                    <div className="usage-popover-body">
                        {usage.loading ? (
                            <div className="usage-loading">Loading...</div>
                        ) : (
                            <>
                                <UsagePopoverSections usage={usage} />
                                {usage.periods.length > 0 ? (
                                    <div className="usage-section">
                                        <div className="usage-section-title">History</div>
                                        <div className="usage-period-tabs">
                                            {['today', 'thisWeek', 'lastWeek', 'allTime'].map((periodKey) => (
                                                <button
                                                    key={periodKey}
                                                    className={`usage-period-tab${periodKey === activePeriod ? ' active' : ''}`}
                                                    type="button"
                                                    onClick={() => setActivePeriod(periodKey)}
                                                >
                                                    {PERIOD_LABELS[periodKey] ?? periodKey}
                                                </button>
                                            ))}
                                        </div>
                                        <div className="usage-table-container">
                                            {renderUsagePeriodTable(usage, activePeriod)}
                                        </div>
                                    </div>
                                ) : null}
                            </>
                        )}
                    </div>
                </div>
            ) : null}
        </>
    );
}

function UsageChip({
    children,
    className = '',
    title,
    onActivate,
}: {
    children: ReactNode;
    className?: string;
    title: string;
    onActivate: () => void;
}): ReactNode {
    return (
        <span
            className={`usage-chip${className ? ` ${className}` : ''}`}
            title={title}
            role="button"
            tabIndex={0}
            onClick={onActivate}
            onKeyDown={(event) => activateWithKeyboard(event, onActivate)}
        >
            {children}
        </span>
    );
}

function UsagePopoverSections({ usage }: { usage: UsageSnapshotDTO }): ReactNode {
    const { visible, hidden } = partitionLiveProviders(usage.providers);

    if (visible.length === 0 && hidden.length === 0 && usage.periods.length === 0) {
        return <div className="usage-no-data">No usage data available yet.</div>;
    }

    return (
        <>
            {visible.length > 0 ? renderLiveQuotas(visible) : null}
            {visible.length === 0 && hidden.length > 0 ? renderUnconfiguredProviders(hidden) : null}
        </>
    );
}

function MiniBar({ usedPercent, width = 40 }: { usedPercent: number; width?: number }): ReactNode {
    const left = Math.max(0, 100 - usedPercent);
    const fill = Math.round((left / 100) * width);
    const empty = Math.max(0, width - fill);

    return (
        <span className="usage-mini-bar">
            <span className="usage-mini-fill" style={{ width: `${fill}px`, background: usageBarColor(usedPercent) }} />
            <span className="usage-mini-empty" style={{ width: `${empty}px` }} />
        </span>
    );
}

function renderLiveQuotas(providers: UsageSnapshotDTO['providers']): ReactNode {
    return (
        <div className="usage-section">
            <div className="usage-section-title">Live Quotas</div>
            {providers.map((provider) => (
                <div className="usage-provider-card" key={provider.id}>
                    <div className="usage-provider-header">
                        {statusDot(provider.status)}
                        <span className="usage-provider-label">{provider.label}</span>
                        {provider.planName ? <span className="usage-plan-badge">{provider.planName}</span> : null}
                    </div>

                    {provider.windows.length > 0 ? (
                        <div className="usage-windows">
                            {provider.windows.map((window) => {
                                if (window.unavailableReason) {
                                    return (
                                        <div className="usage-window-row usage-window-unavailable" key={window.key}>
                                            <span className="usage-window-label">{window.label}</span>
                                            <span className="usage-window-reason">{window.unavailableReason}</span>
                                        </div>
                                    );
                                }

                                const left = Math.max(0, 100 - window.usedPercent);
                                const reset = formatResetShort(window.resetAt);

                                return (
                                    <div className="usage-window-row" key={window.key}>
                                        <span className="usage-window-label">{window.label}</span>
                                        <MiniBar usedPercent={window.usedPercent} width={60} />
                                        <span className="usage-window-pct" style={{ color: usageBarColor(window.usedPercent) }}>
                                            {left}% left
                                        </span>
                                        {reset ? <span className="usage-window-reset">{reset}</span> : null}
                                    </div>
                                );
                            })}
                        </div>
                    ) : null}

                    {provider.balances.length > 0 ? (
                        <div className="usage-balances">
                            {provider.balances.map((balance) => (
                                <div className="usage-balance-row" key={balance.label}>
                                    <span className="usage-balance-label">{balance.label}</span>
                                    <span className="usage-balance-value">{formatBalance(balance.remaining, balance.unit)}</span>
                                </div>
                            ))}
                        </div>
                    ) : null}

                    {provider.diagnostics.length > 0 ? (
                        <div className="usage-diagnostics">
                            {provider.diagnostics.map((diagnostic, index) => (
                                <div className="usage-diagnostic" key={`${provider.id}-${index}`}>{diagnostic}</div>
                            ))}
                        </div>
                    ) : null}
                </div>
            ))}
        </div>
    );
}

function renderUnconfiguredProviders(providers: UsageSnapshotDTO['providers']): ReactNode {
    return (
        <div className="usage-section">
            <div className="usage-section-title-row">
                <span className="usage-section-title">Live Quotas</span>
                <span className="usage-section-summary">
                    {providers.length === 1
                        ? '1 provider skipped (not configured).'
                        : `${providers.length} providers skipped (not configured).`}
                </span>
            </div>
            <div className="usage-unconfigured-list">
                {providers.map((provider) => (
                    <div className="usage-unconfigured-row" key={provider.id}>
                        <span className="usage-unconfigured-label">{provider.label}</span>
                        <span className="usage-unconfigured-reason">{provider.diagnostic || 'Not configured.'}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

function renderUsagePeriodTable(usage: UsageSnapshotDTO, periodKey: string): ReactNode {
    const period = usage.periods.find((entry) => entry.key === periodKey);
    if (!period) {
        return <div className="usage-no-data">No data</div>;
    }

    return (
        <table className="usage-table">
            <thead>
                <tr>
                    <th>Provider</th>
                    <th>Sessions</th>
                    <th>Cost</th>
                    <th>Tokens</th>
                </tr>
            </thead>
            <tbody>
                {period.providers.map((provider) => (
                    <Fragment key={`${period.key}-${provider.key}`}>
                        <tr className="usage-table-row" key={`${period.key}-${provider.key}`}>
                            <td>{provider.key}</td>
                            <td>{provider.sessionCount}</td>
                            <td>${provider.cost.toFixed(2)}</td>
                            <td>{formatTokenCount(provider.tokens)}</td>
                        </tr>
                        {(period.modelsByProvider[provider.key] ?? []).map((model) => (
                            <tr className="usage-table-model-row" key={`${period.key}-${provider.key}-${model.key}`}>
                                <td className="usage-model-name">{model.key}</td>
                                <td>{model.sessionCount}</td>
                                <td>${model.cost.toFixed(2)}</td>
                                <td>{formatTokenCount(model.tokens)}</td>
                            </tr>
                        ))}
                    </Fragment>
                ))}
                <tr className="usage-table-total">
                    <td><strong>Total</strong></td>
                    <td><strong>{period.total.sessionCount}</strong></td>
                    <td><strong>${period.total.cost.toFixed(2)}</strong></td>
                    <td><strong>{formatTokenCount(period.total.tokens)}</strong></td>
                </tr>
            </tbody>
        </table>
    );
}

function pickPrimaryProvider(usage: UsageSnapshotDTO): UsageSnapshotDTO['providers'][number] | undefined {
    if (!usage.providers.length) return undefined;

    const current = usage.currentProviderId
        ? usage.providers.find((provider) => provider.id === usage.currentProviderId)
        : undefined;
    if (current && current.windows.length > 0) return current;

    const codex = usage.providers.find((provider) => provider.id === 'openai-codex');
    if (codex && codex.windows.length > 0) return codex;

    return usage.providers.find((provider) => provider.windows.length > 0 || provider.balances.length > 0);
}

function partitionLiveProviders(providers: UsageSnapshotDTO['providers']): {
    visible: UsageSnapshotDTO['providers'];
    hidden: UsageSnapshotDTO['providers'];
} {
    const visible: UsageSnapshotDTO['providers'] = [];
    const hidden: UsageSnapshotDTO['providers'] = [];

    for (const provider of providers) {
        if (provider.id === 'offline') continue;
        if (isUsableLiveProvider(provider)) {
            visible.push(provider);
        } else {
            hidden.push(provider);
        }
    }

    return { visible, hidden };
}

function isUsableLiveProvider(provider: UsageSnapshotDTO['providers'][number]): boolean {
    if (provider.status === 'unavailable') return false;
    return provider.windows.length > 0 || provider.balances.length > 0;
}

function usageBarColor(usedPercent: number): string {
    const left = Math.max(0, 100 - usedPercent);
    if (left > 50) return 'var(--success-fg)';
    if (left > 20) return 'var(--warning-fg)';
    return 'var(--error-fg)';
}

function formatResetShort(resetAt: number | undefined): string {
    if (!resetAt) return '';

    const diff = resetAt - Date.now();
    if (diff <= 0) return 'resetting';

    const minutes = Math.floor(diff / 60000);
    if (minutes < 60) return `${minutes}m`;
    if (minutes >= 1440) {
        const days = Math.floor(minutes / 1440);
        const remainingHours = Math.floor((minutes % 1440) / 60);
        return remainingHours > 0 ? `${days}d${remainingHours}h` : `${days}d`;
    }

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h${remainingMinutes}m`;
}

function statusDot(status: string): ReactNode {
    switch (status) {
        case 'live':
            return <span className="usage-status-dot usage-status-live" title="Live data" />;
        case 'cached':
            return <span className="usage-status-dot usage-status-cached" title="Cached data" />;
        case 'stale':
            return <span className="usage-status-dot usage-status-stale" title="Stale data" />;
        case 'local':
            return <span className="usage-status-dot usage-status-local" title="Local data" />;
        default:
            return <span className="usage-status-dot usage-status-unavailable" title="Unavailable" />;
    }
}

function formatBalance(value: number | null, unit: string): string {
    if (value == null) return '-';
    return unit === 'USD' ? `$${value.toFixed(2)}` : `${value} ${unit}`;
}

function formatTokenCount(value: number): string {
    if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
    if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
    return String(value);
}

function activateWithKeyboard(event: KeyboardEvent<HTMLElement>, action: () => void): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    action();
}
