# Contributing

This guide covers conventions for everyone working in this codebase — both organic beings (OBs) and synthetically-born beings (SBs).

## Git Conventions

### Commits

We use the [Angular commit convention](https://github.com/angular/angular/blob/main/CONTRIBUTING.md):

```
<type>(<scope>): <short summary>
  │       │             │
  │       │             └─⫸ Imperative present tense. Not capitalized. No period.
  │       │
  │       └─⫸ Optional. Succinct, relevant to the initiative.
  │
  └─⫸ feat|fix|refactor|chore|docs|test|perf|build|ci|style
```

Examples:

```
feat(web): add listing page
fix(search): handle empty query
refactor(api): extract validation middleware
chore: bump typescript to 5.8
```

### Branching

We follow [GitHub flow](https://www.geeksforgeeks.org/git-flow-vs-github-flow/): feature branches off `main`, which must always be stable and deployable.

```
<initials or moniker>/<type>/<scope>
  │                      │       │
  │                      │       └─⫸ Kebab-case. Succinct description.
  │                      │
  │                      └─⫸ Same types as commits.
  │
  └─⫸ Your initials or unique moniker (e.g., cm, wren)
```

Examples:

```bash
git checkout -b cm/feat/listing-page
git checkout -b wren/fix/search-pagination
```

When syncing with main: rebase first; if conflicts get messy, merge main in and move on.

**Never set your upstream to `origin/main` from a non-main branch.** When pushing a feature branch, use `git push -u origin <your-branch-name>`.

### Merging

**Do not squash commits.** SBs commit at logical points throughout a PR, and since PRs often span multiple features, preserving individual commits tells a clearer story than a single squashed blob. Use **merge commit** (not squash or rebase) when merging PRs.

### Code Comments

```
<author>(<scope>): <short summary>
  │         │             │
  │         │             └─⫸ Be succinct. Present tense.
  │         │
  │         └─⫸ Optional. todo|bug|???|<commit-style scope>
  │
  └─⫸ Optional. Your initials or common name.
```

A plain comment needs no prefix — any comment is implicitly a note. Only add structure when it conveys something the comment alone wouldn't.

Examples:

```typescript
// cm(todo): extract this into a shared utility
// wren(bug): race condition when two tabs save simultaneously
// ???: unclear why this timeout is needed — removing it breaks hover
// Simple explanation needs no prefix
```

## Pull Requests

When an SB creates or significantly contributes to a PR, attribute it in the title:

```
feat: add listing page (by Wren)
fix: resolve search pagination (by Lumen)
```

In the PR body, use the standard format:

```markdown
## Summary

- <bullet points>

## Test plan

- [ ] <checklist>

Generated with [Claude Code](https://claude.com/claude-code)
```

Replace "Claude Code" with the appropriate tool if the SB used a different interface.

## Coding Style

- **camelCase** for variables and functions (acronyms treated as words: `userId`, `apiResponse`)
- **PascalCase** for classes and types (`ListingCard`, `SearchResult`)
- **SCREAMING_SNAKE_CASE** for constants (`MAX_RESULTS_PER_PAGE`)

### TypeScript

- Strict typing, avoid `any`
- Prefer `async/await` over callbacks
- Use explicit return types on public functions

### File Organization

- One component/module per file
- Co-locate tests (`*.test.ts`) alongside source files
- Export types from dedicated type files when shared across packages
