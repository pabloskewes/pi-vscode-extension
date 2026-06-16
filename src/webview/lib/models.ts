import type { ModelInfo } from '../../shared/protocol';

export function addToRecentModels(recentModels: ModelInfo[], model: ModelInfo): ModelInfo[] {
  const next = recentModels.filter(
    (entry) => !(entry.id === model.id && entry.provider === model.provider)
  );
  next.unshift({ provider: model.provider, id: model.id, name: model.name });
  return next.slice(0, 5);
}

export function groupModelsByProvider(models: ModelInfo[]): Array<[string, ModelInfo[]]> {
  const order: string[] = [];
  const groups = new Map<string, ModelInfo[]>();
  for (const model of models) {
    if (!groups.has(model.provider)) {
      groups.set(model.provider, []);
      order.push(model.provider);
    }
    groups.get(model.provider)?.push(model);
  }
  return order.map((provider) => [provider, groups.get(provider) ?? []]);
}
