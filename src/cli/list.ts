/**
 * CLI list command — connects to the IPC server and lists all
 * active PTY sessions with their status.
 *
 * Output format:
 *   ID      Status
 *   s1      running
 *   s2      exited(0)
 */

import * as net from "net";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  encodeMessage,
  processBuffer,
  type ServerMessage,
  type SessionInfo,
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
 * Format session status for display.
 */
function formatStatus(s: SessionInfo): string {
  if (!s.exited) return "running";
  return `exited(${s.exitCode ?? "?"})`;  
}

/**
 * Query a single server for its session list.
 */
function queryServer(
  pid: number,
  port: number
): Promise<{ pid: number; sessions: SessionInfo[] }> {
  return new Promise((resolve) => {
    const socket = net.connect(port, "127.0.0.1", () => {
      socket.write(encodeMessage({ type: "list" }));
    });

    let buffer = "";
    const timeout = setTimeout(() => {
      socket.destroy();
      resolve({ pid, sessions: [] });
    }, 3000);

    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const { messages, remaining } = processBuffer<ServerMessage>(buffer);
      buffer = remaining;

      for (const msg of messages) {
        if (msg.type === "session_list") {
          clearTimeout(timeout);
          socket.end();
          resolve({ pid, sessions: msg.sessions });
          return;
        }
      }
    });

    socket.on("error", () => {
      clearTimeout(timeout);
      resolve({ pid, sessions: [] });
    });

    socket.on("close", () => {
      clearTimeout(timeout);
      resolve({ pid, sessions: [] });
    });
  });
}

/**
 * Main entry point for the list command.
 */
export async function list(): Promise<void> {
  const ports = discoverPorts();

  if (ports.length === 0) {
    process.stderr.write(
      "\x1b[33m[pty-spawn] No running pty-spawn server found.\x1b[0m\n" +
        "\x1b[90mMake sure Pi is running with the pty-spawn extension loaded.\x1b[0m\n"
    );
    process.exit(0);
  }

  // Query all discovered servers in parallel
  const results = await Promise.all(
    ports.map(({ pid, port }) => queryServer(pid, port))
  );

  let totalSessions = 0;

  for (const { pid, sessions } of results) {
    if (sessions.length === 0) continue;
    totalSessions += sessions.length;

    if (results.length > 1) {
      // Multiple servers: show which Pi process each belongs to
      console.log(`\x1b[90m── Pi process ${pid} ──\x1b[0m`);
    }

    // Table header
    console.log(
      `  \x1b[1m${'ID'.padEnd(10)}${'Status'.padEnd(15)}\x1b[0m`
    );

    // Session rows
    for (const s of sessions) {
      const status = formatStatus(s);
      const color = s.exited ? "\x1b[90m" : "\x1b[32m"; // gray for exited, green for running
      console.log(
        `  ${color}${s.id.padEnd(10)}${status.padEnd(15)}\x1b[0m`
      );
    }

    console.log();
  }

  if (totalSessions === 0) {
    console.log("\x1b[90mNo active sessions.\x1b[0m");
  }
}
