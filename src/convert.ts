import { readFile } from "node:fs/promises";
import type { Browser } from "puppeteer";
import MarkdownIt from "markdown-it";
import hljs from "highlight.js";
import path from "node:path";

import { githubMarkdownCss } from "./styles.js";

const MARKDOWN_EXTS = new Set([".md", ".markdown", ".mdown", ".mkd"]);

export interface RenderOptions {
  /** Paper format passed through to Chrome, e.g. "A4" or "Letter". */
  format?: string;
  /** Page margin applied on all sides, e.g. "1in" or "20mm". */
  margin?: string;
  /** Override the document title (defaults to the source filename). */
  title?: string;
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

/** Build the full self-contained HTML document for a source file. */
export function buildHtml(
  source: string,
  filePath: string,
  options: RenderOptions = {}
): string {
  const ext = path.extname(filePath).toLowerCase();
  const isMarkdown = MARKDOWN_EXTS.has(ext);
  const title = options.title ?? path.basename(filePath);

  const bodyHtml = isMarkdown
    ? md.render(source)
    : // Plain text: preserve it verbatim inside a code block.
      `<pre class="plain-text">${escapeHtml(source)}</pre>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>${githubMarkdownCss}
.plain-text { background: transparent; padding: 0; font-size: 0.9em; }
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
