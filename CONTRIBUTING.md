# Contributing to ClaudeWorks

Issues and feature requests are the best way to contribute. I read everything and they shape what gets built next.

## Setup

```bash
git clone https://github.com/Mduffy37/claudeworks.git
cd claudeworks
npm install
npm start
```

`npm start` launches the app. UI changes require `npm run build` first — the renderer doesn't hot-reload from `npm start` alone. Use `npm run dev` for the Vite dev server if you're iterating on UI only.

## Codebase notes

- `src/electron/` — main process. Each module has a narrow job: `assembly.ts` builds profile config dirs, `marketplace.ts` handles GitHub fetches, `launch.ts` opens terminals, `teams.ts` manages team composition.
- `src/ui/` — renderer process. State lives in hooks under `src/ui/hooks/`; components are in `src/ui/components/`.
- `src/builtin-plugin/` — the `profiles-manager` skills that ship inside the app. These are Claude Code skills, not TypeScript.
- The curated marketplace lives in a sibling repo (`Mduffy37/claudeworks-marketplace`). Marketplace features require `gh auth login` or a `GITHUB_TOKEN` to test locally.

## Before opening a PR

- Run `npm run smoke` — four smoke tests that catch the most common assembly regressions.
- Include a screenshot or short description of what changed visually.
- Keep PRs focused. One thing at a time.

## Adding a plugin to the marketplace

Open a PR against [`claudeworks-marketplace`](https://github.com/Mduffy37/claudeworks-marketplace), not this repo. The `README.md` there documents the v2 schema.

## Questions

Open a [GitHub Discussion](https://github.com/Mduffy37/claudeworks/discussions) rather than an issue.
