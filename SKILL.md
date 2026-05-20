---
name: pty-spawn
description: >
  Use when the command needs a real terminal: interactive prompts
  (apt install, npm init, ssh), colored output, programs that
  check isatty(), or full-screen TUI programs (vim, htop, top).
---

## pty-spawn

Provides `pty_bash` — runs commands in a real PTY with headless terminal emulation.

### When to use pty_bash vs bash

| Use pty_bash | Use bash |
|---|---|
| Interactive prompts (Y/n, passwords) | Simple one-shot commands |
| Programs that check isatty() | grep, cat, ls (without --color) |
| Colored output you want to preserve | File manipulation |
| REPLs (python3, node, mysql) | git, npm scripts |
| Full-screen TUI (vim, htop, top) | |

### How it works

1. Commands run in a real PTY via `node-pty` (isatty=true)
2. Raw PTY output is fed into `@xterm/headless` — a real terminal emulator
3. The emulator's screen buffer is read as clean text for the LLM
4. If xterm is unavailable, falls back to regex-based ANSI stripping

### TUI output

When a command uses the alternate screen buffer (vim, htop, less), the output
is prefixed with `[TUI screen 80x24]` to indicate full-screen mode.
