import * as vscode from 'vscode';
import { PiSessionManager } from './pi/session';
import { SidebarProvider } from './providers/sidebar';
import { StatusBarManager } from './providers/status-bar';
import { SettingsPanel } from './providers/settings-panel';

import { DiffManager, DiffContentProvider } from './providers/diff';
import { CheckpointManager } from './providers/checkpoint';
import { WebviewDebugController, WebviewDebugMcpServer } from './debug/mcp-server';

let piSession: PiSessionManager | undefined;

export async function activate(context: vscode.ExtensionContext) {
    const outputChannel = vscode.window.createOutputChannel('Pi Agent');
    outputChannel.appendLine('Pi Agent extension activating...');

    try {
        piSession = new PiSessionManager(outputChannel);
        await piSession.initialize();

        const diffContentProvider = new DiffContentProvider();
        const checkpointManager = new CheckpointManager();
        const statusBar = new StatusBarManager(piSession);
        const debugController = new WebviewDebugController(outputChannel);
        const debugMcpServer = new WebviewDebugMcpServer(debugController, outputChannel);

        const diffManager = new DiffManager(piSession, checkpointManager);
        const sidebarProvider = new SidebarProvider(
            context.extensionUri, piSession, diffManager, checkpointManager, outputChannel, debugController,
        );

        const applyDebugMcpConfiguration = async () => {
            const config = vscode.workspace.getConfiguration('pi-agent');
            const enabled = config.get<boolean>('debugMcp.enabled', context.extensionMode === vscode.ExtensionMode.Development);
            if (!enabled) {
                await debugMcpServer.stop();
                return;
            }

            const port = config.get<number>('debugMcp.port', 38473);
            if (!Number.isInteger(port) || port < 1 || port > 65535) {
                throw new Error(`Invalid pi-agent.debugMcp.port: ${port}`);
            }

            await debugMcpServer.start('127.0.0.1', port);
        };

        await applyDebugMcpConfiguration();

        context.subscriptions.push(
            vscode.window.registerWebviewViewProvider('pi-agent.chat', sidebarProvider),
            vscode.workspace.registerTextDocumentContentProvider('pi-diff', diffContentProvider),
            statusBar,
            debugController,
            debugMcpServer,

            diffManager,
            checkpointManager,
            outputChannel,
            vscode.workspace.onDidChangeConfiguration((event) => {
                if (!event.affectsConfiguration('pi-agent.debugMcp')) {
                    return;
                }

                void applyDebugMcpConfiguration().catch((error) => {
                    const message = error instanceof Error ? error.message : String(error);
                    outputChannel.appendLine(`[PI-MCP] Failed to apply debug MCP configuration: ${message}`);
                    vscode.window.showErrorMessage(`Pi Agent debug MCP error: ${message}`);
                });
            }),

            vscode.commands.registerCommand('pi-agent.newChat', async () => {
                await piSession?.newSession();
                sidebarProvider.sendStateSync();
            }),

            vscode.commands.registerCommand('pi-agent.abort', async () => {
                await piSession?.abort();
            }),

            vscode.commands.registerCommand('pi-agent.selectModel', async () => {
                await piSession?.showModelPicker();
                sidebarProvider.sendStateSync();
            }),

            vscode.commands.registerCommand('pi-agent.toggleThinking', async () => {
                const level = piSession?.cycleThinkingLevel();
                if (level) {
                    vscode.window.showInformationMessage(`Thinking level: ${level}`);
                }
                sidebarProvider.sendStateSync();
            }),

            vscode.commands.registerCommand('pi-agent.focusChat', () => {
                vscode.commands.executeCommand('pi-agent.chat.focus');
            }),

            vscode.commands.registerCommand('pi-agent.openSettings', () => {
                SettingsPanel.show(context.extensionUri, context.secrets);
            }),
        );

        outputChannel.appendLine('Pi Agent extension activated.');
    } catch (err: any) {
        outputChannel.appendLine(`Failed to activate: ${err.message}`);
        vscode.window.showErrorMessage(`Pi Agent failed to activate: ${err.message}`);
    }
}

export async function deactivate() {
    await piSession?.dispose();
    await PiSessionManager.disposeGlobal();
}
