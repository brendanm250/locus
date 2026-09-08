# Agent Workspace Rules

## Architecture & Agent Hierarchy
- **Orchestrator Role**: The main conversation agent acts as the technical orchestrator, lead reviewer, and backlog keeper:
  - Tracks high-level architectural goals and verifies incoming changes align with them.
  - Maintains a running backlog of deferred items, minor bugs/regressions spotted during review, and future user requests.
  - Scopes discrete tasks for subagents and directs execution.
- **Subagent Reporting**: Subagents communicate with and report to the **Orchestrator**, not the User.
- **Autonomous Planning**: Subagents should formulate a concise technical plan at the start of a task. If planning review is required, the subagent submits the plan to the Orchestrator for approval, never blocking on or prompting the User.
- **Self-Inspection & Verification**: Subagents must thoroughly inspect and verify their own work before reporting completion:
  - Run test suite: `python -m unittest discover tests`
  - For UI / rendering changes: validate in the browser using Chrome DevTools MCP (`take_screenshot`, `list_console_messages`, DOM checks) to ensure visual correctness and zero JS console errors.
  - Review diffs: subagents must run `git diff` on their changes to ensure no extraneous edits, regressions, or duplicate code before handoff.
  - Keep completion summaries sent back to the orchestrator concise and focused (bulleted change summary + test/verification results) to avoid context bloat.

## Autonomous Operation & Approval Economy
- **Pre-Approved Safe Commands (Run Autonomously)**: Agents should run routine, non-destructive commands directly without asking for confirmation:
  - Repository status & history inspection: `git status`, `git diff`, `git log`
  - Automated tests: `python -m unittest discover tests`, `python tests/<test_file>.py`
  - Web server validation: `python -m http.server <port>` or launching `start_server.bat`
- **Browser Automation & Screenshots**: Fully autonomous. Agents are authorized to inspect DOM state, take screenshots via Chrome DevTools MCP (`take_screenshot`), save them directly to artifact directories, and verify visuals without requesting prior user approval.
- **Native Tools First**: Always use native tools (`view_file`, `grep_search`, `find_by_name`, `list_dir`, `write_to_file`, `replace_file_content`). Never use shell fallbacks (`cat`, `type`, `grep`, `dir`, `ls`, or redirection `>`).
- **Standardized Commands**: Keep CLI invocations standard and predictable. Do NOT chain arbitrary shell commands with `;` or `&&`. Avoid inline code/heredocs (`python -c`, `@' ... '@ | python`).
- **Diagnostic Scripts**: If custom diagnostics are required, write a dedicated, clearly named script in `scratch/` rather than running inline snippets. Never silently overwrite existing scripts.

## Environment & Git
- **Branches**: Default repository branch is `main`. Subagents operate in feature branches.
- **Protected Actions (Require User Approval)**: Never push to remote, rebase/force-push, or commit directly to `main` without explicit user review of diffs and commit messages.
