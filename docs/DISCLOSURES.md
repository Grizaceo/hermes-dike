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
  300 MB ([claims.json](../claims.json)). Read-only graph endpoints
  (`/grafo/*`) reuse the verified generation for up to 60 seconds instead
  of re-checking integrity on every call; `/verificar` always checks.
- **Temporary files.** The text to check (or the `.docx` bytes) is written
  to a temporary folder inside the data folder and removed after the call.
- **Engine caches** and the engine's `HOME`, both redirected into the data
  folder. Nothing is written to your real home folder.
- **NIF case boards and the personal review graph.** The panel's NIF and
  graph-personal endpoints run `scripts/panel.py` inside the same isolated
  subprocess, with `DIKE_USER`/`DIKE_USERS_ROOT` pointed at
  `$HERMES_HOME/plugin-data/dike/users`. Case boards are versioned SQLite
  stores under `<users>/<user>/cases/<case_id>/` — every edit is an
  append-only patch attributed to an author — and personal-graph candidates
  live under the same workspace. This data sits **outside** the sealed
  corpus generation, so writing cases never trips the integrity check that
  `constancia` runs on every citation call.

If you do not allow these writes, do not enable the plugin; the tool's
description tells the agent the same.

## Network

- The verifier needs no network. The end-to-end tests pass with networking
  disabled (`unshare -rn`, see [claims.json](../claims.json)).
- Installing the Python dependencies may contact the package registry. That
  is done by Hermes's installer, not by the plugin.

## The panel surfaces (Dashboard tab, Desktop sidebar)

`dashboard/` and `desktop/` put the same engine behind Hermes's own UI:

- `dashboard/manifest.json` and `dashboard/dist/index.js` add a **Diké** tab
  to the web dashboard. `desktop/plugin.js` adds a sidebar row and a page to
  the Desktop app: the app copies it to `~/.hermes/desktop-plugins/dike/`
  and keeps it off until you enable it under **Capabilities → Plugins**.
- `dashboard/plugin_api.py` serves `GET /api/plugins/dike/estado`,
  `POST /api/plugins/dike/verificar`, and the NIF/graph routes
  (`/nif/casos`, `/nif/init`, `/nif/seed`, `/nif/snapshot`, `/nif/edit`,
  `/nif/gap`, `/nif/validar`, `/nif/confianza`, `/grafo/personal`,
  `/grafo/corpus`, `/grafo/corpus/norma/{code}`). The routes run inside
  Hermes — the dashboard process, or the profile's plugin host under
  `plugins.isolation: host` — behind the dashboard's own auth and the
  enabled-plugin gate, and they answer for the profile that has the plugin
  enabled.
- `/verificar` takes **text only**: the HTTP surface does not expose the
  adapter's local file read (`ruta`). It calls `verificar_citas` from the
  agent adapter, so everything above — the subprocess, its environment, the
  corpus check, the confined writes — applies unchanged. `/estado` only
  reports whether the corpus generation is installed; it never installs or
  downloads.
- The NIF and graph routes run `scripts/panel.py` — plugin code, not motor
  code — in the same isolated subprocess shape as the verifier: list argv,
  no shell, minimal environment, timeout (90 s; 300 s for corpus reads).
  Inputs are validated before they reach the driver: `case_id` must match a
  strict identifier pattern, `field_path` must be one of the editable NIF
  sections, `gap_index` an integer, `validated` a boolean, `confidence` a
  number, and corpus norm codes numeric Ley Chile identifiers. Engine
  stderr never reaches the browser raw: local paths are redacted and errors
  are capped at 400 characters.
- `grafo corpus` and `grafo corpus-norma` first re-run the sealed-corpus
  assurance (`_asegurar_corpus`) and then only **read** the installed
  generation: they never write inside it.
- Both UI files are plain readable JavaScript with no build step and no
  bundled dependencies (the dashboard supplies React and its components;
  the Desktop plugin imports only `@hermes/plugin-sdk` and `react`).

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
plugin runs only these engine entry points: `starter install`, once, to
install the corpus; `constancia --json`, to check citations; and, through
`scripts/panel.py`, `lexo_cli.nif_studio.service` (versioned case boards),
`lexo_cli.pichanga` (personal review graph) and `lexo_cli.starter.userconfig`
(workspace resolution) for the panel's NIF and graph views.

## The corpus package

`corpus/chile-base-af1422d66d1e6eee.tar.gz` is a plain gzip tarball of text
files: one JSON record per article (text, text hash, source URL, in-force
window), the package manifest and build report, a JSON-LD context, and Turtle
graph and SHACL shape files. No binaries or bytecode. Its SHA-256 is in
`corpus/SHA256SUMS`. Provenance and terms: [corpus/README.md](../corpus/README.md).

## The Desktop bundle

`desktop/plugin.js` is built by `desktop/build.mjs` (esbuild) from
`desktop/src/`: `@hermes/plugin-sdk`, `react` and `react/jsx-runtime` stay
external (provided by the app). It bundles `three@0.183.2` and
`3d-force-graph@1.79.0` (pinned in `desktop/package.json`); the optional
`ngraph.*` imports inside 3d-force-graph are aliased to
`desktop/src/ngraph-stub.js`, so the bundle contains **no `eval`, no
`new Function` and no dynamic `import()`**. The build is unminified for
review (license comments in `plugin.js.LEGAL.txt`) and deterministic:
two clean `npm ci && node build.mjs` runs produce the same sha256 —
reproduce with `cd desktop && npm ci && node build.mjs && sha256sum plugin.js`
(expected hash and sizes in `desktop/BUNDLE.json`). The bundle makes no
network calls: it only reaches the plugin's own REST routes via `ctx.rest`.

## HTTP surface (dashboard/plugin_api.py)

The routes sit behind Hermes' own plugin routing and authentication; the
plugin adds no authentication of its own. The `/grafo/*` and `/estado`
routes are `GET` and read-only. `POST /verificar` writes only a temporary
copy of the brief, removed after the call, and `POST /nif/*` writes case
files; no route writes outside plugin-data.

- `/estado`, `/verificar` — engine + integrity status; `/verificar` runs
  the citation check (read-only, always re-verifies corpus integrity).
- `/grafo/corpus`, `/grafo/corpus/norma/{code}`, `/grafo/red`,
  `/grafo/nodo`, `/grafo/unidades`, `/grafo/unidad` — read-only graph
  metadata (60 s memo, see below); the response cache lives at
  `<plugin-data>/dike/cache/grafo_red_v3_<pack_hash>.json`.
- `/grafo/fuentes` — lists the corpus and the optional local layer.
- `/grafo/evidencia` — evidence snippet for one local-layer link.
- `/nif/*` — case-board CRUD via `scripts/panel.py` (writes under
  `<plugin-data>/dike/users`).

The 60-second memo applies only to read-only graph metadata: the graph
view shows corpus metadata and certifies nothing. `/verificar` and
`/estado` re-check integrity on every call.

## The optional local graph layer

`scripts/construir_red_local.py` builds a second, local-only graph source
from a user-supplied anonymized database:

- **Reads only** `<plugin-data>/dike/grafo-local/fuentes/app_anon_v2.db`
  (opened read-only) and `aprobacion_anonimizacion.json` in the same
  folder; the build refuses to run when the recorded sha256 does not
  match the database file.
- **Writes only** `<plugin-data>/dike/grafo-local/ambiental/` — the
  directory is created `0700` and its files `0600`: `red.json` (slim
  network), `unidades.json` (texts + evidence snippets, fetched on click)
  and `construccion.json` (counters).
- The output never ships with the plugin and contains nothing the user
  did not already put in that folder. The plugin itself carries no
  judgment data.

## Caches

- `<plugin-data>/dike/cache/grafo_red_v3_<pack_hash>.json` — the slim
  corpus graph, rebuilt when missing or when the schema version changes.
- Engine caches and the engine's `HOME` stay under plugin-data (see
  "What it writes").
