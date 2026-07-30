# printr sample

A quick document to verify rendering.

## Features

- GitHub-style typography
- Syntax-highlighted code
- Tables and blockquotes

> Markdown in, polished PDF out.

```ts
function greet(name: string): string {
  return `Hello, ${name}!`;
}
console.log(greet("world"));
```

| Input  | Output   |
| ------ | -------- |
| `.md`  | styled   |
| `.txt` | verbatim |

Some inline `code` and a [link](https://example.com).

![image](https://res.cloudinary.com/pabloclueless/image/upload/v1769641447/2_coylng.png)

## How printr renders a file

```mermaid
flowchart TB
    IN["Input file<br/>.md · .mmd · .docx<br/>source · .txt"] --> EXT{"Extension?"}

    EXT -->|"markdown"| MDI["markdown-it<br/>+ extractMermaid"]
    EXT -->|".mmd"| ONE["whole file<br/>= one diagram"]
    EXT -->|".docx"| MAM["mammoth<br/>styles → HTML"]
    EXT -->|"code / text"| HLJS["highlight.js"]

    MDI --> SHELL
    ONE --> SHELL
    MAM --> SHELL
    HLJS --> SHELL["htmlDocument<br/>inline CSS + images"]

    SHELL --> HAS{"diagrams?"}
    HAS -->|"no"| TARGET{"target"}
    HAS -->|"yes"| RENDER["renderMermaidInPage<br/>Chrome + mermaid bundle<br/>parse error → highlighted source"]
    RENDER --> TARGET

    TARGET -->|"pdf"| OUTPDF(["report.pdf<br/>inline SVG, stays vector"])
    TARGET -->|"docx"| OUTDOCX(["report.docx<br/>PNG @2x via html-to-docx"])
```
