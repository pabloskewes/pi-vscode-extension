import { marked } from 'marked';
import { replaceInlineFileMarkers } from '../../shared/file-markers';
import { escHtml } from './format';

const renderer = new marked.Renderer();
let markdownRenderPrefix = 'cb';
let markdownCodeBlockId = 0;

renderer.code = function ({ text, lang }: { text: string; lang?: string | undefined }) {
  const id = `${markdownRenderPrefix}-${++markdownCodeBlockId}`;
  const langLabel = lang ? `<span class="code-lang">${escHtml(lang)}</span>` : '';
  return `<div class="code-block-wrapper">
        <div class="code-block-header">${langLabel}<button class="copy-btn" data-code-id="${id}">Copy</button></div>
        <pre class="code-block-pre" id="${id}"><code class="code-block-code">${escHtml(text)}</code></pre>
    </div>`;
};

renderer.codespan = function ({ text }: { text: string }) {
  return `<code>${escHtml(text)}</code>`;
};

marked.setOptions({
  renderer,
  breaks: true,
  gfm: true,
});

function fileMarkerToLink(marker: { raw: string; path: string; startLine?: number; endLine?: number }): string {
  const attrs = [
    'href="#"',
    'class="file-inline-link"',
    `data-file-path="${escHtml(marker.path)}"`,
  ];
  if (typeof marker.startLine === 'number') {
    attrs.push(`data-start-line="${marker.startLine}"`);
  }
  if (typeof marker.endLine === 'number') {
    attrs.push(`data-end-line="${marker.endLine}"`);
  }
  return `<a ${attrs.join(' ')}>${escHtml(marker.raw)}</a>`;
}

function injectFileLinksIntoHtml(html: string): string {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = html;

  const walker = document.createTreeWalker(wrapper, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const parent = node.parentElement;
      if (parent && (parent.tagName === 'CODE' || parent.tagName === 'PRE')) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const textNodes: Text[] = [];
  while (walker.nextNode()) {
    textNodes.push(walker.currentNode as Text);
  }

  for (const textNode of textNodes) {
    const original = textNode.textContent ?? '';
    const replaced = replaceInlineFileMarkers(original, fileMarkerToLink);
    if (replaced === original) {
      continue;
    }
    const span = document.createElement('span');
    span.innerHTML = replaced;
    textNode.parentNode?.replaceChild(span, textNode);
  }

  return wrapper.innerHTML;
}

export function renderMarkdown(text: string, prefix = 'cb'): string {
  if (!text) return '';
  markdownRenderPrefix = prefix;
  markdownCodeBlockId = 0;
  const html = marked.parse(text) as string;
  return injectFileLinksIntoHtml(html);
}
