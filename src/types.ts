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
