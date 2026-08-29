# printr

> Print **Markdown**, **Word** and **plain-text** files as nicely styled **PDFs** or **Word documents** — straight from your terminal.

Markdown is rendered with GitHub-flavored styling and syntax-highlighted code
blocks, then printed to PDF through headless Chrome (Puppeteer) for high
fidelity. Word documents (`.docx`) are converted through `mammoth`, which maps
Word's styles onto the same clean typography. Source-code files (JavaScript,
TypeScript, Rust, C, Python, Go, …) are syntax-highlighted and labelled with
their filename, and any other plain-text file is rendered verbatim in a clean
monospace layout.

Pass `--to docx` and the same inputs are written as Word documents instead,
with the syntax highlighting carried over as real character formatting. Output
is always self-contained: images referenced by a document are embedded, so
nothing is fetched when the file is opened later.

## Features

- 📄 GitHub-flavored Markdown styling with print-tuned page breaks
- 🖨️ High-fidelity PDF output through headless Chrome
- 📝 Word `.docx` output with syntax highlighting preserved (`--to docx`)
- 📥 Word `.docx` input: headings, lists, tables, images and links
- 🎨 Syntax highlighting for code blocks via `highlight.js`
- 🧜 Mermaid diagrams, both in ` ```mermaid ` blocks and as standalone `.mmd` files
- 📁 Batch conversion with glob patterns, reusing one browser for speed
- 👀 `--watch` mode that re-renders on every save
- 🧾 Plain-text files rendered verbatim in monospace

## Install

Run it on demand without installing:

```bash
npx @pablo-clueless/printr report.md
```

Or install globally to get the `printr` command everywhere:

```bash
npm install -g @pablo-clueless/printr
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

# Word documents work the same way
printr proposal.docx

# Write a Word document instead of a PDF
printr report.md --to docx

# …or just name the output; the extension decides
printr report.md -o ~/Desktop/report.docx

# Batch convert a folder of notes into Word documents
printr "docs/**/*.md" --to docx -d out/

# Batch convert with a glob, into one folder
printr "docs/**/*.md" -d out/

# Mix formats in one run
printr README.md proposal.docx notes.txt -d out/

# Letter paper, tighter margins
printr notes.txt -f Letter -m 15mm

# Source files are syntax-highlighted by extension
printr src/main.rs -d out/

# Force a language for an unrecognized extension
printr Dockerfile --lang dockerfile

# A standalone Mermaid file becomes a one-diagram document
printr architecture.mmd

# Print Mermaid blocks as source instead of rendering them
printr design-doc.md --no-mermaid

# Watch and re-render on every save (Ctrl+C to stop)
printr "docs/**/*.md" -d out/ --watch
```

Quote glob patterns (`"docs/**/*.md"`) so your shell passes them to `printr`
rather than expanding them itself.

## Options

| Flag                  | Description                                                                 | Default               |
| --------------------- | --------------------------------------------------------------------------- | --------------------- |
| `-o, --output <file>` | Output PDF path (single input only)                                         | beside source         |
| `-d, --out-dir <dir>` | Folder for output PDFs                                                      | source folder         |
| `-f, --format <fmt>`  | Paper format: `A4`, `Letter`, `Legal`, …                                    | `A4`                  |
| `-m, --margin <size>` | Page margin on all sides, e.g. `20mm`, `1in`                                | `20mm`                |
| `-t, --title <title>` | Document title (single input only)                                          | filename              |
| `--to <format>`       | Output format: `pdf` or `docx`                                              | from `-o`, else `pdf` |
| `-l, --lang <lang>`   | Force the syntax-highlight language for source files, e.g. `python`, `rust` | by extension          |
| `--no-mermaid`        | Skip diagram rendering; Mermaid blocks print as highlighted source          | off                   |
| `--mermaid-version`   | Mermaid major version to fetch                                              | `11`                  |
| `-w, --watch`         | Re-render whenever an input file changes                                    | off                   |
| `-h, --help`          | Show help                                                                   |                       |

## Supported inputs

- **Markdown:** `.md`, `.markdown`, `.mdown`, `.mkd`
- **Mermaid:** `.mmd`, `.mermaid` — rendered as a single diagram
- **Word:** `.docx`
- **Source code (syntax-highlighted):** `.js`, `.mjs`, `.cjs`, `.jsx`, `.ts`,
  `.tsx`, `.rs`, `.c`, `.h`, `.py`, `.go`
- **Other code:** files with an unrecognized extension are auto-detected by
  `highlight.js` and highlighted accordingly. Use `--lang` to force a specific
  language.
- **Plain text:** `.txt`, `.text`, and `.log` are always rendered verbatim in
  monospace.

## Output formats

| `--to`          | Written with              | Notes                                                                |
| --------------- | ------------------------- | -------------------------------------------------------------------- |
| `pdf` (default) | Headless Chrome           | Full CSS fidelity, print-tuned page breaks                           |
| `docx`          | `@turbodocx/html-to-docx` | Editable Word document; no Chrome needed, so it is noticeably faster |

`--format` and `--margin` apply to both: paper size and margins are translated
into the Word document's own page setup.

Every input except `.docx` itself can be written as a Word document —
converting a `.docx` to a `.docx` is refused rather than silently copied.

### Word output

Markdown structure maps onto real Word constructs: headings, bullet and
numbered lists, tables, blockquotes, links and images. Code keeps its
**syntax highlighting** — highlight.js tokens become genuine character
formatting (colour and monospace font), so a highlighted source file stays
highlighted and stays editable in Word. Indentation and line breaks inside code
are preserved exactly.

Because Word has no stylesheet, styling is applied run by run rather than by
CSS, so the result is close to the PDF but not identical — page-break tuning in
particular is left to Word.

## Mermaid diagrams

Fenced ` ```mermaid ` blocks in Markdown are rendered as diagrams, and a
standalone `.mmd` / `.mermaid` file is treated as one diagram filling the page:

```bash
printr architecture.mmd
printr design-doc.md --to docx
```

In a PDF the diagram is embedded as vector SVG, so it stays sharp at any zoom.
Word has no SVG support worth relying on, so the `--to docx` path rasterizes
each diagram to a high-DPI PNG scaled to the printable column width.

Rendering happens in the same headless Chrome instance that prints the PDF, so
there is no extra dependency — but Mermaid's browser bundle (~3.4 MB) is
downloaded from jsDelivr the first time a diagram is actually rendered, then
cached under the OS cache directory and reused. To work entirely offline, point
`PRINTR_MERMAID_PATH` at a local copy of `mermaid.min.js`; it is then used
verbatim and the network is never touched.

A diagram that fails to parse does not fail the document: printr logs the
error and falls back to printing that block's source, syntax-highlighted and
labelled with the parser message, so the rest of the file still renders. Pass
`--no-mermaid` to skip diagram rendering entirely and print every block as
source.

Because Word output only needs Chrome for diagrams, a `.docx` conversion with
no Mermaid blocks in it still never launches a browser.

### Word input

`.docx` files are converted by mapping Word's _styles_ onto semantic HTML —
headings, lists, tables, blockquotes, links, footnotes and embedded images —
which is then printed with printr's own typography. That means the output is a
clean, consistently styled document rather than a pixel-for-pixel facsimile of
Word: bespoke fonts, colours, text boxes and exact page layout are not carried
over. Built-in styles (`Title`, `Subtitle`, `Quote`, `Intense Quote`, `Heading
1`–`6`) are recognised, including on localized Word installs.

Legacy `.doc` files are a different, binary format and are not supported —
re-save them as `.docx` first.

## Examples

Ready-to-try samples live in [`examples/`](examples/):

```bash
printr examples/sample.md -d examples/out/
printr examples/sample.docx -d examples/out/
printr examples/sample.md --to docx -d examples/out/
```

Note that `sample.md` and `sample.docx` would both produce `sample.pdf`, so
printr refuses to convert them in the same run rather than overwriting one
with the other.

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
