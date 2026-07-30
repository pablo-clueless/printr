# Mermaid sample

A short tour of the diagram types printr renders.

## Flowchart

```mermaid
graph TD
  A[User] --> B{Logged in?}
  B -- yes --> C[Dashboard]
  B -- no --> D[Login page]
  D --> A
```

## Sequence

```mermaid
sequenceDiagram
  participant U as User
  participant A as API
  participant D as Database
  U->>A: GET /me
  A->>D: load user
  D-->>A: row
  A-->>U: 200 OK
```

## Broken diagram

This one has a syntax error on purpose so you can see the fallback:

```mermaid
graph TD
  A --> B
  C --
```

The block above should print as labelled source code rather than a diagram.
