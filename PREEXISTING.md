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
