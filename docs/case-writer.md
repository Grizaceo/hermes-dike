# The Case Writer (Desktop)

[Español](case-writer.es.md)

- **Studio layout, Strategy board and Word-like page.** The Case Writer opens
  as a studio with a collapsible, resizable **Strategy board** above the
  document (sticky notes, procedural templates for lawsuits, judgments,
  contracts and administrative rulings, directed links between cards, and a
  **Corpus search** panel over the sealed corpus), a centered Word-like page in
  the middle (formatting bar, `Write | Read` toggle, configurable paper
  themes and page widths), the **Hermes chat** docked on the right, and a
  vertical tool rail between them (Check, Privacy, Style, Board, Graph,
  Settings, Chat) that opens dedicated drawers for the citation verifier,
  privacy/pseudonymization, the **plain-language review** (style and
  argumentative structure of Spanish legal writing), the interactive case
  board, differentiated graph tools (corpus search/reader and the legal-system
  pack builder), and user preferences. The page is in English by default;
  the EN/ES switch in its header changes the interface, never the statute
  text or the engine codes.
- **Editor and verifier.** The brief is edited in place and saved per case.
  "Check citations" runs the same engine; each citation is marked in the
  text, and only an engine `VERIFICADA` on the exact current text shows as
  verified — any edit turns it back to "Text changed". A failed citation can
  be repaired (the replacement must pass the engine before it can be
  applied), withdrawn with a reason, or escalated.
- **From search.** In the Corpus graph's content search, "Add to brief"
  appends the article's canonical citation as a new paragraph at the end of
  the brief and runs the verifier on it like any other citation — it never
  arrives verified, and a derogated or not-yet-in-force article is expected
  to come back FALLO. The citation is a clue carried over, not a verified
  source, and the search query itself is never stored. Articles whose gid
  has no form the verifier grammar accepts cannot be carried over — the
  button stays disabled with the reason: 204 lettered-without-suffix
  articles (e.g. `art. 54 a`) and 1 `bis e` in the current corpus, because
  the grammar would resolve them to a different article.
- **Privacy.** Before any text leaves for a model, a rule-based detector
  marks national IDs, emails, phones, addresses, plates, names with context
  and sensitive data, keeps case numbers and judges, and replaces the rest
  with stable tokens (`[PERSONA_1]`). You see the list, keep or mask each
  value, mask a selection, and preview exactly what goes out. On the
  synthetic goldset it scores F1 0.979, above the detector it was ported
  from (0.9425), with recall 1.0 on IDs, emails and phones
  ([claims.json](../claims.json)); the goldset has little diversity, so this
  is a regression check, not proof that it generalizes.
- **Chat about the brief.** Each turn sends your question with the brief (or
  only the changed paragraphs) inside a `<dike-escritor v="1">` envelope.
  Two plugin hooks recognize that envelope: `pre_llm_call` adds fail-closed
  instructions to the user message (never to the system prompt) and
  `pre_tool_call` blocks every tool except skills, tool discovery and the
  verifier, which there accepts text only (never a file path), so the chat
  cannot reach the profile's terminal or files. If the instructions cannot
  be read, every turn of that session is blocked. Other chats are untouched. The
  citations in each reply go through the engine before they can show as
  verified.
- **Footnotes that open the node.** When the chat grounds a claim about an
  article it writes a note in the canonical form
  `[^n]: dike:a:<code>:<eid>#u<unit> «literal fragment» (optional citation)`.
  The fragment is the article text the claim rests on, quoted literally and
  20–400 characters long. The page checks three things before showing a
  note: the node id resolves in the corpus graph, the fragment is a literal
  substring of that node's text, and the optional citation parses. The note
  then shows one of its states — pending, verified (a chip that opens the
  exact node in the graph), mismatched, or unresolved — and a line reading
  "Relevance to the case is the model's reading; you decide.": whether the
  article is relevant is the model's reading and your decision, never the
  plugin's. "Review source in graph" and the verified chips jump straight to
  that node. "Insert into brief" adds the notes to the brief as plain text.
- **Live case board (NIF).** On request, the model proposes updates to the
  case's theory, the NIF (facts known,
  alleged and missing, norms, subjects, hypotheses, gaps). Each proposal
  must quote the brief literally and respect the NIF schema; nothing enters
  the case board until you accept it.
- **Prediction (experimental, off by default).** A layered predictor:
  deterministic procedural phrases, literal continuations from the corpus,
  and, only with your opt-in, a model completion that is pseudonymized when
  it would leave the machine.

## Choosing the profile the chat runs in

The Case Writer chat runs in a Hermes profile that has Diké enabled and a
model configured. By default that is the **active profile** — the one the
Desktop app is connected to. Two ways to change it:

- **Run everything in a dedicated profile.** Create it, install and enable
  Diké there, give it a model, and open the Desktop app on that profile.
  `--clone` copies the active profile's `config.yaml` (which carries the
  model), `.env`, `SOUL.md` and skills; `--clone-from <name>` clones a
  different source, and `--no-skills` makes a lean profile (configure a
  model afterwards):

  ```bash
  hermes profile create abogado-dike --clone
  hermes -p abogado-dike plugins install Grizaceo/hermes-dike --ref <sha>
  hermes -p abogado-dike plugins enable dike
  ```

- **Keep the dashboard on one profile and the chat on another.** Set the
  plugin's `perfil_chat` setting in the profile that serves the dashboard to
  the name of the profile that should run the chat (that profile still needs
  Diké and a model):

  ```bash
  hermes -p <dashboard-profile> config set plugins.entries.dike.settings.perfil_chat abogado-dike
  ```

  Leave `perfil_chat` empty (`""`) to use the active profile. The same key
  lives in that profile's `config.yaml` under
  `plugins.entries.dike.settings.perfil_chat`.

## Planned: one retrieval contract for search and prediction

Not implemented. This fixes the shape so a later retriever can plug in
without touching the UI or the verifier.

- **The contract is today's `/grafo/buscar` response.** A retriever takes a
  query and a limit and returns `rotulo`, `metodo` (`motor`, `determinista`,
  `modelo`), and `resultados` with `nodo_id`, `gid`, `score`, `score_rel`,
  `canal`, `cita`, `vigencia` and `materias`. Any new retriever returns that
  same shape, with `metodo.modelo` naming its model, and shows up as a
  separate `local_only` source. It never replaces the BM25 one silently.
- **Admission rule.** A model-based retriever, such as IndexO's e5 dense
  index, enters only if it beats BM25 recall@10 on a held-out goldset.
  `normas_qrels_v1` does not count: it is in-sample for BM25. Measured on
  2026-11-08 against that suite, the e5 index alone reached 0.032 against
  0.952 for BM25, and every fusion we tried scored lower. It is not
  admitted.
- **Prediction reuses it.** The predictor's corpus layers (L3/L4) may call
  the same contract with the current paragraph as the query. Each
  suggestion carries `procedencia: {tipo: 'busqueda', gid, motor}` and is
  never marked verified. A citation it inserts goes through the verifier
  like one carried over from search. The query never leaves the machine.
