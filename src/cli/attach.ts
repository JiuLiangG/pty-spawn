/**
 * CLI attach command — connects to the IPC server and mirrors
 * a PTY session's raw output to the current terminal in real time.
 *
 * The user sees exactly what the PTY produces: colors, cursor
 * movement, TUI rendering — everything. Their terminal emulator
 * (e.g. Windows Terminal) handles the ANSI rendering.
 *
 * Ctrl+C detaches (stops observing) without killing the session.
 */

import * as net from "net";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  encodeMessage,
  processBuffer,
  type ServerMessage,
} from "../ipc-protocol.js";

/** Scan /tmp for pty-spawn IPC port files and return available ports. */
function discoverPorts(): { pid: number; port: number }[] {
  const tmpdir = os.tmpdir();
  const results: { pid: number; port: number }[] = [];

  try {
    const files = fs.readdirSync(tmpdir);
    for (const f of files) {
      const match = f.match(/^pty-spawn-ipc-(\d+)\.port$/);
      if (!match) continue;

      const pid = parseInt(match[1], 10);
      const filePath = path.join(tmpdir, f);

      try {
        const content = fs.readFileSync(filePath, "utf-8").trim();
        const port = parseInt(content, 10);
        if (!isNaN(port)) {
          results.push({ pid, port });
        }
      } catch {
        // File may have been removed; skip.
      }
    }
  } catch {
    // tmpdir not readable; return empty.
  }

  return results;
}

/**
 * Resize the local terminal to match the PTY dimensions.
 * Uses ANSI escape sequence DECSLPP (or xterm window manipulation).
 * Falls back gracefully if the terminal doesn't support it.
 */
function resizeTerminal(cols: number, rows: number): void {
  // CSI 8 ; rows ; cols t — xterm window resize sequence
  // Supported by Windows Terminal, iTerm2, xterm, and most modern terminals.
  process.stdout.write(`\x1b[8;${rows};${cols}t`);
}

/**
 * Clear the terminal screen and reset cursor position.
 */
function clearScreen(): void {
  // ESC[2J = clear entire screen, ESC[H = cursor to home (top-left)
  process.stdout.write("\x1b[2J\x1b[H");
}

/** Track original terminal size for restore on exit. */
let originalCols = process.stdout.columns || 80;
let originalRows = process.stdout.rows || 24;
let didResize = false;

/**
 * Restore the original terminal size on exit.
 */
function restoreTerminal(): void {
  if (didResize) {
    resizeTerminal(originalCols, originalRows);
    didResize = false;
  }
}

/**
 * Attach to a session on a specific IPC server port.
 */
function attachToPort(port: number, sessionId: string): void {
  // Save original terminal size before any resize
  originalCols = process.stdout.columns || 80;
  originalRows = process.stdout.rows || 24;

  const socket = net.connect(port, "127.0.0.1", () => {
    // Send attach request
    socket.write(encodeMessage({ type: "attach", sessionId }));
  });

  let buffer = "";

  socket.on("data", (chunk: Buffer) => {
    buffer += chunk.toString();
    const { messages, remaining } = processBuffer<ServerMessage>(buffer);
    buffer = remaining;

    for (const msg of messages) {
      handleMessage(socket, sessionId, msg);
    }
  });

  socket.on("error", (err) => {
    restoreTerminal();
    process.stderr.write(
      `\x1b[31m[pty-spawn] Connection error: ${err.message}\x1b[0m\n`
    );
    process.exit(1);
  });

  socket.on("close", () => {
    restoreTerminal();
    process.stderr.write(
      `\x1b[90m[pty-spawn] Disconnected from server.\x1b[0m\n`
    );
    process.exit(0);
  });

  // Ctrl+C: detach gracefully (don't kill the session)
  process.on("SIGINT", () => {
    restoreTerminal();
    process.stderr.write(
      `\x1b[90m\n[pty-spawn] Detaching from session ${sessionId}...\x1b[0m\n`
    );
    try {
      socket.write(encodeMessage({ type: "detach", sessionId }));
    } catch {
      // Socket may already be closed.
    }
    socket.end();
    process.exit(0);
  });
}

/**
 * Handle a server message.
 */
function handleMessage(
  socket: net.Socket,
  sessionId: string,
  msg: ServerMessage
): void {
  switch (msg.type) {
    case "attached": {
      // Server tells us the PTY dimensions — resize local terminal to match
      const { cols, rows } = msg;

      process.stderr.write(
        `\x1b[90m[pty-spawn] Attached to session ${sessionId} (PTY: ${cols}x${rows}). Press Ctrl+C to detach.\x1b[0m\n`
      );

      // Resize local terminal to match PTY if sizes differ
      const localCols = process.stdout.columns || 80;
      const localRows = process.stdout.rows || 24;

      if (localCols !== cols || localRows !== rows) {
        resizeTerminal(cols, rows);
        didResize = true;
        process.stderr.write(
          `\x1b[90m[pty-spawn] Resized terminal: ${localCols}x${localRows} → ${cols}x${rows}\x1b[0m\n`
        );
      }

      // Clear screen before history replay for clean rendering
      clearScreen();
      break;
    }

    case "data":
      // Decode base64 and write raw bytes to stdout.
      // The user's terminal emulator renders ANSI escapes, colors, etc.
      process.stdout.write(Buffer.from(msg.data, "base64"));
      break;

    case "exit":
      restoreTerminal();
      process.stderr.write(
        `\x1b[90m\n[pty-spawn] Session ${sessionId} exited with code ${msg.exitCode}.\x1b[0m\n`
      );
      process.exit(0);
      break;

    case "error":
      restoreTerminal();
      process.stderr.write(
        `\x1b[31m[pty-spawn] Error: ${msg.message}\x1b[0m\n`
      );
      process.exit(1);
      break;

    case "session_list":
      // Unexpected in attach mode; ignore.
      break;
  }
}

/**
 * Main entry point for the attach command.
 */
export function attach(sessionId: string): void {
  const ports = discoverPorts();

  if (ports.length === 0) {
    process.stderr.write(
      "\x1b[31m[pty-spawn] No running pty-spawn server found.\x1b[0m\n" +
        "\x1b[90mMake sure Pi is running with the pty-spawn extension loaded.\x1b[0m\n"
    );
    process.exit(1);
  }

  if (ports.length === 1) {
    // Only one server running; connect directly.
    attachToPort(ports[0].port, sessionId);
    return;
  }

  // Multiple servers running; try each one to find the session.
  // For now, try the first one. Future: query each server for the session.
  process.stderr.write(
    `\x1b[33m[pty-spawn] Found ${ports.length} running servers. Trying first...\x1b[0m\n`
  );
  attachToPort(ports[0].port, sessionId);
}
