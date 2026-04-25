@AGENTS.md

<!-- BEGIN BEADS INTEGRATION -->
## Beads Issue Tracker

This project uses **bd (beads)** as the shared cross-agent issue tracker for Claude and Codex work, including parallel worktrees. Run `bd prime` for the current workflow context and command reference.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for durable repo work, cross-agent handoffs, dependencies, and worktree coordination.
- Keep TodoWrite available for short-lived in-session checklists when useful.
- Keep `MEMORY.md` available for auto-memory. Use `bd remember` only when the knowledge should live in beads.
- Run `bd prime` at session start for detailed command reference and current tracker context.

## Session Completion

When ending a work session:

1. File `bd` issues for durable follow-up work.
2. Run relevant quality gates when code changed.
3. Update or close related `bd` issues.
4. Commit beads and code changes together when appropriate.
5. Push only when the user/request explicitly asks for it or approval has been given.
6. Leave enough context for the next Claude or Codex session to resume cleanly.
<!-- END BEADS INTEGRATION -->
