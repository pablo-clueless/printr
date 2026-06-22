/**
 * GitHub-flavored Markdown stylesheet plus a highlight.js theme, scoped for
 * print. Kept inline so the produced HTML is fully self-contained and Chrome
 * never has to fetch external resources while rendering the PDF.
 */
export const githubMarkdownCss = `
:root {
  --fg: #1f2328;
  --muted: #59636e;
  --border: #d1d9e0;
  --border-muted: #d1d9e0b3;
  --accent: #0969da;
  --code-bg: #f6f8fa;
  --code-fg: #1f2328;
}

* { box-sizing: border-box; }

body {
  color: var(--fg);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans",
    Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji";
  font-size: 11pt;
  line-height: 1.55;
  word-wrap: break-word;
  margin: 0;
}

.markdown-body > *:first-child { margin-top: 0 !important; }
.markdown-body > *:last-child { margin-bottom: 0 !important; }

h1, h2, h3, h4, h5, h6 {
  margin-top: 1.4em;
  margin-bottom: 0.6em;
  font-weight: 600;
  line-height: 1.25;
}
h1 { font-size: 1.9em; padding-bottom: 0.3em; border-bottom: 1px solid var(--border-muted); }
h2 { font-size: 1.45em; padding-bottom: 0.3em; border-bottom: 1px solid var(--border-muted); }
h3 { font-size: 1.2em; }
h4 { font-size: 1em; }
h5 { font-size: 0.9em; }
h6 { font-size: 0.85em; color: var(--muted); }

p, blockquote, ul, ol, dl, table, pre { margin-top: 0; margin-bottom: 1em; }

a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }

blockquote {
  padding: 0 1em;
  color: var(--muted);
  border-left: 0.25em solid var(--border);
  margin-left: 0;
}

ul, ol { padding-left: 2em; }
li + li { margin-top: 0.25em; }
li > p { margin-top: 0.5em; }

code, kbd, pre, samp {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas,
    "Liberation Mono", monospace;
}

code {
  font-size: 0.88em;
  background: var(--code-bg);
  padding: 0.2em 0.4em;
  border-radius: 6px;
}

pre {
  padding: 1em;
  overflow: auto;
  font-size: 0.85em;
  line-height: 1.45;
  background: var(--code-bg);
  border-radius: 6px;
  white-space: pre-wrap;
  word-break: break-word;
}
pre code {
  background: transparent;
  padding: 0;
  font-size: inherit;
  border-radius: 0;
}

table {
  border-collapse: collapse;
  display: block;
  width: max-content;
  max-width: 100%;
  overflow: auto;
}
table th, table td { padding: 6px 13px; border: 1px solid var(--border); }
table th { font-weight: 600; }
table tr:nth-child(2n) { background: var(--code-bg); }

img { max-width: 100%; }

hr {
  height: 1px;
  border: 0;
  background: var(--border);
  margin: 1.6em 0;
}

/* Page-break behavior for print */
h1, h2, h3, h4, h5, h6 { break-after: avoid-page; }
pre, blockquote, table, img { break-inside: avoid; }

/* highlight.js — GitHub light theme */
.hljs { color: var(--code-fg); background: var(--code-bg); }
.hljs-comment, .hljs-quote { color: #6a737d; }
.hljs-keyword, .hljs-selector-tag, .hljs-doctag, .hljs-type, .hljs-name, .hljs-strong { color: #d73a49; }
.hljs-literal, .hljs-number, .hljs-variable, .hljs-template-variable, .hljs-tag .hljs-attr { color: #005cc5; }
.hljs-string, .hljs-regexp, .hljs-addition, .hljs-attribute, .hljs-meta .hljs-string { color: #032f62; }
.hljs-title, .hljs-section, .hljs-built_in, .hljs-title.class_, .hljs-title.function_ { color: #6f42c1; }
.hljs-attr, .hljs-attribute, .hljs-symbol, .hljs-bullet, .hljs-link { color: #e36209; }
.hljs-emphasis { font-style: italic; }
.hljs-strong { font-weight: 600; }
`;
