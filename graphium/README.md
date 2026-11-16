# Graphium native engine

Diké reuses Graphium 0.2.0's bidirectional CSR representation, multiscale layout and GBIN v1 serializer under the included MIT license (Copyright 2026 Grizaceo).

## Provenance

Imported from the installed Graphium 0.2.0 Rust source. No vaults, profile data, paths or discovery adapters are included. Upstream files are unmodified:

| File | SHA-256 |
|---|---|
| `src/csr.rs` | `c64015ca5241ee7b18a89bed163d3a6932a21e441b6db2abe6197a4b75bb3a50` |
| `src/layout.rs` | `79e43ee3fcc19bd65c34bb5db6922bc32c5ff86d54185a93b7e555e8094cc22f` |

`src/main.rs` is the Diké-specific stdin adapter, not Graphium's source-discovery CLI. `src/incremental.rs` adds native pinned-node continuity, scale-aware sibling seeding and bounded spatial-bucket refinement of new nodes; it is not an upstream file. None imports Hermes. The HTTP adapters are outside the Rust core in `dashboard/graphium_engine.py` and `dashboard/plugin_api.py`.

## Build and exercise

From the plugin root:

```sh
python scripts/build_graphium.py
# After dependencies have been acquired, prove an offline build:
python scripts/build_graphium.py --offline
cargo test --locked --offline --manifest-path graphium/Cargo.toml
DIKE_TEST_NATIVE=1 python -m unittest discover -s tests -p test_graphium_engine.py -v
```

Cargo, a native toolchain and initial dependency acquisition are installation prerequisites; successful cached offline compilation does not prove an offline installation. Platform binaries are build artifacts, not committed here. The runtime never auto-compiles, downloads or silently switches engine during an HTTP request. An operator may set `DIKE_GRAPHIUM_BINARY` to an explicit executable; the default is plugin-local `graphium/bin/dike-graphium`.

## Contract and authority

`POST /grafo/graphium/layout` accepts a projection with `nodes` and `links`, returns `engine`, `gbin_b64` and `node_ids`. The ID at position N corresponds to GBIN node index N; exact IDs, including whitespace, are preserved. Metadata and original identifiers stay with Diké's legal panels. Rust sorts/deduplicates identical edges and omits self-links, so binary edge order is not input order. Edge kind encodes `[tipo, estado]` as JSON, retaining different statuses. Structural containment is marked structural; all other imported nodes/relations are review, never automatically canonical.

The ASGI route admits at most one graph body/operation per process before parsing. Raw bodies are limited to **16 MiB**, **250,000 JSON containers**, nesting depth **64**, and **10 seconds** of body reception. Complexity preflight counts containers outside strings before Python object allocation; it does not replace JSON syntax validation. The standalone native adapter has separate upper bounds of 200,000 nodes, 1,000,000 edges and 64 MiB serialized input. These are independent denial bounds, not a promise that every combination of maxima fits the HTTP transport or renders interactively. Rayon is bounded to two workers.

Responses: malformed graph fields return 400; JSON/body-shape validation can return 422; oversized/over-complex raw bodies return 413; slow bodies return 408; unavailable/busy/failed native engines return 503. Busy admission includes `Retry-After: 1`. The UI automatically retries only busy failures, respecting that delay, and exposes manual retry for other failures. Existing Hermes authentication is an enclosing host boundary whose installed behavior still needs rollout verification. No network client, remote fallback or runtime compilation is introduced.

The visor preserves known positions and camera state during expansion and refines only new nodes in Rust. **Recalcular distribución** explicitly clears the display-position pool, runs the full native layout and fits the camera; it never changes graph facts, evidence or review state. Position continuity is a display policy, not legal authority. A fresh owned canvas per React effect supports StrictMode remounts while releasing old GPU contexts.

## UI acceptance harness

`node scripts/check_graphium_ui.mjs` uses a fresh headless Chromium, actual WebGL2, an isolated ASGI server and the real native binary. To exercise the React boundary, first build its fixture with `node scripts/build_graphium_react_fixture.mjs /path/to/isolated/node_modules`, where that **test-only** directory contains React/React DOM 19.2.0. These dependencies are not installed in the plugin. The harness checks StrictMode, recovery, Retry-After spacing, deterministic-error non-retry, stale results, preset submission, explicit recomputation, overlap picking and context teardown. It is not installed-Hermes or physical-GPU acceptance.

## External vaults

No vault is bundled, connected or discovered automatically. A future explicit user-source connector must keep data in user storage, distinguish documentary links from reviewed legal knowledge, and support disconnect. This native projection contract is data-source agnostic; it does not itself implement that connector.
