# Diké for Hermes

[Español](README.es.md)

A Hermes Agent plugin that checks the article citations of Chilean law in a
legal brief against a sealed, hash-identified local copy of the statutes, and
refuses to certify what it cannot prove.

## Status

- **Hackathon entry** for the Nous Research Hermes Agent Plugin Hackathon.
  **Listed in the Hermes plugin catalog**
  ([pull request](https://github.com/NousResearch/hermes-agent/pull/150360))
  at an earlier version that has the citation check alone. This version adds
  the Desktop Case Writer; moving the catalog pin to it takes a new catalog
  pull request.
- **Linux only.** Requires Hermes Agent v0.23.0 or later.
- **The engine is not new.** It is [Diké](https://github.com/Grizaceo/dike),
  vendored unchanged; `VENDORED.json` names the commit and the hash of every
  file. [PREEXISTING.md](PREEXISTING.md) says what existed before the
  hackathon and what was built during it.

## Quickstart

`hermes plugins install dike` installs the **catalog pin, version 0.2.0** —
an earlier release with the citation check alone (no Case Writer, hooks or
Desktop page). For this version, install from GitHub pinned to a commit:

```bash
hermes plugins install Grizaceo/hermes-dike --ref <40-char-commit>
hermes plugins enable dike
```

A local clone works the same way — `hermes plugins install
file:///path/to/clone --ref <40-char-commit> --yes-deps`, then
`hermes plugins enable dike`. `--ref` pins the commit; omit it for `HEAD`.
Prefix either with `-p <profile>` for a dedicated profile
([docs/case-writer.md](docs/case-writer.md)). Run `/dike-estado` to confirm
the install.

Then ask Hermes to check the citations of a brief, or run the check yourself
with the text after the command:

```text
/dike-verificar Conforme al artículo 161 del Código del Trabajo y al artículo 9999 del Código del Trabajo.
```

The first call unpacks and checks the corpus in the plugin's data folder,
which takes about a minute; later calls work offline. In the Desktop app, turn
on the plugin's page under **Capabilities → Plugins** to get the Case Writer.

## How it works

### Why a plugin and not a prompt

Ask a model whether article 9999 of the Código del Trabajo exists, and it can
answer either way with confidence. Diké answers from a sealed corpus, and when
it has no evidence it says so. A prompt or a skill can ask a model to be
careful. It cannot:

- carry 8,544 articles of 25 statutes and check their hashes before answering;
- give the same answer every time, with the network off;
- refuse by contract, so an ambiguous or unknown citation never becomes a pass;
- stop the model from using tools while it discusses a brief (that takes hooks);
- pseudonymize a brief before it leaves the machine, and log a hash of what left.

### The citation check

1. The agent gets one tool, `dike_verificar_citas`. It takes `texto` (the
   text) or `ruta` (a `.md`, `.txt` or `.docx` file). `/dike-verificar` runs
   the same check on the text after the command, without a model.
2. The plugin runs the engine as a subprocess with a minimal environment, with
   no agent credentials and a home folder inside the plugin's data. The engine
   finds each article citation and resolves it against the corpus: identity,
   text hash and in-force status on the reference date.
3. The plugin validates the engine's answer against a fixed contract and fails
   closed: a malformed answer is an error, never a pass. It also refuses input
   with invisible control characters, and it does not certify a citation whose
   text names two different statutes.

On the synthetic brief in `tests/fixtures/escrito_demo.md`, with six
citations:

| Citation | Result |
|---|---|
| artículo 161, 162, 163 and 168 del Código del Trabajo | **verified**: identifier (`cl.norma.ct:art:0161`…), Ley Chile source URL, SHA-256 of the text |
| artículo 60 | **refused**, `AMBIGUOUS`: no statute named, and article 60 exists in more than one code |
| artículo 9999 del Código del Trabajo | **refused**, `UNRESOLVABLE`: not in the corpus |

`certificacion_sustantiva` is always `false`: the tool does not check that an
article supports the argument. `certificacion_vigencia_actual` is always
`false`: the corpus is a dated copy, and each verified citation carries its
retrieval date.

### The Desktop page

Three tabs on the same engine, through the plugin's backend at
`/api/plugins/dike`:

- **Case Writer.** A brief editor where only the engine can mark a citation
  verified. Before any text leaves the machine, a pseudonymization step you
  see and control replaces personal data with stable tokens. A chat about the
  brief runs in your own Hermes gateway; two plugin hooks give it fixed
  instructions and block every tool except skills, tool discovery and the
  citation check, which there accepts text only. See
  [docs/case-writer.md](docs/case-writer.md).
- **Corpus graph.** A read-only 3D map of the statutes, their articles and
  their minimal normative units, each with a candidate label (obligation,
  prohibition, permission…) from regex rules, plus a deterministic BM25
  search whose results are clues, never verified citations.
- **Case board.** The case's theory (facts, norms, hypotheses and gaps),
  versioned, with every change attributed. The chat can propose updates; they
  enter only when you accept them.

What the plugin reads, writes and runs: [docs/DISCLOSURES.md](docs/DISCLOSURES.md).
For other legal systems, `scripts/ordenamiento.py` and the
`dike-ordenamiento` skill validate statute packs from a declarative profile;
those packs cannot be citation-checked yet ([docs/legal-systems.md](docs/legal-systems.md)).

## How this was built

- **Decided and reviewed by me (Cristóbal Muñoz):** _to be completed by the
  maintainer._
- **Before the hackathon:** the Diké engine and its corpus, and the first
  version of this adapter with its 73 tests, in the `hermes-plugin/` folder of
  [Grizaceo/dike](https://github.com/Grizaceo/dike) (October 2026). See
  [PREEXISTING.md](PREEXISTING.md).
- **Written by AI during the hackathon:** Claude Code (Claude Opus 5.5) moved
  the adapter into this repository, wrote `scripts/vendor_engine.py` and the
  first README, and later reviewed the entry as a judge would and fixed what
  it found (the two-statute and control-character guards, three gaps in the
  chat hooks, these documents). Devin (Claude Opus 5.5) wrote the catalog
  entry and banner, the Dashboard tab and Desktop page, the case board, the 3D
  graph, the Case Writer with its hooks, privacy module and predictor, the
  content search and the legal-system framework. The privacy detector and the
  predictor's deterministic layer are ported from earlier projects (sources,
  commits and licenses in `VENDORED.json`).
- **Verified by AI, not yet repeated by me** (commands and values in
  [claims.json](claims.json)): the test suite on Hermes v0.23.0;
  `hermes plugins validate --install-deps` and `doctor` on this tree; an
  install from a local clone, with the demo brief checked with networking
  off; the corpus counts, the reproducible Desktop bundle and the privacy
  benchmark; two real chat turns in a Case Writer session, where the
  instructions were injected and the model's attempt to use the terminal was
  blocked; for the catalog version, the install from GitHub and a real model
  choosing the tool on its own.
- **Not verified:** macOS, Hermes versions before v0.23.0, and a chat turn
  typed by hand in the Desktop app.

## Limits

- **Chilean law, 25 statutes, article citations only.** Citations of other
  statutes come back unverified; a mention such as "Ley 19.496" without an
  article is listed in `no_verificadas`. Output is in Spanish.
- **A dated copy, not today's official text.** The corpus was taken from Ley
  Chile in August 2026. Every answer names it by `pack_hash` and gives each
  source's retrieval date. Absence is not proof: a citation the corpus cannot
  resolve may still exist in law.
- **One citation per sentence or line.** If two citations sit on consecutive
  lines without a period, a comma or a list bullet, the engine can attach the
  first statute to the second citation. The plugin then refuses to certify it
  and says why, instead of guessing.
- **Not instant.** The engine starts on every call: about 15 to 20 seconds, and
  about a minute for the first one ([claims.json](claims.json)).
- **What "integrity-checked" means.** Every call compares the installed
  corpus' file names, sizes and modification times with the install record,
  and re-hashes everything when they differ; a full SHA-256 also runs once
  per process. A change that keeps both size and modification time is caught
  at the next process start.
- **Disk.** About 300 MB per Hermes profile.
- **Pseudonymization, not anonymization.** The detector is rule-based and does
  not find every name without context, so it lists candidates for you. The
  token map stays on this machine. Read the preview before sending.
- **The chat's model is your profile's model.** The chat runs in the active
  Hermes profile by default, or in the profile set in the plugin's
  `perfil_chat` setting. The hooks keep the chat away from tools; they do not
  make a model right. Citation states come only from the engine.
- **Labels and search results are clues.** Deontic labels and graph relations
  come from rules and stay unvalidated until a lawyer reviews them; content
  search is lexical (BM25), not semantic. Prediction is experimental and off
  by default.
- **`.pdf` and other formats: pass the text.** `ruta` accepts `.md`, `.txt` and
  `.docx`.
- **Moving `plugin-data/dike` is repaired, not trusted blindly.** After a
  move the plugin re-hashes the whole generation against the install record;
  a tampered file still fails closed. Delete `plugin-data/dike/generations`
  to force a clean reinstall.
- **Isolation, degraded mode, and no signing.** The engine and panel run
  inside bubblewrap when available, else in a declared degraded mode (see
  [docs/DISCLOSURES.md](docs/DISCLOSURES.md)). Diké can sign records of
  verified citations; this plugin never does, and never touches signing keys.
- **Node.js and npm are only needed to rebuild the Desktop bundle**; the
  shipped `desktop/plugin.js` needs neither.

## License

The code is under the [MIT License](LICENSE). The corpus under `corpus/` is
derived from Ley Chile (Biblioteca del Congreso Nacional de Chile) and is not
covered by the MIT License; its terms and provenance are in
[corpus/README.md](corpus/README.md). That file is copied unchanged from
Grizaceo/dike, so its mentions of a `Dockerfile`, `scripts/producto/` and
commit `a605d56` refer to that repository.
