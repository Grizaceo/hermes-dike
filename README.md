# Diké for Hermes

[Español](README.es.md)

A Hermes Agent plugin that checks every article citation of Chilean law in a
legal brief against a local, hash-identified copy of the statutes, and refuses
to certify what it cannot prove.

## Status

- **Hackathon entry** for the Nous Research Hermes Agent Plugin Hackathon
  (November 2026). Not in the Hermes plugin catalog yet.
- **Linux only.** Tested with Hermes Agent v0.22.7 on Python 3.11.16.
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

## How it works

The plugin gives the agent one tool, `dike_verificar_citas`. It takes either
`texto` (the pasted text) or `ruta` (a `.md` or `.txt` file).

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
dated copy, retrieved on 2026-08-18.

A model asked whether article 9999 of the Código del Trabajo exists can answer
either way with confidence. This tool answers from a sealed corpus whose
integrity it checks again on every call, and when it has no evidence it says
so.

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
- **Not verified:** installing from GitHub (the repository is not published
  yet); Hermes versions older than v0.22.7; Python versions other than 3.11.16;
  macOS; a real model choosing the tool on its own (the tests call it
  directly).

## Limits

- **Chilean law, 25 statutes.** Citations of other statutes come back
  unverified. Output is in Spanish.
- **Article citations only.** A mention such as "Ley 19.496" without an article
  is listed in `no_verificadas`, not verified.
- **Absence is not proof.** A citation the corpus cannot resolve may still
  exist in law.
- **A dated copy, not the official text of today.** Every answer names the
  corpus by `pack_hash` and gives each source's retrieval date.
- **Not a sandbox.** The subprocess keeps your operating-system permissions.
  What the plugin reads, writes and runs is listed in
  [docs/DISCLOSURES.md](docs/DISCLOSURES.md).
- **No signing.** Diké can sign commitments of verified citations; this plugin
  never does, and never touches signing keys.

## License

The code is under the [MIT License](LICENSE). The corpus under `corpus/` is
derived from Ley Chile (Biblioteca del Congreso Nacional de Chile) and is not
covered by the MIT License; its terms and provenance are in
[corpus/README.md](corpus/README.md).
