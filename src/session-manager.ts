import * as pty from "node-pty";
import { EventEmitter } from "events";
import { ScreenRenderer } from "./screen-renderer.js";
import type { PtyHandle } from "./types.js";
import type { SessionInfo } from "./ipc-protocol.js";

/** Maximum raw output buffer size per session (1MB). */
const MAX_RAW_OUTPUT = 1024 * 1024;

export interface Session {
  id: string;
  handle: PtyHandle;
  renderer: ScreenRenderer;
  rawOutput: string;
  exited: boolean;
  exitCode: number | null;
  /** Event emitter for real-time output streaming (attach support). */
  emitter: EventEmitter;
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
  const emitter = new EventEmitter();
  emitter.setMaxListeners(20);

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
    emitter,
  };

  ptyProcess.onData((data: string) => {
    // Append to raw output buffer (with cap)
    session.rawOutput += data;
    if (session.rawOutput.length > MAX_RAW_OUTPUT) {
      session.rawOutput = session.rawOutput.slice(-MAX_RAW_OUTPUT);
    }
    renderer.write(data);
    // Notify attach listeners with raw data
    emitter.emit("data", data);
  });

  ptyProcess.onExit(({ exitCode }) => {
    alive = false;
    session.exited = true;
    session.exitCode = exitCode;
    emitter.emit("exit", exitCode);
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
  s.emitter.removeAllListeners();
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

// ── G2d: Attach support exports ────────────────────────────────────

/**
 * List all sessions with their current status.
 * Used by IPC server for the "list" command.
 */
export function listSessions(): SessionInfo[] {
  const result: SessionInfo[] = [];
  for (const s of sessions.values()) {
    result.push({
      id: s.id,
      exited: s.exited,
      exitCode: s.exitCode,
    });
  }
  return result;
}

/**
 * Get the EventEmitter for a session (used by IPC server for attach).
 * Returns null if the session does not exist.
 */
export function getSessionEmitter(id: string): EventEmitter | null {
  const s = sessions.get(id);
  return s ? s.emitter : null;
}

/**
 * Get the raw output history of a session (used for attach replay).
 * Returns null if the session does not exist.
 */
export function getSessionRawOutput(id: string): string | null {
  const s = sessions.get(id);
  return s ? s.rawOutput : null;
}
