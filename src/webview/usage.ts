import type { ClientMessage, UsageSnapshotDTO } from '../shared/protocol';

let usageSnapshot: UsageSnapshotDTO | undefined;
let usagePopoverOpen = false;
let refreshHandler: (() => void) | undefined;

export function setUsageSnapshot(usage: UsageSnapshotDTO): void {
    usageSnapshot = usage;
}

export function setUsageRefreshHandler(handler: (() => void) | undefined): void {
    refreshHandler = handler;
}

export function updateUsageFooter(): void {
    const slot = document.getElementById('usage-bar-slot');
    if (!slot) return;

    const usage = usageSnapshot;
    if (!usage?.available) {
        slot.innerHTML = '';
        slot.style.display = 'none';
        return;
    }

    const primary = pickPrimaryProvider(usage);
    if (!primary) {
        slot.innerHTML = '';
        slot.style.display = 'none';
        return;
    }

    slot.style.display = '';

    const fiveHour = primary.windows.find((w) => w.key === 'fiveHour');
    const weekly = primary.windows.find((w) => w.key === 'weekly');
    let html = '';

    if (fiveHour && !fiveHour.unavailableReason) {
        const left = Math.max(0, 100 - fiveHour.usedPercent);
        const reset = formatResetShort(fiveHour.resetAt);
        html += `<span class="usage-chip" id="usage-chip-primary" title="${escHtml(primary.label)} 5h: ${left}% left${reset ? ', resets in ' + reset : ''}">`;
        html += statusDot(primary.status);
        html += '<span class="usage-chip-label">5h</span>';
        html += miniBar(fiveHour.usedPercent);
        html += `<span class="usage-chip-pct">${left}%</span>`;
        if (reset) html += `<span class="usage-chip-reset">${escHtml(reset)}</span>`;
        html += '</span>';
    }

    if (weekly && !weekly.unavailableReason) {
        const left = Math.max(0, 100 - weekly.usedPercent);
        html += `<span class="usage-chip usage-chip-secondary" id="usage-chip-weekly" title="${escHtml(primary.label)} weekly: ${left}% left">`;
        html += '<span class="usage-chip-label">Wk</span>';
        html += `<span class="usage-chip-pct">${left}%</span>`;
        html += '</span>';
    }

    if (primary.balances.length > 0 && !fiveHour && !weekly) {
        const bal = primary.balances[0];
        html += `<span class="usage-chip" title="${escHtml(primary.label)}: ${escHtml(bal.label)}">`;
        html += statusDot(primary.status);
        html += `<span class="usage-chip-label">${escHtml(bal.label)}</span>`;
        html += `<span class="usage-chip-pct">${bal.remaining != null ? '$' + bal.remaining.toFixed(2) : '-'}</span>`;
        html += '</span>';
    }

    html += '<button class="usage-refresh-btn" id="btn-usage-refresh" title="Refresh usage"><svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M13 3v4H9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M13 7a5 5 0 1 0 1 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button>';
    html += '<button class="usage-detail-btn" id="btn-usage-detail" title="Usage details"><svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M8 1v6M8 11h.01M2 8a6 6 0 1 1 12 0A6 6 0 0 1 2 8Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>';
    slot.innerHTML = html;

    document.getElementById('btn-usage-refresh')?.addEventListener('click', (e) => {
        e.stopPropagation();
        refreshHandler?.();
    });
    document.getElementById('btn-usage-detail')?.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleUsagePopover();
    });
    document.getElementById('usage-chip-primary')?.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleUsagePopover();
    });
    document.getElementById('usage-chip-weekly')?.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleUsagePopover();
    });
}

function pickPrimaryProvider(usage: UsageSnapshotDTO): UsageSnapshotDTO['providers'][number] | undefined {
    if (!usage.providers.length) return undefined;
    const current = usage.currentProviderId
        ? usage.providers.find((p) => p.id === usage.currentProviderId)
        : undefined;
    if (current && current.windows.length > 0) return current;
    const codex = usage.providers.find((p) => p.id === 'openai-codex');
    if (codex && codex.windows.length > 0) return codex;
    return usage.providers.find((p) => p.windows.length > 0 || p.balances.length > 0);
}

function usageBarColor(usedPercent: number): string {
    const left = Math.max(0, 100 - usedPercent);
    if (left > 50) return 'var(--success-fg)';
    if (left > 20) return 'var(--warning-fg)';
    return 'var(--error-fg)';
}

function miniBar(usedPercent: number, width = 40): string {
    const left = Math.max(0, 100 - usedPercent);
    const fill = Math.round((left / 100) * width);
    const empty = Math.max(0, width - fill);
    const color = usageBarColor(usedPercent);
    return `<span class="usage-mini-bar"><span class="usage-mini-fill" style="width:${fill}px;background:${color}"></span><span class="usage-mini-empty" style="width:${empty}px"></span></span>`;
}

function formatResetShort(resetAt: number | undefined): string {
    if (!resetAt) return '';
    const diff = resetAt - Date.now();
    if (diff <= 0) return 'resetting';
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m`;
    if (mins >= 1440) {
        const days = Math.floor(mins / 1440);
        const remHours = Math.floor((mins % 1440) / 60);
        return remHours > 0 ? `${days}d${remHours}h` : `${days}d`;
    }
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;
    return `${hrs}h${remMins}m`;
}

function statusDot(status: string): string {
    switch (status) {
        case 'live': return '<span class="usage-status-dot usage-status-live" title="Live data"></span>';
        case 'cached': return '<span class="usage-status-dot usage-status-cached" title="Cached data"></span>';
        case 'stale': return '<span class="usage-status-dot usage-status-stale" title="Stale data"></span>';
        case 'local': return '<span class="usage-status-dot usage-status-local" title="Local data"></span>';
        default: return '<span class="usage-status-dot usage-status-unavailable" title="Unavailable"></span>';
    }
}

function toggleUsagePopover(): void {
    const existing = document.getElementById('usage-popover');
    if (existing) {
        existing.remove();
        usagePopoverOpen = false;
        return;
    }
    usagePopoverOpen = true;
    showUsagePopover();
}

function showUsagePopover(): void {
    const usage = usageSnapshot;
    if (!usage) return;

    const container = document.querySelector('.input-container');
    if (!container) return;

    const popover = el('div', 'usage-popover');
    popover.id = 'usage-popover';

    const header = el('div', 'usage-popover-header');
    header.innerHTML = '<div class="usage-popover-header-left"><span class="usage-popover-title">Usage</span></div><div class="usage-popover-actions"><button class="usage-popover-refresh" id="btn-usage-popover-refresh">Refresh</button><button class="usage-popover-close" id="btn-usage-close">&times;</button></div>';
    popover.appendChild(header);

    const body = el('div', 'usage-popover-body');

    if (usage.loading) {
        body.innerHTML = '<div class="usage-loading">Loading...</div>';
    } else {
        const { visible, hidden } = partitionLiveProviders(usage.providers);
        if (visible.length > 0) {
            body.appendChild(renderLiveQuotas(visible));
        } else if (hidden.length > 0) {
            body.appendChild(renderUnconfiguredProviders(hidden));
        }
        if (usage.periods.length > 0) {
            body.appendChild(renderHistory(usage));
        }
        if (visible.length === 0 && hidden.length === 0 && usage.periods.length === 0) {
            body.innerHTML = '<div class="usage-no-data">No usage data available yet.</div>';
        }
    }

    popover.appendChild(body);
    const anchor = document.getElementById('usage-popover-anchor');
    if (anchor && anchor.parentElement === container) {
        container.insertBefore(popover, anchor);
    } else {
        container.insertBefore(popover, container.firstChild);
    }

    document.getElementById('btn-usage-close')?.addEventListener('click', () => {
        popover.remove();
        usagePopoverOpen = false;
    });
    document.getElementById('btn-usage-popover-refresh')?.addEventListener('click', (e) => {
        e.stopPropagation();
        refreshHandler?.();
    });
}

function renderLiveQuotas(providers: UsageSnapshotDTO['providers']): HTMLElement {
    const section = el('div', 'usage-section');
    section.innerHTML = '<div class="usage-section-title">Live Quotas</div>';
    for (const prov of providers) {
        const card = el('div', 'usage-provider-card');
        let html = `<div class="usage-provider-header">${statusDot(prov.status)} <span class="usage-provider-label">${escHtml(prov.label)}</span>`;
        if (prov.planName) html += ` <span class="usage-plan-badge">${escHtml(prov.planName)}</span>`;
        html += '</div>';

        if (prov.windows.length > 0) {
            html += '<div class="usage-windows">';
            for (const w of prov.windows) {
                if (w.unavailableReason) {
                    html += `<div class="usage-window-row usage-window-unavailable"><span class="usage-window-label">${escHtml(w.label)}</span><span class="usage-window-reason">${escHtml(w.unavailableReason)}</span></div>`;
                } else {
                    const left = Math.max(0, 100 - w.usedPercent);
                    const reset = formatResetShort(w.resetAt);
                    html += `<div class="usage-window-row"><span class="usage-window-label">${escHtml(w.label)}</span>${miniBar(w.usedPercent, 60)}<span class="usage-window-pct" style="color:${usageBarColor(w.usedPercent)}">${left}% left</span>`;
                    if (reset) html += `<span class="usage-window-reset">${escHtml(reset)}</span>`;
                    html += '</div>';
                }
            }
            html += '</div>';
        }

        if (prov.balances.length > 0) {
            html += '<div class="usage-balances">';
            for (const b of prov.balances) {
                const val = b.remaining != null
                    ? (b.unit === 'USD' ? `$${b.remaining.toFixed(2)}` : `${b.remaining} ${b.unit}`)
                    : '-';
                html += `<div class="usage-balance-row"><span class="usage-balance-label">${escHtml(b.label)}</span><span class="usage-balance-value">${escHtml(val)}</span></div>`;
            }
            html += '</div>';
        }

        if (prov.diagnostics.length > 0) {
            html += '<div class="usage-diagnostics">';
            for (const d of prov.diagnostics) {
                html += `<div class="usage-diagnostic">${escHtml(d)}</div>`;
            }
            html += '</div>';
        }

        card.innerHTML = html;
        section.appendChild(card);
    }
    return section;
}

function renderHistory(usage: UsageSnapshotDTO): HTMLElement {
    const section = el('div', 'usage-section');
    section.innerHTML = '<div class="usage-section-title">History</div>';
    const tabs = el('div', 'usage-period-tabs');
    const labels: Record<string, string> = { today: 'Today', thisWeek: 'This Week', lastWeek: 'Last Week', allTime: 'All Time' };
    let activePeriod = 'thisWeek';

    const tableContainer = el('div', 'usage-table-container');
    const renderPeriodTable = (periodKey: string) => {
        const period = usage.periods.find((p) => p.key === periodKey);
        if (!period) return '<div class="usage-no-data">No data</div>';
        let html = '<table class="usage-table"><thead><tr><th>Provider</th><th>Sessions</th><th>Cost</th><th>Tokens</th></tr></thead><tbody>';
        for (const prov of period.providers) {
            html += `<tr class="usage-table-row"><td>${escHtml(prov.key)}</td><td>${prov.sessionCount}</td><td>$${prov.cost.toFixed(2)}</td><td>${formatTokenCount(prov.tokens)}</td></tr>`;
            for (const m of period.modelsByProvider[prov.key] ?? []) {
                html += `<tr class="usage-table-model-row"><td class="usage-model-name">${escHtml(m.key)}</td><td>${m.sessionCount}</td><td>$${m.cost.toFixed(2)}</td><td>${formatTokenCount(m.tokens)}</td></tr>`;
            }
        }
        html += `<tr class="usage-table-total"><td><strong>Total</strong></td><td><strong>${period.total.sessionCount}</strong></td><td><strong>$${period.total.cost.toFixed(2)}</strong></td><td><strong>${formatTokenCount(period.total.tokens)}</strong></td></tr>`;
        return `${html}</tbody></table>`;
    };

    for (const key of ['today', 'thisWeek', 'lastWeek', 'allTime']) {
        const btn = el('button', `usage-period-tab${key === activePeriod ? ' active' : ''}`);
        btn.textContent = labels[key] ?? key;
        btn.addEventListener('click', () => {
            activePeriod = key;
            tabs.querySelectorAll('.usage-period-tab').forEach((tab) => tab.classList.remove('active'));
            btn.classList.add('active');
            tableContainer.innerHTML = renderPeriodTable(key);
        });
        tabs.appendChild(btn);
    }

    tableContainer.innerHTML = renderPeriodTable(activePeriod);
    section.appendChild(tabs);
    section.appendChild(tableContainer);
    return section;
}

function el(tag: string, className?: string): HTMLElement {
    const node = document.createElement(tag);
    if (className) node.className = className;
    return node;
}

function escHtml(value: string): string {
    return String(value).replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    }[ch] ?? ch));
}

function formatTokenCount(n: number): string {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return String(n);
}

function partitionLiveProviders(providers: UsageSnapshotDTO['providers']): {
    visible: UsageSnapshotDTO['providers'];
    hidden: UsageSnapshotDTO['providers'];
} {
    const visible: UsageSnapshotDTO['providers'] = [];
    const hidden: UsageSnapshotDTO['providers'] = [];
    for (const prov of providers) {
        if (prov.id === 'offline') continue;
        if (isUsableLiveProvider(prov)) {
            visible.push(prov);
        } else {
            hidden.push(prov);
        }
    }
    return { visible, hidden };
}

function isUsableLiveProvider(prov: UsageSnapshotDTO['providers'][number]): boolean {
    if (prov.status === 'unavailable') return false;
    if (prov.windows.length > 0 || prov.balances.length > 0) return true;
    return false;
}

function renderUnconfiguredProviders(providers: UsageSnapshotDTO['providers']): HTMLElement {
    const section = el('div', 'usage-section');
    const titleRow = el('div', 'usage-section-title-row');
    titleRow.innerHTML = '<span class="usage-section-title">Live Quotas</span>';
    const summary = el('span', 'usage-section-summary');
    const count = providers.length;
    summary.textContent = count === 1
        ? '1 provider skipped (not configured).'
        : `${count} providers skipped (not configured).`;
    titleRow.appendChild(summary);
    section.appendChild(titleRow);

    const list = el('div', 'usage-unconfigured-list');
    for (const prov of providers) {
        const row = el('div', 'usage-unconfigured-row');
        const label = el('span', 'usage-unconfigured-label');
        label.textContent = prov.label;
        const reason = el('span', 'usage-unconfigured-reason');
        reason.textContent = prov.diagnostic || 'Not configured.';
        row.appendChild(label);
        row.appendChild(reason);
        list.appendChild(row);
    }
    section.appendChild(list);
    return section;
}
