# Agent instructions

Project-specific instructions for agents go above or below the block.

<!-- vitrina:block v=1 sha256=217c921a83daef0c7a21a4c828caf6f9e907b042472b713017214f98a4da9c14 -->
## Vitrina rules for agents

This repository follows the Vitrina protocol (see PROTOCOL.md in the vitrina repository). The rules apply to every agent and harness. Most are enforced: a guard in your harness, git hooks and GitHub reject what breaks them.

**You may**

- Work in a git worktree on a branch named `agent/<harness>/<topic>`.
- Edit code, tests and docs. Write handoffs, plans, prompts and audits in `.workshop/`, never in the root.
- Run the tests, `vitrina check .` and `vitrina fix --suggest`.
- Commit with exactly one trailer `Assisted-by: <harness>:<model>`, for example `Assisted-by: claude-code:claude-opus-5-5`.
- Push your `agent/*` branch, open a pull request with a summary written for humans and your session IDs, and merge it once the maintainer (@Grizaceo) has approved it.

**You may not, and what stops you**

- Push to `main`, force-push, delete branches or push tags. Stopped by the guard, the `pre-push` hook and GitHub rulesets.
- Skip hooks with `--no-verify` or change `core.hooksPath`. Stopped by the guard; CI runs every check again.
- Approve a pull request, or merge one that the maintainer (@Grizaceo) has not approved. Stopped by GitHub (an author cannot approve their own pull request) and by the guard.
- Change visibility, settings, rulesets, secrets, workflows or releases, or read credentials. Agents use a GitHub identity without admin or workflow permission, and the guard blocks the commands.
- Add `Signed-off-by`. Only a human signs.
- Put workshop files in the root. The allowed root files are listed in rule R1 of PROTOCOL.md.

If a guard blocks you, do not work around it. Write in the pull request what you needed, and the maintainer (@Grizaceo) decides.

**Before you commit**, run `vitrina check .`. The README keeps its order: Status, Quickstart, How it works, How this was built, Limits, after one plain sentence that says what this is. A translation carries the hash of its original; refresh it with `vitrina stamp <file>` after updating the text.
<!-- /vitrina:block -->
