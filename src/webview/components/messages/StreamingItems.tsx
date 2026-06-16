import type { ReactNode } from 'react';
import type { StreamingItem as StreamingItemType } from '../../types';
import { renderStreamingItem } from '../../lib/streaming';

interface StreamingItemsProps {
  items: StreamingItemType[];
  onOpenDiff: (filePath: string, toolCallId: string) => void;
  onOpenFile: (filePath: string) => void;
}

export default function StreamingItems({ items, onOpenDiff, onOpenFile }: StreamingItemsProps): ReactNode {
  return <>{items.map((item) => renderStreamingItem(item, onOpenDiff, onOpenFile))}</>;
}
