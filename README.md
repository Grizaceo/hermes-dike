# Diké for Hermes

[Español](README.es.md)

A Hermes Agent plugin that checks the article citations of Chilean law in a
legal brief against a sealed, hash-identified local copy of the statutes, and
refuses to certify what it cannot prove.

## Status

- **Hackathon entry** for the Nous Research Hermes Agent Plugin Hackathon,
  **listed in the Hermes plugin catalog** ([pull
  request](https://github.com/NousResearch/hermes-agent/pull/150360)) at an
  earlier version with the citation check alone. This version adds the Desktop
  Case Writer; moving the catalog pin takes a new catalog pull request.
- **Linux only.** Requires Hermes Agent v0.23.0 or later.
- **The engine is not new.** It is [Diké](https://github.com/Grizaceo/dike),
  vendored unchanged; `VENDORED.json` names the commit and the hash of every
  file. [PREEXISTING.md](PREEXISTING.md) says what existed before the hackathon
  and what was built during it.

## Quickstart

`hermes plugins install dike` installs the **catalog pin, version 0.2.0**: an
earlier release with the citation check alone. For this version, install from
GitHub pinned to a commit:

```bash
hermes plugins install Grizaceo/hermes-dike --ref <40-char-commit>
hermes plugins enable dike
```

A local clone works the same way (`hermes plugins install file:///path/to/clone
--ref <40-char-commit> --yes-deps`). Run `/dike-estado` to confirm the install.
Then ask Hermes to check the citations of a brief, or run the check yourself
with the text, or the path of a `.md`, `.txt` or `.docx` file, after the
command:

```text
/dike-verificar Conforme al artículo 161 del Código del Trabajo y al artículo 9999 del Código del Trabajo.
```

The first call unpacks and checks the corpus (about a minute). After that the
plugin works offline: the first check after Hermes starts takes 13 to 15 seconds
while the engine verifies the corpus, later ones under a second. Answers are in
English; set `idioma: es` in the plugin's settings for Spanish. In the Desktop
app, turn on the page under **Capabilities → Plugins**.

## How it works

### Why a plugin and not a prompt

Ask a model whether article 9999 of the Código del Trabajo exists, and it can
answer either way with confidence. Diké answers from a sealed corpus, and says
so when it has no evidence. A prompt can ask a model to be careful. It cannot:

- carry 8,544 articles of 25 statutes and check their hashes before answering;
- give the same answer every time, with the network off;
- refuse by contract, so an ambiguous or unknown citation never becomes a pass;
- stop the model from using tools while it discusses a brief (that takes hooks);
- pseudonymize a brief before it leaves the machine, and log a hash of what
  left.

### The citation check

1. The agent gets three tools. `dike_verificar_citas` takes `texto` (the text)
   or `ruta` (a file); `/dike-verificar` runs the same check without a model.
   Two read-only companions serve the corpus: `dike_leer_articulo` returns one
   article's text and normative units, and `dike_buscar_corpus` runs a
   deterministic lexical search whose hits are leads, never verified citations.
2. The engine runs in a child process with a minimal environment, no agent
   credentials and, when bubblewrap is available, a sandbox without network. It
   finds each article citation and resolves it against the corpus: identity,
   text hash and in-force status on the reference date. The engine re-verifies
   the whole corpus when it starts, so the plugin keeps one sandboxed engine
   process per session that forks a short-lived child for each request; only the
   first request waits for that verification.
3. The plugin validates the engine's answer against a fixed contract and fails
   closed: a malformed answer is an error, never a pass. It also refuses input
   with invisible control characters, and it does not certify a citation whose
   text names two different statutes.

On the synthetic brief in `tests/fixtures/escrito_demo.md`, with six citations:

| Citation | Result |
|---|---|
| artículo 161, 162, 163 and 168 del Código del Trabajo | **verified**: identifier (`cl.norma.ct:art:0161`…), Ley Chile source URL, SHA-256 of the text |
| artículo 60 | **refused**, `AMBIGUOUS`: no statute named, and article 60 exists in more than one code |
| artículo 9999 del Código del Trabajo | **refused**, `UNRESOLVABLE`: not in the corpus |

`certificacion_sustantiva` and `certificacion_vigencia_actual` are always
`false`: the tool does not check that an article supports the argument, and the
corpus is a dated copy (each verified citation carries its retrieval date).

### The Desktop page

Four tabs on the same engine, through the plugin's backend at
`/api/plugins/dike`. The page is in English, with Spanish one click away, and
follows the app's theme.

- **Case Writer.** A brief editor where only the engine can mark a citation
  verified. Before any text leaves the machine, a pseudonymization step you see
  and control replaces personal data with stable tokens. A chat about the brief
  runs in your own Hermes gateway; two plugin hooks give it fixed instructions
  and block every tool except skills, tool discovery and the plugin's three
  tools, which there accept text only. Claims the chat makes about articles
  carry footnotes that open the exact graph node so you can check the text;
  whether an article is relevant is the model's reading and your call. See
  [docs/case-writer.md](docs/case-writer.md).
- **Corpus graph.** A read-only 3D map of the statutes, their articles and their
  minimal normative units, each with a candidate label (obligation, prohibition,
  permission…) from regex rules, plus the same lexical search.
- **Case board.** The case's theory (facts, norms, hypotheses and gaps),
  versioned, with every change attributed. The chat can propose updates; they
  enter only when you accept them.
- **Legal systems and settings.** Validates statute packs for other legal
  systems from a declarative profile; those packs cannot be citation-checked yet
  ([docs/legal-systems.md](docs/legal-systems.md)).

What it reads, writes and runs: [docs/DISCLOSURES.md](docs/DISCLOSURES.md). How
the code is organized: [docs/architecture.md](docs/architecture.md).

## How this was built

- **Decided and reviewed by me (Cristóbal Muñoz):** _to be completed by the
  maintainer._
- **Before the hackathon:** the Diké engine and its corpus, and the first
  version of this adapter with its 73 tests, in the `hermes-plugin/` folder of
  [Grizaceo/dike](https://github.com/Grizaceo/dike) (October 2026). See
  [PREEXISTING.md](PREEXISTING.md).
- **Written by AI during the hackathon:**
  - Claude Code (Claude Opus 5.5) moved the adapter here, wrote
    `scripts/vendor_engine.py` and the first README, then reviewed the entry as
    a judge would and fixed what it found.
  - Devin (Claude Opus 5.5) wrote the catalog entry, the Dashboard tab and the
    Desktop page: case board, 3D graph, Case Writer with its hooks, privacy
    module and predictor, content search, legal-system framework.
  - In the last round Claude Code (Claude Fable 5.2) directed two audits and
    wrote the engine server and the page's stylesheet; Codex (gpt-6.1-sol) fixed
    the Python side, reorganized the tests, put the plugin's text in English and
    finished translating the two interfaces Devin (swe-2-flash-max) had fixed.
  - The privacy detector and the predictor's deterministic layer are ported from
    earlier projects (sources and licenses in `VENDORED.json`).
- **Verified by AI, not yet repeated by me** (commands and values in
  [claims.json](claims.json)): the test suites on Hermes v0.23.0; `hermes
  plugins validate` and `doctor`; an install from a local clone, with the demo
  brief checked with networking off; the corpus counts, the reproducible Desktop
  bundle, the engine server's latency and the privacy benchmark; two real chat
  turns in a Case Writer session, where the model's attempt to use the terminal
  was blocked.
- **Not verified:** macOS, Hermes versions before v0.23.0, and the Desktop page
  inside the app after the last round: it was checked in a browser harness with
  the app's theme tokens (`desktop/dev/`).

## Limits

- **Chilean law, 25 statutes, article citations only.** Citations of other
  statutes come back unverified; a mention such as "Ley 19.496" without an
  article is listed in `no_verificadas`. For a `.pdf`, pass its text.
- **English around Spanish law.** The plugin's own text is English or Spanish.
  Statute names, article text, the engine's messages and result codes
  (`VERIFICADA`, `FALLO`…) and the plain-language review stay Spanish.
- **A dated copy, not today's official text.** The corpus was taken from Ley
  Chile in August 2026. Every answer names it by `pack_hash` and gives each
  source's retrieval date. Absence is not proof: a citation the corpus cannot
  resolve may still exist in law.
- **One citation per sentence or line.** If two citations sit on consecutive
  lines without a period, a comma or a list bullet, the engine can attach the
  first statute to the second citation. The plugin then refuses to certify it
  and says why, instead of guessing.
- **What "integrity-checked" means.** Every call compares the installed corpus'
  file names, sizes and modification times with the install record, and
  re-hashes everything when they differ; a full SHA-256 also runs once per
  process, and the engine verifies every file each time its server starts. A
  change that keeps both size and modification time is caught at the next server
  start (after 10 idle minutes, a new day or a restart); until then the engine
  answers from the copy it verified in memory.
- **Memory and disk.** About 300 MB of disk per Hermes profile, and about 170 MB
  of memory while the engine server runs.
- **Pseudonymization, not anonymization.** The rule-based detector does not find
  every name without context, so it lists candidates for you. The token map
  stays on this machine. Read the preview before sending.
- **The chat's model is your profile's model** (the active profile, or the one
  set in `perfil_chat`). The hooks keep the chat away from tools; they do not
  make a model right. Citation states come only from the engine.
- **Labels and search results are clues.** Candidate labels and graph relations
  come from rules, unvalidated until a lawyer reviews them; search is lexical
  (BM25), not semantic. Prediction is experimental and off.
- **Isolation and no signing.** The engine runs inside bubblewrap when
  available, else in a declared degraded mode. Diké can sign records of verified
  citations; this plugin never does, and never touches signing keys.

## License

The code is under the [MIT License](LICENSE). The corpus under `corpus/` is
derived from Ley Chile (Biblioteca del Congreso Nacional de Chile) and is not
covered by the MIT License; its terms and provenance are in
[corpus/README.md](corpus/README.md), copied unchanged from Grizaceo/dike (its
mentions of a `Dockerfile` and `scripts/producto/` refer to that repository).
