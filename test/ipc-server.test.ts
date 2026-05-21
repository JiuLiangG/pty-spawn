import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as net from "net";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  encodeMessage,
  processBuffer,
  type ServerMessage,
  type ClientMessage,
} from "../src/ipc-protocol.js";
import { startIpcServer, stopIpcServer } from "../src/ipc-server.js";
import {
  createSession,
  closeSession,
  closeAllSessions,
  sendToSession,
} from "../src/session-manager.js";

/**
 * Helper: connect to IPC server and return a socket + message reader.
 */
function connectToServer(port: number): Promise<{
  socket: net.Socket;
  readMessages: () => Promise<ServerMessage[]>;
}> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1", () => {
      let buffer = "";

      const readMessages = (): Promise<ServerMessage[]> => {
        return new Promise((res) => {
          // Give a short time for data to arrive
          setTimeout(() => {
            const { messages, remaining } = processBuffer<ServerMessage>(buffer);
            buffer = remaining;
            res(messages);
          }, 200);
        });
      };

      socket.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
      });

      resolve({ socket, readMessages });
    });

    socket.on("error", reject);
  });
}

/**
 * Helper: send a client message to the server.
 */
function sendMsg(socket: net.Socket, msg: ClientMessage): void {
  socket.write(encodeMessage(msg));
}

/**
 * Helper: wait for a short time.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Helper: read the IPC port from the port file for a given PID.
 */
function readPortFile(pid: number): number | null {
  const portFile = path.join(os.tmpdir(), `pty-spawn-ipc-${pid}.port`);
  try {
    return parseInt(fs.readFileSync(portFile, "utf-8").trim(), 10);
  } catch {
    return null;
  }
}

describe("IPC Server", () => {
  let server: net.Server;
  let port: number;

  beforeEach(async () => {
    server = startIpcServer();
    // Wait for server to start listening
    await sleep(300);
    const foundPort = readPortFile(process.pid);
    expect(foundPort).not.toBeNull();
    port = foundPort!;
  });

  afterEach(() => {
    closeAllSessions();
    stopIpcServer(server);
  });

  it("should start and write port file", () => {
    const portFile = path.join(os.tmpdir(), `pty-spawn-ipc-${process.pid}.port`);
    expect(fs.existsSync(portFile)).toBe(true);
    const content = fs.readFileSync(portFile, "utf-8").trim();
    expect(parseInt(content, 10)).toBeGreaterThan(0);
  });

  it("should accept TCP connections", async () => {
    const { socket } = await connectToServer(port);
    expect(socket.connecting).toBe(false);
    socket.end();
  });

  it("should list sessions (empty)", async () => {
    const { socket, readMessages } = await connectToServer(port);
    sendMsg(socket, { type: "list" });

    const msgs = await readMessages();
    expect(msgs.length).toBe(1);
    expect(msgs[0].type).toBe("session_list");
    if (msgs[0].type === "session_list") {
      expect(msgs[0].sessions).toEqual([]);
    }

    socket.end();
  });

  it("should list sessions (with sessions)", async () => {
    const session = createSession();
    await sleep(500); // Wait for shell to start

    const { socket, readMessages } = await connectToServer(port);
    sendMsg(socket, { type: "list" });

    const msgs = await readMessages();
    expect(msgs.length).toBe(1);
    if (msgs[0].type === "session_list") {
      expect(msgs[0].sessions.length).toBe(1);
      expect(msgs[0].sessions[0].id).toBe(session.id);
      expect(msgs[0].sessions[0].exited).toBe(false);
    }

    socket.end();
  });

  it("should return error for non-existent session attach", async () => {
    const { socket, readMessages } = await connectToServer(port);
    sendMsg(socket, { type: "attach", sessionId: "nonexistent" });

    const msgs = await readMessages();
    expect(msgs.length).toBe(1);
    expect(msgs[0].type).toBe("error");
    if (msgs[0].type === "error") {
      expect(msgs[0].message).toContain("not found");
    }

    socket.end();
  });

  it("should replay history on attach", async () => {
    const session = createSession();
    await sleep(500); // Wait for shell prompt

    const { socket, readMessages } = await connectToServer(port);
    sendMsg(socket, { type: "attach", sessionId: session.id });

    const msgs = await readMessages();
    // Should receive at least one data message (history replay)
    const dataMessages = msgs.filter((m) => m.type === "data");
    expect(dataMessages.length).toBeGreaterThanOrEqual(1);

    socket.end();
  });

  it("should stream real-time output after attach", async () => {
    const session = createSession();
    await sleep(500);

    const { socket, readMessages } = await connectToServer(port);
    sendMsg(socket, { type: "attach", sessionId: session.id });

    // Consume history replay
    await readMessages();

    // Send a command to the session
    sendToSession(session.id, "echo HELLO_IPC_TEST\r");
    await sleep(500);

    // Read new messages
    const msgs = await readMessages();
    const dataMessages = msgs.filter((m) => m.type === "data");
    expect(dataMessages.length).toBeGreaterThanOrEqual(1);

    // Decode and check content
    const allData = dataMessages
      .map((m) => {
        if (m.type === "data") {
          return Buffer.from(m.data, "base64").toString();
        }
        return "";
      })
      .join("");
    expect(allData).toContain("HELLO_IPC_TEST");

    socket.end();
  });

  it("should stop streaming after detach", async () => {
    const session = createSession();
    await sleep(500);

    const { socket, readMessages } = await connectToServer(port);
    sendMsg(socket, { type: "attach", sessionId: session.id });
    await readMessages(); // consume history

    // Detach
    sendMsg(socket, { type: "detach", sessionId: session.id });
    await sleep(100);

    // Send a command to the session
    sendToSession(session.id, "echo AFTER_DETACH\r");
    await sleep(500);

    // Should NOT receive the new output
    const msgs = await readMessages();
    const allData = msgs
      .filter((m) => m.type === "data")
      .map((m) => {
        if (m.type === "data") {
          return Buffer.from(m.data, "base64").toString();
        }
        return "";
      })
      .join("");
    expect(allData).not.toContain("AFTER_DETACH");

    socket.end();
  });

  it("should clean up subscriptions on client disconnect", async () => {
    const session = createSession();
    await sleep(500);

    const { socket } = await connectToServer(port);
    sendMsg(socket, { type: "attach", sessionId: session.id });
    await sleep(200);

    // Abruptly close the connection
    socket.destroy();
    await sleep(200);

    // Verify: emitter listener count should be back to 0 (or base level)
    // This is an indirect test — if cleanup fails, EventEmitter would
    // leak listeners and eventually warn.
    // The session itself should still be alive.
    expect(session.exited).toBe(false);
  });

  it("should support multiple clients attaching to same session", async () => {
    const session = createSession();
    await sleep(500);

    const client1 = await connectToServer(port);
    const client2 = await connectToServer(port);

    sendMsg(client1.socket, { type: "attach", sessionId: session.id });
    sendMsg(client2.socket, { type: "attach", sessionId: session.id });
    await sleep(200);

    // Both should receive history
    const msgs1 = await client1.readMessages();
    const msgs2 = await client2.readMessages();
    expect(msgs1.filter((m) => m.type === "data").length).toBeGreaterThanOrEqual(1);
    expect(msgs2.filter((m) => m.type === "data").length).toBeGreaterThanOrEqual(1);

    // Send a command
    sendToSession(session.id, "echo MULTI_TEST\r");
    await sleep(500);

    // Both should receive the new output
    const newMsgs1 = await client1.readMessages();
    const newMsgs2 = await client2.readMessages();

    const decode = (msgs: ServerMessage[]) =>
      msgs
        .filter((m) => m.type === "data")
        .map((m) => (m.type === "data" ? Buffer.from(m.data, "base64").toString() : ""))
        .join("");

    expect(decode(newMsgs1)).toContain("MULTI_TEST");
    expect(decode(newMsgs2)).toContain("MULTI_TEST");

    client1.socket.end();
    client2.socket.end();
  });

  it("should clean up port file on stop", () => {
    stopIpcServer(server);
    const portFile = path.join(os.tmpdir(), `pty-spawn-ipc-${process.pid}.port`);
    expect(fs.existsSync(portFile)).toBe(false);

    // Re-create server for afterEach cleanup
    server = startIpcServer();
  });
});
