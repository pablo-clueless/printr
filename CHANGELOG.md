# Changelog

All notable changes to **printr** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
