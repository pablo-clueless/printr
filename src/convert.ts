import { readFile } from "node:fs/promises";
import type { Browser } from "puppeteer";
import MarkdownIt from "markdown-it";
import hljs from "highlight.js";
import path from "node:path";

import { githubMarkdownCss } from "./styles.js";

const MARKDOWN_EXTS = new Set([".md", ".markdown", ".mdown", ".mkd"]);

/** Extensions always rendered verbatim, never auto-highlighted as code. */
const PLAIN_TEXT_EXTS = new Set([".txt", ".text", ".log"]);

/**
 * Source-code extensions mapped to the highlight.js language they should be
 * highlighted as. Anything not listed here falls back to verbatim plain text.
 */
const CODE_LANGS: Record<string, string> = {
  ".js": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".jsx": "javascript",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".rs": "rust",
  ".c": "c",
  ".h": "c",
  ".py": "python",
  ".go": "go",
};

export interface RenderOptions {
  /** Paper format passed through to Chrome, e.g. "A4" or "Letter". */
  format?: string;
  /** Page margin applied on all sides, e.g. "1in" or "20mm". */
  margin?: string;
  /** Override the document title (defaults to the source filename). */
  title?: string;
  /**
   * Force the highlight.js language for source files, overriding extension
   * detection (e.g. "python"). Use for files with an unrecognized extension.
   */
  lang?: string;
  /** Extra CSS appended after the built-in stylesheet. */
  extraCss?: string;
}

const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  highlight(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(code, { language: lang, ignoreIllegals: true })
          .value;
      } catch {
        /* fall through to auto */
      }
    }
    return hljs.highlightAuto(code).value;
  },
});

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Wrap already-highlighted code in a labelled block. `lang` may be empty when
 * auto-detection could not identify a language; the block is still labelled
 * with the filename.
 */
function codeFileHtml(filePath: string, lang: string, highlighted: string): string {
  const langClass = lang ? ` language-${escapeHtml(lang)}` : "";
  return (
    `<div class="code-file" data-filename="${escapeHtml(path.basename(filePath))}">` +
    `<pre><code class="hljs${langClass}">${highlighted}</code></pre>` +
    `</div>`
  );
}

/** Build the full self-contained HTML document for a source file. */
export function buildHtml(
  source: string,
  filePath: string,
  options: RenderOptions = {}
): string {
  const ext = path.extname(filePath).toLowerCase();
  const isMarkdown = MARKDOWN_EXTS.has(ext);
  const title = options.title ?? path.basename(filePath);

  // A forced language (--lang) overrides extension detection.
  const lang = options.lang ?? CODE_LANGS[ext];

  let bodyHtml: string;
  if (isMarkdown) {
    bodyHtml = md.render(source);
  } else if (lang && hljs.getLanguage(lang)) {
    // Source code with a known/forced language: highlight as that language.
    const highlighted = hljs.highlight(source, {
      language: lang,
      ignoreIllegals: true,
    }).value;
    bodyHtml = codeFileHtml(filePath, lang, highlighted);
  } else if (!lang && !PLAIN_TEXT_EXTS.has(ext)) {
    // Unknown extension: let highlight.js guess the language from the content.
    const auto = hljs.highlightAuto(source);
    bodyHtml = codeFileHtml(filePath, auto.language ?? "", auto.value);
  } else {
    // Plain text: preserve it verbatim inside a code block.
    bodyHtml = `<pre class="plain-text">${escapeHtml(source)}</pre>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>${githubMarkdownCss}
.plain-text { background: transparent; padding: 0; font-size: 0.9em; }
.code-file::before { content: attr(data-filename); display: block; font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace; font-size: 0.85em; color: #57606a; margin-bottom: 0.4em; }
.code-file pre { margin-top: 0; }
${options.extraCss ?? ""}</style>
</head>
<body><article class="markdown-body">${bodyHtml}</article></body>
</html>`;
}

/**
 * Render a single source file to a PDF buffer using an already-launched
 * browser. Reusing the browser across files keeps batch conversion fast.
 */
export async function renderFileToPdf(
  browser: Browser,
  filePath: string,
  options: RenderOptions = {}
): Promise<Uint8Array> {
  const source = await readFile(filePath, "utf8");
  const html = buildHtml(source, filePath, options);

  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "load" });
    const margin = options.margin ?? "20mm";
    return await page.pdf({
      format: (options.format ?? "A4") as never,
      printBackground: true,
      margin: { top: margin, bottom: margin, left: margin, right: margin },
    });
  } finally {
    await page.close();
  }
}
