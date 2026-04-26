import * as vscode from 'vscode';
import type { PiSessionManager } from '../pi/session';
import type { AgentSessionEvent } from '@mariozechner/pi-coding-agent';

export class TerminalManager implements vscode.Disposable {
    private _terminal: vscode.Terminal | undefined;
    private _session: PiSessionManager;
    private _unsubscribe?: () => void;
    private _disposables: vscode.Disposable[] = [];

    constructor(session: PiSessionManager) {
        this._session = session;

        this._unsubscribe = session.events.on('tool_execution_start', (event: AgentSessionEvent) => {
            const e = event as any;
            if (e.toolName === 'bash' || e.toolName === 'python') {
                this._showToolExecution(e);
            }
        });

        this._disposables.push(
            vscode.window.onDidCloseTerminal((t) => {
                if (t === this._terminal) {
                    this._terminal = undefined;
                }
            })
        );
    }

    private _getOrCreateTerminal(): vscode.Terminal {
        if (this._terminal) {
            return this._terminal;
        }

        this._terminal = vscode.window.createTerminal({
            name: 'Pi Agent',
            iconPath: new vscode.ThemeIcon('hubot'),
        });

        return this._terminal;
    }

    private _showToolExecution(event: any): void {
        const terminal = this._getOrCreateTerminal();
        terminal.show(true);

        const command = event.args?.command ?? event.args?.code ?? '';
        if (command) {
            terminal.sendText(`# Pi Agent: ${event.toolName}`, true);
            terminal.sendText(command, true);
        }
    }

    dispose(): void {
        this._unsubscribe?.();
        this._terminal?.dispose();
        for (const d of this._disposables) {
            d.dispose();
        }
    }
}
