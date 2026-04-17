# Release notes

One file per tagged release, named to match the tag exactly: `v<MAJOR>.<MINOR>.<PATCH>.md`.

The `.github/workflows/release.yml` workflow reads the file for the tag being released and uses its contents as the body of the GitHub release draft. If the file doesn't exist for a given tag, the workflow falls back to GitHub's auto-generated commit summary so you never get an empty release.

## Format

Markdown. Structure is flexible, but a useful baseline:

```markdown
# v1.2.3

<one-paragraph summary: what changed and why it matters to users>

## Highlights

- Short bullets for the things you want users to notice first.

## Fixes

- Bug fixes worth calling out.

## Known issues

- Anything users should be aware of, or say "None."

## Install

Download `ClaudeWorks-1.2.3-arm64.dmg` from this release and drag it to `/Applications/`. On first launch, macOS Gatekeeper will warn — approve via **System Settings → Privacy & Security → Open Anyway**.
```

Write for users, not for other developers. The commit log is the developer-facing changelog; this file is the user-facing one.
