#!/usr/bin/env node
import { renderFileToPdf, isDocx, type RenderOptions } from "./convert.js";
import { writeFile, mkdir, stat } from "node:fs/promises";
import puppeteer, { type Browser } from "puppeteer";
import { renderFileToDocx } from "./docx.js";
import { watch, type FSWatcher } from "node:fs";
import { Command } from "commander";
import path from "node:path";
import { glob } from "glob";

type Target = "pdf" | "docx";

interface CliOptions {
  output?: string;
  outDir?: string;
  format: string;
  margin: string;
  title?: string;
  lang?: string;
  to?: string;
  watch?: boolean;
  /** Commander stores `--no-mermaid` as `mermaid: false`; it is otherwise unset. */
  mermaid?: boolean;
  mermaidVersion?: string;
}

const program = new Command();

program
  .name("printr")
  .description("Print Markdown, Word and text files as nicely styled PDFs or Word documents.")
  .argument(
    "<inputs...>",
    "files or globs to convert (.md, .mmd, .docx, .txt, .js, .ts, .rs, .c, .py, .go, …)",
  )
  .option("-o, --output <file>", "output PDF path (single input only)")
  .option("-d, --out-dir <dir>", "directory for output PDFs (defaults beside each source)")
  .option("-f, --format <format>", "paper format: A4, Letter, Legal, …", "A4")
  .option("-m, --margin <size>", "page margin on all sides, e.g. 20mm or 1in", "20mm")
  .option("-t, --title <title>", "document title (single input only)")
  .option("--to <format>", "output format: pdf or docx (default: pdf, or inferred from --output)")
  .option(
    "-l, --lang <lang>",
    "force syntax-highlight language for source files, e.g. python, rust",
  )
  .option("--no-mermaid", "skip Mermaid rendering; ```mermaid blocks print as source")
  .option(
    "--mermaid-version <ver>",
    "Mermaid major version to fetch (default: 11); cached under the OS user-cache dir",
  )
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
    const isFile = await stat(input)
      .then((s) => s.isFile())
      .catch(() => false);
    if (isFile) {
      resolved.add(path.resolve(input));
      continue;
    }
    const matches = await glob(input, { nodir: true, windowsPathsNoEscape: true });
    for (const m of matches) resolved.add(path.resolve(m));
  }
  return [...resolved].sort();
}

/**
 * Decide what to write. An explicit `--to` wins; otherwise the extension of
 * `--output` decides, so `-o notes.docx` does the obvious thing.
 */
function resolveTarget(opts: CliOptions): Target {
  const fromOutput = opts.output ? path.extname(opts.output).toLowerCase() : undefined;
  const explicit = opts.to?.toLowerCase();

  if (explicit && explicit !== "pdf" && explicit !== "docx") {
    throw new Error(`unknown output format "${opts.to}" — expected pdf or docx`);
  }
  // Commander supplies the "pdf" default, so only a mismatch with a non-.pdf
  // --output is worth reporting as a conflict.
  if (explicit && fromOutput && fromOutput !== `.${explicit}`) {
    throw new Error(`--to ${explicit} conflicts with the output file "${opts.output}"`);
  }
  if (fromOutput === ".docx") return "docx";
  return explicit === "docx" ? "docx" : "pdf";
}

function outputPathFor(file: string, opts: CliOptions, target: Target): string {
  if (opts.output) return path.resolve(opts.output);
  const base = path.basename(file, path.extname(file)) + `.${target}`;
  const dir = opts.outDir ? path.resolve(opts.outDir) : path.dirname(file);
  return path.join(dir, base);
}

/**
 * Render a single source file and write its output, logging the result.
 * `getBrowser` is called only when a PDF is actually produced, so a run that
 * writes nothing but .docx never starts Chrome.
 */
async function renderOne(
  getBrowser: () => Promise<Browser>,
  file: string,
  opts: CliOptions,
  renderOpts: RenderOptions,
  target: Target,
): Promise<void> {
  const out = outputPathFor(file, opts, target);
  await mkdir(path.dirname(out), { recursive: true });

  let data: Uint8Array;
  if (target === "docx") {
    if (isDocx(file)) {
      throw new Error(`${path.basename(file)} is already a Word document`);
    }
    // Hand over the launcher rather than a browser: the .docx writer only
    // calls it when the file actually contains Mermaid, so converting plain
    // documents to Word still never starts Chrome.
    data = await renderFileToDocx(file, renderOpts, getBrowser);
  } else {
    data = await renderFileToPdf(await getBrowser(), file, renderOpts);
  }

  await writeFile(out, data);
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

  const target = resolveTarget(opts);

  // Inputs differing only by extension (report.md and report.docx) map to the
  // same output name; catch that before one silently overwrites the other.
  const byOutput = new Map<string, string[]>();
  for (const file of files) {
    const out = outputPathFor(file, opts, target);
    const group = byOutput.get(out);
    if (group) group.push(file);
    else byOutput.set(out, [file]);
  }
  for (const [out, group] of byOutput) {
    if (group.length > 1) {
      throw new Error(
        `${group.map((f) => path.basename(f)).join(" and ")} would both be ` +
          `written to ${path.relative(process.cwd(), out)}; convert them ` +
          `separately or use --out-dir to keep them apart`,
      );
    }
  }

  const renderOpts: RenderOptions = {
    format: opts.format,
    margin: opts.margin,
    title: opts.title,
    lang: opts.lang,
    noMermaid: opts.mermaid === false,
    mermaid: opts.mermaidVersion ? { version: opts.mermaidVersion } : undefined,
  };

  // Chrome is only needed for PDF output, and launching it costs a second or
  // more, so start it on first use and reuse it across files.
  let browser: Browser | undefined;
  const getBrowser = async (): Promise<Browser> => {
    browser ??= await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    return browser;
  };

  // Always close the browser, including when a file fails to render —
  // otherwise the Chrome process keeps the CLI alive after the error.
  try {
    // Initial render of everything that currently matches.
    for (const file of files) {
      await renderOne(getBrowser, file, opts, renderOpts, target);
    }
    console.log(`Done. Converted ${files.length} file${files.length === 1 ? "" : "s"}.`);

    if (opts.watch) {
      await startWatch(getBrowser, inputs, opts, renderOpts, target);
    }
  } finally {
    await browser?.close();
  }
}

/**
 * Watch the directories backing each input pattern and re-render a file
 * whenever it changes. Re-resolving the patterns on each event means newly
 * created files that match a glob are picked up too. The browser is kept open
 * for the lifetime of the watch.
 */
async function startWatch(
  getBrowser: () => Promise<Browser>,
  inputs: string[],
  opts: CliOptions,
  renderOpts: RenderOptions,
  target: Target,
): Promise<void> {
  // Deduplicate watch roots; a recursive root supersedes a non-recursive one
  // for the same directory.
  const roots = new Map<string, boolean>();
  for (const input of inputs) {
    const isFile = await stat(input)
      .then((s) => s.isFile())
      .catch(() => false);
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
          const exists = await stat(full)
            .then((s) => s.isFile())
            .catch(() => false);
          if (!exists) return; // file was deleted mid-edit
          try {
            await renderOne(getBrowser, full, opts, renderOpts, target);
          } catch (err) {
            console.error(`printr: failed to render ${filename}: ${(err as Error).message}`);
          }
        });
      }, 120),
    );
  };

  for (const [dir, recursive] of roots) {
    try {
      const w = watch(dir, { recursive }, (_event, filename) => handleChange(dir, filename));
      watchers.push(w);
      console.log(
        `Watching ${path.relative(process.cwd(), dir) || "."}${recursive ? " (recursive)" : ""} …`,
      );
    } catch (err) {
      console.error(`printr: cannot watch ${dir}: ${(err as Error).message}`);
    }
  }
  console.log("Press Ctrl+C to stop.");

  // Keep the process alive until interrupted. Closing the browser is left to
  // the caller, which owns it and closes it on every exit path.
  await new Promise<void>((resolve) => {
    const shutdown = () => {
      for (const w of watchers) w.close();
      resolve();
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
  console.log("\nStopped.");
}

program.parseAsync();
