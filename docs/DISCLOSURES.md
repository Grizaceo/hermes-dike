# What the plugin reads, writes and runs

This page lists every effect the plugin has outside the agent's conversation,
for the catalog review and for anyone deciding whether to install it.

## It runs a subprocess

- Each call runs `python -m lexo_cli` (the vendored Diké engine) with the same
  interpreter as Hermes, through `subprocess.run`, without a shell, with a
  300-second timeout.
- The subprocess gets a minimal environment: `PATH`, `LANG`, `LC_ALL` and `TZ`
  from the parent, plus the variables that point the engine to the plugin's
  data. Agent credentials and API keys are not passed.
- `PYTHONPATH` carries `motor/` and the `site-packages` folders of the Hermes
  process, because the engine needs the same installed dependencies
  (pydantic, pyyaml, rich, requests, cryptography). Hermes's own code is not
  passed.
- **This is not a sandbox.** The subprocess runs with your operating-system
  permissions.

## It reads

- The text you pass in `texto`, or the file you name in `ruta`. Regular
  `.md` and `.txt` files are accepted up to 400,000 UTF-8 bytes (the same
  limit applies to `texto`); `.docx` files are accepted up to 10 MB, copied
  into the per-call temporary folder and read by the engine in the
  subprocess through `agent_invoker.resolve_document` (python-docx). No file
  is ever read through a symbolic link. A relative `ruta` resolves against
  the calling session's working directory when Hermes reports one; when it
  does not (gateway sessions), a relative path is refused, never resolved
  against the gateway's own directory.
- Its own `corpus/` and `motor/` folders.

## It writes

All writes go under the current profile's plugin data folder,
`$HERMES_HOME/plugin-data/dike`:

- **The installed corpus.** On the first call the package in `corpus/` is
  checked against `corpus/SHA256SUMS`, unpacked with Python's `tarfile`
  `data` filter (no absolute paths, links out of the tree or device files),
  installed by the engine, and published by renaming a finished folder.
  `installed.json` records, per installed file, its SHA-256 and its
  `[size, mtime_ns]` stat. Every later call first compares names+size+mtime:
  if they match and this process already hashed that exact stat, it trusts
  it; if they match but this process has not verified them yet, or if they
  differ, it re-hashes everything. Re-hashed content that still matches the
  record (touched files) refreshes the stat; different content raises
  `installed corpus integrity mismatch`. **Limit:** a change that preserves
  size and mtime exactly is caught only at the next process start, not
  mid-process. The 5 MB tarball digest is cached per process. The installed corpus takes about
  300 MB ([claims.json](../claims.json)).
- **Temporary files.** The text to check (or the `.docx` bytes) is written
  to a temporary folder inside the data folder and removed after the call.
- **Engine caches** and the engine's `HOME`, both redirected into the data
  folder. Nothing is written to your real home folder.

If you do not allow these writes, do not enable the plugin; the tool's
description tells the agent the same.

## Network

- The verifier needs no network. The end-to-end tests pass with networking
  disabled (`unshare -rn`, see [claims.json](../claims.json)).
- Installing the Python dependencies may contact the package registry. That
  is done by Hermes's installer, not by the plugin.

## What it never does

- It never signs, and never reads or writes signing keys.
- It never calls a model, and never calls Hermes.
- It registers no hooks, no middleware, no background processes and no
  scheduled jobs.
- It sends no telemetry and stores no credentials.
- It never updates its own files.

## Code it carries but does not run

`motor/` is the Diké engine as published, so it includes modules from the
larger Diké codebase that this plugin never calls (for example `mcp/`,
`hitl/` and the subagent launcher in `agent_invoker.py`; from that module,
`constancia` uses only `resolve_document`, to read the temporary file). The
plugin runs only two engine
commands: `starter install`, once, to install the corpus, and `constancia
--json`, to check citations.

## The corpus package

`corpus/chile-base-af1422d66d1e6eee.tar.gz` is a plain gzip tarball of text
files: one JSON record per article (text, text hash, source URL, in-force
window), the package manifest and build report, a JSON-LD context, and Turtle
graph and SHACL shape files. No binaries or bytecode. Its SHA-256 is in
`corpus/SHA256SUMS`. Provenance and terms: [corpus/README.md](../corpus/README.md).
