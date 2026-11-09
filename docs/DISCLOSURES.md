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
- **Case Writer briefs.** `POST /escrito` saves the brief you are writing,
  per case, to `escritos/<case_id>.json` (folder `0700`, file `0600`,
  atomic write, revision check that refuses a stale save with 409). The
  file holds the brief's HTML and plain text and a small log of the
  citations you withdrew or escalated, with your reason.
- **Pseudonym maps and your privacy decisions.** `privacidad/<case_id>.json`
  (`0700`/`0600`) maps each personal value found in that case's text to its
  stable token (`[PERSONA_1]`, `[RUT_1]`…) and stores which values you chose
  to keep or to mask. It contains the real values: it is what lets the page
  show model replies with the real names, and it never leaves the machine.
- **Send log, without content.** Every time the Case Writer sends text to a
  model, `privacidad/envios.jsonl` (`0600`, rotated at 1 MB) records the
  time, the case, the destination (profile and model as shown on screen),
  the SHA-256 of the exact text sent, the counts per type of masked data,
  the strategy and whether pseudonymization was on. Never the text. If
  that line cannot be written, nothing is sent.
- **Chat hook audit, without content.** In the profile that serves the
  Case Writer chat, `escritor/auditoria.jsonl` (`0600`, rotated at 1 MB)
  records, per marked session, when the instructions or the reminder were
  injected and the name of every tool the hook blocked. Never the user's or
  the model's text.
- **Prediction events (off by default).** Only if you turn on its telemetry,
  `prediccion/eventos.jsonl` (`0600`) records per suggestion the layer,
  whether you accepted it, its length and its provenance type. Never text.

If you do not allow these writes, do not enable the plugin; the tool's
description tells the agent the same.

## Network

- The verifier needs no network. The end-to-end tests pass with networking
  disabled (`unshare -rn`, see [claims.json](../claims.json)).
- Installing the Python dependencies may contact the package registry. That
  is done by Hermes's installer, not by the plugin.
- The plugin itself opens no network connection. The Case Writer's chat,
  NIF proposals and optional model prediction go through **your own Hermes
  gateway**, to the model that the serving profile is configured to use:
  where that model runs (your machine or a provider) is your Hermes
  configuration, and the page shows it before you send.

## The Case Writer chat: what reaches a model, and how it is kept in its lane

The Desktop page's Case Writer has a chat about the brief you are writing.
It is the only part of the plugin that makes a model run, and it runs only
when you act: you send a chat message, you ask for NIF proposals, or you
turn on model prediction.

- **Where it runs.** In the profile `lexo-lawyer` by default (the page checks
  first that Diké is enabled there and refuses to open the chat otherwise).
  The page opens one hidden session per case, titled
  `Diké · Escrito · <case_id>`, through the Desktop SDK
  (`host.requestProfile`: `session.list`, `session.create`,
  `session.resume`, `prompt.submit`, `session.interrupt`), so it does not
  appear in the Sessions sidebar.
- **What is sent per turn.** Your question, wrapped in a
  `<dike-escritor v="1">` envelope with the brief (in full on the first
  turn or when more than 40 % of its paragraphs changed, otherwise only
  the changed paragraphs, capped at 12,000 characters), the paragraph at
  your cursor or your selection, and the current citation results. The
  whole envelope is pseudonymized first (see below). NIF proposals send
  the same pseudonymized brief plus the case's NIF sections through
  `llm.oneshot` with the chat session's model.
- **Pseudonymization, on by default.** Before anything is sent, the page
  calls `/privacidad/seudonimizar`, which replaces personal data with stable
  tokens. Detection is rule-based (ported, with provenance in
  `VENDORED.json`, from earlier Diké work): national IDs with check-digit
  validation, email, phones, addresses, plates, names after a title, a
  procedural role or before an ID, sensitive data categories; case numbers
  (RIT, RUC, ROL) and judges are kept. **It is pseudonymization, not
  anonymization:** the map stays on this machine, and a rule-based detector
  does not find every name without context, so the page lists possible
  names for you to mask. You can turn it off per case only after
  confirming that the text will leave with personal data; the send log
  records that choice.
- **Hooks.** The plugin registers `pre_llm_call` and `pre_tool_call`. They
  act only on sessions whose user message starts with the
  `<dike-escritor v="1"` envelope (or whose platform is `dike-escritor`);
  for every other session they return nothing, so no other chat changes.
  In a marked session, `pre_llm_call` adds the Case Writer's instructions
  (`escritor/instrucciones.md`) to the first turn's user message, and a
  short reminder to later turns; the system prompt is never touched. If
  the instructions cannot be read, the turn is blocked. `pre_tool_call`
  blocks every tool except `skills_list`, `skill_view` and
  `dike_verificar_citas`, so the chat cannot use the serving profile's
  terminal, files, browser, memory or delegation. Forging the envelope only
  restricts that session.
- **Citation states stay with the engine.** After every reply the page runs
  `/verificar` on the reply; a citation is shown as verified only when the
  engine returned `VERIFICADA` for that exact text. The model's own words
  never set a state.
- **Nothing enters the brief or the NIF on its own.** Inserting a reply
  into the brief, and accepting a NIF proposal, are your clicks. Accepted
  proposals are written through `/nif/edit`, so the patch is attributed to
  `user`. The flow never calls `/nif/validar` or `/nif/confianza`.
- **Prediction (experimental, off by default).** The deterministic layer and
  the corpus layer run on this machine. The model layer is off until you
  enable it; if the profile's `auxiliary.dike_prediccion` is not a local
  endpoint without fallbacks, the page says where the paragraph would go
  and asks for an explicit opt-in per case, and the text is pseudonymized
  first.

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
  no shell, minimal environment, timeout (90 s; 120 s for content search,
  300 s for corpus reads). `/grafo/buscar` additionally passes the query
  on the subprocess's stdin instead of argv.
  Inputs are validated before they reach the driver: `case_id` must match a
  strict identifier pattern, `field_path` must be one of the editable NIF
  sections, `gap_index` an integer, `validated` a boolean, `confidence` a
  number, and corpus norm codes numeric Ley Chile identifiers. Engine
  stderr never reaches the browser raw: local paths are redacted and errors
  are capped at 400 characters.
- `grafo corpus` and `grafo corpus-norma` first re-run the sealed-corpus
  assurance (`_asegurar_corpus`) and then only **read** the installed
  generation: they never write inside it.
- The dashboard file is plain readable JavaScript with no build step (the
  dashboard supplies React and its components). The Desktop plugin imports
  only `@hermes/plugin-sdk` and `react`; its bundled libraries are listed
  under "The Desktop bundle". The Desktop page adds the Case Writer routes
  (`/escrito`, `/privacidad/*`, `/prediccion/corpus`) listed under
  "HTTP surface".

## What it never does

- It never signs, and never reads or writes signing keys.
- The agent half never calls a model. Model turns happen only when you use
  the Case Writer's chat, NIF proposals or model prediction, and they run in
  your own Hermes gateway (see above).
- Its only hooks are the two described above, and they change nothing
  outside Case Writer sessions. No middleware, no background processes and
  no scheduled jobs.
- It sends no telemetry and stores no credentials. It never reads `.env`,
  `auth.json` or any credential store: model access goes through Hermes.
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
external (provided by the app). It bundles `three@0.183.2`,
`3d-force-graph@1.79.0` and the Tiptap 3.32.2 editor (`@tiptap/core`,
`@tiptap/starter-kit`, `@tiptap/pm`, `@tiptap/extension-placeholder`, all
MIT, mounted without `@tiptap/react` so `react-dom` is never imported;
pinned in `desktop/package.json`). The build escapes invisible Unicode
characters from third-party code (`\u200B`…) before hashing; the optional
`ngraph.*` imports inside 3d-force-graph are aliased to
`desktop/src/ngraph-stub.js`, so the bundle contains **no `eval`, no
`new Function` and no dynamic `import()`**. The build is unminified for
review (license comments in `plugin.js.LEGAL.txt`) and deterministic:
two clean `npm ci && node build.mjs` runs produce the same sha256 —
reproduce with `cd desktop && npm ci && node build.mjs && sha256sum plugin.js`
(expected hash and sizes in `desktop/BUNDLE.json`). The bundle makes no
network calls of its own: it reaches the plugin's REST routes via
`ctx.rest`, and the Hermes gateway only through the Desktop SDK
(`host.requestProfile`, `host.retainProfile`, `host.onEvent`) for the Case
Writer chat, NIF proposals and model prediction.

## HTTP surface (dashboard/plugin_api.py)

The routes sit behind Hermes' own plugin routing and authentication; the
plugin adds no authentication of its own. The `/grafo/*` and `/estado`
routes are `GET` and read-only, with one exception: `POST /grafo/buscar`,
which is `POST` precisely so the query never lands in access logs. It
writes only the BM25 index cache described below; `POST /verificar` writes
only a temporary copy of the brief, removed after the call; `POST /nif/*`
writes case files; `POST /escrito` and `POST /privacidad/*` write the files
listed in "It writes"; no route writes outside plugin-data.

- `/escrito` (`GET`, `POST`) — load and save the Case Writer brief of a case.
- `/privacidad/detectar`, `/privacidad/decision`, `/privacidad/seudonimizar`,
  `/privacidad/envio` (`POST`) — detect personal data, store your
  keep/mask decisions, pseudonymize a text with the case's stable tokens,
  and log a send without its content. Pure Python in the plugin host, no
  subprocess; text limited to 400,000 bytes.
- `/prediccion/corpus` (`GET`) — literal continuation of your last words
  from the installed corpus' article texts, read-only from the sealed
  generation, indexed in memory on first use.

- `/estado`, `/verificar` — engine + integrity status; `/verificar` runs
  the citation check (read-only, always re-verifies corpus integrity).
- `/grafo/corpus`, `/grafo/corpus/norma/{code}`, `/grafo/red`,
  `/grafo/nodo`, `/grafo/unidades`, `/grafo/unidad` — read-only graph
  metadata (60 s memo, see below); the response cache lives at
  `<plugin-data>/dike/cache/grafo_red_v3_<pack_hash>.json`.
- `/grafo/buscar` (`POST`) — content search over the sealed corpus. Body
  `{"q", "limite"}`: the query is validated (1–300 characters, no control
  characters, at least one searchable term) and sent to `scripts/panel.py`
  **on stdin**, never in argv, so it cannot appear in `ps`; it is never
  written to disk or logged. The panel runs the vendored deterministic
  BM25 retriever (`StarterCorpusRetriever`, no model, no network) over the
  sealed corpus and maps each hit to the graph article node
  (`a:<leychileCode>:<eId>`). Results are labeled as clues, not verified
  citations. Reads only the sealed corpus; the single write is the BM25
  index cache at `<generation>/home/.dike/bm25_cache/<snapshot16>.pkl` —
  outside the `users/` subtree the integrity check hashes, next to the
  existing binding cache.
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
- `<generation>/home/.dike/bm25_cache/<snapshot16>.pkl` — the pickled BM25
  index of the sealed corpus, keyed by the snapshot hash; written by the
  engine's retriever on first search and reused afterwards. It contains
  only article terms and document statistics — never a query. It lives
  under the generation's `home/`, outside the `users/` subtree that the
  integrity check hashes (same place as the binding cache).
- Engine caches and the engine's `HOME` stay under plugin-data (see
  "What it writes").
