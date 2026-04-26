import * as vscode from 'vscode';
import type { PiSessionManager } from '../pi/session';
import type { ClientMessage, ServerMessage } from '../shared/protocol';
import type { DiffManager } from './diff';
import type { CheckpointManager } from './checkpoint';

export class SidebarProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private _extensionUri: vscode.Uri;
    private _session: PiSessionManager;
    private _diffManager: DiffManager;
    private _checkpointManager: CheckpointManager;
    private _unsubscribers: (() => void)[] = [];
    private _turnCounter = 0;
    private _suspendedMessages: any[] = [];

    constructor(
        extensionUri: vscode.Uri,
        session: PiSessionManager,
        diffManager: DiffManager,
        checkpointManager: CheckpointManager,
    ) {
        this._extensionUri = extensionUri;
        this._session = session;
        this._diffManager = diffManager;
        this._checkpointManager = checkpointManager;
    }

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ): void {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri],
        };

        webviewView.webview.html = this._getHtml(webviewView.webview);

        webviewView.webview.onDidReceiveMessage((msg: ClientMessage) => {
            this._handleMessage(msg);
        });

        this._unsubscribers.push(
            this._session.events.onAll((event) => {
                this._post({ type: 'agentEvent', event: safeSerialize(event) });

                if (
                    event.type === 'agent_start' ||
                    event.type === 'agent_end' ||
                    event.type === 'message_end' ||
                    event.type === 'turn_end'
                ) {
                    this.sendStateSync();
                }
            }),
        );

        this._unsubscribers.push(
            this._diffManager.onFileChange((change) => {
                this._post({ type: 'fileChange', change });
            }),
        );

        webviewView.onDidDispose(() => {
            for (const unsub of this._unsubscribers) unsub();
            this._unsubscribers = [];
        });

        this._post({ type: 'ready' });
        this.sendStateSync();
    }

    sendStateSync(): void {
        const state = this._session.serializeState();
        if (this._suspendedMessages.length > 0) {
            state.messages = [
                ...state.messages,
                ...this._suspendedMessages.map((m: any) => safeSerialize(m)),
            ];
        }
        state.fileChanges = this._diffManager.fileChanges;
        state.rollbackPoint = this._checkpointManager.rollbackPoint;
        this._post({ type: 'stateSync', state });
    }

    private _post(message: ServerMessage): void {
        this._view?.webview.postMessage(message);
    }

    private async _handleMessage(msg: ClientMessage): Promise<void> {
        try {
            switch (msg.type) {
                case 'prompt': {
                    if (this._checkpointManager.rollbackPoint !== null) {
                        this._checkpointManager.discardSuspended();
                        this._diffManager.discardSuspended();
                        this._suspendedMessages = [];
                    }
                    this._turnCounter++;
                    const turnIdx = this._turnCounter;
                    this._checkpointManager.startTurn(turnIdx);
                    this._diffManager.setCurrentTurn(turnIdx);
                    await this._session.prompt(msg.text);
                    break;
                }
                case 'steer':
                    await this._session.steer(msg.text);
                    break;
                case 'followUp':
                    await this._session.followUp(msg.text);
                    break;
                case 'abort':
                    await this._session.abort();
                    break;
                case 'getModels': {
                    const models = this._session.getModels();
                    const current = this._session.getCurrentModel();
                    const thinkingLevel = this._session.getThinkingLevel();
                    this._post({ type: 'models', models, current, thinkingLevel });
                    break;
                }
                case 'setModel':
                    await this._session.setModel(msg.provider, msg.modelId);
                    this.sendStateSync();
                    break;
                case 'setThinkingLevel':
                    this._session.setThinkingLevel(msg.level);
                    this.sendStateSync();
                    break;
                case 'newSession':
                    await this._session.newSession();
                    this._diffManager.clearAll();
                    this._checkpointManager.clearAll();
                    this._turnCounter = 0;
                    this._suspendedMessages = [];
                    this.sendStateSync();
                    break;
                case 'loadSession':
                    await this._session.loadSession(msg.sessionPath);
                    this._diffManager.clearAll();
                    this._checkpointManager.clearAll();
                    this._turnCounter = 0;
                    this._suspendedMessages = [];
                    this.sendStateSync();
                    break;
                case 'getSessions': {
                    const sessions = await this._session.getSessions();
                    const currentId = this._session.session?.sessionId;
                    this._post({ type: 'sessions', sessions, currentSessionId: currentId });
                    break;
                }
                case 'getState':
                    this.sendStateSync();
                    break;
                case 'openFile': {
                    const fileUri = vscode.Uri.file(msg.filePath);
                    try {
                        const doc = await vscode.workspace.openTextDocument(fileUri);
                        await vscode.window.showTextDocument(doc, { preview: true });
                    } catch { /* file may not exist */ }
                    break;
                }
                case 'openDiff':
                    await this._diffManager.openDiff(msg.filePath, msg.toolCallId);
                    break;
                case 'undoFileChange':
                    await this._diffManager.undoFileChange(msg.filePath, msg.toolCallId);
                    this.sendStateSync();
                    break;
                case 'undoAllFileChanges':
                    await this._diffManager.undoAllFileChanges();
                    this.sendStateSync();
                    break;
                case 'restoreCheckpoint': {
                    const restored = await this._checkpointManager.restoreCheckpoint(msg.messageIndex);
                    this._diffManager.suspendChangesAfter(msg.messageIndex);

                    const allMsgs = this._session.getMessages();
                    const cutoff = this._findCutoffIndex(allMsgs, msg.messageIndex);
                    if (cutoff >= 0 && cutoff < allMsgs.length) {
                        this._suspendedMessages = allMsgs.slice(cutoff);
                        this._session.setMessages(allMsgs.slice(0, cutoff));
                    }

                    if (restored.length > 0) {
                        vscode.window.showInformationMessage(
                            `Restored ${restored.length} file(s) to checkpoint.`
                        );
                    }
                    this.sendStateSync();
                    break;
                }
                case 'redoCheckpoint': {
                    const redone = await this._checkpointManager.redoCheckpoint();
                    this._diffManager.redoChanges();

                    if (this._suspendedMessages.length > 0) {
                        const current = this._session.getMessages();
                        this._session.setMessages([...current, ...this._suspendedMessages]);
                        this._suspendedMessages = [];
                    }

                    if (redone.length > 0) {
                        vscode.window.showInformationMessage(
                            `Re-applied ${redone.length} file(s).`
                        );
                    }
                    this.sendStateSync();
                    break;
                }
                case 'confirmAction': {
                    const answer = await vscode.window.showWarningMessage(
                        msg.message,
                        { modal: true },
                        'Yes',
                    );
                    this._post({
                        type: 'confirmResult',
                        action: msg.action,
                        confirmed: answer === 'Yes',
                        payload: msg.payload,
                    });
                    break;
                }
            }
        } catch (err: any) {
            this._post({ type: 'error', message: err.message ?? String(err) });
        }
    }

    /**
     * Finds the index in the messages array where the (N+1)th user message starts.
     * rollbackPoint = N means keep through turn N, remove from turn N+1 onward.
     */
    private _findCutoffIndex(messages: any[], rollbackPoint: number): number {
        let userMsgCount = 0;
        for (let i = 0; i < messages.length; i++) {
            if (messages[i].role === 'user') {
                userMsgCount++;
                if (userMsgCount > rollbackPoint) {
                    return i;
                }
            }
        }
        return -1;
    }

    private _getHtml(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'out', 'webview', 'main.js')
        );
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'src', 'webview', 'styles', 'main.css')
        );
        const nonce = getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy"
          content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <link rel="stylesheet" href="${styleUri}">
    <title>Pi Agent</title>
</head>
<body>
    <div id="app"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }
}

function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

function safeSerialize(obj: any): any {
    try {
        return JSON.parse(JSON.stringify(obj));
    } catch {
        return { type: obj?.type, _serializationFailed: true };
    }
}
