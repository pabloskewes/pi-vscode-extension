import type { ReactNode } from 'react';
import type { ModelInfo } from '../../../shared/protocol';

interface ModelItemProps {
  model: ModelInfo;
  currentModel?: ModelInfo;
  onSelectModel: (provider: string, modelId: string) => void;
}

export default function ModelItem({ model, currentModel, onSelectModel }: ModelItemProps): ReactNode {
  const isActive = currentModel && currentModel.id === model.id && currentModel.provider === model.provider;

  return (
    <div
      className={`model-item${isActive ? ' active' : ''}`}
      data-provider={model.provider}
      data-model-id={model.id}
      data-name={(model.name ?? model.id).toLowerCase()}
      onClick={() => onSelectModel(model.provider, model.id)}
    >
      <span className="model-item-check">{isActive ? '✓' : ''}</span>
      <span className="model-item-name">{model.name ?? model.id}</span>
    </div>
  );
}
