# Security

## Threat model

`pi-roundtable` is a thin orchestrator over `pi --mode rpc`. Its threat surface is small:

- **Spawns subprocesses**: the orchestrator `child_process.spawn`s `pi` with arguments it constructs. It does not evaluate user input as shell.
- **Reads/writes files**: only the files explicitly given to it — `--save PATH`, peers/presets files in its install directory, and the frontmatter of saved transcripts.
- **No network**: all network I/O happens inside the spawned `pi` subprocess via its own provider config.

The orchestrator **does not** read environment variables for credentials. API keys are managed entirely by `pi`'s own auth system (`pi auth`).

## What to watch for

If you customize peer markdown files, remember they're injected into the system prompt of a subprocess. Don't put secrets in peer files — they'd be visible to the model. Don't put untrusted content in peer files either — that's prompt injection.

## Reporting issues

Open an issue at <https://github.com/sloanb/pi-roundtable/issues>. For sensitive disclosures, contact the maintainer via GitHub.
