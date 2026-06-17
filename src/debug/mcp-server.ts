import * as http from 'node:http';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as vscode from 'vscode';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import * as z from 'zod/v4';
import type { DebugBridgeClientEvent, DebugBridgeLogEntry, DebugBridgeRequest } from '../shared/protocol';

const DEBUG_MCP_ROUTE = '/mcp';
const BRIDGE_READY_TIMEOUT_MS = 8000;
const REQUEST_TIMEOUT_MS = 10000;
const MAX_LOG_ENTRIES = 500;

type PendingRequest = {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
};

export class WebviewDebugController implements vscode.Disposable {
    private _webview?: vscode.Webview;
    private _bridgeReady = false;
    private _readyPromise: Promise<void>;
    private _resolveReady!: () => void;
    private _requestSeq = 0;
    private _logSeq = 0;
    private _pendingRequests = new Map<string, PendingRequest>();
    private _consoleLogs: DebugBridgeLogEntry[] = [];

    constructor(private readonly _outputChannel: vscode.OutputChannel) {
        this._readyPromise = this._createReadyPromise();
    }

    attachWebview(webview: vscode.Webview): void {
        this._webview = webview;
        this._bridgeReady = false;
        this._readyPromise = this._createReadyPromise();
        this._rejectPendingRequests(new Error('Webview debug bridge was reloaded.'));
    }

    detachWebview(webview?: vscode.Webview): void {
        if (!this._webview) {
            return;
        }
        if (webview && webview !== this._webview) {
            return;
        }

        this._webview = undefined;
        this._bridgeReady = false;
        this._readyPromise = this._createReadyPromise();
        this._rejectPendingRequests(new Error('Webview debug bridge disconnected.'));
        this._outputChannel.appendLine('[PI-MCP] Webview debug bridge detached.');
    }

    handleClientMessage(message: DebugBridgeClientEvent): void {
        switch (message.kind) {
            case 'ready':
                this._bridgeReady = true;
                this._resolveReady();
                this._outputChannel.appendLine(`[PI-MCP] Webview debug bridge ready: ${message.href}`);
                break;
            case 'log':
                this._appendConsoleLog(message.level, message.args, message.timestamp);
                break;
            case 'pageError':
                this._appendConsoleLog('error', [{
                    kind: 'pageError',
                    message: message.message,
                    stack: message.stack,
                    source: message.source,
                    lineno: message.lineno,
                    colno: message.colno,
                }], message.timestamp);
                break;
            case 'unhandledRejection':
                this._appendConsoleLog('error', [{
                    kind: 'unhandledRejection',
                    reason: message.reason,
                }], message.timestamp);
                break;
            case 'response': {
                const pending = this._pendingRequests.get(message.requestId);
                if (!pending) {
                    return;
                }
                clearTimeout(pending.timer);
                this._pendingRequests.delete(message.requestId);
                if (message.ok) {
                    pending.resolve(message.result);
                } else {
                    const responseError = 'error' in message
                        ? message.error
                        : { message: 'Unknown webview debug error.' };
                    const error = new Error(responseError.message);
                    error.stack = responseError.stack ?? error.stack;
                    pending.reject(error);
                }
                break;
            }
        }
    }

    getConsoleLogs(since = 0): { entries: DebugBridgeLogEntry[]; nextSince: number } {
        const entries = since > 0
            ? this._consoleLogs.filter((entry) => entry.seq > since)
            : [...this._consoleLogs];
        return { entries, nextSince: this._logSeq };
    }

    async evaluateWebview(code: string): Promise<unknown> {
        return this._sendRequest({
            kind: 'evaluate',
            requestId: this._nextRequestId('evaluate'),
            code,
        });
    }

    async simulateDrop(path: string, selector?: string): Promise<unknown> {
        return this._sendRequest({
            kind: 'simulateDrop',
            requestId: this._nextRequestId('drop'),
            path,
            selector,
        });
    }

    dispose(): void {
        this.detachWebview();
    }

    private _appendConsoleLog(level: DebugBridgeLogEntry['level'], args: unknown[], timestamp: number): void {
        const entry: DebugBridgeLogEntry = {
            seq: ++this._logSeq,
            timestamp,
            level,
            text: args.map((arg) => formatValue(arg)).join(' '),
            args,
        };

        this._consoleLogs.push(entry);
        if (this._consoleLogs.length > MAX_LOG_ENTRIES) {
            this._consoleLogs.splice(0, this._consoleLogs.length - MAX_LOG_ENTRIES);
        }

        this._outputChannel.appendLine(`[PI-WEBVIEW ${level.toUpperCase()}] ${entry.text}`);
        void this._appendDebugFileLog(entry);
    }

    private async _appendDebugFileLog(entry: DebugBridgeLogEntry): Promise<void> {
        try {
            const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!wsRoot) return;

            const timestamp = new Date(entry.timestamp).toISOString();
            const line = `[${timestamp}] [PI-WEBVIEW ${entry.level.toUpperCase()}] ${entry.text}\n`;

            const debugDir = path.join(wsRoot, '.vscode');
            await fs.promises.mkdir(debugDir, { recursive: true });
            const logPath = path.join(debugDir, 'interaction-debug.log');
            await fs.promises.appendFile(logPath, line);
        } catch {
            // silently ignore file write failures
        }
    }

    private _createReadyPromise(): Promise<void> {
        return new Promise<void>((resolve) => {
            this._resolveReady = resolve;
        });
    }

    private async _sendRequest(request: DebugBridgeRequest): Promise<unknown> {
        await this._awaitBridgeReady();

        const webview = this._webview;
        if (!webview) {
            throw new Error('Pi Agent webview is not open. Open the sidebar before using debug tools.');
        }

        return new Promise<unknown>(async (resolve, reject) => {
            const timer = setTimeout(() => {
                this._pendingRequests.delete(request.requestId);
                reject(new Error(`Timed out waiting for webview debug response for ${request.kind}.`));
            }, REQUEST_TIMEOUT_MS);

            this._pendingRequests.set(request.requestId, { resolve, reject, timer });

            try {
                const delivered = await webview.postMessage({ type: '__debugBridgeRequest', request });
                if (!delivered) {
                    clearTimeout(timer);
                    this._pendingRequests.delete(request.requestId);
                    reject(new Error('VS Code did not deliver the debug request to the webview.'));
                }
            } catch (error) {
                clearTimeout(timer);
                this._pendingRequests.delete(request.requestId);
                reject(error instanceof Error ? error : new Error(String(error)));
            }
        });
    }

    private async _awaitBridgeReady(): Promise<void> {
        if (this._bridgeReady) {
            return;
        }

        if (!this._webview) {
            throw new Error('Pi Agent webview is not open. Open the sidebar before using debug tools.');
        }

        await Promise.race([
            this._readyPromise,
            new Promise<void>((_, reject) => setTimeout(() => reject(
                new Error('Timed out waiting for the Pi Agent webview debug bridge to initialize.')
            ), BRIDGE_READY_TIMEOUT_MS)),
        ]);
    }

    private _rejectPendingRequests(error: Error): void {
        for (const [requestId, pending] of this._pendingRequests) {
            clearTimeout(pending.timer);
            pending.reject(error);
            this._pendingRequests.delete(requestId);
        }
    }

    private _nextRequestId(prefix: string): string {
        this._requestSeq += 1;
        return `${prefix}-${this._requestSeq}`;
    }
}

export class WebviewDebugMcpServer implements vscode.Disposable {
    private _server?: http.Server;
    private _host?: string;
    private _port?: number;

    constructor(
        private readonly _controller: WebviewDebugController,
        private readonly _outputChannel: vscode.OutputChannel,
    ) { }

    get url(): string | undefined {
        if (!this._host || !this._port) {
            return undefined;
        }
        return `http://${this._host}:${this._port}${DEBUG_MCP_ROUTE}`;
    }

    async start(host: string, port: number): Promise<void> {
        if (this._server && this._host === host && this._port === port) {
            return;
        }

        await this.stop();

        const server = http.createServer((req, res) => {
            void this._handleRequest(req, res);
        });

        await new Promise<void>((resolve, reject) => {
            server.once('error', reject);
            server.listen(port, host, () => {
                server.off('error', reject);
                resolve();
            });
        });

        this._server = server;
        this._host = host;
        this._port = port;
        this._outputChannel.appendLine(`[PI-MCP] Webview debug MCP listening at ${this.url}`);
    }

    async stop(): Promise<void> {
        if (!this._server) {
            return;
        }

        const server = this._server;
        const url = this.url;
        this._server = undefined;
        this._host = undefined;
        this._port = undefined;

        await new Promise<void>((resolve, reject) => {
            server.close((error) => error ? reject(error) : resolve());
        });

        this._outputChannel.appendLine(`[PI-MCP] Webview debug MCP stopped${url ? ` (${url})` : ''}.`);
    }

    dispose(): void {
        void this.stop();
    }

    private async _handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        try {
            if (!isLoopbackHostHeader(req.headers.host)) {
                this._sendJson(res, 403, {
                    jsonrpc: '2.0',
                    error: { code: -32000, message: 'Forbidden host header.' },
                    id: null,
                });
                return;
            }

            const requestUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
            if (requestUrl.pathname !== DEBUG_MCP_ROUTE) {
                this._sendJson(res, 404, {
                    jsonrpc: '2.0',
                    error: { code: -32000, message: 'Not found.' },
                    id: null,
                });
                return;
            }

            if (req.method === 'POST') {
                const body = await readJsonBody(req);
                const transport = new StreamableHTTPServerTransport({
                    sessionIdGenerator: undefined,
                });
                const server = this._createMcpServer();

                res.on('close', () => {
                    void transport.close();
                    void server.close();
                });

                await server.connect(transport);
                await transport.handleRequest(req as any, res as any, body);
                return;
            }

            if (req.method === 'GET' || req.method === 'DELETE') {
                this._sendJson(res, 405, {
                    jsonrpc: '2.0',
                    error: { code: -32000, message: 'Method not allowed.' },
                    id: null,
                });
                return;
            }

            this._sendJson(res, 405, {
                jsonrpc: '2.0',
                error: { code: -32000, message: 'Method not allowed.' },
                id: null,
            });
        } catch (error) {
            this._outputChannel.appendLine(`[PI-MCP] Request error: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
            if (!res.headersSent) {
                this._sendJson(res, 500, {
                    jsonrpc: '2.0',
                    error: { code: -32603, message: error instanceof Error ? error.message : 'Internal server error' },
                    id: null,
                });
            }
        }
    }

    private _createMcpServer(): McpServer {
        const server = new McpServer({
            name: 'pi-agent-webview-debug',
            version: '0.1.0',
        });

        server.registerTool(
            'evaluate_webview',
            {
                description: 'Run JavaScript in the Pi Agent webview to inspect DOM state, event handlers, and runtime values.',
                inputSchema: {
                    code: z.string().describe('JavaScript source to evaluate in the webview context.'),
                },
            },
            async ({ code }) => {
                const result = await this._controller.evaluateWebview(code);
                return asToolResult(result);
            },
        );

        server.registerTool(
            'get_console_logs',
            {
                description: 'Read buffered Pi Agent webview console logs captured by the debug bridge.',
                inputSchema: {
                    since: z.number().int().nonnegative().optional().describe('Optional log sequence cursor from a previous get_console_logs call.'),
                },
                annotations: {
                    readOnlyHint: true,
                },
            },
            async ({ since }) => {
                return asToolResult(this._controller.getConsoleLogs(since ?? 0));
            },
        );

        server.registerTool(
            'simulate_drop',
            {
                description: 'Dispatch a synthetic drag-and-drop sequence in the Pi Agent webview using a file path payload.',
                inputSchema: {
                    path: z.string().describe('Absolute file path to expose via text/uri-list and text/plain on the synthetic DataTransfer.'),
                    selector: z.string().optional().describe('Optional CSS selector for the drop target. Defaults to the composer input container.'),
                },
            },
            async ({ path, selector }) => {
                const result = await this._controller.simulateDrop(path, selector);
                return asToolResult(result);
            },
        );

        return server;
    }

    private _sendJson(res: http.ServerResponse, statusCode: number, body: unknown): void {
        if (res.headersSent) {
            return;
        }

        const text = JSON.stringify(body);
        res.writeHead(statusCode, {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(text),
        });
        res.end(text);
    }
}

function asToolResult(value: unknown): { content: Array<{ type: 'text'; text: string }> } {
    return {
        content: [{
            type: 'text',
            text: formatToolValue(value),
        }],
    };
}

function formatToolValue(value: unknown): string {
    if (value === undefined) {
        return 'undefined';
    }

    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}

function formatValue(value: unknown): string {
    if (typeof value === 'string') {
        return value;
    }
    if (value === undefined) {
        return 'undefined';
    }
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    const text = Buffer.concat(chunks).toString('utf8').trim();
    if (!text) {
        throw new Error('Missing JSON request body.');
    }

    return JSON.parse(text);
}

function isLoopbackHostHeader(hostHeader: string | undefined): boolean {
    if (!hostHeader) {
        return false;
    }

    return /^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(hostHeader);
}
