import { Fragment, type MutableRefObject, type ReactNode } from 'react';
import type { ModelInfo } from '../../../shared/protocol';
import { groupModelsByProvider } from '../../lib/models';
import {
    THINKING_LEVELS,
    getThinkingLevelsForModel,
    type ThinkingLevel,
} from '../../lib/thinking-levels';
import ModelItem from './ModelItem';

function resolveAvailableLevels(
    current: ModelInfo | undefined,
    allModels: ModelInfo[]
): readonly ThinkingLevel[] | undefined {
    // 1. SDK-provided map on the current model wins.
    if (current?.thinkingLevelMap) {
        return THINKING_LEVELS.filter(
            (level) => current.thinkingLevelMap![level] !== null
        );
    }

    // 2. Non-reasoning models: only off.
    if (current?.reasoning === false) {
        return ['off'];
    }

    // 3. Try to find a sibling model with the same id that has the SDK map.
    if (current) {
        const currentId = current.id.toLowerCase();
        const sibling = allModels.find(
            (m) =>
                m.thinkingLevelMap &&
                (m.id.toLowerCase() === currentId ||
                    m.id.toLowerCase().split('/').pop() === currentId)
        );
        if (sibling) {
            return THINKING_LEVELS.filter(
                (level) => sibling.thinkingLevelMap![level] !== null
            );
        }
    }

    // 4. Curated dictionary keyed by model id.
    const fromDictionary = getThinkingLevelsForModel(current);
    return fromDictionary;
}

interface ModelPickerProps {
  pickerRef: MutableRefObject<HTMLDivElement | null>;
  searchRef: MutableRefObject<HTMLInputElement | null>;
  searchValue: string;
  filteredModels: ModelInfo[];
  recentModels: ModelInfo[];
  availableModels: ModelInfo[];
  currentModel?: ModelInfo;
  thinkingLevel?: string;
  onSearchChange: (value: string) => void;
  onSelectModel: (provider: string, modelId: string) => void;
  onSetThinkingLevel: (level: string) => void;
}

export default function ModelPicker({
  pickerRef,
  searchRef,
  searchValue,
  filteredModels,
  recentModels,
  availableModels,
  currentModel,
  thinkingLevel,
  onSearchChange,
  onSelectModel,
  onSetThinkingLevel,
}: ModelPickerProps): ReactNode {
  const query = searchValue.trim().toLowerCase();
  const groupedModels = groupModelsByProvider(availableModels);
  const recentAvailable = recentModels
    .map((recent) => availableModels.find((model) => model.id === recent.id && model.provider === recent.provider))
    .filter((model): model is ModelInfo => !!model);

  const availableLevels = resolveAvailableLevels(currentModel, availableModels) ?? THINKING_LEVELS;

  return (
    <div className="model-picker" id="model-picker" ref={pickerRef}>
      <input
        className="model-search"
        placeholder="Search models..."
        type="text"
        value={searchValue}
        ref={searchRef}
        onChange={(event) => onSearchChange(event.target.value)}
      />

      <div className="model-list">
        {query ? (
          filteredModels.map((model) => (
            <ModelItem
              key={`${model.provider}:${model.id}`}
              model={model}
              currentModel={currentModel}
              onSelectModel={onSelectModel}
            />
          ))
        ) : (
          <>
            {recentAvailable.length > 0 ? (
              <>
                <div className="model-section-header">Recent</div>
                {recentAvailable.map((model) => (
                  <ModelItem
                    key={`recent:${model.provider}:${model.id}`}
                    model={model}
                    currentModel={currentModel}
                    onSelectModel={onSelectModel}
                  />
                ))}
              </>
            ) : null}

            {groupedModels.map(([provider, models]) => (
              <Fragment key={provider}>
                <div className="model-section-header" data-provider={provider}>
                  {provider}
                </div>
                {models.map((model) => (
                  <ModelItem
                    key={`${provider}:${model.id}`}
                    model={model}
                    currentModel={currentModel}
                    onSelectModel={onSelectModel}
                  />
                ))}
              </Fragment>
            ))}
          </>
        )}
      </div>

      <div className="thinking-chips">
        <span className="thinking-label">Thinking:</span>
        {availableLevels.map((level) => (
          <button
            className={`thinking-chip${level === thinkingLevel ? ' active' : ''}`}
            data-level={level}
            key={level}
            type="button"
            onClick={() => onSetThinkingLevel(level)}
          >
            {level.charAt(0).toUpperCase() + level.slice(1)}
          </button>
        ))}
      </div>
    </div>
  );
}
