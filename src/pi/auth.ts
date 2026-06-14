import type { AuthStorage } from '@earendil-works/pi-coding-agent';

let cached: AuthStorage | undefined;

export async function getAuthStorage(): Promise<AuthStorage> {
    if (cached) {
        return cached;
    }
    const { AuthStorage: AS } = await import('@earendil-works/pi-coding-agent');
    cached = AS.create();
    return cached;
}

export function disposeAuthStorage() {
    cached = undefined;
}
