import { marked } from 'marked';
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

export function renderMarkdown(text: string, prefix = 'cb'): string {
  if (!text) return '';
  markdownRenderPrefix = prefix;
  markdownCodeBlockId = 0;
  return marked.parse(text) as string;
}
