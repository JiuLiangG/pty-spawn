---
name: pty-spawn
description: >
  Use when the command needs a real terminal: interactive prompts
  (apt install, npm init, ssh), colored output, or programs that
  check isatty().
---

## pty-spawn

Provides `pty_bash` — runs commands in a real PTY instead of a pipe.

### When to use pty_bash vs bash

| Use pty_bash | Use bash |
|---|---|
| Interactive prompts (Y/n, passwords) | Simple one-shot commands |
| Programs that check isatty() | grep, cat, ls (without --color) |
| Colored output you want to preserve | File manipulation |
| REPLs (python3, node, mysql) | git, npm scripts |

### Limitations

- Output is stripped of ANSI codes (plain text only)
- No full-screen TUI rendering (vim/htop output will be garbled)
- For full TUI support, use the g2-terminal extension instead
