# ink-boilerplate

Monorepo boilerplate with AI agent conventions and a Next.js starter.

## What's included

- **Yarn 4 workspaces** monorepo setup
- **`packages/web`** — Next.js 16, React 19, Tailwind v4, TanStack Query
- **AGENTS.md** — canonical AI agent guidelines (session init, coding conventions, commands)
- **CLAUDE.md / GEMINI.md** — symlinks to AGENTS.md
- **CONTRIBUTING.md** — git conventions (Angular commits, GitHub flow, no-squash merging, code comments, PR format)
- **`.ink/`** — [Inkwell](https://github.com/conoremclaughlin/inkwell) integration scaffolding

## Quick start

```bash
# Clone and rename
git clone https://github.com/conoremclaughlin/ink-boilerplate.git my-project
cd my-project

# Find-and-replace "my-project" with your project name in:
#   - package.json (name, description, scripts)
#   - packages/web/package.json (name)
#   - AGENTS.md (Project Overview section)
#   - packages/web/src/app/layout.tsx (metadata)
#   - packages/web/src/app/page.tsx (content)

# Install and run
yarn install
yarn dev
```

## Structure

```
.
├── AGENTS.md              # AI agent guidelines (source of truth)
├── CLAUDE.md -> AGENTS.md # Claude-specific pointer
├── GEMINI.md -> AGENTS.md # Gemini-specific pointer
├── CONTRIBUTING.md        # Git and coding conventions
├── package.json           # Root workspace config
├── packages/
│   └── web/               # Next.js application
│       ├── src/
│       │   ├── app/       # App Router pages
│       │   ├── components/# React components
│       │   └── lib/       # Utilities
│       └── ...
└── .ink/                  # Inkwell config
```

## License

MIT
