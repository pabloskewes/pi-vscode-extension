import type { ClientMessage } from '../shared/protocol';

interface VsCodeApi {
  postMessage(message: ClientMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

export const vscode = acquireVsCodeApi();

export const iconsBaseUri = document.getElementById('app')?.dataset.iconsUri ?? '';
