import type { FileReferenceInfo } from '../../shared/protocol';
import { escHtml } from './format';
import { getNodeIndex, isNodeInside } from './dom';

export function getComposerPayload(input: HTMLElement | null): ComposerPayload {
  if (!input) {
    return { text: '', files: [] };
  }

  const raw = readComposerContent(input);
  const leadingTrim = raw.text.length - raw.text.trimStart().length;
  const text = raw.text.trim();
  const seen = new Set<string>();
  const files: FileReferenceInfo[] = [];

  for (const file of raw.files) {
    const dedupeKey = file.absolutePath ?? file.relativePath;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const rawOffset = file.insertOffset ?? 0;
    files.push({
      relativePath: file.relativePath,
      absolutePath: file.absolutePath,
      displayName: file.displayName,
      insertOffset: Math.max(0, Math.min(text.length, rawOffset - leadingTrim)),
    });
  }

  return { text, files };
}

export interface ComposerPayload {
  text: string;
  files: FileReferenceInfo[];
}

interface ComposerContent {
  text: string;
  files: FileReferenceInfo[];
}

export function readComposerContent(root: Node): ComposerContent {
  let text = '';
  const files: FileReferenceInfo[] = [];

  const walk = (node: Node): void => {
    if (isComposerFileChip(node)) {
      files.push({
        relativePath: node.dataset.filePath ?? '',
        absolutePath: node.dataset.absolutePath,
        displayName: node.dataset.fileName ?? node.dataset.filePath ?? '',
        insertOffset: text.length,
      });
      return;
    }

    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? '';
      return;
    }

    if (isLineBreakNode(node)) {
      text += '\n';
      return;
    }

    node.childNodes.forEach(walk);
  };

  walk(root);
  return { text, files: files.filter((file) => file.relativePath) };
}

export function getComposerTextBeforeCaret(input: HTMLElement): string {
  const offset = getComposerCaretTextOffset(input);
  return readComposerContent(input).text.slice(0, offset);
}

export function getComposerCaretTextOffset(input: HTMLElement): number {
  const selection = window.getSelection();
  const anchorNode = selection?.anchorNode;
  if (!selection || !anchorNode || !isNodeInside(anchorNode, input)) {
    return readComposerContent(input).text.length;
  }

  let textOffset = 0;
  let found = false;
  const anchorOffset = selection.anchorOffset;

  const walk = (node: Node): void => {
    if (found) return;

    if (node === anchorNode) {
      if (node.nodeType === Node.TEXT_NODE) {
        textOffset += Math.min(anchorOffset, node.textContent?.length ?? 0);
      } else {
        const children = Array.from(node.childNodes).slice(0, anchorOffset);
        for (const child of children) {
          textOffset += getComposerNodeTextLength(child);
        }
      }
      found = true;
      return;
    }

    if (isComposerFileChip(node)) return;

    if (node.nodeType === Node.TEXT_NODE) {
      textOffset += node.textContent?.length ?? 0;
      return;
    }

    if (isLineBreakNode(node)) {
      textOffset += 1;
      return;
    }

    node.childNodes.forEach(walk);
  };

  walk(input);
  return found ? textOffset : readComposerContent(input).text.length;
}

export function getComposerNodeTextLength(node: Node): number {
  if (isComposerFileChip(node)) return 0;
  if (node.nodeType === Node.TEXT_NODE) return node.textContent?.length ?? 0;
  if (isLineBreakNode(node)) return 1;

  let length = 0;
  node.childNodes.forEach((child) => {
    length += getComposerNodeTextLength(child);
  });
  return length;
}

export function replaceComposerTextRange(
  input: HTMLElement,
  startOffset: number,
  endOffset: number,
  replacement: string | Node,
  trailingText = ''
): void {
  const range = document.createRange();
  const start = findComposerTextPosition(input, startOffset);
  const end = findComposerTextPosition(input, endOffset);
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  range.deleteContents();

  if (typeof replacement === 'string') {
    const textNode = document.createTextNode(replacement);
    range.insertNode(textNode);
    setComposerCaret(textNode, textNode.length);
  } else {
    const fragment = document.createDocumentFragment();
    fragment.appendChild(replacement);
    const trailingNode = document.createTextNode(trailingText);
    fragment.appendChild(trailingNode);
    range.insertNode(fragment);
    setComposerCaret(trailingNode, trailingNode.length);
  }

  input.dispatchEvent(new Event('input', { bubbles: true }));
}

export function findComposerTextPosition(
  root: HTMLElement,
  targetOffset: number
): { node: Node; offset: number } {
  const target = Math.max(0, targetOffset);
  let textOffset = 0;
  let found: { node: Node; offset: number } | null = null;

  const walk = (node: Node): void => {
    if (found) return;
    if (isComposerFileChip(node)) return;

    if (node.nodeType === Node.TEXT_NODE) {
      const length = node.textContent?.length ?? 0;
      if (target <= textOffset + length) {
        found = { node, offset: Math.max(0, target - textOffset) };
        return;
      }
      textOffset += length;
      return;
    }

    if (isLineBreakNode(node)) {
      if (target <= textOffset) {
        found = { node: node.parentNode ?? root, offset: getNodeIndex(node) };
        return;
      }
      if (target <= textOffset + 1) {
        found = { node: node.parentNode ?? root, offset: getNodeIndex(node) + 1 };
        return;
      }
      textOffset += 1;
      return;
    }

    node.childNodes.forEach(walk);
  };

  walk(root);
  return found ?? { node: root, offset: root.childNodes.length };
}

export function insertComposerText(input: HTMLElement, text: string): void {
  const selection = window.getSelection();
  const range = document.createRange();

  if (selection && selection.rangeCount > 0 && selection.anchorNode && isNodeInside(selection.anchorNode, input)) {
    const selectedRange = selection.getRangeAt(0);
    range.setStart(selectedRange.startContainer, selectedRange.startOffset);
    range.setEnd(selectedRange.endContainer, selectedRange.endOffset);
  } else {
    range.selectNodeContents(input);
    range.collapse(false);
  }

  range.deleteContents();
  const textNode = document.createTextNode(text);
  range.insertNode(textNode);
  setComposerCaret(textNode, textNode.length);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

export function normalizeComposerEmptyState(input: HTMLElement): void {
  if (!input.querySelector('.attachment-chip-inline') && input.textContent === '') {
    input.innerHTML = '';
  }
}

export function createComposerFileChip(file: FileReferenceInfo): HTMLElement {
  const chip = document.createElement('span');
  chip.className = 'attachment-chip attachment-chip-file attachment-chip-inline';
  chip.contentEditable = 'false';
  chip.dataset.filePath = file.relativePath;
  if (file.absolutePath) {
    chip.dataset.absolutePath = file.absolutePath;
  }
  chip.dataset.fileName = file.displayName;
  chip.title = file.relativePath;
  chip.innerHTML = `
        <span class="attachment-file-icon">@</span>
        <span class="attachment-chip-name">${escHtml(file.displayName)}</span>
        <button class="attachment-chip-remove" type="button" title="Remove">&times;</button>
    `;

  chip.querySelector('.attachment-chip-remove')?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const input = chip.closest('#input') as HTMLElement | null;
    chip.remove();
    input?.dispatchEvent(new Event('input', { bubbles: true }));
    input?.focus();
  });

  return chip;
}

export function setComposerCaret(node: Node, offset: number): void {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

export function isComposerFileChip(node: Node): node is HTMLElement {
  return (
    node instanceof HTMLElement &&
    node.classList.contains('attachment-chip-file') &&
    !!node.dataset.filePath
  );
}

export function isLineBreakNode(node: Node): boolean {
  return node instanceof HTMLBRElement;
}
