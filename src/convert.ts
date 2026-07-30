import { readFile } from "node:fs/promises";
import type { Browser } from "puppeteer";
import MarkdownIt from "markdown-it";
import hljs from "highlight.js";
import mammoth from "mammoth";
import path from "node:path";

import { githubMarkdownCss } from "./styles.js";
import {
  extractMermaid,
  renderMermaidInPage,
  applyRenderedMermaid,
  registerMermaidHljs,
  type MermaidBundleOptions,
  type ExtractedMermaid,
} from "./mermaid.js";

const MARKDOWN_EXTS = new Set([".md", ".markdown", ".mdown", ".mkd"]);

/** Standalone Mermaid source files, treated as a single diagram. */
const MERMAID_EXTS = new Set([".mmd", ".mermaid"]);

/** Word documents, read as binary and converted through mammoth. */
const DOCX_EXTS = new Set([".docx"]);

/** Extensions always rendered verbatim, never auto-highlighted as code. */
const PLAIN_TEXT_EXTS = new Set([".txt", ".text", ".log"]);

// Register a minimal Mermaid grammar so the source-fallback path (--no-mermaid
// or a parse error) still produces a syntax-highlighted code block.
registerMermaidHljs(hljs);

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
  /**
   * Skip Mermaid rendering. ```mermaid blocks then render as syntax-highlighted
   * source instead of being turned into diagrams. Useful when the renderer is
   * unavailable (no network, etc.) or to debug a document quickly.
   */
  noMermaid?: boolean;
  /** Where to fetch Mermaid from. See `MermaidBundleOptions`. */
  mermaid?: MermaidBundleOptions;
}

/** Result of extracting any Mermaid blocks from a source file. */
export interface BodyRender {
  /** HTML body to feed to the document shell. */
  body: string;
  /** Mermaid blocks discovered, in source order. Empty if the file has none. */
  mermaidBlocks: ExtractedMermaid["blocks"];
}

const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  highlight(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
      } catch {
        /* fall through to auto */
      }
    }
    return hljs.highlightAuto(code).value;
  },
});

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Exported so the .docx path can escape arbitrary text the same way.
export { escapeHtml as escapeHtmlText };

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

/** True when `filePath` is a Word document and must be read as binary. */
export function isDocx(filePath: string): boolean {
  return DOCX_EXTS.has(path.extname(filePath).toLowerCase());
}

const IMAGE_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
};

/**
 * Replace `<img>` sources that point at local files with data URIs, resolved
 * relative to the document. Neither renderer is given a base directory —
 * Chrome renders the HTML from a string and the .docx writer has no filesystem
 * context — so a relative path would otherwise silently fail to load.
 * Remote and data URIs, and sources that cannot be read, are left untouched.
 */
export async function inlineLocalImages(html: string, baseDir: string): Promise<string> {
  const sources = new Set<string>();
  for (const m of html.matchAll(/<img\b[^>]*?\ssrc="([^"]+)"/g)) {
    const src = m[1];
    if (/^(?:data:|https?:|file:)/i.test(src)) continue;
    sources.add(src);
  }
  if (sources.size === 0) return html;

  const replacements = new Map<string, string>();
  await Promise.all(
    [...sources].map(async (src) => {
      // Strip any query/fragment and undo URL escaping to get a real path.
      const cleaned = src.replace(/[?#].*$/, "");
      let relative = cleaned;
      try {
        relative = decodeURIComponent(cleaned);
      } catch {
        /* not percent-encoded; use as-is */
      }
      const mime = IMAGE_MIME[path.extname(relative).toLowerCase()];
      if (!mime) return;
      try {
        const data = await readFile(path.resolve(baseDir, relative));
        replacements.set(src, `data:${mime};base64,${data.toString("base64")}`);
      } catch {
        /* unreadable: leave the original source in place */
      }
    }),
  );

  if (replacements.size === 0) return html;
  return html.replace(
    /(<img\b[^>]*?\ssrc=")([^"]+)(")/g,
    (whole, before: string, src: string, after: string) => {
      const inlined = replacements.get(src);
      return inlined ? `${before}${inlined}${after}` : whole;
    },
  );
}

/**
 * Wrap rendered body HTML in the self-contained document shell shared by every
 * input type, so Markdown, source files and Word documents all print alike.
 * Exported so the .docx path can render Mermaid diagrams in the same shell
 * before handing the body to html-to-docx.
 */
export function htmlDocument(bodyHtml: string, title: string, options: RenderOptions): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>${githubMarkdownCss}
.plain-text { background: transparent; padding: 0; font-size: 0.9em; }
.code-file::before { content: attr(data-filename); display: block; font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace; font-size: 0.85em; color: #57606a; margin-bottom: 0.4em; }
.code-file pre { margin-top: 0; }
.doc-title { font-size: 2.1em; border-bottom: none; margin-bottom: 0.2em; }
.doc-subtitle { color: var(--muted); font-size: 1.15em; margin-top: 0; }
/* Word wraps every table cell's text in a paragraph; drop the trailing gap. */
td > p:last-child, th > p:last-child { margin-bottom: 0; }
${options.extraCss ?? ""}</style>
</head>
<body><article class="markdown-body">${bodyHtml}</article></body>
</html>`;
}

/**
 * Render a source file's contents to the body HTML — Markdown, highlighted
 * code or verbatim text. Shared by the PDF and .docx writers so both apply the
 * same rules for deciding how a file should be presented.
 *
 * Returns the body HTML together with any Mermaid blocks discovered during
 * rendering, so the caller can drive an in-page Mermaid pass before the
 * document is finalised. Mermaid is a two-stage render: the source blocks
 * are replaced with placeholder divs here, then a real Chrome page turns
 * them into diagrams.
 */
export function buildBodyHtml(
  rawSource: string,
  filePath: string,
  options: RenderOptions = {},
): BodyRender {
  // Editors on Windows readily write a UTF-8 BOM. Left in place it stops the
  // first line from parsing — a leading "# Title" is no longer a heading, and
  // Mermaid rejects the diagram keyword outright — so drop it up front.
  const source = rawSource.charCodeAt(0) === 0xfeff ? rawSource.slice(1) : rawSource;
  const ext = path.extname(filePath).toLowerCase();
  const isMarkdown = MARKDOWN_EXTS.has(ext);
  const isMermaid = MERMAID_EXTS.has(ext);

  // A forced language (--lang) overrides extension detection.
  const lang = options.lang ?? CODE_LANGS[ext];

  if (isMermaid) {
    // A standalone .mmd file is one big Mermaid block. The title comes from
    // the filename, the diagram is centered on the page.
    if (options.noMermaid) {
      const highlighted = hljs.highlight(source, {
        language: "mermaid",
        ignoreIllegals: true,
      }).value;
      return {
        body: codeFileHtml(filePath, "mermaid", highlighted),
        mermaidBlocks: [],
      };
    }
    const id = "m-0";
    return {
      body: `<div class="mermaid-placeholder" data-id="${id}"><pre class="mermaid-source">${escapeHtml(source)}</pre></div>`,
      mermaidBlocks: [{ id, code: source, line: 1 }],
    };
  }

  if (isMarkdown) {
    const { source: prepared, blocks } = options.noMermaid
      ? { source, blocks: [] }
      : extractMermaid(source);
    return { body: md.render(prepared), mermaidBlocks: blocks };
  }
  if (lang && hljs.getLanguage(lang)) {
    // Source code with a known/forced language: highlight as that language.
    const highlighted = hljs.highlight(source, {
      language: lang,
      ignoreIllegals: true,
    }).value;
    return { body: codeFileHtml(filePath, lang, highlighted), mermaidBlocks: [] };
  }
  if (!lang && !PLAIN_TEXT_EXTS.has(ext)) {
    // Unknown extension: let highlight.js guess the language from the content.
    const auto = hljs.highlightAuto(source);
    return {
      body: codeFileHtml(filePath, auto.language ?? "", auto.value),
      mermaidBlocks: [],
    };
  }
  // Plain text: preserve it verbatim inside a code block.
  return { body: `<pre class="plain-text">${escapeHtml(source)}</pre>`, mermaidBlocks: [] };
}

/** Build the full self-contained HTML document for a source file. */
export function buildHtml(
  source: string,
  filePath: string,
  options: RenderOptions = {},
): { html: string; mermaidBlocks: ExtractedMermaid["blocks"] } {
  const title = options.title ?? path.basename(filePath);
  const { body, mermaidBlocks } = buildBodyHtml(source, filePath, options);
  return { html: htmlDocument(body, title, options), mermaidBlocks };
}

/**
 * Word paragraph styles that mammoth's default map leaves as plain paragraphs.
 * These are additive: the default map (headings, lists, bold, italic, tables,
 * hyperlinks, footnotes) still applies underneath.
 */
const DOCX_STYLE_MAP = [
  "p[style-name='Title'] => h1.doc-title:fresh",
  "p[style-name='Subtitle'] => p.doc-subtitle:fresh",
  "p[style-name='Quote'] => blockquote:fresh",
  "p[style-name='Intense Quote'] => blockquote:fresh",
  "r[style-name='Code Char'] => code",
  // Localized Word installs give the built-in styles translated display
  // names but keep these style ids, so match on id as well.
  "p[style-id='Title'] => h1.doc-title:fresh",
  "p[style-id='Subtitle'] => p.doc-subtitle:fresh",
  "p[style-id='Quote'] => blockquote:fresh",
  "p[style-id='IntenseQuote'] => blockquote:fresh",
  // Mammoth drops underlines by default because Word documents often use them
  // for headings; printing a document as-is is better served by keeping them.
  "u => u",
];

/**
 * Build the HTML document for a Word file. Mammoth maps Word's styles onto
 * semantic HTML — which the Markdown stylesheet already covers — rather than
 * trying to reproduce Word's own layout. Embedded images come back as data
 * URIs, keeping the document self-contained.
 */
export async function buildDocxHtml(
  filePath: string,
  options: RenderOptions = {},
): Promise<string> {
  const buffer = await readFile(filePath);
  let bodyHtml: string;
  try {
    const result = await mammoth.convertToHtml({ buffer }, { styleMap: DOCX_STYLE_MAP });
    bodyHtml = result.value;
  } catch (err) {
    // Usually a corrupt file, or one that is not really a .docx despite the
    // extension — a renamed .doc or PDF, say.
    throw new Error(
      `could not read ${path.basename(filePath)} as a Word document: ` +
        `${(err as Error).message}`,
    );
  }
  return htmlDocument(bodyHtml, options.title ?? path.basename(filePath), options);
}

/**
 * Render a single source file to a PDF buffer using an already-launched
 * browser. Reusing the browser across files keeps batch conversion fast.
 */
export async function renderFileToPdf(
  browser: Browser,
  filePath: string,
  options: RenderOptions = {},
): Promise<Uint8Array> {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".doc") {
    // Reading this as text would silently produce a PDF full of binary noise.
    throw new Error(
      "legacy .doc files are not supported — open the file in Word or " +
        "LibreOffice and re-save it as .docx",
    );
  }

  const { html, mermaidBlocks } = isDocx(filePath)
    ? { html: await buildDocxHtml(filePath, options), mermaidBlocks: [] }
    : await (async () => {
        const built = buildHtml(await readFile(filePath, "utf8"), filePath, options);
        const inlined = await inlineLocalImages(built.html, path.dirname(filePath));
        return { html: inlined, mermaidBlocks: built.mermaidBlocks };
      })();

  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "load" });
    if (mermaidBlocks.length > 0) {
      const render = await renderMermaidInPage(page, mermaidBlocks, options.mermaid);
      await applyRenderedMermaid(page, mermaidBlocks, render, "svg", browser);
    }
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
