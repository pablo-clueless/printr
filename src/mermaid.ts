import { readFile, writeFile, mkdir } from "node:fs/promises";
import type { Browser, Page } from "puppeteer";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Mermaid rendering for printr.
 *
 * Mermaid's npm package is ~80 MB unpacked because it ships every diagram
 * type's ESM chunks. We only need the pre-built browser IIFE, ~3.4 MB, and we
 * already have a headless Chrome instance in the process — so we fetch the
 * bundle once, cache it on disk, and inject it into pages that need diagrams.
 *
 * Three knobs control where the bundle comes from:
 *   - `PRINTR_MERMAID_PATH` -> use this file verbatim (offline install)
 *   - `--mermaid-version` / `getMermaidBundleOptions` -> which CDN version
 *   - otherwise: a default cache directory under the OS user-data dir
 *
 * The first run that actually needs Mermaid fetches the bundle. The fetch is
 * logged so it isn't a surprise.
 */

export interface MermaidBundleOptions {
  /** Mermaid major version, e.g. "11". */
  version?: string;
  /** Override the cache directory. */
  cacheDir?: string;
  /** Override the source URL (for testing or a private mirror). */
  url?: string;
}

const DEFAULT_VERSION = "11";
const CDN_BASE = "https://cdn.jsdelivr.net/npm/mermaid";

/** Where the cached bundle lives by default. XDG-style on Linux, AppData on Windows. */
function defaultCacheDir(): string {
  const home = process.env.HOME || process.env.USERPROFILE || tmpdir();
  if (process.platform === "win32") {
    const appData = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
    return path.join(appData, "printr", "cache");
  }
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Caches", "printr");
  }
  const xdg = process.env.XDG_CACHE_HOME || path.join(home, ".cache");
  return path.join(xdg, "printr");
}

function bundlePath(cacheDir: string, version: string): string {
  return path.join(cacheDir, `mermaid-${version}.min.js`);
}

/**
 * Keyed by resolved bundle path so a process that renders with two different
 * `--mermaid-version` values doesn't silently reuse the first one's bundle.
 */
const bundleCache = new Map<string, string>();

/**
 * Return the Mermaid IIFE source, fetching and caching it on first use. The
 * path is remembered so subsequent calls in the same run don't re-read disk.
 *
 * `PRINTR_MERMAID_PATH` is a hard offline override: if set, we never touch
 * the network and never write to the cache.
 */
export async function getMermaidScript(options: MermaidBundleOptions = {}): Promise<string> {
  const envPath = process.env.PRINTR_MERMAID_PATH;
  if (envPath) {
    const hit = bundleCache.get(envPath);
    if (hit) return hit;
    const source = await readFile(envPath, "utf8");
    bundleCache.set(envPath, source);
    return source;
  }

  const version = options.version ?? DEFAULT_VERSION;
  const cacheDir = options.cacheDir ?? defaultCacheDir();
  const file = bundlePath(cacheDir, version);

  const hit = bundleCache.get(file);
  if (hit) return hit;

  if (existsSync(file)) {
    const source = await readFile(file, "utf8");
    bundleCache.set(file, source);
    return source;
  }

  const url = options.url ?? `${CDN_BASE}@${version}/dist/mermaid.min.js`;
  console.error(`printr: fetching Mermaid ${version} (~3.4 MB) from ${cdnHost(url)} \u2026`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `could not download Mermaid (HTTP ${res.status} from ${cdnHost(url)}); ` +
        `set PRINTR_MERMAID_PATH to a local copy to work offline`,
    );
  }
  const source = await res.text();

  await mkdir(cacheDir, { recursive: true });
  // Write to a temp file in the same directory and rename, so a partial
  // download doesn't leave a half-written bundle in the cache.
  const tmp = path.join(cacheDir, `.mermaid-${process.pid}-${Date.now()}.tmp`);
  await writeFile(tmp, source);
  try {
    const { rename } = await import("node:fs/promises");
    await rename(tmp, file);
  } catch {
    // Some filesystems don't allow rename-over-existing; fall back.
    if (existsSync(file)) await writeFile(file, source);
    else throw new Error(`failed to write Mermaid bundle to ${file}`);
  }

  bundleCache.set(file, source);
  return source;
}

/** Strip the path off a URL for friendlier logging. */
function cdnHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

// ---------------------------------------------------------------------------
// Markdown pre-processing
// ---------------------------------------------------------------------------

export interface ExtractedMermaid {
  /** Markdown with ```mermaid blocks replaced by placeholder divs. */
  source: string;
  /** Each block, in source order, with the id used in the placeholder. */
  blocks: Array<{ id: string; code: string; line: number }>;
}

const FENCE_RE = /^(`{3,}|~{3,})([^\s]*)?[ \t]*\r?\n([\s\S]*?)\r?\n\1[ \t]*$/gm;

/**
 * Find ```mermaid fenced blocks and replace each with a `<div class="mermaid-placeholder"
 * data-id="m-N">` placeholder. `markdown-it` is configured with `html: true`,
 * so the divs pass through into the rendered body untouched; the placeholder
 * gives the in-page renderer something to find and the offline fallback
 * something to swap out for the source.
 *
 * The replacement preserves the original source verbatim inside the div so
 * the offline / error fallback already has something to display.
 */
export function extractMermaid(markdown: string): ExtractedMermaid {
  const blocks: ExtractedMermaid["blocks"] = [];
  const source = markdown.replace(
    FENCE_RE,
    (match, fence: string, lang: string | undefined, body: string, offset: number) => {
      if ((lang ?? "").trim().toLowerCase() !== "mermaid") return match;
      const id = `m-${blocks.length}`;
      const line = markdown.slice(0, offset).split(/\r?\n/).length;
      blocks.push({ id, code: body, line });
      return `<div class="mermaid-placeholder" data-id="${id}"><pre class="mermaid-source">${escapeHtml(body)}</pre></div>`;
    },
  );
  return { source, blocks };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ---------------------------------------------------------------------------
// In-page rendering
// ---------------------------------------------------------------------------

interface RenderResult {
  /** Map from placeholder id to rendered SVG, or undefined if it failed. */
  svgs: Map<string, string | undefined>;
  /** Per-block error messages, keyed by id. */
  errors: Map<string, string>;
}

/**
 * Inject Mermaid into the page, run it against every `.mermaid-placeholder`,
 * and return the rendered SVGs. Failed diagrams are recorded separately so
 * the caller can fall back to the original source without losing the
 * successes.
 *
 * The page must already have the document HTML loaded via `setContent`. We
 * reuse the same page for every diagram so we only pay the script-load cost
 * once per file.
 */
export async function renderMermaidInPage(
  page: Page,
  blocks: ExtractedMermaid["blocks"],
  options: MermaidBundleOptions = {},
): Promise<RenderResult> {
  const result: RenderResult = { svgs: new Map(), errors: new Map() };
  if (blocks.length === 0) return result;

  const script = await getMermaidScript(options);

  // Inject the IIFE as a real <script> so it runs in the page's global scope
  // and assigns `window.mermaid` the way Mermaid's build expects. Mermaid
  // starts rendering on load when it finds a `.mermaid` class; our
  // placeholders use `.mermaid-placeholder`, so startOnLoad is a no-op for
  // us regardless of how we initialize it.
  await page.evaluate((scriptText: string) => {
    const el = document.createElement("script");
    el.textContent = scriptText;
    document.head.appendChild(el);
  }, script);

  await page.evaluate(() => {
    const w = window as unknown as {
      mermaid?: {
        initialize: (cfg: unknown) => void;
        render: (id: string, code: string) => Promise<{ svg: string }>;
      };
    };
    if (!w.mermaid) throw new Error("Mermaid bundle did not load");
    w.mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "default",
      flowchart: { useMaxWidth: true, htmlLabels: true },
      fontFamily:
        '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif',
    });
  });

  for (const block of blocks) {
    try {
      const svg = await page.evaluate(
        async (id: string, code: string) => {
          const w = window as unknown as {
            mermaid: { render: (id: string, code: string) => Promise<{ svg: string }> };
          };
          const { svg } = await w.mermaid.render(id, code);
          return svg;
        },
        block.id,
        block.code,
      );
      result.svgs.set(block.id, svg);
    } catch (err) {
      result.errors.set(block.id, (err as Error).message);
    }
  }

  return result;
}

/**
 * Replace each `.mermaid-placeholder` in the page with either its rendered
 * SVG (as a real `<svg>` element) or — if rendering failed — a labelled
 * `<pre>` block holding the original source, with a console warning.
 *
 * For the PDF renderer this is the final form; for the .docx renderer we
 * rasterize each SVG to PNG and replace with an `<img>` instead.
 */
export async function applyRenderedMermaid(
  page: Page,
  blocks: ExtractedMermaid["blocks"],
  render: RenderResult,
  mode: "svg" | "png",
  browser: Browser,
): Promise<{ pngs: Map<string, string> }> {
  const pngs = new Map<string, string>();

  for (const block of blocks) {
    const svg = render.svgs.get(block.id);
    if (!svg) {
      const msg = render.errors.get(block.id) ?? "unknown error";
      console.error(
        `printr: mermaid block ${block.id} failed: ${msg} \u2014 falling back to source`,
      );
      await page.evaluate(
        (id: string, code: string, err: string) => {
          const div = document.querySelector(`.mermaid-placeholder[data-id="${id}"]`);
          if (!div) return;
          div.classList.remove("mermaid-placeholder");
          div.classList.add("mermaid-error");
          const label = document.createElement("div");
          label.className = "mermaid-error-label";
          label.textContent = `Mermaid error: ${err}`;
          const pre = document.createElement("pre");
          pre.className = "plain-text mermaid-source";
          pre.textContent = code;
          div.replaceChildren(label, pre);
        },
        block.id,
        block.code,
        msg,
      );
      continue;
    }

    if (mode === "svg") {
      await page.evaluate(
        (id: string, svgText: string) => {
          const div = document.querySelector(`.mermaid-placeholder[data-id="${id}"]`);
          if (!div) return;
          div.classList.remove("mermaid-placeholder");
          div.classList.add("mermaid-diagram");
          // Keep Mermaid's own <style> block: every fill, stroke and label
          // colour lives in it, and its selectors are all scoped to the
          // diagram's own id (`#m-0 .node rect { … }`), so it cannot reach
          // the rest of the document. Dropping it renders the diagram as
          // solid black shapes on a blank page.
          div.innerHTML = svgText;
          const svg = div.querySelector("svg");
          if (svg instanceof SVGSVGElement) {
            // Mermaid already sizes itself: `width="100%"` plus a viewBox to
            // give the aspect ratio, plus an inline `max-width` holding the
            // diagram's natural width. Preserve that and merely cap it to the
            // page — overwriting it with a flat 100% stretches a three-node
            // flowchart across the full text column.
            const natural = svg.style.maxWidth;
            svg.style.maxWidth = natural ? `min(100%, ${natural})` : "100%";
            svg.style.height = "auto";
            svg.style.display = "block";
            svg.style.margin = "0 auto";
            svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
          }
        },
        block.id,
        svg,
      );
    } else {
      // PNG mode: render the SVG into a fresh page, screenshot it, then
      // replace the placeholder with an <img> data URI. A dedicated page
      // keeps the document's other content out of the shot.
      const png = await rasterizeSvg(browser, svg);
      pngs.set(block.id, png.dataUri);
      await page.evaluate(
        (id: string, dataUri: string, width: number, height: number) => {
          const div = document.querySelector(`.mermaid-placeholder[data-id="${id}"]`);
          if (!div) return;
          div.classList.remove("mermaid-placeholder");
          div.classList.add("mermaid-diagram");
          const img = document.createElement("img");
          img.src = dataUri;
          img.alt = "Mermaid diagram";
          // The raster is deliberately oversized for print quality, so it must
          // carry explicit display dimensions — html-to-docx sizes an image
          // from its attributes, and without them Word lays the diagram out at
          // its full pixel width and runs it off the page.
          img.setAttribute("width", String(width));
          img.setAttribute("height", String(height));
          div.replaceChildren(img);
        },
        block.id,
        png.dataUri,
        png.width,
        png.height,
      );
    }
  }

  return { pngs };
}

/**
 * Render an SVG string to a PNG data URI by loading it in a small page and
 * screenshotting the root <svg>. The SVG is given an explicit width so the
 * screenshot is high-DPI; the docx path clamps the embedded image to the
 * printable width via inline styles.
 */
async function rasterizeSvg(
  browser: Browser,
  svg: string,
): Promise<{ dataUri: string; width: number; height: number }> {
  // Mermaid's <style> block carries every colour in the diagram, so unlike the
  // width/height attributes it must survive. What has to go is the inline
  // `max-width`, which would otherwise pin the diagram to its natural size and
  // defeat the point of rendering at a larger raster width.
  const cleaned = svg.replace(/<svg([^>]*)>/, (_m, attrs: string) => {
    const next = attrs
      .replace(/\swidth="[^"]*"/, "")
      .replace(/\sheight="[^"]*"/, "")
      .replace(/\sstyle="[^"]*"/, "");
    return `<svg${next} width="${RASTER_WIDTH}">`;
  });

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:#fff}svg{display:block}</style>
</head><body>${cleaned}</body></html>`;

  const page = await browser.newPage();
  try {
    await page.setViewport({ width: RASTER_WIDTH + 100, height: 1200, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: "load" });
    const handle = await page.$("svg");
    if (!handle) throw new Error("Mermaid SVG did not render");
    const box = await handle.boundingBox();
    const buf = await handle.screenshot({ omitBackground: false, type: "png" });

    // Scale the CSS-pixel size of the rendered SVG down to something that fits
    // the printable column, keeping the aspect ratio.
    const cssWidth = box?.width || RASTER_WIDTH;
    const cssHeight = box?.height || RASTER_WIDTH;
    const scale = Math.min(1, PRINT_WIDTH_PX / cssWidth);
    return {
      dataUri: `data:image/png;base64,${Buffer.from(buf).toString("base64")}`,
      width: Math.round(cssWidth * scale),
      height: Math.round(cssHeight * scale),
    };
  } finally {
    await page.close();
  }
}

/** Raster width for .docx diagrams: a 2x raster at roughly 6.5" of print width. */
const RASTER_WIDTH = 1600;

/** 6.5 inches of printable width at 96 CSS px/inch — A4/Letter minus 20mm margins. */
const PRINT_WIDTH_PX = 624;

// ---------------------------------------------------------------------------
// Highlighting the source for the fallback path
// ---------------------------------------------------------------------------

/**
 * Register a minimal highlight.js grammar for the `mermaid` language. The
 * grammar exists so that when rendering is disabled (--no-mermaid) or a
 * diagram fails, the source code is still styled consistently with other
 * code blocks rather than appearing as a wall of plain monospace text.
 */
export function registerMermaidHljs(hljs: import("highlight.js").HLJSApi): void {
  if (hljs.getLanguage("mermaid")) return;
  hljs.registerLanguage("mermaid", () => ({
    name: "Mermaid",
    keywords: {
      keyword:
        "graph flowchart sequenceDiagram classDiagram stateDiagram stateDiagram-v2 " +
        "gitGraph erDiagram journey gantt pie quadrantRequirement requirementDiagram " +
        "infoBlock C4Context C4Container C4Component C4Dynamic C4Deployment " +
        "TB TD BT RL LR subgraph end direction class note left right " +
        "title section participant actor loop alt else opt par and " +
        "critical option break rect autonumber activate deactivate " +
        "state fork join choice if switch case",
      literal: "true false null",
      built_in: "default theme style fill stroke width",
    },
    contains: [
      hljs.QUOTE_STRING_MODE,
      hljs.C_LINE_COMMENT_MODE,
      hljs.C_BLOCK_COMMENT_MODE,
      // Mermaid arrows: -->, ---, ==>, --, ->, etc.
      { className: "built_in", begin: /(?:-+|=+>|<-+|-\.)+>?/, relevance: 0 },
      { className: "number", begin: /\b\d+\b/, relevance: 0 },
    ],
  }));
}
