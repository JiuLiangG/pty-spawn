# pty-spawn

A minimal [pi](https://github.com/earendil-works/pi) extension that runs bash commands in a real PTY with headless terminal emulation.

## Why

pi's built-in `bash` tool uses `stdio: "pipe"`, so `isatty()` returns `false`. Many programs behave differently (or refuse to work) without a terminal. This extension fixes that with two dependencies: `node-pty` for the PTY layer and `@xterm/headless` for terminal emulation.

## What it does

- Spawns commands via `node-pty` instead of `child_process.spawn`
- Child process sees `isatty()=true` and `TERM=xterm-256color`
- Raw PTY output is fed into `@xterm/headless` — a real terminal emulator
- Screen buffer is read as clean text for the LLM (no ANSI codes, correct cursor positioning)
- Full-screen TUI programs (vim, htop, top) render correctly via alternate screen buffer detection
- Falls back to regex-based ANSI stripping if `@xterm/headless` is unavailable
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

# Full-screen TUI programs render correctly
pty_bash("htop")                      # screen captured via xterm emulation
pty_bash("vim file.txt")              # alternate buffer detected

# Colored output is captured and cleaned
pty_bash("ls --color=always")
pty_bash("cargo build 2>&1")
```

## Architecture

```
PTY (node-pty)  →  raw bytes  →  ScreenRenderer (@xterm/headless)  →  clean text
                                         ↓ fallback
                                  cleanOutput (regex pipeline)
```

- **G2a layer** (`pty-manager.ts`, `clean-output.ts`): PTY spawning + regex-based output cleaning
- **G2b layer** (`screen-renderer.ts`): Headless terminal emulation via `@xterm/headless`
- **Integration** (`pty-bash-tool.ts`): Uses G2b when available, falls back to G2a

## File structure

```
pty-spawn/
├── package.json              # pi extension manifest + deps (v0.2.0)
├── tsconfig.json
├── README.md
├── SKILL.md                  # LLM guidance
├── src/
│   ├── index.ts              # Extension entry (~20 lines)
│   ├── types.ts              # Shared types: PtyHandle, SpawnOptions, ScreenSnapshot (~40 lines)
│   ├── pty-manager.ts        # PTY lifecycle: spawn, kill, cleanup (~70 lines)
│   ├── clean-output.ts       # G2a regex pipeline: fallback output cleaning (~80 lines)
│   ├── screen-renderer.ts    # G2b core: @xterm/headless wrapper (~120 lines)
│   └── pty-bash-tool.ts      # Tool registration + execution (~110 lines)
└── test/
    ├── pty-manager.test.ts   # PTY unit tests (~40 lines)
    └── screen-renderer.test.ts # ScreenRenderer tests (~90 lines)
```

Total: ~570 lines.

## Roadmap

- **Persistent sessions** (+~100 lines): `pty_start` / `pty_send` / `pty_read` for multi-turn interactive sessions

## License

MIT
