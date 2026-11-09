# Legal systems (ordenamientos)

[Español](legal-systems.es.md)

Diké models graphs of statutes for **legal systems** (ordenamientos jurídicos)
through a declarative profile (`dike-perfil-ordenamiento-v1`) and a shared core
vocabulary v1. Chile is the reference profile; a fictitious country `xx`
ships as a worked example. Everything runs through `scripts/ordenamiento.py`
(standard library only, offline, no downloads) and the pack it builds is
validated level by level.

## The four steps

1. **Template.** `python scripts/ordenamiento.py plantilla --jur xx --dir <dir>`
   writes `perfil-xx.json` (fields left as `COMPLETAR`) and `paquete.json`
   (the constructor config).
2. **Validate the profile.** `validar-perfil <perfil.json>` returns explained
   errors with JSON paths (`$.normas.tipos[2].nivel`); exit 0 when clean.
3. **Build the pack.** `construir --perfil P --config C --salida DIR` splits
   each statute text with the profile's `patronArticulo`, mints node IRIs from
   the profile's templates, writes canonical JSON and a MANIFEST with per-file
   sha256. It refuses truncated texts, duplicate or non-positive article
   numbers, empty packs, unsafe `articulosArchivo` paths, and runs the
   plugin's privacy detector: a critical personal identifier fails the build.
4. **Validate the pack.** `validar-pack --perfil P --pack DIR [--texto]`
   emits the `dike-informe-compatibilidad-v1` report and exits 0 only at level
   C1 or above.

## What the `cl` profile proves

`ordenamiento/perfiles/cl.json` reproduces the sealed public pack
`corpus/chile-base-*.tar.gz`: C0 and C1 green, with 25 statutes, 8,544
articles, 8,569 temporal windows and 17,068 edges re-minted from the profile
templates — including the legacy edge-id rule the sealed pack predates — and
three declared year exceptions (Ley Chile codes 1058072, 207436, 172986). The
proof is `tests/test_ordenamiento.py::test_chile_base_c1`.

## Levels C0–C3

Levels are cumulative; each level has its own test.

- **C0 format and manifest** — canonical JSON; MANIFEST lists every file with
  sha256 and bytes; `manifestCoreSha256` recomputes; no unsafe paths; no
  symlinks.
- **C1 core** — `pack.json` declares a recognized `format`, and for
  `dike-ordenamiento-pack-v1` packs the declared profile must match the one
  used for validation; every node is a core class; node keys are core terms
  or declared extensions; `@id`s re-mint from the profile templates; the year
  rule holds or a declared exception applies.
- **C2 vigencia and provenance** — *not evaluated yet* (planned; see below).
- **C3 mapped extensions** — *not evaluated yet* (planned; see below).

`nivelAlcanzado` reports the highest fully passed level; C2/C3 always read
`no_evaluado` and never count as a pass. The report's `gid` field states that
non-`cl` packs are not yet verifiable by the dike-id grammar (2.0.0 only
accepts `cl`), which is declared, not a pass.

## Limits

- **Non-`cl` packs are not verifiable by `/dike-verificar` yet**: the vendored
  dike-id grammar only accepts the `cl` prefix, and `motor/` is not touched by
  this framework.
- **C2 and C3 are not evaluated**; vigencia states beyond the declared window
  and extension mapping compliance are future work.
- **No judgment or administrative-act constructor** exists; only statutes.
- **Nothing is downloaded**: statute texts come from each country's official
  source under its own terms.

## What comes next

> **Graphs of several legal systems (plan, not implemented).** Each pack
> declares its legal-system profile and its core version. A C3 compatibility
> level guarantees that every system-specific term declares which common term
> it corresponds to and with what relation (equivalent, narrower, broader or
> related). On that basis, a future version could: (1) **connect** graphs
> through citations across legal systems, which today are marked as "other
> system" rather than as errors; (2) publish **crosswalks** reviewed by
> people between institutions of two systems, as tables with evidence and not
> as model inferences; and (3) **compare** legal systems only over the terms
> marked as comparable. Terms without correspondence stay out of every
> comparison, because forcing an equivalence would be inventing law. None of
> this is built. A declared mapping does not certify that two institutions are
> equivalent in their effects: that requires legal review, like everything
> that enters the canonical graph.
