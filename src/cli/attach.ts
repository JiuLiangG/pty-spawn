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
 * Attach to a session on a specific IPC server port.
 */
function attachToPort(port: number, sessionId: string): void {
  const socket = net.connect(port, "127.0.0.1", () => {
    // Send attach request
    socket.write(encodeMessage({ type: "attach", sessionId }));

    // Print header
    process.stderr.write(
      `\x1b[90m[pty-spawn] Attached to session ${sessionId} (port ${port}). Press Ctrl+C to detach.\x1b[0m\n`
    );
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
    process.stderr.write(
      `\x1b[31m[pty-spawn] Connection error: ${err.message}\x1b[0m\n`
    );
    process.exit(1);
  });

  socket.on("close", () => {
    process.stderr.write(
      `\x1b[90m[pty-spawn] Disconnected from server.\x1b[0m\n`
    );
    process.exit(0);
  });

  // Ctrl+C: detach gracefully (don't kill the session)
  process.on("SIGINT", () => {
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
    case "data":
      // Decode base64 and write raw bytes to stdout.
      // The user's terminal emulator renders ANSI escapes, colors, etc.
      process.stdout.write(Buffer.from(msg.data, "base64"));
      break;

    case "exit":
      process.stderr.write(
        `\x1b[90m\n[pty-spawn] Session ${sessionId} exited with code ${msg.exitCode}.\x1b[0m\n`
      );
      process.exit(0);
      break;

    case "error":
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
