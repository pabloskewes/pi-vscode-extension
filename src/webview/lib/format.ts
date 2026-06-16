export function escHtml(value: string): string {
  const div = document.createElement('div');
  div.textContent = value;
  return div.innerHTML;
}

export function unescapeHtmlEntities(value: string): string {
  const div = document.createElement('div');
  div.innerHTML = value;
  return div.textContent ?? value;
}

export function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...`;
}

export function tryParseJSON(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function extractToolResultText(result: unknown): string {
  if (result === undefined || result === null) return '';
  if (typeof result === 'string') return result;
  if (Array.isArray(result)) {
    return result
      .map((item) => (typeof item === 'string' ? item : extractTextItem(item)))
      .filter(Boolean)
      .join('\n');
  }
  if (typeof result === 'object') {
    const obj = result as Record<string, unknown>;
    if (Array.isArray(obj.content)) {
      const text = obj.content
        .map((item) => (typeof item === 'string' ? item : extractTextItem(item)))
        .filter(Boolean)
        .join('\n');
      if (text) return text;
    }
    if (typeof obj.text === 'string') return obj.text;
    if (typeof obj.output === 'string') return obj.output;
  }
  return JSON.stringify(result, null, 2);
}

function extractTextItem(item: unknown): string {
  if (typeof item === 'string') return item;
  if (item && typeof item === 'object' && 'text' in item) {
    const text = (item as Record<string, unknown>).text;
    return typeof text === 'string' ? text : '';
  }
  return '';
}

export function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp < 1e12 ? timestamp * 1000 : timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function formatTokenCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

export function formatToolArgs(args: unknown): string {
  if (!args || typeof args !== 'object') return '';
  const entries = Object.entries(args);
  if (entries.length === 0) return '';
  return entries
    .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join('\n');
}
