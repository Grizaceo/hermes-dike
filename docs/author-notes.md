# Author's notes

[Español](author-notes.es.md)

By Cristóbal Muñoz, who decided and reviewed what this plugin does. The
original is in Spanish.

This project began as separate local applications, part of my own experiments
in how to bring law and AI together.

## The knowledge graph

The first thing I designed, and worked on through the first half of the year,
was legal knowledge graphs. A graph is the meeting point between two things:
the lawyer's own prior work, accumulated in a graph that the lawyer approves
and edits, and the retrieval and answers produced by AI models. The graph is
always the hard limit. The idea is fail-closed: the system would rather abstain
than answer from what the model remembers from its training. The graph is meant
to be the hinge that lets lawyers keep control over what a model reasons about,
and how, while still using the speed of an LLM to strengthen their work.

I built the graphs from official Chilean public APIs that give access to
legislation, case law and administrative decisions. Acquisition and building
are paused for now, because Chile is still debating how that information may
properly be used with AI by a service like the one Diké proposes.

## Modules around the graph

Once the graph took shape, I saw that on its own it was not enough for what
Diké could offer as a way to use AI in 2026. So I started building modules
around it, each with the graph as its base, to make up a complete stack for
legal work built on graphs.

- **The Case Writer** was conceived from the start as an agentic, Word-like
  editor. You talk to a restricted AI chat, the knowledge-graph tools are
  native, and the model's advice and reviews speed up the writing, with the
  context of what you have written and access to the graphs.
- **The Strategy board.** I added a canvas-style board to the Case Writer to
  help lawyers build the theory of the case the way we were taught in law
  school: on a board, requirement by requirement, fact by fact, so the theory
  can be seen as it is built.
- **The NIF (Normative Interactive Framework).** The board fell short as a way
  to build the theory of the case, because the model in the Case Writer is
  meant to advise rather than to propose. So I designed the NIF as the space
  where the model builds the theory of the case from what it understands of
  the brief and whatever context the lawyer gives it, and where the lawyer can
  simply review it and correct what the model takes the theory of the case to
  be. That way both speak the same language while working on the case, and
  misunderstandings do not surface only at the end, when the lawyer finds that
  the model was never talking about the same thing.

  To build the NIF, I designed locally, and am still developing, an adaptation
  of the classic legal research method to agentic work with AI models across
  several profiles: an agentic legal research methodology. For lack of time I
  could not add all the legal profiles the methodology needs, so the plugin
  carries an adapted version. I will keep working on adding it properly.
- **The citation check** is Diké's core: the deterministic part of the system,
  which keeps the model from asserting things it is not sure of and affecting
  the lawyer's judgment.

## What was built or adjusted for the hackathon

- **Pseudonymization.** I already had a set of scripts, protocols and skills to
  anonymize documents. For the hackathon they became a tool inside the Case
  Writer.
- **Graph building.** The tools, scripts and skills for building graphs were
  scattered across my Hermes profiles. Here they were packaged so that others
  can build graphs for their own jurisdictions.
- **LexO Escribe Claro** (the plain-language review) is inspired by an AI tool
  the Chilean judiciary uses so that judges and legal practitioners write in a
  way laypeople can understand, to improve access to justice. I carried the
  idea into the Case Writer: if the courts write this way, lawyers should write
  their briefs this way too. Arguments served ready to use make the judge's
  work easier, which also improves one's own chances in the case, and it helps
  access to justice.

## What I decided, and how I reviewed it

Every module in the plugin was planned and thought out by me. So were others
that complement them but did not make it into the hackathon for lack of time:
the scrapers for judgments, administrative decisions and statutes, and above
all the text predictor. That predictor is meant to work the way GitHub Copilot
did at the beginning of AI coding, suggesting rather than writing the code
itself: context-aware suggestions for legal documents as the lawyer writes. For
lack of time, and because I do not have the funds to train a specialized model
to test the concept in the cloud, it stays an experimental feature.

AI tools such as Hermes helped me build what I envision. But I tested and
thought through every feature as help for my own profession as a law
graduate, from one point of view: what help would a lawyer accept, without
losing sight of the fact that it is the lawyer, not an AI model, who practices
law.

So every module was decided and reviewed by me from a legal perspective, that
is, for its usefulness to a lawyer. I have been learning to program, but my
knowledge is still basic. My testing was dogfooding, as a lawyer using the
interface. It was not a review of the code for problems underneath that could
fail silently, which a lawyer using the interface would not notice.

## Why Hermes, and why the name

I intend to keep working on the plugin whatever the results of the hackathon.
At some point this year I was working on the graph, the Case Writer and the
legal-reviewer, the tool I use to turn a document into nodes and edges in a
graph, or to extract its citations, which are imported automatically into the
Case Writer. I realized I was losing a lot of time debugging the tools and
agentic chats I was trying to integrate into my own stack, instead of working
on what I know best, which is law.

So halfway through I stopped building my own agentic stack and took Hermes as
the base, above all for its signature feature: creating and saving skills
automatically at the end of each session. That is very much how lawyers work.
After a case in an area they did not know, the next one is much easier,
because law is repetitive, much like AI harnesses and skills. That is why I
chose Hermes as the agentic engine of the legal stack I am trying to build, and
why the stack is called Diké (also Dike or Dicea), following the Greek gods that
Hermes started. Its provisional name was LexO, for "lex orchestration".
