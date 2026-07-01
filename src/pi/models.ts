import type { ModelRegistry } from '@earendil-works/pi-coding-agent';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ModelInfo } from '../shared/protocol';
import { getAuthStorage } from './auth';

let cached: ModelRegistry | undefined;

export async function getModelRegistry(): Promise<ModelRegistry> {
    if (cached) {
        return cached;
    }
    const { ModelRegistry: MR } = await import('@earendil-works/pi-coding-agent');
    const authStorage = await getAuthStorage();
    cached = MR.create(authStorage);
    return cached;
}

export function getAvailableModels(registry: ModelRegistry): ModelInfo[] {
    const models = registry.getAvailable().map((m) => ({
        provider: String(m.provider),
        id: m.id,
        name: m.name,
        reasoning: m.reasoning,
        thinkingLevelMap: m.thinkingLevelMap as Record<string, string | null> | undefined,
    }));
    return filterEnabledModels(models);
}

function filterEnabledModels(models: ModelInfo[]): ModelInfo[] {
    const patterns = readEnabledModelPatterns();
    if (patterns.length === 0) {
        return models;
    }

    // Walk patterns in declaration order so the picker reflects the order
    // the user wrote them in `enabledModels`.
    const seen = new Set<string>();
    const ordered: ModelInfo[] = [];
    for (const pattern of patterns) {
        for (const model of models) {
            const key = `${model.provider}:${model.id}`;
            if (seen.has(key)) continue;
            if (matchesModelPattern(model, pattern)) {
                seen.add(key);
                ordered.push(model);
            }
        }
    }

    return ordered.length > 0 ? ordered : models;
}

function readEnabledModelPatterns(): string[] {
    try {
        const agentDir = process.env.PI_CODING_AGENT_DIR
            ?? path.join(os.homedir(), '.pi', 'agent');
        const settingsPath = path.join(agentDir, 'settings.json');
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        return Array.isArray(settings.enabledModels)
            ? settings.enabledModels.filter((value: unknown): value is string => typeof value === 'string')
            : [];
    } catch {
        return [];
    }
}

function matchesModelPattern(model: ModelInfo, pattern: string): boolean {
    const normalized = pattern.trim();
    if (!normalized) {
        return false;
    }

    const fullId = `${model.provider}/${model.id}`;
    return wildcardMatch(fullId, normalized) || wildcardMatch(model.id, normalized);
}

function wildcardMatch(value: string, pattern: string): boolean {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`).test(value);
}

export function findModel(registry: ModelRegistry, provider: string, modelId: string): ReturnType<ModelRegistry['find']> {
    return registry.find(provider, modelId);
}

export function disposeModelRegistry() {
    cached = undefined;
}
