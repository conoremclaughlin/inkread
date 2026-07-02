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

<!-- Replace this section with your project's description -->

This is a yarn workspaces monorepo:

- **`packages/web`** — Next.js web application (Next.js 16, React 19, Tailwind v4, TanStack Query)

## Architecture

```
packages/
  web/
    src/
      app/           # Next.js App Router pages
      components/    # React components
      lib/           # Utilities and shared logic
```

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
yarn dev              # Web dev server
yarn build            # Build all packages
yarn lint             # Lint all packages
yarn type-check       # Type-check all packages
yarn test             # Run all tests
```
