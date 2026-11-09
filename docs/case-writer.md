# The Case Writer (Desktop)

[Español](case-writer.es.md)

- **Editor and verifier.** The brief is edited in place and saved per case.
  "Verificar citas" runs the same engine; each citation is marked in the
  text, and only an engine `VERIFICADA` on the exact current text shows as
  verified — any edit turns it back to "out of date". A failed citation can
  be repaired (the replacement must pass the engine before it can be
  applied), withdrawn with a reason, or escalated, following the loop of
  Diké Shield.
- **Privacy.** Before any text leaves for a model, a rule-based detector
  marks national IDs, emails, phones, addresses, plates, names with context
  and sensitive data, keeps case numbers and judges, and replaces the rest
  with stable tokens (`[PERSONA_1]`). You see the list, keep or mask each
  value, mask a selection, and preview exactly what goes out. On the
  synthetic goldset it matches the detector it was ported from (F1 0.94,
  recall 1.0 on IDs, emails and phones; [claims.json](../claims.json)).
- **Chat about the brief.** Each turn sends your question with the brief (or
  only the changed paragraphs) inside a `<dike-escritor v="1">` envelope.
  Two plugin hooks recognize that envelope: `pre_llm_call` adds fail-closed
  instructions to the user message (never to the system prompt) and
  `pre_tool_call` blocks every tool except skills and the verifier, so the
  chat cannot reach the profile's terminal. Other chats are untouched. The
  citations in each reply go through the engine before they can show as
  verified.
- **Live NIF.** On request, the model proposes NIF updates (facts known,
  alleged and missing, norms, subjects, hypotheses, gaps). Each proposal
  must quote the brief literally and respect the NIF schema; nothing enters
  the case board until you accept it.
- **Prediction (experimental, off by default).** A layered predictor:
  deterministic procedural phrases, literal continuations from the corpus,
  and, only with your opt-in, a model completion that is pseudonymized when
  it would leave the machine.
