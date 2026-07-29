# Changelog

All notable changes to **printr** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Word document **output**: `--to docx` writes Markdown, source-code and
  plain-text inputs as `.docx` instead of PDF. The format is also inferred from
  `--output`, so `-o notes.docx` is enough.
- Syntax highlighting survives into Word output — highlight.js tokens become
  real character formatting, with the colours read from the same stylesheet the
  PDF uses. Indentation and line breaks inside code blocks are preserved.
- `--format` and `--margin` are translated into the Word document's page setup.
- Word document **input**: `.docx` files are converted through `mammoth`, mapping
  Word styles onto semantic HTML that is printed with printr's own typography.
  Headings, lists, tables, blockquotes, links and footnotes are preserved, and
  embedded images are inlined as data URIs so the document stays
  self-contained.
- Recognition of the built-in `Title`, `Subtitle`, `Quote` and `Intense Quote`
  paragraph styles, matched by style name and by style id so localized Word
  installs map correctly.
- Underlined runs are preserved (mammoth discards them by default).

- `examples/sample.docx`, a sample Word document.

### Changed

- A `.doc` input now fails with a clear message instead of being read as text
  and printed as binary noise.

### Fixed

- Images referenced by a relative path (`![](diagram.png)`) are now embedded in
  the output. Neither renderer is given a base directory, so these previously
  failed to load and were silently dropped from both PDF and `.docx`.
- Two inputs that differ only by extension (`report.md` and `report.docx`) map
  to the same PDF name; printr now reports this before rendering instead of
  silently overwriting one output with the other.
- The headless Chrome instance is now closed when a file fails to render.
  Previously the error was reported but the browser stayed open, leaving the
  CLI hanging instead of exiting. Chrome is also started lazily, so a run that
  only writes `.docx` never launches it at all.

## [0.1.0] - 2026-06-22

### Added

- Initial release: a CLI that prints Markdown and plain-text files as PDFs.
- Markdown rendering with GitHub-flavored styling (`markdown-it`) and
  syntax-highlighted code blocks (`highlight.js`).
- High-fidelity PDF output through headless Chrome (`puppeteer`); generated HTML
  is fully self-contained so no external resources are fetched while rendering.
- Plain-text files (any non-Markdown extension) rendered verbatim in a
  monospace layout.
- Batch conversion with glob support (e.g. `printr "docs/**/*.md"`), reusing a
  single browser instance across files for speed.
- `--watch` / `-w` mode: re-renders a file whenever it changes, debounced and
  serialized, with recursive directory watching for `**` patterns and pickup of
  newly created files matching a glob.
- CLI options: `--output`/`-o`, `--out-dir`/`-d`, `--format`/`-f`,
  `--margin`/`-m`, `--title`/`-t`.

[Unreleased]: https://example.com/printr/compare/v0.1.0...HEAD
[0.1.0]: https://example.com/printr/releases/tag/v0.1.0
