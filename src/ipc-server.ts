/**
 * IPC Server for pty-spawn attach system.
 *
 * Listens on a random TCP port on localhost. The port number is
 * written to a well-known file so CLI clients can discover it.
 *
 * Supports:
 * - "list": enumerate active sessions
 * - "attach": subscribe to a session's raw PTY output stream
 * - "detach": unsubscribe from a session
 */

import * as net from "net";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  listSessions,
  getSessionEmitter,
  getSessionRawOutput,
  getSessionStatus,
  getSessionDimensions,
} from "./session-manager.js";
import {
  encodeMessage,
  processBuffer,
  type ClientMessage,
  type ServerMessage,
} from "./ipc-protocol.js";

/**
 * Get the port file path for this process.
 * Includes PID to avoid conflicts when multiple Pi instances run pty-spawn.
 */
function getPortFilePath(): string {
  return path.join(os.tmpdir(), `pty-spawn-ipc-${process.pid}.port`);
}

/**
 * Send a server message to a client socket.
 */
function send(socket: net.Socket, msg: ServerMessage): void {
  try {
    socket.write(encodeMessage(msg));
  } catch {
    // Socket may have been destroyed; ignore write errors.
  }
}

/**
 * Handle a single client connection.
 */
function onConnection(socket: net.Socket): void {
  let buffer = "";

  // Track subscriptions: sessionId → { dataListener, exitListener }
  const subscriptions = new Map<
    string,
    { dataListener: (data: string) => void; exitListener: (code: number) => void }
  >();

  socket.on("data", (chunk: Buffer) => {
    buffer += chunk.toString();
    const { messages, remaining } = processBuffer<ClientMessage>(buffer);
    buffer = remaining;

    for (const msg of messages) {
      handleMessage(socket, subscriptions, msg);
    }
  });

  socket.on("close", () => {
    // Clean up all subscriptions when client disconnects
    for (const [sid, { dataListener, exitListener }] of subscriptions) {
      const emitter = getSessionEmitter(sid);
      if (emitter) {
        emitter.removeListener("data", dataListener);
        emitter.removeListener("exit", exitListener);
      }
    }
    subscriptions.clear();
  });

  socket.on("error", () => {
    // Ignore client socket errors (e.g. ECONNRESET)
  });
}

/**
 * Handle a parsed client message.
 */
function handleMessage(
  socket: net.Socket,
  subscriptions: Map<
    string,
    { dataListener: (data: string) => void; exitListener: (code: number) => void }
  >,
  msg: ClientMessage
): void {
  switch (msg.type) {
    case "list": {
      send(socket, {
        type: "session_list",
        sessions: listSessions(),
      });
      break;
    }

    case "attach": {
      const { sessionId } = msg;
      const emitter = getSessionEmitter(sessionId);

      if (!emitter) {
        send(socket, {
          type: "error",
          message: `Session not found: ${sessionId}`,
        });
        return;
      }

      // Avoid duplicate subscriptions
      if (subscriptions.has(sessionId)) {
        send(socket, {
          type: "error",
          message: `Already attached to session: ${sessionId}`,
        });
        return;
      }

      // Send PTY dimensions first so client can prepare its viewport
      const dims = getSessionDimensions(sessionId);
      const cols = dims?.cols ?? 120;
      const rows = dims?.rows ?? 30;

      send(socket, {
        type: "attached",
        sessionId,
        cols,
        rows,
      });

      // Send history replay — capped to ~1 screenful.
      // TUI apps (like Pi) constantly redraw the screen; replaying the
      // entire raw history produces rendering artifacts. Limiting to
      // the tail avoids this: the terminal only processes the most
      // recent output and renders cleanly.
      const history = getSessionRawOutput(sessionId);
      if (history && history.length > 0) {
        // Roughly 1 screenful: cols * rows * 4 bytes (accounts for
        // ANSI escape sequences and multi-byte chars).
        const maxReplay = cols * rows * 4;
        const tail = history.length > maxReplay
          ? history.slice(-maxReplay)
          : history;

        send(socket, {
          type: "data",
          sessionId,
          data: Buffer.from(tail).toString("base64"),
        });
      }

      // Check if session already exited
      const status = getSessionStatus(sessionId);
      if (status.exited) {
        send(socket, {
          type: "exit",
          sessionId,
          exitCode: null,
        });
        return;
      }

      // Subscribe to real-time output
      const dataListener = (data: string) => {
        send(socket, {
          type: "data",
          sessionId,
          data: Buffer.from(data).toString("base64"),
        });
      };

      const exitListener = (code: number) => {
        send(socket, {
          type: "exit",
          sessionId,
          exitCode: code,
        });
        // Auto-remove subscription on exit
        subscriptions.delete(sessionId);
      };

      emitter.on("data", dataListener);
      emitter.on("exit", exitListener);
      subscriptions.set(sessionId, { dataListener, exitListener });
      break;
    }

    case "detach": {
      const { sessionId } = msg;
      const sub = subscriptions.get(sessionId);
      if (sub) {
        const emitter = getSessionEmitter(sessionId);
        if (emitter) {
          emitter.removeListener("data", sub.dataListener);
          emitter.removeListener("exit", sub.exitListener);
        }
        subscriptions.delete(sessionId);
      }
      break;
    }
  }
}

/**
 * Start the IPC server on a random available port.
 * Writes the port number to a well-known file for CLI discovery.
 */
export function startIpcServer(): net.Server {
  const server = net.createServer(onConnection);

  server.on("error", (err) => {
    // Log but don't crash — attach is optional functionality
    console.error("[pty-spawn] IPC server error:", err.message);
  });

  server.listen(0, "127.0.0.1", () => {
    const addr = server.address() as net.AddressInfo;
    const portFile = getPortFilePath();
    try {
      fs.writeFileSync(portFile, String(addr.port), "utf-8");
    } catch (err) {
      console.error("[pty-spawn] Failed to write port file:", err);
    }
  });

  return server;
}

/**
 * Stop the IPC server and clean up the port file.
 */
export function stopIpcServer(server: net.Server): void {
  server.close();
  const portFile = getPortFilePath();
  try {
    fs.unlinkSync(portFile);
  } catch {
    // File may not exist; ignore.
  }
}

/**
 * Get the port file path (exported for CLI clients).
 * CLI clients scan /tmp/pty-spawn-ipc-*.port to find running servers.
 */
export { getPortFilePath };

/**
 * Port file glob pattern for CLI discovery.
 */
export const PORT_FILE_PATTERN = "pty-spawn-ipc-*.port";
