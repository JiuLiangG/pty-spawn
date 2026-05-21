import * as pty from "node-pty";
import { ScreenRenderer } from "./screen-renderer.js";
import type { PtyHandle } from "./types.js";

export interface Session {
  id: string;
  handle: PtyHandle;
  renderer: ScreenRenderer;
  rawOutput: string;
  exited: boolean;
  exitCode: number | null;
}

const sessions = new Map<string, Session>();
let counter = 0;

/**
 * Create a persistent interactive shell session.
 * Spawns the default shell (bash on Unix, cmd.exe on Windows)
 * with a ScreenRenderer for terminal emulation.
 */
export function createSession(cwd?: string): Session {
  const id = "s" + (++counter);
  const cols = 80;
  const rows = 24;
  const renderer = new ScreenRenderer(cols, rows);

  // Spawn shell directly (not through spawnPty which wraps with -c)
  const shell = process.platform === "win32" ? "cmd.exe" : "/bin/bash";
  const args: string[] = [];

  const ptyProcess = pty.spawn(shell, args, {
    name: "xterm-256color",
    cols,
    rows,
    cwd: cwd ?? process.cwd(),
    env: process.env as Record<string, string>,
  });

  let alive = true;

  const session: Session = {
    id,
    handle: null as unknown as PtyHandle,
    renderer,
    rawOutput: "",
    exited: false,
    exitCode: null,
  };

  ptyProcess.onData((data: string) => {
    session.rawOutput += data;
    renderer.write(data);
  });

  ptyProcess.onExit(({ exitCode }) => {
    alive = false;
    session.exited = true;
    session.exitCode = exitCode;
  });

  const handle: PtyHandle = {
    get isAlive() {
      return alive;
    },
    write(data) {
      if (alive) ptyProcess.write(data);
    },
    resize(c, r) {
      if (alive) ptyProcess.resize(c, r);
    },
    kill() {
      if (!alive) return;
      alive = false;
      try {
        ptyProcess.kill();
      } catch {}
    },
  };

  session.handle = handle;
  sessions.set(id, session);
  return session;
}

/**
 * Send input to a session's PTY stdin.
 */
export function sendToSession(id: string, input: string): void {
  const s = sessions.get(id);
  if (!s) throw new Error("Session not found: " + id);
  if (s.exited) throw new Error("Session already exited: " + id);
  s.handle.write(input);
}

/**
 * Read the current screen content of a session.
 * Returns a full snapshot each time (like looking at a real terminal).
 */
export async function readSession(id: string): Promise<string> {
  const s = sessions.get(id);
  if (!s) throw new Error("Session not found: " + id);
  await s.renderer.flush();
  let text = s.renderer.renderForLLM();
  if (s.exited) {
    text += "\n[Process exited with code " + s.exitCode + "]";
  }
  return text;
}

/**
 * Close a session: kill the process and free resources.
 */
export function closeSession(id: string): void {
  const s = sessions.get(id);
  if (!s) return;
  if (!s.exited) s.handle.kill();
  s.renderer.dispose();
  sessions.delete(id);
}

/**
 * Close all active sessions. Called on extension shutdown.
 */
export function closeAllSessions(): void {
  for (const id of [...sessions.keys()]) closeSession(id);
}

/**
 * Check if a session exists and its status.
 */
export function getSessionStatus(id: string): { exists: boolean; exited: boolean } {
  const s = sessions.get(id);
  if (!s) return { exists: false, exited: false };
  return { exists: true, exited: s.exited };
}
