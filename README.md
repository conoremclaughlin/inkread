# inkread

An iOS reading app that doesn't fight you.

Apple Books makes PDFs miserable, note-taking painful, and getting your notes *out* nearly impossible. inkread fixes that:

- **PDF → EPUB conversion** — import any PDF and read it as a reflowable EPUB with proper typography instead of pinch-zooming a fixed page.
- **Listen like an audiobook** — any book, read aloud with the on-device iOS AI voices. Pick up where you left off, sentence-level tracking.
- **Frictionless notes & highlights** — select, highlight, annotate. No modal maze.
- **Your notes are yours** — export all highlights and notes for a book as clean Markdown (pastes perfectly into Notion, Obsidian, anywhere) or share individual passages with attribution via the share sheet.
- **Local-first library** — books live on device; sync and community translations are on the roadmap.

## Status

Early development. Private while licensing implications of the conversion pipeline are sorted out.

## Roadmap

- **EPUB import** — read existing EPUBs, not just converted PDFs (parser lands in `core/epub`).
- **Sync** — local-first library synced through a small backend; books and annotations as CRDT-ish merge of per-device state.
- **Community translations** — translate chapters on device (or via an LLM backend), push translations up for other readers of the same book; `TextLocator` offsets already give stable anchor points.
- **Notion API export** — direct push of notes to a Notion database as an alternative to Markdown share.
- **Background audio** — keep TTS playing with the screen locked (needs `UIBackgroundModes: audio` in a dev build; Expo Go can't).

## Structure

Yarn 4 workspaces monorepo:

| Package | What it is |
| --- | --- |
| `packages/core` | Pure TypeScript: PDF-text → chapter segmentation, EPUB 3 builder, annotation models, Markdown export. Unit-tested with vitest. |
| `packages/mobile` | Expo (React Native) iOS app. Reader UI, TTS playback, pdf.js extraction, SQLite storage. |

## Development

```bash
yarn install
yarn test          # core unit tests
yarn ios           # run the app on an iOS simulator
```

See [AGENTS.md](./AGENTS.md) for architecture and [CONTRIBUTING.md](./CONTRIBUTING.md) for conventions.
