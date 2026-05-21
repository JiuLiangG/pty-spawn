---
name: pty-spawn
description: >
  Use when the command needs a real terminal: interactive prompts
  (apt install, npm init, ssh), colored output, programs that
  check isatty(), or full-screen TUI programs (vim, htop, top).
  Use persistent sessions for multi-turn interactions (REPLs, ssh, databases).
---

## pty-spawn

Provides `pty_bash` for one-shot PTY commands and `pty_start`/`pty_send`/`pty_read`/`pty_close` for persistent interactive sessions.

### When to use pty_bash vs bash

| Use pty_bash | Use bash |
|---|---|
| Interactive prompts (Y/n, passwords) | Simple one-shot commands |
| Programs that check isatty() | grep, cat, ls (without --color) |
| Colored output you want to preserve | File manipulation |
| Full-screen TUI (vim, htop, top) | git, npm scripts |

### When to use persistent sessions

| Use pty_start + pty_send | Use pty_bash |
|---|---|
| Multi-turn REPL (python3, node, mysql) | Single command execution |
| SSH sessions with multiple commands | One-shot scripts |
| Interactive debugging sessions | Commands that exit on their own |
| Programs requiring multiple inputs over time | Short-lived interactions |

### How it works

1. Commands run in a real PTY via `node-pty` (isatty=true)
2. Raw PTY output is fed into `@xterm/headless` — a real terminal emulator
3. The emulator's screen buffer is read as clean text for the LLM
4. If xterm is unavailable, falls back to regex-based ANSI stripping (pty_bash only)

### Persistent sessions (multi-turn interaction)

| Tool | Purpose |
|---|---|
| pty_start | Start a new interactive session |
| pty_send | Send input (commands, keystrokes) |
| pty_read | Read current screen without sending |
| pty_close | End session and clean up |

Typical workflow:
1. `pty_start()` → get sessionId + initial prompt
2. `pty_send(sessionId, "python3\n")` → see `>>> `
3. `pty_send(sessionId, "1+1\n")` → see `2` and `>>> `
4. `pty_close(sessionId)`

Special keys: `\n`=Enter, `\t`=Tab, `\x03`=Ctrl+C, `\x04`=Ctrl+D

### TUI output

When a command uses the alternate screen buffer (vim, htop, less), the output
is prefixed with `[TUI screen 80x24]` to indicate full-screen mode.
