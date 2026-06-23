# printr

> Print **Markdown** and **plain-text** files as nicely styled PDFs — straight from your terminal.

Markdown is rendered with GitHub-flavored styling and syntax-highlighted code
blocks, then printed to PDF through headless Chrome (Puppeteer) for high
fidelity. Source-code files (JavaScript, TypeScript, Rust, C, Python, Go, …)
are syntax-highlighted and labelled with their filename, and any other
plain-text file is rendered verbatim in a clean monospace layout. The
generated HTML is fully self-contained, so no external resources are fetched
while rendering.

## Features

- 📄 GitHub-flavored Markdown styling with print-tuned page breaks
- 🎨 Syntax highlighting for code blocks via `highlight.js`
- 🖨️ High-fidelity PDF output through headless Chrome
- 📁 Batch conversion with glob patterns, reusing one browser for speed
- 👀 `--watch` mode that re-renders on every save
- 🧾 Plain-text files rendered verbatim in monospace

## Install

Run it on demand without installing:

```bash
npx @pablo_clueless/printr report.md
```

Or install globally to get the `printr` command everywhere:

```bash
npm install -g @pablo_clueless/printr
```

> **Chromium download:** on first install Puppeteer downloads a matching
> Chromium build (~150 MB). To reuse an existing Chrome instead, set
> `PUPPETEER_EXECUTABLE_PATH` to its path and install with
> `PUPPETEER_SKIP_DOWNLOAD=1`.

**Requirements:** Node.js >= 18.

## Usage

```bash
# Single file → writes report.pdf beside the source
printr report.md

# Explicit output path
printr report.md -o ~/Desktop/report.pdf

# Batch convert with a glob, into one folder
printr "docs/**/*.md" -d out/

# Letter paper, tighter margins
printr notes.txt -f Letter -m 15mm

# Source files are syntax-highlighted by extension
printr src/main.rs -d out/

# Force a language for an unrecognized extension
printr Dockerfile --lang dockerfile

# Watch and re-render on every save (Ctrl+C to stop)
printr "docs/**/*.md" -d out/ --watch
```

Quote glob patterns (`"docs/**/*.md"`) so your shell passes them to `printr`
rather than expanding them itself.

## Options

| Flag | Description | Default |
| ---- | ----------- | ------- |
| `-o, --output <file>` | Output PDF path (single input only) | beside source |
| `-d, --out-dir <dir>` | Folder for output PDFs | source folder |
| `-f, --format <fmt>` | Paper format: `A4`, `Letter`, `Legal`, … | `A4` |
| `-m, --margin <size>` | Page margin on all sides, e.g. `20mm`, `1in` | `20mm` |
| `-t, --title <title>` | Document title (single input only) | filename |
| `-l, --lang <lang>` | Force the syntax-highlight language for source files, e.g. `python`, `rust` | by extension |
| `-w, --watch` | Re-render whenever an input file changes | off |
| `-h, --help` | Show help | |

## Supported inputs

- **Markdown:** `.md`, `.markdown`, `.mdown`, `.mkd`
- **Source code (syntax-highlighted):** `.js`, `.mjs`, `.cjs`, `.jsx`, `.ts`,
  `.tsx`, `.rs`, `.c`, `.h`, `.py`, `.go`
- **Other code:** files with an unrecognized extension are auto-detected by
  `highlight.js` and highlighted accordingly. Use `--lang` to force a specific
  language.
- **Plain text:** `.txt`, `.text`, and `.log` are always rendered verbatim in
  monospace.

## Examples

A ready-to-try sample lives in [`examples/`](examples/):

```bash
printr examples/sample.md -d examples/out/
```

## Contributing

```bash
git clone https://github.com/pablo-clueless/printr.git
cd printr
npm install        # installs deps and downloads Chromium
npm run dev -- examples/sample.md   # run from source without building
npm run build      # compile TypeScript to dist/
```

Issues and pull requests are welcome. See [CHANGELOG.md](CHANGELOG.md) for the
release history.

## License

[MIT](LICENSE)
