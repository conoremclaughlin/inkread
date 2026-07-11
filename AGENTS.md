# Agent Guidelines

This is the **canonical reference** for all AI agents working in this repository. If you're Claude, Gemini, GPT, or any other model: this file is for you. Model-specific files (CLAUDE.md, GEMINI.md) point here.

## Session Initialization (IMPORTANT)

**At the start of every new session**, establish identity and call bootstrap:

### Step 1: Determine Your Identity

Identity is resolved in layers. **Stop at the first match** — do not continue checking lower layers:

1. **System prompt override**: If the system prompt contains an "Identity Override" section specifying your agent ID, use that. **Stop here.**
2. **Environment variable**: Run `echo $AGENT_ID` in a shell. If it returns a non-empty value, use that as your agentId. **Stop here.**
3. **Repo-level identity**: Read `.ink/identity.json` in the current repo.
4. **Central config**: Read `~/.ink/config.json` agentMapping.

### Step 2: Load User Config

Read from `~/.ink/config.json`:

```json
{"userId": "...", "email": "...", "agentMapping": {"claude-code": "wren", ...}}
```

### Step 3: Call Bootstrap with Identity

```
bootstrap(userId: "<from config>", agentId: "<your identity>")
```

### Step 4: Start or Resume Session

Read `studioId` from `.ink/identity.json` (if present) and pass it to `start_session`.

Throughout the session, use `update_session_phase` for structural status changes and `remember` for decisions, insights, and important events.

**Note**: Never commit PII (emails, user IDs) to the repository. Always read from config files.

## Project Overview

**inkread** — an iOS reader app that fixes what Apple Books gets wrong:

- Import PDFs and automatically convert them to EPUB (reflowable, far nicer to read)
- Read EPUBs with a fast, themeable reader
- Listen to any book as an audiobook using on-device iOS AI voices (AVSpeechSynthesizer)
- Highlight passages and take notes without friction
- Share passages and export notes/highlights as Markdown (Notion-friendly) via the share sheet
- Local-first library with room for sync and community translations later

This is a yarn workspaces monorepo:

- **`packages/core`** — pure TypeScript domain logic: PDF-text → chapter segmentation, EPUB 3 builder, reader HTML (shared by mobile and web), annotation models, Markdown/Notion export. Fully unit-tested in Node with vitest.
- **`packages/mobile`** — Expo (React Native) iOS app. Uses `@inkread/core` for all conversion/export logic. PDF text extraction runs in a hidden WebView with a bundled pdf.js; TTS via `expo-speech`; storage via `expo-sqlite` + `expo-file-system` (local-first).
- **`packages/web`** — Next.js 16 e-reader + the API. Supabase cookie-session auth (`@supabase/ssr`), route handlers behind a `LibraryRepository` interface (never query the provider directly), in-browser pdf.js import, iframe reader sharing core's HTML, `speechSynthesis` listen mode. Local Supabase at ports 545xx (`supabase start`); web dev server on 6021.
- **`packages/desktop`** — Electron shell around the web app (`yarn desktop`, points at `APP_URL`, default http://127.0.0.1:6021). Session cookies persist, so it behaves like a signed-in native app.

## Architecture

```
packages/
  core/
    src/
      models/        # Book, Chapter, Annotation, Position types
      pdf/           # PDF text → structured chapters (segmentation heuristics)
      epub/          # EPUB 3 assembly (fflate zip, OPF/nav generation)
      export/        # Annotations → Markdown / share text
  mobile/
    src/
      screens/       # Library, Reader, Book detail, Notes
      reader/        # WebView reader HTML/JS bridge (selection, highlights, pagination)
      tts/           # Sentence-queue TTS controller over expo-speech
      pdf/           # pdf.js WebView extractor bridge
      store/         # SQLite persistence + file storage
```

Design rule: anything that can be pure TypeScript lives in `core` where it is testable in Node. `mobile` owns only UI, native APIs, and glue.

## Coding Conventions

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full reference on coding style, git conventions, and PR process. Key points:

- Strict TypeScript, avoid `any`
- Angular commit convention: `feat(scope): description`
- Do not squash commits on merge
- camelCase for variables/functions, PascalCase for types/components

## Development Commands

```bash
# Root
yarn install          # Install all workspaces
yarn test             # Run all tests (core: vitest)
yarn type-check       # Type-check all packages
yarn ios              # Build + run the iOS app on a simulator
yarn dev              # Start the Expo dev server
supabase start        # Local Postgres/auth stack (ports 545xx)
yarn workspace @inkread/web dev   # Web e-reader + API on http://127.0.0.1:6021
```
