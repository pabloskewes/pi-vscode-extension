import type { ModelInfo } from '../../shared/protocol';

export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

const THINKING_LEVEL_SET = new Set<string>(THINKING_LEVELS);

/**
 * Curated fallback for models whose provider does not expose a
 * thinkingLevelMap. Keys are model-id prefixes; the first matching
 * entry wins. Order matters: most specific first.
 *
 * Each entry is backed by the provider's published documentation or
 * reliable observed behavior. Sources are listed at the top of each
 * section. When in doubt, the entry is conservative (fewer levels).
 */
const FALLBACK_BY_MODEL_PREFIX: Array<{ prefix: string; levels: readonly ThinkingLevel[] }> = [
    // ---- OpenAI o-series (reasoning_effort: low / medium / high) ----
    // Source: https://platform.openai.com/docs/models
    { prefix: 'o1-mini', levels: ['off', 'low', 'medium', 'high'] },
    { prefix: 'o1-preview', levels: ['off', 'low', 'medium', 'high'] },
    { prefix: 'o1', levels: ['off', 'low', 'medium', 'high'] },
    { prefix: 'o3-mini', levels: ['off', 'low', 'medium', 'high'] },
    { prefix: 'o3-pro', levels: ['off', 'low', 'medium', 'high'] },
    { prefix: 'o3', levels: ['off', 'low', 'medium', 'high'] },
    { prefix: 'o4-mini', levels: ['off', 'low', 'medium', 'high'] },
    { prefix: 'o4', levels: ['off', 'low', 'medium', 'high'] },

    // ---- OpenAI gpt-5 family (reasoning_effort: none/low/medium/high/xhigh) ----
    // Source: https://platform.openai.com/docs/models ("Reasoning: none | low | medium | high | xhigh")
    { prefix: 'gpt-5.5', levels: ['off', 'low', 'medium', 'high', 'xhigh'] },
    { prefix: 'gpt-5.4-mini', levels: ['off', 'low', 'medium', 'high', 'xhigh'] },
    { prefix: 'gpt-5.4', levels: ['off', 'low', 'medium', 'high', 'xhigh'] },
    { prefix: 'gpt-5', levels: ['off', 'low', 'medium', 'high', 'xhigh'] },
    { prefix: 'gpt-4.1', levels: ['off'] },
    { prefix: 'gpt-4o', levels: ['off'] },

    // ---- Deepseek (binary thinking mode, no discrete levels) ----
    // Source: https://api-docs.deepseek.com/quick_start/pricing
    //   "Supports both non-thinking and thinking (default) modes"
    // The SDK's thinkingLevelMap marks high and xhigh as supported;
    // minimal/low/medium are null. The SDK is authoritative here.
    { prefix: 'deepseek-v4', levels: ['off', 'high', 'xhigh'] },
    { prefix: 'deepseek-reasoner', levels: ['off', 'high', 'xhigh'] },
    { prefix: 'deepseek-chat', levels: ['off', 'high', 'xhigh'] },
    { prefix: 'deepseek', levels: ['off', 'high', 'xhigh'] },

    // ---- Anthropic Claude ----
    // Source: https://docs.anthropic.com/en/docs/about-claude/models/overview
    //   and https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking
    //   Fable/Mythos/Opus 4.7+/4.8: adaptive thinking only, `effort`
    //   parameter. Earlier Claude 3.x/4.5/4.6: extended thinking with
    //   budget_tokens. In both cases the SDK maps the binary state to
    //   xhigh via thinkingLevelMap, so the UI shows off / xhigh.
    { prefix: 'claude-fable', levels: ['off', 'xhigh'] },
    { prefix: 'claude-mythos', levels: ['off', 'xhigh'] },
    { prefix: 'claude-opus-4-8', levels: ['off', 'xhigh'] },
    { prefix: 'claude-opus-4-7', levels: ['off', 'xhigh'] },
    { prefix: 'claude-opus-4-6', levels: ['off', 'xhigh'] },
    { prefix: 'claude-opus-4-5', levels: ['off', 'xhigh'] },
    { prefix: 'claude-opus-4-1', levels: ['off', 'xhigh'] },
    { prefix: 'claude-opus-4', levels: ['off', 'xhigh'] },
    { prefix: 'claude-opus', levels: ['off', 'xhigh'] },
    { prefix: 'claude-sonnet-4-6', levels: ['off', 'xhigh'] },
    { prefix: 'claude-sonnet-4-5', levels: ['off', 'xhigh'] },
    { prefix: 'claude-sonnet-4-1', levels: ['off', 'xhigh'] },
    { prefix: 'claude-sonnet-4', levels: ['off', 'xhigh'] },
    { prefix: 'claude-sonnet-3-7', levels: ['off', 'xhigh'] },
    { prefix: 'claude-sonnet-3-5', levels: ['off', 'xhigh'] },
    { prefix: 'claude-sonnet', levels: ['off', 'xhigh'] },
    { prefix: 'claude-haiku-4-5', levels: ['off', 'xhigh'] },
    { prefix: 'claude-haiku-4-1', levels: ['off', 'xhigh'] },
    { prefix: 'claude-haiku-4', levels: ['off', 'xhigh'] },
    { prefix: 'claude-haiku-3-5', levels: ['off', 'xhigh'] },
    { prefix: 'claude-haiku', levels: ['off', 'xhigh'] },
    { prefix: 'claude-3-7', levels: ['off', 'xhigh'] },
    { prefix: 'claude-3-5', levels: ['off', 'xhigh'] },
    { prefix: 'claude', levels: ['off', 'xhigh'] },

    // ---- Google Gemini ----
    // Source: https://ai.google.dev/gemini-api/docs/thinking
    // Gemini 2.5 Pro/Flash support a thinking budget with dynamic
    // levels (low/medium/high). Gemini 3 added higher tiers. Earlier
    // 1.5/2.0 do not support thinking.
    { prefix: 'gemini-3', levels: ['off', 'low', 'medium', 'high', 'xhigh'] },
    { prefix: 'gemini-2.5-pro', levels: ['off', 'low', 'medium', 'high'] },
    { prefix: 'gemini-2.5-flash', levels: ['off', 'low', 'medium', 'high'] },
    { prefix: 'gemini-2.5', levels: ['off', 'low', 'medium', 'high'] },
    { prefix: 'gemini-2.0', levels: ['off'] },
    { prefix: 'gemini-1.5', levels: ['off'] },
    { prefix: 'gemini', levels: ['off', 'low', 'medium', 'high'] },

    // ---- xAI Grok ----
    // Source: https://docs.x.ai/docs/models
    // Reasoning variants (grok-4.20-0309-reasoning, grok-4.x) support
    // a `reasoning_effort` parameter. Non-reasoning variants do not.
    { prefix: 'grok-4.20-multi-agent', levels: ['off', 'low', 'medium', 'high'] },
    { prefix: 'grok-4.20-reasoning', levels: ['off', 'low', 'medium', 'high'] },
    { prefix: 'grok-4', levels: ['off', 'low', 'medium', 'high'] },
    { prefix: 'grok-3-mini', levels: ['off', 'low', 'medium', 'high'] },
    { prefix: 'grok-3', levels: ['off'] },
    { prefix: 'grok-2', levels: ['off'] },
    { prefix: 'grok', levels: ['off'] },

    // ---- Moonshot Kimi ----
    // Source: https://huggingface.co/MoonshotAI/Kimi-K2-Instruct
    //   "Kimi-K2-Instruct ... a reflex-grade model without long thinking."
    { prefix: 'kimi-k2-thinking', levels: ['off', 'low', 'medium', 'high'] },
    { prefix: 'kimi-k2', levels: ['off'] },
    { prefix: 'kimi', levels: ['off'] },

    // ---- Zhipu GLM ----
    // Source: https://docs.z.ai/guides/llm/glm-5
    // GLM-5 / GLM-4.6 expose a binary `thinking.type` (enabled/disabled)
    // via the thinking mode; there are no discrete levels.
    { prefix: 'glm-5', levels: ['off', 'xhigh'] },
    { prefix: 'glm-4.6', levels: ['off', 'xhigh'] },
    { prefix: 'glm-4.5', levels: ['off', 'xhigh'] },
    { prefix: 'glm', levels: ['off'] },

    // ---- Alibaba Qwen ----
    // Qwen3 / QwQ expose thinking_mode (enabled/disabled). Older Qwen2.x
    // does not support thinking.
    { prefix: 'qwen3-max', levels: ['off', 'xhigh'] },
    { prefix: 'qwen3', levels: ['off', 'xhigh'] },
    { prefix: 'qwq', levels: ['off', 'xhigh'] },
    { prefix: 'qwen', levels: ['off'] },

    // ---- Mistral ----
    // Magistral is Mistral's reasoning model with discrete levels
    // (low/medium/high). Other Mistral models do not support thinking.
    { prefix: 'magistral', levels: ['off', 'low', 'medium', 'high'] },
    { prefix: 'mistral-large', levels: ['off'] },
    { prefix: 'mistral', levels: ['off'] },

    // ---- Meta Llama ----
    // No first-class thinking support; some third-party hosts may
    // expose it but the upstream API does not.
    { prefix: 'llama-4', levels: ['off'] },
    { prefix: 'llama-3.3', levels: ['off'] },
    { prefix: 'llama', levels: ['off'] },

    // ---- Models surfaced by the opencode-go proxy ----
    // The proxy re-exposes real models from each upstream provider, so
    // capabilities match the upstream. If a new variant appears, add
    // it above in the matching provider section.
    { prefix: 'kimi-k2.7-code', levels: ['off'] },
    { prefix: 'minimax-m3', levels: ['off', 'low', 'medium', 'high'] },
];

function normalizeModelId(modelId: string): string {
    const basename = modelId.split('/').pop() ?? modelId;
    return basename.toLowerCase();
}

function findFallbackLevels(modelId: string): readonly ThinkingLevel[] | undefined {
    const id = normalizeModelId(modelId);
    for (const entry of FALLBACK_BY_MODEL_PREFIX) {
        if (id === entry.prefix || id.startsWith(entry.prefix)) {
            return entry.levels;
        }
    }
    return undefined;
}

export function getThinkingLevelsForModel(
    model: Pick<ModelInfo, 'id' | 'provider' | 'thinkingLevelMap'> | undefined
): readonly ThinkingLevel[] | undefined {
    if (!model) return undefined;
    if (model.thinkingLevelMap) {
        // SDK provided an explicit map: null = unsupported, string = supported,
        // missing key = use provider default (supported).
        return THINKING_LEVELS.filter((level) => model.thinkingLevelMap![level] !== null);
    }
    return findFallbackLevels(model.id);
}

export function filterThinkingLevels<T extends string>(
    level: T,
    allowed: readonly string[] | undefined
): T {
    if (!allowed || allowed.length === 0) return level;
    if (allowed.includes(level)) return level;
    // Pick the closest allowed level (prefer the one nearest in the canonical order).
    const order = THINKING_LEVELS as readonly string[];
    const idx = order.indexOf(level);
    let best: string = allowed[0] as string;
    let bestDist = Infinity;
    for (const candidate of allowed) {
        if (!THINKING_LEVEL_SET.has(candidate)) continue;
        const candIdx = order.indexOf(candidate);
        const dist = Math.abs(candIdx - idx);
        if (dist < bestDist) {
            bestDist = dist;
            best = candidate;
        }
    }
    return best as T;
}
