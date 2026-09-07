# Agent Workspace Rules

## Autonomous Operation & Approval Economy
- **Pre-Approved Safe Commands (Run Autonomously)**: Agents should run routine, non-destructive commands directly without asking for confirmation:
  - Repository status & history inspection: `git status`, `git diff`, `git log`
  - Automated tests: `python -m unittest discover tests`, `python tests/<test_file>.py`
  - Web server validation: `python -m http.server <port>` or launching `start_server.bat`
- **Browser Automation & Screenshots**: Fully autonomous. Agents are authorized to inspect DOM state, take screenshots via Chrome DevTools MCP (`take_screenshot`), copy/save screenshots to artifact directories, and embed visual captures into walkthroughs/reports without requesting prior user approval.
- **Native Tools First**: Always use native tools (`view_file`, `grep_search`, `find_by_name`, `list_dir`, `write_to_file`, `replace_file_content`). Never use shell fallbacks (`cat`, `type`, `grep`, `dir`, `ls`, or redirection `>`).
- **Standardized Commands**: Keep CLI invocations standard and predictable. Do NOT chain arbitrary shell commands with `;` or `&&`. Avoid inline code/heredocs (`python -c`, `@' ... '@ | python`).
- **Diagnostic Scripts**: If custom diagnostics are required, write a dedicated, clearly named script in `scratch/` rather than running inline snippets. Never silently overwrite existing scripts.

## Environment & Git
- **Branches**: Default repository branch is `main`. Subagents operate in feature branches.
- **Protected Actions (Require User Approval)**: Never push to remote, rebase/force-push, or commit directly to `main` without explicit user review of diffs and commit messages.
