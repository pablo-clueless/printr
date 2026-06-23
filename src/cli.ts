#!/usr/bin/env node
import { renderFileToPdf, type RenderOptions } from "./convert.js";
import { writeFile, mkdir, stat } from "node:fs/promises";
import puppeteer, { type Browser } from "puppeteer";
import { watch, type FSWatcher } from "node:fs";
import { Command } from "commander";
import path from "node:path";
import { glob } from "glob";

interface CliOptions {
  output?: string;
  outDir?: string;
  format: string;
  margin: string;
  title?: string;
  lang?: string;
  watch?: boolean;
}

const program = new Command();

program
  .name("printr")
  .description("Print Markdown and text files as nicely styled PDFs.")
  .argument("<inputs...>", "files or globs to convert (.md, .txt, .js, .ts, .rs, .c, .py, .go, …)")
  .option("-o, --output <file>", "output PDF path (single input only)")
  .option("-d, --out-dir <dir>", "directory for output PDFs (defaults beside each source)")
  .option("-f, --format <format>", "paper format: A4, Letter, Legal, …", "A4")
  .option("-m, --margin <size>", "page margin on all sides, e.g. 20mm or 1in", "20mm")
  .option("-t, --title <title>", "document title (single input only)")
  .option("-l, --lang <lang>", "force syntax-highlight language for source files, e.g. python, rust")
  .option("-w, --watch", "watch inputs and re-render on change (Ctrl+C to stop)")
  .showHelpAfterError()
  .action(async (inputs: string[], opts: CliOptions) => {
    try {
      await run(inputs, opts);
    } catch (err) {
      console.error(`printr: ${(err as Error).message}`);
      process.exitCode = 1;
    }
  });

async function resolveInputs(inputs: string[]): Promise<string[]> {
  const resolved = new Set<string>();
  for (const input of inputs) {
    // A literal existing path should be used as-is (handles names with glob chars).
    const isFile = await stat(input).then((s) => s.isFile()).catch(() => false);
    if (isFile) {
      resolved.add(path.resolve(input));
      continue;
    }
    const matches = await glob(input, { nodir: true, windowsPathsNoEscape: true });
    for (const m of matches) resolved.add(path.resolve(m));
  }
  return [...resolved].sort();
}

function outputPathFor(file: string, opts: CliOptions): string {
  if (opts.output) return path.resolve(opts.output);
  const base = path.basename(file, path.extname(file)) + ".pdf";
  const dir = opts.outDir ? path.resolve(opts.outDir) : path.dirname(file);
  return path.join(dir, base);
}

/** Render a single source file and write its PDF, logging the result. */
async function renderOne(
  browser: Browser,
  file: string,
  opts: CliOptions,
  renderOpts: RenderOptions
): Promise<void> {
  const out = outputPathFor(file, opts);
  await mkdir(path.dirname(out), { recursive: true });
  const pdf = await renderFileToPdf(browser, file, renderOpts);
  await writeFile(out, pdf);
  console.log(`${path.relative(process.cwd(), file)} → ${path.relative(process.cwd(), out)}`);
}

/**
 * For a single input pattern, determine which directory to watch and whether
 * it must be watched recursively. The watch root is the leading portion of the
 * pattern before the first segment containing glob magic.
 */
function watchRootFor(input: string): { dir: string; recursive: boolean } {
  const recursive = input.includes("**");
  const parts = input.split(/[\\/]/);
  const base: string[] = [];
  for (const part of parts) {
    if (/[*?[\]{}!()+@]/.test(part)) break;
    base.push(part);
  }
  const basePath = base.length ? base.join(path.sep) : ".";
  return { dir: path.resolve(basePath), recursive };
}

async function run(inputs: string[], opts: CliOptions): Promise<void> {
  const files = await resolveInputs(inputs);
  if (files.length === 0) {
    throw new Error("no matching files found");
  }
  if (opts.output && files.length > 1) {
    throw new Error("--output can only be used with a single input file");
  }
  if (opts.title && files.length > 1) {
    throw new Error("--title can only be used with a single input file");
  }

  const renderOpts: RenderOptions = {
    format: opts.format,
    margin: opts.margin,
    title: opts.title,
    lang: opts.lang,
  };

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  // Initial render of everything that currently matches.
  for (const file of files) {
    await renderOne(browser, file, opts, renderOpts);
  }
  console.log(`Done. Converted ${files.length} file${files.length === 1 ? "" : "s"}.`);

  if (!opts.watch) {
    await browser.close();
    return;
  }

  await startWatch(browser, inputs, opts, renderOpts);
}

/**
 * Watch the directories backing each input pattern and re-render a file
 * whenever it changes. Re-resolving the patterns on each event means newly
 * created files that match a glob are picked up too. The browser is kept open
 * for the lifetime of the watch.
 */
async function startWatch(
  browser: Browser,
  inputs: string[],
  opts: CliOptions,
  renderOpts: RenderOptions
): Promise<void> {
  // Deduplicate watch roots; a recursive root supersedes a non-recursive one
  // for the same directory.
  const roots = new Map<string, boolean>();
  for (const input of inputs) {
    const isFile = await stat(input).then((s) => s.isFile()).catch(() => false);
    const { dir, recursive } = isFile
      ? { dir: path.dirname(path.resolve(input)), recursive: false }
      : watchRootFor(input);
    roots.set(dir, (roots.get(dir) ?? false) || recursive);
  }

  const watchers: FSWatcher[] = [];
  const debounce = new Map<string, NodeJS.Timeout>();
  let rendering = Promise.resolve();

  const handleChange = (root: string, filename: string | null) => {
    if (!filename) return;
    const full = path.resolve(root, filename);
    const prev = debounce.get(full);
    if (prev) clearTimeout(prev);
    debounce.set(
      full,
      setTimeout(() => {
        debounce.delete(full);
        // Serialize renders so concurrent saves don't open many pages at once.
        rendering = rendering.then(async () => {
          const matched = await resolveInputs(inputs);
          if (!matched.includes(full)) return; // not one of our inputs
          const exists = await stat(full).then((s) => s.isFile()).catch(() => false);
          if (!exists) return; // file was deleted mid-edit
          try {
            await renderOne(browser, full, opts, renderOpts);
          } catch (err) {
            console.error(`printr: failed to render ${filename}: ${(err as Error).message}`);
          }
        });
      }, 120)
    );
  };

  for (const [dir, recursive] of roots) {
    try {
      const w = watch(dir, { recursive }, (_event, filename) =>
        handleChange(dir, filename)
      );
      watchers.push(w);
      console.log(`Watching ${path.relative(process.cwd(), dir) || "."}${recursive ? " (recursive)" : ""} …`);
    } catch (err) {
      console.error(`printr: cannot watch ${dir}: ${(err as Error).message}`);
    }
  }
  console.log("Press Ctrl+C to stop.");

  // Keep the process alive until interrupted, then clean up.
  await new Promise<void>((resolve) => {
    const shutdown = () => {
      for (const w of watchers) w.close();
      browser.close().finally(() => resolve());
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
  console.log("\nStopped.");
}

program.parseAsync();
