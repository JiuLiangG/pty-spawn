import type { IPty } from "node-pty";

/** PTY handle wrapping a node-pty instance */
export interface PtyHandle {
  readonly isAlive: boolean;
  /** Write data to the child process stdin */
  write(data: string): void;
  /** Resize the PTY window */
  resize(cols: number, rows: number): void;
  /** Kill the child process */
  kill(): void;
}

/** Options for spawning a PTY process */
export interface SpawnOptions {
  command: string;
  cols?: number;
  rows?: number;
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
  onData: (data: string) => void;
  onExit: (exitCode: number) => void;
}

/** A snapshot of the terminal screen at a point in time */
export interface ScreenSnapshot {
  /** Screen content, one string per row (trimmed at right) */
  lines: string[];
  /** Cursor column position (0-based) */
  cursorX: number;
  /** Cursor row position (0-based) */
  cursorY: number;
  /** Terminal column count */
  cols: number;
  /** Terminal row count */
  rows: number;
  /** True when in alternate screen buffer (full-screen TUI mode) */
  isAlternateBuffer: boolean;
}
