# Changelog

## 1.0.0 — 2026-10-29

First public release. Previously developed privately as a personal "inbox" plugin; renamed to
`dsh-delivery-box` because the npm name `dsh-inbox` is already taken by an unrelated project,
and this package now supports both the repo layout and the one-click ZIP installer.

Highlights:

- Sidebar **Delivery Box** panel and main panel.
- **Two-level navigation**: categories (projects, with dot/counts/latest time/thumbnails) →
  files of that category **grouped by the conversation that produced them**.
- Inline preview: images, video (seekable), audio, PDF, plain text.
- **Copy to clipboard**: image clipboard for images, file clipboard for everything else
  (paste straight into WeChat / Teams / mail).
- Reveal in Explorer, open with the default app, delete to the Recycle Bin (two-step confirm).
- Live rescan every 5 seconds; new deliverables appear without a refresh.
- Source annotations in the hidden `.origins.json`; hidden/extensions-based type mapping.
- **Host**: seven loopback routes, single-range `Range` support for media (fixes unseekable video),
  Node built-ins only.
- `tools/inbox.mjs` CLI: `add` / `list` / `copy` / `reveal` / `tag` / `open`, with
  `--clip`, `--link` (hard link), `--origin`, `--project`, `--json`.
- Windows one-click installer (`installer/`): auto-detects DSH home/profile, backs up the manifest and
  lockfile, patches them, links the plugin, writes `inbox.config.json`, generates a `投递.cmd` wrapper
  that pins the local Node path; `uninstall.cmd` rolls back.
- Configurable inbox folder: `DSH_INBOX_DIR` → `inbox.config.json` → `%USERPROFILE%\取件箱`.

Known limitations at 1.0.0:

- Clipboard, Explorer reveal and Recycle Bin deletion are Windows-only.
- Tested with DSH 0.2.1-rc.3; other 0.2.x versions are expected to work but are not tested.
- The panel groups by `project` first (falling back to `origin`); a file with neither ends up in
  "Unlabeled".
