# pty-spawn

PTY-based execution extension for [pi](https://github.com/earendil-works/pi) — makes `isatty()=true`, with headless terminal emulation, persistent sessions, and **real-time session observation**.

## Features

### G2a: PTY Execution (`pty_bash`)
Run commands in a real PTY where `isatty()` returns true. Supports colored output, TUI programs, and anything that checks for terminal presence.

### G2b: Terminal Emulation (`ScreenRenderer`)
Headless terminal emulation via `@xterm/headless`. Correctly renders full-screen TUI programs (vim, htop, etc.) and produces clean text output for LLM consumption.

### G2c: Persistent Sessions (`pty_start/send/read/close`)
Long-lived interactive terminal sessions for multi-turn interactions. Use for REPLs, SSH, database clients, or any interactive program.

### G2d: Session Observation (`pty-spawn attach`) 🆕
Real-time terminal mirroring — observe any PTY session from another terminal window. See exactly what's happening: colors, TUI rendering, everything.

## MCP Tools

| Tool | Description |
|------|-------------|
| `pty_bash` | One-shot command execution in a real PTY |
| `pty_start` | Start a persistent interactive session |
| `pty_send` | Send input to a session (include `\n` for Enter) |
| `pty_read` | Read current screen without sending input |
| `pty_close` | Close a session and free resources |

## CLI Commands

The CLI connects to the IPC server running inside the pty-spawn extension process.

```bash
# List all active sessions
pty-spawn list

# Attach to a session (real-time terminal mirror)
pty-spawn attach s1
```

### `pty-spawn list`

Shows all active PTY sessions across all running Pi instances:

```
  ID        Status
  s1        running
  s2        exited(0)
```

### `pty-spawn attach <sessionId>`

Mirrors a session's terminal output in real-time. You see exactly what the PTY produces — colors, cursor movement, TUI rendering — as if you were sitting in front of that terminal.

- **Read-only**: Your keystrokes are NOT sent to the session
- **Ctrl+C**: Detaches (stops observing) without killing the session
- **History replay**: Shows the full terminal history when you attach

#### Use Case: Observing Pi(A) controlling Pi(B)

```
Terminal Tab 1: You ↔ Pi(A)        Terminal Tab 2: pty-spawn attach s1
┌─────────────────────────┐        ┌─────────────────────────┐
│ You: Run the tests      │        │ $ npm test              │
│ A: OK, sending command  │        │ > vitest run            │
│    to session s1...     │        │ ✓ test/foo (3 tests)    │
│ A: Tests all passed!    │        │ ✓ test/bar (5 tests)    │
│                         │        │ Tests: 8 passed         │
└─────────────────────────┘        └─────────────────────────┘
```

## Architecture

```
┌─────────────────────────────────────────┐
│  pty-spawn MCP Server Process           │
│                                         │
│  ┌─────────────┐    ┌──────────────┐    │
│  │ Session Mgr  │──▶│ IPC Server   │◀── TCP localhost
│  │ (sessions)   │   │ (auto port)  │    │
│  └──────┬──────┘    └──────────────┘    │
│         │                               │
│         ▼                               │
│  ┌─────────────┐                        │
│  │  PTY (B)    │                        │
│  │  node-pty   │                        │
│  └─────────────┘                        │
└─────────────────────────────────────────┘
         ▲ TCP connect
         │
┌────────┴────────┐
│  CLI: attach    │
│  (your terminal)│
│  real-time view │
└─────────────────┘
```

The IPC server uses NDJSON (newline-delimited JSON) over TCP localhost. PTY output is base64-encoded for safe binary transport. Port discovery uses temp files (`/tmp/pty-spawn-ipc-{pid}.port`).

## File Structure

```
pty-spawn/
├── package.json              # v0.4.0, pi extension manifest + CLI bin
├── tsconfig.json
├── README.md
├── SKILL.md                  # LLM guidance
├── src/
│   ├── index.ts              # Extension entry: register tools + start IPC server
│   ├── types.ts              # Shared types: PtyHandle, SpawnOptions, ScreenSnapshot
│   ├── pty-manager.ts        # PTY lifecycle: spawn, kill, cleanup
│   ├── clean-output.ts       # G2a regex pipeline: fallback output cleaning
│   ├── screen-renderer.ts    # G2b: @xterm/headless wrapper
│   ├── pty-bash-tool.ts      # One-shot tool registration + execution
│   ├── session-manager.ts    # G2c+G2d: persistent sessions + EventEmitter + attach exports
│   ├── session-tools.ts      # G2c tool registration: pty_start/send/read/close
│   ├── ipc-protocol.ts       # G2d: NDJSON message types + encode/parse helpers
│   ├── ipc-server.ts         # G2d: TCP IPC server for attach/list
│   └── cli/
│       ├── index.ts           # CLI entry point (command router)
│       ├── attach.ts          # CLI attach command (real-time mirror)
│       └── list.ts            # CLI list command (enumerate sessions)
└── test/
    ├── pty-manager.test.ts
    ├── screen-renderer.test.ts
    ├── session-manager.test.ts
    ├── ipc-server.test.ts     # G2d: IPC server unit tests
    └── cli-attach.test.ts     # G2d: CLI attach integration tests
```

## Install

### Local development

```bash
pi -e ./pty-spawn/src/index.ts
```

### CLI (after build)

```bash
npm run build
npm link          # Makes 'pty-spawn' command available globally
pty-spawn list    # List sessions
pty-spawn attach s1  # Attach to session
```

## Version History

- **v0.4.0** — G2d: Session observation (`pty-spawn attach/list` CLI)
- **v0.3.0** — G2c: Persistent sessions (`pty_start/send/read/close`)
- **v0.2.0** — G2b: Headless terminal emulation (`ScreenRenderer`)
- **v0.1.0** — G2a: PTY execution (`pty_bash`)

## License

MIT
