import * as pty from "node-pty";
import type { PtyHandle, SpawnOptions } from "./types.js";

const activePtys = new Set<PtyHandle>();

/**
 * Wrap a command to disable PTY echo and line processing before execution.
 *
 * On Unix, `stty -echo` prevents the PTY from echoing input back.
 * `stty -onlcr` prevents \n → \r\n conversion in the output direction.
 */
function wrapCommand(command: string): string {
  if (process.platform === "win32") return command;
  return `stty -echo -onlcr 2>/dev/null; ${command}`;
}

/**
 * Spawn a command inside a real PTY.
 * The child process sees isatty()=true and TERM=xterm-256color.
 */
export function spawnPty(options: SpawnOptions): PtyHandle {
  const shell = process.platform === "win32" ? "cmd.exe" : "/bin/sh";
  const wrappedCommand = wrapCommand(options.command);
  const args =
    process.platform === "win32"
      ? ["/c", options.command]
      : ["-c", wrappedCommand];

  const ptyProcess = pty.spawn(shell, args, {
    name: "xterm-256color",
    cols: options.cols ?? 80,
    rows: options.rows ?? 24,
    cwd: options.cwd ?? process.cwd(),
    env: { ...process.env, ...options.env } as Record<string, string>,
  });

  let alive = true;

  ptyProcess.onData((data: string) => {
    options.onData(data);
  });

  ptyProcess.onExit(({ exitCode }) => {
    alive = false;
    activePtys.delete(handle);
    options.onExit(exitCode);
  });

  const handle: PtyHandle = {
    get isAlive() {
      return alive;
    },
    write(data) {
      if (alive) ptyProcess.write(data);
    },
    resize(cols, rows) {
      if (alive) ptyProcess.resize(cols, rows);
    },
    kill() {
      if (!alive) return;
      alive = false;
      activePtys.delete(handle);
      try {
        ptyProcess.kill();
      } catch {}
    },
  };

  activePtys.add(handle);
  return handle;
}

/** Kill all active PTYs created by this extension */
export function killAllPtys(): void {
  for (const h of [...activePtys]) h.kill();
}
