# pty-spawn

A minimal [pi](https://github.com/earendil-works/pi) extension that runs bash commands in a real PTY with headless terminal emulation. Supports both one-shot commands and persistent interactive sessions.

## Why

pi's built-in `bash` tool uses `stdio: "pipe"`, so `isatty()` returns `false`. Many programs behave differently (or refuse to work) without a terminal. This extension fixes that with two dependencies: `node-pty` for the PTY layer and `@xterm/headless` for terminal emulation.

## What it does

### One-shot commands (`pty_bash`)

- Spawns commands via `node-pty` instead of `child_process.spawn`
- Child process sees `isatty()=true` and `TERM=xterm-256color`
- Raw PTY output is fed into `@xterm/headless` — a real terminal emulator
- Screen buffer is read as clean text for the LLM (no ANSI codes, correct cursor positioning)
- Full-screen TUI programs (vim, htop, top) render correctly via alternate screen buffer detection
- Falls back to regex-based ANSI stripping if `@xterm/headless` is unavailable
- Supports timeout and cancellation (Escape)

### Persistent sessions (`pty_start` / `pty_send` / `pty_read` / `pty_close`)

- Start an interactive shell session that persists across multiple tool calls
- Send commands, keystrokes, and control characters to the running session
- Read the current terminal screen at any time (snapshot mode)
- Multiple concurrent sessions with independent state
- Supports REPLs (Python, Node), SSH, databases, and any interactive program
- Automatic cleanup on extension shutdown

## Install

### Local development

```bash
pi -e ./pty-spawn/src/index.ts
```

### Project-level

```bash
cp -r pty-spawn .pi/extensions/pty-spawn
cd .pi/extensions/pty-spawn && npm install
```

### Global

```bash
cp -r pty-spawn ~/.pi/agent/extensions/pty-spawn
cd ~/.pi/agent/extensions/pty-spawn && npm install
```

## Usage

### One-shot commands

The LLM will automatically choose `pty_bash` when SKILL.md guidance applies. You can also explicitly ask: "use pty_bash to run ..."

```bash
# Interactive prompts work
pty_bash("apt install nginx")        # Y/n prompt works
pty_bash("npm init")                  # interactive wizard works

# Programs detect terminal presence
pty_bash("python3 -c 'print(1)'")    # runs with isatty=true

# Full-screen TUI programs render correctly
pty_bash("htop")                      # screen captured via xterm emulation
```

### Persistent sessions

For multi-turn interactions, use the session tools:

```
# Start a Python REPL session
pty_start()                           → sessionId: "s1"
pty_send("s1", "python3\n")          → ">>> "
pty_send("s1", "import math\n")      → ">>> "
pty_send("s1", "math.pi\n")          → "3.141592653589793\n>>> "
pty_close("s1")

# SSH session
pty_start()                           → sessionId: "s2"
pty_send("s2", "ssh user@host\n")    → "Password: "
pty_send("s2", "mypassword\n")       → "user@host:~$ "
pty_send("s2", "ls\n")              → file listing
pty_close("s2")

# Special keys
pty_send("s1", "\t")                  # Tab (autocomplete)
pty_send("s1", "\x03")               # Ctrl+C (interrupt)
pty_send("s1", "\x04")               # Ctrl+D (EOF)
```

## Architecture

```
PTY (node-pty)  →  raw bytes  →  ScreenRenderer (@xterm/headless)  →  clean text
                                         ↓ fallback (pty_bash only)
                                  cleanOutput (regex pipeline)
```

- **G2a layer** (`pty-manager.ts`, `clean-output.ts`): PTY spawning + regex-based output cleaning
- **G2b layer** (`screen-renderer.ts`): Headless terminal emulation via `@xterm/headless`
- **G2c layer** (`session-manager.ts`, `session-tools.ts`): Persistent session lifecycle management
- **Integration** (`pty-bash-tool.ts`): Uses G2b when available, falls back to G2a

## File structure

```
pty-spawn/
├── package.json              # pi extension manifest + deps (v0.3.0)
├── tsconfig.json
├── README.md
├── SKILL.md                  # LLM guidance
├── src/
│   ├── index.ts              # Extension entry (~25 lines)
│   ├── types.ts              # Shared types: PtyHandle, SpawnOptions, ScreenSnapshot (~40 lines)
│   ├── pty-manager.ts        # PTY lifecycle: spawn, kill, cleanup (~70 lines)
│   ├── clean-output.ts       # G2a regex pipeline: fallback output cleaning (~80 lines)
│   ├── screen-renderer.ts    # G2b core: @xterm/headless wrapper (~120 lines)
│   ├── pty-bash-tool.ts      # One-shot tool registration + execution (~110 lines)
│   ├── session-manager.ts    # G2c core: persistent session lifecycle (~80 lines)
│   └── session-tools.ts      # G2c tool registration: pty_start/send/read/close (~120 lines)
└── test/
    ├── pty-manager.test.ts   # PTY unit tests (~40 lines)
    ├── screen-renderer.test.ts # ScreenRenderer tests (~90 lines)
    └── session-manager.test.ts # Session manager tests (~80 lines)
```

Total: ~835 lines.

## License

MIT
