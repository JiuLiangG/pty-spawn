# pty-spawn

A minimal [pi](https://github.com/earendil-works/pi) extension that runs bash commands in a real PTY.

## Why

pi's built-in `bash` tool uses `stdio: "pipe"`, so `isatty()` returns `false`. Many programs behave differently (or refuse to work) without a terminal. This extension fixes that with a single dependency: `node-pty`.

## What it does

- Spawns commands via `node-pty` instead of `child_process.spawn`
- Child process sees `isatty()=true` and `TERM=xterm-256color`
- ANSI escape sequences are stripped before returning output to the LLM
- Supports timeout and cancellation (Escape)
- Cleans up all PTY processes on session shutdown

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

The LLM will automatically choose `pty_bash` when SKILL.md guidance applies. You can also explicitly ask: "use pty_bash to run ..."

### Examples of commands that benefit from PTY

```bash
# Interactive prompts work
pty_bash("apt install nginx")        # Y/n prompt works
pty_bash("npm init")                  # interactive wizard works

# Programs detect terminal presence
pty_bash("python3")                   # REPL starts properly
pty_bash("ssh user@host")             # password prompt works

# Colored output is captured (then stripped for LLM)
pty_bash("ls --color=always")
pty_bash("cargo build 2>&1")
```

## File structure

```
pty-spawn/
├── package.json              # pi extension manifest + deps
├── tsconfig.json
├── README.md
├── SKILL.md                  # LLM guidance
├── src/
│   ├── index.ts              # Extension entry (~20 lines)
│   ├── pty-manager.ts        # PTY lifecycle (~70 lines)
│   ├── pty-bash-tool.ts      # Tool definition (~100 lines)
│   └── types.ts              # Shared types (~20 lines)
└── test/
    └── pty-manager.test.ts   # Unit tests (~40 lines)
```

Total: ~310 lines.

## Roadmap

This is **G2a** — the PTY pipe layer. Future additions:

- **Persistent sessions** (+~100 lines): `pty_start` / `pty_send` / `pty_read` for multi-turn interactive sessions
- **Terminal emulation** (+~500 lines): `@xterm/headless` rendering for full TUI support (becomes g2-terminal / G2a+G2b)

Each layer is purely additive — no existing code needs to change.

## License

MIT
