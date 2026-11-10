# How the code is organized

This page is for someone who is about to read or change the code. What the
plugin does for a user is in the [README](../README.md); every effect it has
on the machine is in [DISCLOSURES.md](DISCLOSURES.md).

## The idea in one paragraph

The Diké engine (`motor/`) decides whether a citation is verified. It is
vendored unchanged and this repository never edits it. Everything else is an
adapter around it: code that gets text to the engine safely, checks what the
engine answers before repeating it, and puts the result in front of a person.
The adapter may remove a certification (when the answer is malformed, or a
citation names two statutes). It never adds one.

## The pieces

| Where | Job |
|---|---|
| `motor/`, `corpus/` | The vendored engine and the sealed corpus package. `VENDORED.json` records the commit and every file's hash; `scripts/vendor_engine.py --check` verifies the copy, and a test runs it. |
| `__init__.py` | The adapter Hermes loads. Input handling and limits, installing the corpus and checking its integrity, the contract check on the engine's answer, the two-statute guard, the three tools, the two slash commands, `register`. |
| `aislamiento.py` | How a child process is run: the bubblewrap profile, the sandbox policy (`auto` or required), the one-shot runner `ejecutar`, and `consultar`, the client of the engine server. |
| `scripts/motor_servidor.py` | The engine server. It lets the engine verify the corpus once, then forks one short-lived child per request, which runs the real command and exits. |
| `scripts/panel.py` | A JSON driver over the engine's own modules for what the interfaces need: reading an article, content search, graph metadata, case boards. It runs inside the same sandbox. |
| `lector_docx.py` | A `.docx` reader on the standard library, with limits, so the adapter needs no Word library. |
| `textos.py` | What the Python side says to a person, in English and Spanish. |
| `escritor/` | The Case Writer's server side: the two hooks that keep the chat in its lane (`hooks.py`), the instructions they inject, and the plain-language review (`escribe_claro.py`). |
| `privacidad/` | The rule-based detector of personal data, the stable pseudonyms per case, and the log of what was sent (a hash, never the text). |
| `ordenamiento/` | Statute packs for other legal systems from a declarative profile: build and validate. |
| `dashboard/` | `plugin_api.py`, the HTTP backend both interfaces call at `/api/plugins/dike`, and the web dashboard tab (`dist/index.js`, written by hand, no build). |
| `desktop/` | The Desktop page. Source in `src/`, built into the single file `plugin.js`; `dev/` is a browser harness with a mock backend. |
| `skills/` | Two skills the plugin registers. |
| `tests/` | The Python tests. `desktop/test/` holds the JavaScript ones. |

## A citation check, end to end

1. `verificar_citas` validates the input (`_texto_input`): one of `texto` or
   `ruta`, size limits, no symbolic links, no control characters. A `.docx`
   is read here, not in the engine.
2. `_asegurar_corpus` installs the corpus on first use and, on every call,
   compares the installed files' names, sizes and dates with the install
   record (`_verificar_generacion`). It returns the generation and a
   signature of the state it just checked.
3. The brief is written to a per-call folder and the request goes to the
   engine server for that generation (`_consultar_motor` →
   `aislamiento.consultar`). If the signature, the day or the sandbox state
   changed, the server is restarted and the engine verifies everything again.
   If the server is busy or fails, the same command runs as a one-shot child
   (`_dike` → `aislamiento.ejecutar`).
4. `_validar_constancia` checks the answer against the contract: verdicts,
   counts that add up, a well-formed identifier, source and hash for every
   verified citation, dates that make sense. Anything else is an error.
5. `_degradar_cuerpos_en_conflicto` removes the certification of a citation
   whose text names two statutes. `_enriquecer_nodo_id` adds the graph node of
   each verified citation and can never change a verdict.
6. `_salida_publica` builds what the caller sees: the engine's evidence, the
   scope of what was and was not checked, and no local paths.

The Desktop page and the dashboard tab reach the same function through
`POST /verificar`, which takes text only.

## Process boundaries

- **The Hermes process** runs the adapter, the HTTP backend, the hooks, the
  privacy module and the `.docx` reader.
- **A sandboxed child** runs the engine and `scripts/panel.py`: no network,
  the sealed corpus read-only, only its caches writable. Without bubblewrap
  the same command runs unsandboxed and every answer says so; with the policy
  set to required, nothing runs.
- **The model** runs in the user's own Hermes gateway and only when the user
  acts in the Case Writer. The plugin never calls a model itself.

## Conventions worth knowing before changing anything

- **Fail closed.** An error is a typed error with a stable code, never a
  pass. Presentation (language, labels) may fail open; certification may not.
- **Keys and codes are the contract.** JSON keys and codes (`veredicto`,
  `VERIFICADA`, `INPUT_EMPTY`…) are in Spanish, are read by both interfaces
  and the tests, and do not change with the display language.
- **The codebase's language is Spanish** (identifiers, comments, commit
  messages); what a user reads is English first, Spanish optional.
- **Modules are loaded by path.** Hermes imports the adapter as a package, the
  backend and the tests load it with `spec_from_file_location`, and the engine
  must never be imported into the Hermes process. Sibling modules are
  therefore loaded by absolute path under a fixed name (`dike_aislamiento`,
  `dike_lector_docx`…), which also makes them shared between both loaders.
- **One request to the engine server must be repeatable.** Only read-only
  requests on the sealed corpus go through it, because a failed request is
  retried as a one-shot child.
- **The page styles itself.** The Desktop app compiles only the style classes
  its own code uses, so `desktop/estilos.mjs` generates the page's stylesheet
  at build time, scoped under `.dike-raiz`. Colours come from the app's theme
  tokens through the `--dk-*` variables in `desktop/src/estilos.css`; a test
  refuses colour literals in the page's source.

## Working on it

```bash
# Python tests (the interpreter is the one Hermes runs on; see claims.json)
$HERMES_PYTHON -m pytest tests -q -p no:cacheprovider --basetemp=<a dir on disk>

# Desktop page: tests, the browser harness, and the bundle
cd desktop && npm ci
node --test test/
npm run dev:build && npm run dev:serve     # http://127.0.0.1:4173/?theme=dark&lang=es
npm run build && npm run check             # writes plugin.js and BUNDLE.json
```

One real corpus install is about 68,000 files, so point `--basetemp` at a
disk, not at a small tmpfs. The tests share one installed corpus per session
(`tests/conftest.py`); tests that tamper with it or move it use private copies.
Node.js and npm are needed only to rebuild the page; the shipped
`desktop/plugin.js` needs neither.
