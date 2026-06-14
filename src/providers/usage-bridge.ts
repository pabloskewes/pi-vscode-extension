import * as vscode from 'vscode';
import type { UsageSnapshotDTO, UsageProviderDTO, UsagePeriodDTO, UsagePeriodRowDTO } from '../shared/protocol';

const USAGE_CORE_READY = 'usage-core:ready';
const USAGE_CORE_UPDATE = 'usage-core:update-current';
const USAGE_CORE_REQUEST = 'usage-core:request';

export class UsageBridge implements vscode.Disposable {
    private _onUpdate = new vscode.EventEmitter<UsageSnapshotDTO>();
    readonly onUpdate = this._onUpdate.event;
    private _unsubscribers: (() => void)[] = [];
    private _latest: UsageSnapshotDTO | undefined;

    constructor(private _outputChannel?: vscode.OutputChannel) {}

    get latest(): UsageSnapshotDTO | undefined {
        return this._latest;
    }

    attach(session: any): void {
        this.detach();

        const config = vscode.workspace.getConfiguration('pi-agent');
        if (config.get<string>('usageWidget.enabled', 'auto') === 'off') return;

        let eventBus: any;
        try {
            eventBus = session?.resourceLoader?.eventBus;
        } catch {
            return;
        }
        if (!eventBus || typeof eventBus.on !== 'function') {
            this._outputChannel?.appendLine('Usage bridge skipped: Pi event bus is unavailable.');
            return;
        }

        const handler = (payload: any) => {
            if (!payload?.state) return;
            const dto = this._toDTO(payload.state);
            this._latest = dto;
            const windowCount = dto.providers.reduce((sum, provider) => sum + provider.windows.length, 0);
            this._outputChannel?.appendLine(
                `Usage bridge update: providers=${dto.providers.length}, windows=${windowCount}, periods=${dto.periods.length}, loading=${dto.loading}`,
            );
            this._onUpdate.fire(dto);
        };

        this._unsubscribers.push(eventBus.on(USAGE_CORE_READY, handler));
        this._unsubscribers.push(eventBus.on(USAGE_CORE_UPDATE, handler));
        this._outputChannel?.appendLine('Usage bridge attached.');

        try {
            eventBus.emit(USAGE_CORE_REQUEST, {
                type: 'current',
                reply: handler,
            });
        } catch (err: any) {
            this._outputChannel?.appendLine(`Usage bridge current-state request failed: ${err.message ?? String(err)}`);
        }
    }

    detach(): void {
        for (const unsub of this._unsubscribers) {
            try { unsub(); } catch { /* ignore */ }
        }
        this._unsubscribers = [];
        this._latest = undefined;
    }

    private _toDTO(state: any): UsageSnapshotDTO {
        const providers: UsageProviderDTO[] = [];
        if (Array.isArray(state.providers)) {
            for (const p of state.providers) {
                if (p.providerId === 'offline') continue;
                providers.push({
                    id: p.providerId,
                    label: p.providerLabel ?? p.providerId,
                    status: p.status ?? 'unavailable',
                    windows: Array.isArray(p.windows)
                        ? p.windows.map((w: any) => ({
                            key: w.key,
                            label: w.label,
                            usedPercent: typeof w.usedPercent === 'number' ? w.usedPercent : 0,
                            resetAt: w.resetAt,
                            unavailableReason: w.unavailableReason,
                        }))
                        : [],
                    balances: Array.isArray(p.balances)
                        ? p.balances.map((b: any) => ({
                            label: b.label,
                            remaining: b.remaining ?? null,
                            unit: b.unit ?? '',
                        }))
                        : [],
                    planName: p.planName,
                    diagnostic: p.diagnostic ?? '',
                    diagnostics: Array.isArray(p.diagnostics) ? p.diagnostics : [],
                    fetchedAt: p.fetchedAt ?? 0,
                });
            }
        }

        const periods: UsagePeriodDTO[] = [];
        if (state.offline?.periods && Array.isArray(state.offline.periods)) {
            for (const period of state.offline.periods) {
                const toRow = (r: any): UsagePeriodRowDTO => ({
                    key: r.key,
                    sessionCount: r.sessionCount ?? 0,
                    messageCount: r.messageCount ?? 0,
                    cost: r.cost ?? 0,
                    tokens: r.tokens ?? 0,
                    input: r.input ?? 0,
                    output: r.output ?? 0,
                    cacheRead: r.cacheRead ?? 0,
                    cacheWrite: r.cacheWrite ?? 0,
                });

                const modelsByProvider: Record<string, UsagePeriodRowDTO[]> = {};
                if (period.modelsByProvider) {
                    for (const [prov, models] of Object.entries(period.modelsByProvider)) {
                        modelsByProvider[prov] = Array.isArray(models)
                            ? (models as any[]).map(toRow)
                            : [];
                    }
                }

                periods.push({
                    key: period.key,
                    total: toRow(period.total ?? {}),
                    providers: Array.isArray(period.providers)
                        ? period.providers.map(toRow)
                        : [],
                    modelsByProvider,
                });
            }
        }

        return {
            available: true,
            currentProviderId: state.currentProviderId ?? null,
            currentModelLabel: state.currentModelLabel,
            providers,
            periods,
            diagnostics: Array.isArray(state.diagnostics) ? state.diagnostics : [],
            generatedAt: state.generatedAt ?? 0,
            loading: state.loading ?? false,
        };
    }

    dispose(): void {
        this.detach();
        this._onUpdate.dispose();
    }
}
