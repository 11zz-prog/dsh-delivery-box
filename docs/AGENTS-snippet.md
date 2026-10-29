# AGENTS.md snippet — let every session file its deliverables

Copy the block below into your workspace `AGENTS.md` (the file your DSH agent reads every session).
Replace `<PLUGIN_DIR>` with the folder where the plugin lives, for example:

- registry install: find it with `dsh plugin --profile desktop list` or look inside the profile's
  `node_modules/dsh-delivery-box`.
- Windows one-click install: `%USERPROFILE%\dsh-inbox\plugin`.
- clone + `installer\install.cmd`: the repository folder.

```md
## Delivery inbox: file every deliverable

After producing a finished file (image / video / document / report / audio / archive), run:

& "<PLUGIN_DIR>\tools\投递.cmd" add <file> --origin "<this conversation or project>" --clip --json

- --origin: the conversation/project that produced it (the panel groups by it; do not omit)
- --clip: also put it on the clipboard (images → image clipboard, otherwise → file clipboard)
- --link: hard-link large videos instead of copying (same volume; falls back to a copy)
- To annotate existing files: & "<PLUGIN_DIR>\tools\投递.cmd" tag <file name> --origin "<conversation>" --json
```

If `投递.cmd` was not generated (the installer did not find Node), use:

```powershell
& node "<PLUGIN_DIR>\tools\inbox.mjs" add <file> --origin "<conversation>" --clip --json
```

Tips:

- Keep `--origin` short and recognisable; the panel shows it as the group title inside a project.
- A project name can be passed with `--project "项目名"`; otherwise the CLI infers it from a path
  containing `projects\<name>\`.
- Large videos: `--link` avoids keeping two copies on disk (same volume only).
