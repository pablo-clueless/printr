import { readFile } from "node:fs/promises";
import HTMLtoDOCX from "@turbodocx/html-to-docx";
import path from "node:path";

import { buildBodyHtml, inlineLocalImages, type RenderOptions } from "./convert.js";
import { githubMarkdownCss } from "./styles.js";

/**
 * Word has no notion of our stylesheet, so code is styled run-by-run with
 * inline attributes instead. This is the font those runs get.
 */
const MONO_FONT = "Consolas";
const CODE_BG = "#f6f8fa";

/** Page sizes in twips (1/1440 inch), keyed by the `--format` value. */
const PAGE_SIZES: Record<string, { width: number; height: number }> = {
  a3: { width: 16838, height: 23811 },
  a4: { width: 11906, height: 16838 },
  a5: { width: 8391, height: 11906 },
  legal: { width: 12240, height: 20160 },
  letter: { width: 12240, height: 15840 },
  tabloid: { width: 15840, height: 24480 },
};

/** Conversion factors to twips for the CSS units Chrome's PDF writer accepts. */
const UNIT_TWIPS: Record<string, number> = {
  in: 1440,
  cm: 566.929,
  mm: 56.6929,
  pt: 20,
  px: 15, // 96 CSS px per inch
};

/** Parse a CSS length like "20mm" into twips, or undefined if unparseable. */
function toTwips(size: string): number | undefined {
  const m = /^\s*([\d.]+)\s*(in|cm|mm|pt|px)?\s*$/i.exec(size);
  if (!m) return undefined;
  const value = Number(m[1]);
  if (!Number.isFinite(value)) return undefined;
  const unit = (m[2] ?? "px").toLowerCase();
  return Math.round(value * UNIT_TWIPS[unit]);
}

interface TokenStyle {
  color?: string;
  fontStyle?: string;
  fontWeight?: string;
}

/**
 * Derive the highlight.js token colors from the stylesheet rather than
 * duplicating them, so the .docx and the PDF stay in step when the theme
 * changes. Rules are read in source order and merged per property, which is
 * how the cascade would resolve them for a span carrying a single token class.
 */
function parseHljsTheme(css: string): Map<string, TokenStyle> {
  const theme = new Map<string, TokenStyle>();
  for (const rule of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const selectors = rule[1];
    const body = rule[2];
    if (!selectors.includes(".hljs-")) continue;

    const declared: TokenStyle = {};
    const color = /(?:^|[;\s])color\s*:\s*([^;]+)/.exec(body);
    if (color) declared.color = color[1].trim();
    const style = /font-style\s*:\s*([^;]+)/.exec(body);
    if (style) declared.fontStyle = style[1].trim();
    const weight = /font-weight\s*:\s*([^;]+)/.exec(body);
    if (weight) declared.fontWeight = weight[1].trim();
    if (!declared.color && !declared.fontStyle && !declared.fontWeight) continue;

    for (const selector of selectors.split(",")) {
      // For compound or descendant selectors the rightmost token class is the
      // one the span actually carries (".hljs-title.class_", ".hljs-tag .hljs-attr").
      const classes = [...selector.matchAll(/\.(hljs-[\w-]+)/g)].map((m) => m[1]);
      const key = classes.at(-1);
      if (!key) continue;
      theme.set(key, { ...theme.get(key), ...declared });
    }
  }
  return theme;
}

const HLJS_THEME = parseHljsTheme(githubMarkdownCss);

function tokenCss(className: string): string {
  // A span may carry several classes; merge them left to right.
  let style: TokenStyle = {};
  for (const name of className.split(/\s+/)) {
    const found = HLJS_THEME.get(name);
    if (found) style = { ...style, ...found };
  }
  const parts = [`font-family:${MONO_FONT}`];
  if (style.color) parts.push(`color:${style.color}`);
  if (style.fontStyle) parts.push(`font-style:${style.fontStyle}`);
  if (style.fontWeight) parts.push(`font-weight:${style.fontWeight}`);
  return parts.join(";");
}

/**
 * Rewrite one code block's inner HTML for Word: highlight.js class names become
 * inline styles (class-based CSS is ignored by the converter), and newlines
 * become <br/> because a literal newline inside a Word text run is not a line
 * break — without this the whole block collapses onto one line.
 */
function inlineCodeBlock(inner: string): string {
  return (
    inner
      .replace(/<span class="([^"]*)">/g, (_m, cls: string) => `<span style="${tokenCss(cls)}">`)
      // Any remaining unclassed span still needs the monospace font, since the
      // font on the <pre> does not reach into child elements.
      .replace(/<span>/g, `<span style="font-family:${MONO_FONT}">`)
      .replace(/\r?\n/g, "<br/>")
  );
}

/**
 * Prepare body HTML for the converter: strip the parts Word cannot use and
 * inline everything the stylesheet would otherwise have provided.
 */
export function inlineStylesForDocx(bodyHtml: string): string {
  return (
    bodyHtml
      // The <code> wrapper adds nothing once its runs are styled, and its
      // class-based background would be dropped anyway.
      .replace(
        /<pre[^>]*>(?:\s*<code[^>]*>)?([\s\S]*?)(?:<\/code>\s*)?<\/pre>/g,
        (_m, inner: string) =>
          `<pre style="font-family:${MONO_FONT};background-color:${CODE_BG}">` +
          `${inlineCodeBlock(inner)}</pre>`,
      )
      // Inline `code` spans inside prose.
      .replace(/<code>/g, `<code style="font-family:${MONO_FONT}">`)
      // The filename label lives in a ::before rule the converter cannot see,
      // so emit it as real text instead.
      .replace(
        /<div class="code-file" data-filename="([^"]*)">/g,
        (_m, name: string) => `<div><p style="font-family:${MONO_FONT};color:#57606a">${name}</p>`,
      )
  );
}

/** Options accepted when writing a .docx, mirroring the PDF renderer's. */
export interface DocxOptions extends RenderOptions {
  /** Paper format, e.g. "A4" or "Letter". */
  format?: string;
  /** Page margin applied on all sides, e.g. "20mm". */
  margin?: string;
}

/** Convert a Markdown, source-code or plain-text file into a .docx buffer. */
export async function renderFileToDocx(
  filePath: string,
  options: DocxOptions = {},
): Promise<Buffer> {
  const source = await readFile(filePath, "utf8");
  const title = options.title ?? path.basename(filePath);
  const body = await inlineLocalImages(
    inlineStylesForDocx(buildBodyHtml(source, filePath, options)),
    path.dirname(filePath),
  );

  const margin = toTwips(options.margin ?? "20mm") ?? 1440;
  const pageSize = PAGE_SIZES[(options.format ?? "A4").toLowerCase()];

  const result = await HTMLtoDOCX(body, null, {
    title,
    pageSize,
    margins: { top: margin, right: margin, bottom: margin, left: margin },
    table: { row: { cantSplit: true } },
    footer: false,
    header: false,
  });

  // The converter's return type covers browser builds too; on Node it is
  // always a Buffer or ArrayBuffer.
  return Buffer.isBuffer(result) ? result : Buffer.from(result as ArrayBuffer);
}
