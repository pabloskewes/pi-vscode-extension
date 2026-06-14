import * as vscode from 'vscode';
import type { UsageSnapshotDTO, UsageProviderDTO, UsagePeriodDTO, UsagePeriodRowDTO } from '../shared/protocol';

const USAGE_CORE_READY = 'usage-core:ready';
const USAGE_CORE_UPDATE = 'usage-core:update-current';
const USAGE_CORE_REQUEST = 'usage-core:request';
const USAGE_REFRESH_COMMAND = 'usage:refresh';

/**
 * Bridges @pi-vault/pi-usage snapshots from Pi's extension event bus into the
 * VS Code webview protocol.
 *
 * Why this exists:
 * - The VS Code fork renders a custom usage footer and popover from host-side
 *   session data instead of Pi's built-in TUI dashboard.
 * - @pi-vault/pi-usage publishes its state through the shared extension event
 *   bus (`usage-core:*`), so the host needs a translator from Pi runtime state
 *   to webview-safe DTOs.
 * - The package exposes real refresh through the slash command `usage:refresh`,
 *   not through a dedicated event API. This bridge encapsulates the command
 *   invocation so the rest of the extension does not depend on package
 *   internals.
 *
 * What it does:
 * - Subscribes to `usage-core:ready` and `usage-core:update-current`.
 * - Requests the latest cached snapshot via `usage-core:request` for late
 *   subscribers.
 * - Optionally triggers a real refresh by invoking the registered
 *   `usage:refresh` extension command on the active Pi session.
 *
 * Assumptions:
 * - The host binds Pi extensions in `rpc` mode.
 * - The usage package continues to register a command named `usage:refresh`.
 * - That command continues to require `ctx.hasUI === true` before running.
 * - A minimal UI shim with no-op dialog methods is sufficient for the command,
 *   and `ctx.ui.custom()` may safely return `undefined` so the TUI dashboard is
 *   skipped while the refresh side effects still execute.
 *
 * Real fix:
 * - A dedicated refresh API should exist at the usage extension boundary so
 *   consumers can request a forced provider refresh without pretending to be a
 *   dialog-capable UI host or invoking a slash command handler directly.
 */

export class UsageBridge implements vscode.Disposable {
    private _onUpdate = new vscode.EventEmitter<UsageSnapshotDTO>();
    readonly onUpdate = this._onUpdate.event;
    private _unsubscribers: (() => void)[] = [];
    private _latest: UsageSnapshotDTO | undefined;
    private _session: any;
    private _refreshPromise: Promise<boolean> | undefined;

    constructor(private _outputChannel?: vscode.OutputChannel) {}

    get latest(): UsageSnapshotDTO | undefined {
        return this._latest;
    }

    attach(session: any): void {
        this.detach();
        this._session = session;

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
        this._session = undefined;
    }

    async refresh(): Promise<boolean> {
        if (this._refreshPromise) {
            return this._refreshPromise;
        }

        this._refreshPromise = this._refreshInternal().finally(() => {
            this._refreshPromise = undefined;
        });
        return this._refreshPromise;
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

    private async _refreshInternal(): Promise<boolean> {
        const session = this._session;
        const runner = session?.extensionRunner;
        if (!runner) {
            this._outputChannel?.appendLine('Usage refresh skipped: Pi extension runner is unavailable.');
            this._requestCurrentSnapshot(session);
            return false;
        }

        const command = typeof runner.getCommand === 'function'
            ? runner.getCommand(USAGE_REFRESH_COMMAND)
            : undefined;
        if (!command?.handler || typeof runner.createCommandContext !== 'function') {
            this._outputChannel?.appendLine(`Usage refresh unavailable: command '${USAGE_REFRESH_COMMAND}' is not registered.`);
            this._requestCurrentSnapshot(session);
            return false;
        }

        const originalUi = typeof runner.getUIContext === 'function' ? runner.getUIContext() : undefined;
        const shimUi = this._createRefreshUiShim();

        try {
            if (typeof runner.setUIContext === 'function') {
                runner.setUIContext(shimUi, 'rpc');
            }
            await command.handler('', runner.createCommandContext());
            this._outputChannel?.appendLine(`Usage refresh invoked via '${USAGE_REFRESH_COMMAND}'.`);
            return true;
        } catch (err: any) {
            this._outputChannel?.appendLine(`Usage refresh failed: ${err.message ?? String(err)}`);
            return false;
        } finally {
            if (typeof runner.setUIContext === 'function') {
                runner.setUIContext(originalUi, 'rpc');
            }
            this._requestCurrentSnapshot(session);
        }
    }

    private _requestCurrentSnapshot(session: any): void {
        const eventBus = session?.resourceLoader?.eventBus;
        if (!eventBus || typeof eventBus.emit !== 'function') {
            return;
        }

        try {
            eventBus.emit(USAGE_CORE_REQUEST, {
                type: 'current',
                reply: (payload: any) => {
                    if (!payload?.state) return;
                    const dto = this._toDTO(payload.state);
                    this._latest = dto;
                    this._onUpdate.fire(dto);
                },
            });
        } catch (err: any) {
            this._outputChannel?.appendLine(`Usage bridge current-state request failed: ${err.message ?? String(err)}`);
        }
    }

    private _createRefreshUiShim(): any {
        return {
            select: async () => undefined,
            confirm: async () => false,
            input: async () => undefined,
            notify: () => {},
            onTerminalInput: () => () => {},
            setStatus: () => {},
            setWorkingMessage: () => {},
            setWorkingVisible: () => {},
            setWorkingIndicator: () => {},
            setHiddenThinkingLabel: () => {},
            setWidget: () => {},
            setFooter: () => {},
            setHeader: () => {},
            setTitle: () => {},
            custom: async () => undefined,
            pasteToEditor: () => {},
            setEditorText: () => {},
            getEditorText: () => '',
            editor: async () => undefined,
            addAutocompleteProvider: () => {},
            setEditorComponent: () => {},
            getEditorComponent: () => undefined,
            theme: {},
            getAllThemes: () => [],
            getTheme: () => undefined,
            setTheme: () => ({ success: false, error: 'Unsupported in usage refresh shim' }),
            getToolsExpanded: () => false,
            setToolsExpanded: () => {},
        };
    }

    dispose(): void {
        this.detach();
        this._onUpdate.dispose();
    }
}
