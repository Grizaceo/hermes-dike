# Diké for Hermes

[Español](README.es.md)

A Hermes Agent plugin that checks the article citations of Chilean law in a
legal brief against a local, hash-identified copy of the statutes, and refuses
to certify what it cannot prove.

## Status

- **Hackathon entry** for the Nous Research Hermes Agent Plugin Hackathon
  (November 2026). Submitted to the Hermes plugin catalog in
  [NousResearch/hermes-agent#150360](https://github.com/NousResearch/hermes-agent/pull/150360);
  not listed yet.
- **Linux only.** Tested with Hermes Agent v0.23.0 (requires_hermes
  `>=0.23.0`). Version 0.7.0: the Desktop page opens on a **Case Writer**
  — a brief editor with the citation check as a module, a pseudonymization
  step you see and control, a chat about the brief that runs in your own
  Hermes, and NIF proposals you accept one by one — next to the 3D graph
  of the 25-law corpus and the case board.
- **The engine is not new.** It is [Diké](https://github.com/Grizaceo/dike),
  vendored unchanged; `VENDORED.json` names the commit and the hash of every
  file. [PREEXISTING.md](PREEXISTING.md) says what existed before the
  hackathon and what was done during it.

## Quickstart

```bash
hermes plugins install Grizaceo/hermes-dike
hermes plugins enable dike
```

Then ask Hermes to check the citations of a brief, or run the tool yourself
with the text after the command:

```text
/dike-verificar Conforme al artículo 161 del Código del Trabajo y al artículo 9999 del Código del Trabajo.
```

The first call unpacks and checks the corpus in the plugin's data folder,
which takes a while. Later calls run offline.

The same check also has a **Diké** tab in the web dashboard and a sidebar
page in the Desktop app (the desktop half is opt-in: enable it under
Capabilities → Plugins). The Desktop page has three tabs: the **Case
Writer**, a read-only map of the sealed corpus graph (its 25 statutes,
8,544 articles and edges) with content search over the articles, and a
case board — the NIF — where each case's
theory is versioned, patch-attributed and marked as human-validated. All of
them call the same engine through the plugin's `/api/plugins/dike` backend.

The Case Writer's chat answers from the profile `lexo-lawyer` when it exists
and has Diké enabled, otherwise from the active profile if it has Diké; it
uses whatever model that profile is configured with.

## How it works

The plugin gives the agent one tool, `dike_verificar_citas`. It takes either
`texto` (the pasted text) or `ruta` (a `.md`, `.txt` or `.docx` file). A relative path resolves against the
session's working directory when Hermes reports one; gateway sessions do not,
so there it must be absolute. The Dashboard and Desktop pages reach the same
adapter over HTTP — text only, never file reads. The panel's NIF and graph
routes run `scripts/panel.py` in the same isolated subprocess: case boards
are versioned SQLite stores under the plugin's data folder (outside the
sealed corpus), and the corpus graph routes only read the verified
installed generation.

The Desktop page renders that corpus graph in 3D: an instrument →
article → inciso hierarchy where each minimal normative unit carries a
deontic-modality label computed by a table of regex rules (R-EXC …
R-DEF) — deterministic candidates, not validated. Its search box has two
modes: by name, and by content — a deterministic BM25 search over the
sealed corpus that returns article nodes as clues, never as verified
citations. Matter chips then explain the query: they name the legal
matters the tree classified it under, the terms that activated each one,
and whether each result is an anchor of that matter or inside its
territory — explanation only, never a reorder. Optionally, a user can
build a local graph from their own anonymized database with
`scripts/construir_red_local.py`: the builder refuses to run unless an
approval file records the database's sha256, writes only under the
profile's plugin-data (dir 700, files 600), and its output is never
shipped with the plugin. The plugin contains no judgment data.

1. The plugin runs the Diké engine as a subprocess (`dike constancia --json`)
   with a minimal environment: no agent credentials, and a home folder inside
   the plugin's data. The engine is never imported into Hermes.
2. The engine finds each article citation and resolves it against the corpus:
   25 statutes and 8,544 articles from Ley Chile ([claims.json](claims.json)).
   For each one it checks the text hash and whether the article was in force on
   the reference date.
3. The plugin validates the engine's answer against a fixed contract: counts,
   verdict, and the evidence each verified citation must carry. A malformed
   answer is reported as an error, never as a pass.

On the synthetic brief in `tests/fixtures/escrito_demo.md`, with six
citations, the tool returns:

| Citation | Result |
|---|---|
| artículo 161, 162, 163 and 168 del Código del Trabajo | **verified**: identifier (`cl.norma.ct:art:0161`…), Ley Chile source URL, SHA-256 of the text |
| artículo 60 | **refused**, `AMBIGUOUS`: no statute named, and article 60 exists in more than one code |
| artículo 9999 del Código del Trabajo | **refused**, `UNRESOLVABLE`: not in the corpus |

The answer also states what it does not cover. `certificacion_sustantiva` is
always `false`: the tool does not check that an article supports the
argument. `certificacion_vigencia_actual` is always `false`: the corpus is a
dated copy taken from Ley Chile in August 2026, and each verified citation
carries its retrieval date.

A model asked whether article 9999 of the Código del Trabajo exists can answer
either way with confidence. This tool answers from a sealed corpus whose
integrity it re-checks on every call ([docs/DISCLOSURES.md](docs/DISCLOSURES.md)),
and when it has no evidence it says so. A prompt or a skill can ask the model to be careful; it cannot carry the
corpus, check its hashes or refuse on the engine's behalf.

The Desktop page's **Case Writer** — editor, verifier module, privacy step,
chat, live NIF and the experimental predictor — is described in
[docs/case-writer.md](docs/case-writer.md); what it sends and writes is in
[docs/DISCLOSURES.md](docs/DISCLOSURES.md).

## How this was built

- **Decided and reviewed by me (Cristóbal Muñoz):** _to be completed by the
  maintainer._
- **Before the hackathon:** the Diké engine and the corpus, and the plugin
  adapter with its 73 tests, in the `hermes-plugin/` folder of
  [Grizaceo/dike](https://github.com/Grizaceo/dike) (October 2026). See
  [PREEXISTING.md](PREEXISTING.md).
- **Written by AI during the hackathon:** Claude Code (Claude Opus 5.5) moved
  the adapter into this repository, wrote `scripts/vendor_engine.py` and the
  `VENDORED.json` check that replaces the old copy test, adapted the tests to
  the new layout, updated the manifest and drafted this README.
- **Verified by Claude Code in this session, not yet repeated by me:** the 73 tests ([claims.json](claims.json));
  `hermes plugins validate . --install-deps` and `hermes plugins doctor . --ci`
  on Hermes v0.22.7; the end-to-end tests with networking disabled
  (`unshare -rn`).
- **Written by AI after publishing:** Devin (Claude Opus 5.5) wrote the
  catalog entry and its pull request, the catalog banner, these README
  corrections, the 0.3.0 adapter changes, the 0.4.0 panel surfaces
  (Dashboard tab, Desktop page and `/api/plugins/dike` backend) and the
  0.5.0 NIF case board and graph views (`scripts/panel.py`, the `/nif/*`
  and `/grafo/*` routes, and both UI halves), listed in
  [PREEXISTING.md](PREEXISTING.md), with their tests, plus the 0.6.0 3D
  corpus graph (`/grafo/red` and the esbuild-bundled Desktop page). Claude Code (Claude Opus
  5.5) reviewed the entry independently, read-only, before those changes.
- **Verified by Devin, not yet repeated by me:** on Hermes v0.23.0, installing
  from GitHub with `hermes plugins install Grizaceo/hermes-dike` and running
  `/dike-verificar` on the demo brief; `validate --install-deps` and
  `doctor --ci` at the pinned commit; the tests and the offline end-to-end
  tests again; for 0.3.0, the suite ([claims.json](claims.json)), `validate`
  and `doctor` on the new tree, and a `.docx` checked through a plugin that
  Hermes installed with its dependencies; for 0.4.0, the `estado` and
  `verificar` routes called against the installed package (4 of 6 on the
  demo brief). Also whether a real model picks the tool when asked to review
  a brief's citations without being told its name: the runs and their results
  are in the catalog pull request.
- **Written by AI for 0.7.0:** Devin (Claude Opus 5.5) wrote the Case
  Writer (editor, verifier module, privacy module, chat, live NIF and the
  predictor's architecture), the two hooks, their tests and the
  disclosures. The privacy detector is ported, not new: from the earlier
  `dpp-ai-compliance-lab`, `graph-legal-ir`, `lexo-case-writer` and
  `dike-desk` work, with provenance in `VENDORED.json`; the deterministic
  predictor is ported from `lexo-case-writer`.
- **Verified by Devin for 0.7.0, not yet repeated by me:** the tests and
  the reproducible bundle ([claims.json](claims.json)); `hermes plugins
  validate` on a clean copy; two real chat turns in the `lexo-lawyer`
  profile carrying the envelope, where the instructions were injected and
  the model's attempt to use the terminal was blocked by `pre_tool_call`
  (audit log lines, no content). A full chat turn typed in the Desktop app
  was not exercised by automation (synthetic keyboard input does not reach
  the app).
- **Not verified:** Hermes versions older than v0.22.7; macOS.

## Limits

- **Chilean law, 25 statutes.** Citations of other statutes come back
  unverified. Output is in Spanish.
- **Article citations only.** A mention such as "Ley 19.496" without an article
  is listed in `no_verificadas`, not verified.
- **Absence is not proof.** A citation the corpus cannot resolve may still
  exist in law.
- **A dated copy, not the official text of today.** Every answer names the
  corpus by `pack_hash` and gives each source's retrieval date.
- **Deontic and relation labels are candidates.** Modality rules and the
  local layer's relation rules (cita, menciona, revisa, aplica) follow the
  NIF posture `deontic_validated: false`. They fail closed: mentions that
  resolve to nothing are counted, never guessed.
- **Moving `plugin-data/dike` does not migrate the corpus.** A data folder
  copied or moved to another path reports `SIN_CORPUS`; delete
  `plugin-data/dike/generations` and the corpus reinstalls on the next call.
- **`.pdf` and other formats: pass the text.** `ruta` accepts `.md`, `.txt`
  and `.docx`; for a `.pdf` or anything else, extract the text and pass it in
  `texto`. `/dike-verificar` treats a lone path token as `ruta`, everything
  else as text.
- **Content search is lexical (BM25), not semantic; it does not cross the
  concept→norm jump.** Results are clues to read, labeled as such — never
  verified citations.
- **The matter tree has 51 anchors and does not change the ranking
  (measured); it explains the classification, it does not improve it.**
- **Not instant.** Every call re-checks the installed corpus and starts the
  engine, so it takes several seconds.
- **Disk.** The installed corpus takes about 300 MB in the plugin's data
  folder ([claims.json](claims.json)).
- **NIF cases are per-profile data.** Case boards live under the active
  profile's plugin data; they are not synced, not signed, and a case marked
  `validated_by_human` records who flipped the flag, not a legal opinion.
- **Not a sandbox.** The subprocess keeps your operating-system permissions.
  What the plugin reads, writes and runs is listed in
  [docs/DISCLOSURES.md](docs/DISCLOSURES.md).
- **No signing.** Diké can sign commitments of verified citations; this plugin
  never does, and never touches signing keys.
- **Pseudonymization, not anonymization.** The detector is rule-based: it
  does not find every name without context (it lists candidates for you),
  and the token map stays on this machine. Read the preview before sending.
- **The chat's model is your profile's model.** Where it runs (your machine
  or a provider) depends on that profile's configuration; the page shows
  it. The hooks keep the chat away from tools; they do not make a model
  right. Citation states come only from the engine.
- **Prediction is experimental and off by default.** Planned, not built:
  a fine-tuned model that predicts legal text the way code assistants
  predict code (limited by funding), the same model that will serve
  IndexO's embeddings acting as the predictor to unify the architecture,
  and a chat model distilled or fine-tuned to use Diké's architecture
  well (needs a training server).

## License

The code is under the [MIT License](LICENSE). The corpus under `corpus/` is
derived from Ley Chile (Biblioteca del Congreso Nacional de Chile) and is not
covered by the MIT License; its terms and provenance are in
[corpus/README.md](corpus/README.md). That file is copied unchanged from
Grizaceo/dike, so its mentions of a `Dockerfile`, `scripts/producto/` and
commit `a605d56` refer to that repository.
