import { h } from './dom.js';
import { safeHref } from './links.js';

const INLINE_RE = /(`[^`]+`|\*\*\*[\s\S]*?\*\*\*|\*\*[\s\S]*?\*\*|\*[\s\S]*?\*|_[^_\n]+_)/;

function textNodes(value) {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.flatMap(textNodes);
  if (value instanceof Node) return [value];
  return [document.createTextNode(String(value))];
}

function parseInline(text, renderText, depth = 0) {
  if (!text) return [];
  if (depth > 4) return textNodes(renderText ? renderText(text) : text);

  return text.split(INLINE_RE).flatMap((part) => {
    if (!part) return [];
    if (part.startsWith('`') && part.endsWith('`') && part.length >= 3) {
      return [h('code', { class: 'md-code' }, part.slice(1, -1))];
    }
    if (part.startsWith('***') && part.endsWith('***') && part.length >= 7) {
      return [h('strong', null, h('em', null, parseInline(part.slice(3, -3), renderText, depth + 1)))];
    }
    if (part.startsWith('**') && part.endsWith('**') && part.length >= 5) {
      return [h('strong', null, parseInline(part.slice(2, -2), renderText, depth + 1))];
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length >= 3) {
      return [h('em', null, parseInline(part.slice(1, -1), renderText, depth + 1))];
    }
    if (part.startsWith('_') && part.endsWith('_') && part.length >= 3) {
      return [h('u', null, parseInline(part.slice(1, -1), renderText, depth + 1))];
    }
    return textNodes(renderText ? renderText(part) : part);
  });
}

function isBlockPrefix(line) {
  return line.startsWith('> ') || /^[-*+] /.test(line) || /^\d+\. /.test(line);
}

function quoteBlock(items, className, renderText) {
  const children = [];
  items.forEach((t, j) => {
    children.push(...parseInline(t, renderText));
    if (j < items.length - 1) children.push(h('br'));
  });
  return h('blockquote', { class: className }, children);
}

/**
 * Renders the chat's message formatting as DOM nodes.
 *
 * Supports `code`, ***bold italic***, **bold**, *italic* and _underline_, quotes
 * with > and nested quotes with >>, and bulleted and numbered lists. Runs of
 * blank lines between content become proportional space. Nested inline
 * formatting is parsed to a fixed depth and deeper text is left plain. All text
 * ends as text nodes.
 *
 * @param {string} text Message body.
 * @param {(plain: string) => Array<Node|string>} [renderText] Renders plain runs,
 *   used for clickable links and search highlighting.
 * @returns {Node[]}
 */
export function renderMarkdown(text, renderText) {
  if (!text) return [];
  const lines = text.split('\n');
  const output = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith('>> ')) {
      const items = [];
      while (i < lines.length && lines[i].startsWith('>> ')) items.push(lines[i++].slice(3));
      output.push(quoteBlock(items, 'md-bq md-bq--nested', renderText));
      continue;
    }

    if (line.startsWith('> ')) {
      const items = [];
      while (i < lines.length && lines[i].startsWith('> ') && !lines[i].startsWith('>> ')) items.push(lines[i++].slice(2));
      output.push(quoteBlock(items, 'md-bq', renderText));
      continue;
    }

    if (/^[-*+] /.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*+] /.test(lines[i])) items.push(lines[i++].slice(2));
      output.push(h('ul', { class: 'md-ul' }, items.map((t) => h('li', null, parseInline(t, renderText)))));
      continue;
    }

    if (/^\d+\. /.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\. /.test(lines[i])) items.push(lines[i++].replace(/^\d+\. /, ''));
      output.push(h('ol', { class: 'md-ol' }, items.map((t) => h('li', null, parseInline(t, renderText)))));
      continue;
    }

    if (line === '') {
      let count = 0;
      while (i < lines.length && lines[i] === '') {
        count++;
        i++;
      }
      if (output.length > 0 && i < lines.length) {
        output.push(h('div', { style: { height: `${count}em` }, 'aria-hidden': 'true' }));
      }
      continue;
    }

    const nextLine = lines[i + 1];
    const addBr = i !== lines.length - 1 && nextLine !== '' && !isBlockPrefix(nextLine ?? '');
    output.push(...parseInline(line, renderText));
    if (addBr) output.push(h('br'));
    i++;
  }

  return output;
}

const DOC_INLINE_RE = /(`[^`]+`|!\[[^\]]*\]\([^)\s]+\)|\[[^\]]+\]\([^)\s]+\)|\*\*\*.+?\*\*\*|\*\*.+?\*\*|\*[^*\n]+\*|_[^_\n]+_|~~.+?~~)/;

function docInline(text) {
  if (!text) return [];
  return text.split(DOC_INLINE_RE).flatMap((part) => {
    if (!part) return [];
    let m;
    if (part.startsWith('`') && part.endsWith('`') && part.length >= 3) return [h('code', { class: 'inline-code' }, part.slice(1, -1))];
    if ((m = part.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/))) {
      const href = safeHref(m[2]);
      return href && href.startsWith('https:') ? [h('img', { alt: m[1], src: href, style: { maxWidth: '100%', borderRadius: '6px' } })] : [m[1]];
    }
    if ((m = part.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/))) {
      const href = safeHref(m[2]);
      return href ? [h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, docInline(m[1]))] : docInline(m[1]);
    }
    if (part.startsWith('***') && part.endsWith('***') && part.length >= 7) return [h('strong', null, h('em', null, docInline(part.slice(3, -3))))];
    if (part.startsWith('**') && part.endsWith('**') && part.length >= 5) return [h('strong', null, docInline(part.slice(2, -2)))];
    if (part.startsWith('~~') && part.endsWith('~~') && part.length >= 5) return [h('del', null, docInline(part.slice(2, -2)))];
    if (/^\*[^*]+\*$/.test(part) || /^_[^_]+_$/.test(part)) return [h('em', null, docInline(part.slice(1, -1)))];
    return [document.createTextNode(part)];
  });
}

function cells(row) {
  return row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

/**
 * Renders a Markdown file for the attachment preview.
 *
 * Supports fenced code, pipe tables, headings to level three, rules, quotes,
 * lists, inline code, emphasis, strikethrough and links. Links pass safeHref(),
 * and images load only from https addresses. Here _text_ is emphasis, as in
 * Markdown, not the chat's underline. All text ends as text nodes.
 *
 * @param {string} raw File contents.
 * @returns {Node[]}
 */
export function renderDocument(raw) {
  const lines = (raw || '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      const code = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) code.push(lines[i++]);
      i++;
      out.push(h('pre', { class: `code-block${fence[1] ? ` language-${fence[1]}` : ''}` }, h('code', null, code.join('\n'))));
      continue;
    }
    if (/^\|.+\|\s*$/.test(line) && /^\|[-:\s|]+\|\s*$/.test(lines[i + 1] || '')) {
      const head = cells(line);
      i += 2;
      const body = [];
      while (i < lines.length && /^\|.+\|\s*$/.test(lines[i])) body.push(cells(lines[i++]));
      out.push(h('table', null,
        h('thead', null, h('tr', null, head.map((c) => h('th', null, docInline(c))))),
        h('tbody', null, body.map((r) => h('tr', null, r.map((c) => h('td', null, docInline(c))))))));
      continue;
    }
    let m;
    if ((m = line.match(/^(#{1,3}) (.+)$/))) {
      out.push(h(`h${m[1].length}`, null, docInline(m[2])));
      i++;
      continue;
    }
    if (/^---+\s*$/.test(line)) {
      out.push(h('hr'));
      i++;
      continue;
    }
    if (line.startsWith('> ')) {
      out.push(h('blockquote', null, docInline(line.slice(2))));
      i++;
      continue;
    }
    if (/^[-*] /.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*] /.test(lines[i])) items.push(lines[i++].slice(2));
      out.push(h('ul', null, items.map((t) => h('li', null, docInline(t)))));
      continue;
    }
    if (/^\d+\. /.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\. /.test(lines[i])) items.push(lines[i++].replace(/^\d+\. /, ''));
      out.push(h('ol', null, items.map((t) => h('li', null, docInline(t)))));
      continue;
    }
    if (!line.trim()) {
      out.push(h('br'));
      i++;
      continue;
    }
    out.push(h('p', null, docInline(line)));
    i++;
  }
  return out;
}
