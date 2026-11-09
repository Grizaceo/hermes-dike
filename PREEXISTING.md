# What existed before the hackathon

The Nous Research Hermes Agent Plugin Hackathon opened on 2026-11-04 at 21:33 UTC.
This repository was created on 2026-11-06. Everything below existed before the
hackathon opened, in the public repository
[Grizaceo/dike](https://github.com/Grizaceo/dike).

| What | Where it comes from | Date |
|---|---|---|
| The Diké engine (`motor/lexo_cli`, `motor/shared`, `motor/dike_id`) | `lexo_cli/`, `shared/`, `packages/dike-id/` of Grizaceo/dike at commit `5b9e19d`, vendored unchanged | first commit of Grizaceo/dike on 2026-10-06, exported from an earlier private repository |
| The corpus snapshot (`corpus/`) | `corpus/` of Grizaceo/dike at the same commit | retrieved from Ley Chile 2026-08-18 |
| The plugin adapter (`__init__.py`) | `hermes-plugin/__init__.py` of Grizaceo/dike | 2026-10-07 to 2026-10-14 |
| The tests (`tests/`) | `hermes-plugin/tests/` of Grizaceo/dike | 2026-10-07 to 2026-10-14 |
| The demo brief (`tests/fixtures/escrito_demo.md`) | `docs/hackathon/escrito_demo.md` of Grizaceo/dike | 2026-10-06 |

The Diké engine was also entered in the BLI Legal Tech Hackathon 2 (DoraHacks,
submitted 2026-10-31). That entry was the Grizaceo/dike repository, which also
carried the first version of this adapter in its `hermes-plugin/` folder.

## Done during the hackathon

- This repository: the adapter moved out of the engine repository, so Hermes
  can install it as a plugin on its own.
- `scripts/vendor_engine.py` and `VENDORED.json`: the engine and corpus are
  copied from a clean checkout and recorded by commit and per-file SHA-256;
  `--check` verifies the copy without the source repository. A test runs it.
- The tests adapted to the new layout.
- The manifest: English description, `requires_hermes` set to the version it
  was tested on (v0.22.7), license, homepage and tags.
- The README, its Spanish translation, `docs/DISCLOSURES.md` and `claims.json`.

Changes to the adapter's code during the hackathon:

- Before publishing: one docstring line (`__init__.py`), which said the
  plugin was not published.
- After publishing, for version 0.3.0, written by AI and reviewed in pull
  requests (see "How this was built" in the README):
  - an input error now says which rule the input broke;
  - `ruta` accepts `.docx` files;
  - a relative `ruta` resolves against the session's working directory;
  - `/dike-verificar` accepts a file path and answers in readable text;
  - the per-call corpus check compares file sizes and modification times,
    and re-hashes when they change;
  - two small fixes: the redaction no longer cuts URLs in the middle of a
    text, and the data folder falls back only when Hermes's storage helper
    is missing.
- After publishing, for version 0.4.0, same authorship and review:
  - `dashboard/` adds a **Diké** tab to the web dashboard
    (`manifest.json`, `dist/index.js`) and a small FastAPI backend
    (`plugin_api.py`) mounted at `/api/plugins/dike/`, with `estado` and a
    text-only `verificar` that calls the same adapter;
  - `desktop/plugin.js` adds a sidebar row and page to the Desktop app,
    copied by the app to `~/.hermes/desktop-plugins/dike/` and opt-in under
    Capabilities → Plugins;
  - none of this changes the adapter, the tool or the command.
- After publishing, for version 0.5.0, same authorship and review:
  - `scripts/panel.py`, a JSON driver that runs inside the same isolated
    subprocess and reuses the vendored engine's own modules:
    `lexo_cli.nif_studio.service` for versioned NIF case boards,
    `lexo_cli.pichanga` for the personal review graph, and
    `lexo_cli.starter.userconfig` for workspace resolution;
  - `/nif/*` and `/grafo/*` routes in `plugin_api.py` that validate inputs
    (case ids, editable field paths, integer gap indexes, booleans,
    numeric confidence and Ley Chile codes) before reaching the driver,
    redact local paths from engine errors, and read the sealed corpus only
    after `_asegurar_corpus` verifies the installed generation;
  - the Dashboard tab and Desktop page extended with the NIF case board
    (list, seed, snapshot, patch-attributed edits, gap filling, human
    validation, confidence) and the graph views (sealed corpus map with
    per-norm articles, personal GRE candidates);
  - NIF case data lives under `plugin-data/dike/users/`, outside the
    sealed corpus generation, so board writes never affect the integrity
    check the citation verifier runs;
  - none of this changes the adapter, the tool or the command.
- After publishing, for version 0.7.0 (Devin, Claude Opus 5.5; reviewed by
  the maintainer before merge):
  - the Desktop page opens on a **Case Writer** (`desktop/src/escritor/`):
    a Tiptap editor saved per case through `/escrito`, the citation check
    as a module (prove, repair, withdraw with a reason, escalate);
  - a privacy module (`privacidad/` and `/privacidad/*`) **ported, not
    new**: patterns and strategies from `dpp-ai-compliance-lab`, name and
    judge rules from `graph-legal-ir`, the RIT/RUC/ROL whitelist and
    check-digit validation from `lexo-case-writer`, the title pass from
    `dike-desk`; provenance in `VENDORED.json`;
  - a chat about the brief served by a Hermes profile with two hooks
    (`escritor/hooks.py`: `pre_llm_call`, `pre_tool_call`) that act only on
    sessions carrying the `<dike-escritor v="1">` envelope;
  - NIF proposals through `llm.oneshot` that enter the case board only
    through `/nif/edit` after the lawyer accepts them;
  - a predictor architecture, off by default, whose deterministic layer is
    ported from `lexo-case-writer`, plus `/prediccion/corpus`;
  - the tool, the command and the vendored engine are unchanged.
- After publishing, for version 0.6.0 (Devin, Claude Opus 5.5):
  - the 3D graph of the sealed corpus on the Desktop page (`/grafo/red` and
    related read-only routes), with minimal normative units and their
    rule-based deontic labels;
  - `scripts/construir_red_local.py`, an optional builder for a local graph
    layer from the user's own anonymized database; nothing it produces
    ships with the plugin.
- After publishing, for version 0.8.0 (Devin, Claude Opus 5.5):
  - content search over the sealed corpus (`/grafo/buscar`, the engine's
    deterministic BM25 retriever) and "Llevar al escrito", which carries a
    result into the brief only through the verifier;
  - the matter tree in `data/arbol/` and `scripts/canal_arbol.py`, **ported,
    not new** (the script from `indexo-retriever-prod`); it explains a
    query, it does not reorder results;
  - stricter privacy rules (names without context in the strict strategy);
  - `ordenamiento/`, `scripts/ordenamiento.py` and the `dike-ordenamiento`
    skill: legal-system profiles and pack validation, a generalized port of
    `construir_paquete_normas.py` from Grizaceo/dike `885ca85`.
- After publishing, for version 0.8.1 (Claude Code, Claude Opus 5.5), from a
  review written as a judge would: the adapter no longer certifies a
  citation whose text names two different statutes, and refuses input with
  invisible control characters; the Case Writer chat can no longer read
  files through the tool, never runs a turn without its instructions, and
  can find the tool when it is deferred; plus the README, these documents
  and `claims.json`. The engine is unchanged.

## Ported from earlier projects

Some modules were not written during the hackathon but ported from earlier
projects that are not published. Those sources are private and are not
reproducible by third parties; `VENDORED.json` (`ported`) records, for
each one, the source, the commit or working-tree state, the license it
declares, the files it came from, and marks each private source with
`acceso` = "fuente privada, no reproducible por terceros".

| Module in this plugin | Ported from | Recorded state |
|---|---|---|
| `privacidad/` (detector and stable pseudonyms) | `dpp-ai-compliance-lab`, `graph-legal-ir`, `lexo-case-writer`, `dike-desk` | working trees over `0d1e386` and `fe283d6`; commits `7c13a89` and `e3348d2` |
| `desktop/src/escritor/prediccion/l0.js` | `lexo-case-writer` | commit `7c13a89` |
| `scripts/canal_arbol.py` | `indexo-retriever-prod` | commit `32a0d86` |
| `data/arbol/` (matter tree and lexicon, data) | not recorded | not recorded |
| `ordenamiento/` | [Grizaceo/dike](https://github.com/Grizaceo/dike) `scripts/construir_paquete_normas.py` | commit `885ca85` (2026-11-07, during the hackathon) |

Two of those sources carry no license file (`graph-legal-ir`, whose author
is Grizaceo, and the matter-tree data), and two were ported from
uncommitted working trees. The maintainer states their authorship and
license below.

- **Authorship and license of the ported sources:** _to be completed by the
  maintainer._
