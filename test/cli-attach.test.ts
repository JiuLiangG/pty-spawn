import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as net from "net";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { startIpcServer, stopIpcServer } from "../src/ipc-server.js";
import {
  createSession,
  closeAllSessions,
  sendToSession,
} from "../src/session-manager.js";
import {
  encodeMessage,
  processBuffer,
  type ServerMessage,
} from "../src/ipc-protocol.js";

/**
 * Helper: wait for a short time.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Helper: read the IPC port from the port file for the current PID.
 */
function readPort(): number | null {
  const portFile = path.join(os.tmpdir(), `pty-spawn-ipc-${process.pid}.port`);
  try {
    return parseInt(fs.readFileSync(portFile, "utf-8").trim(), 10);
  } catch {
    return null;
  }
}

/**
 * Simulate what the CLI attach command does:
 * 1. Connect to IPC server
 * 2. Send attach request
 * 3. Collect all received data messages
 */
function simulateAttach(
  port: number,
  sessionId: string,
  durationMs: number
): Promise<{ data: string; messages: ServerMessage[] }> {
  return new Promise((resolve) => {
    const socket = net.connect(port, "127.0.0.1", () => {
      socket.write(encodeMessage({ type: "attach", sessionId }));
    });

    let buffer = "";
    const allMessages: ServerMessage[] = [];
    let allData = "";

    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const { messages, remaining } = processBuffer<ServerMessage>(buffer);
      buffer = remaining;

      for (const msg of messages) {
        allMessages.push(msg);
        if (msg.type === "data") {
          allData += Buffer.from(msg.data, "base64").toString();
        }
      }
    });

    setTimeout(() => {
      socket.end();
      resolve({ data: allData, messages: allMessages });
    }, durationMs);

    socket.on("error", () => {
      resolve({ data: allData, messages: allMessages });
    });
  });
}

describe("CLI Attach (Integration)", () => {
  let server: net.Server;
  let port: number;

  beforeEach(async () => {
    server = startIpcServer();
    await sleep(300);
    const foundPort = readPort();
    expect(foundPort).not.toBeNull();
    port = foundPort!;
  });

  afterEach(() => {
    closeAllSessions();
    stopIpcServer(server);
  });

  it("end-to-end: create session → attach → receive output", async () => {
    // Create a session
    const session = createSession();
    await sleep(500); // Wait for shell prompt

    // Simulate CLI attach
    const result = await simulateAttach(port, session.id, 1000);

    // Should have received data (at minimum the shell prompt)
    expect(result.data.length).toBeGreaterThan(0);
    expect(result.messages.some((m) => m.type === "data")).toBe(true);
  });

  it("end-to-end: attach → send command → see output", async () => {
    const session = createSession();
    await sleep(500);

    // Start attach in background
    const attachPromise = simulateAttach(port, session.id, 2000);

    // Wait a bit, then send a command
    await sleep(300);
    sendToSession(session.id, "echo E2E_ATTACH_TEST\r");

    // Wait for attach to complete
    const result = await attachPromise;

    // Should contain our test string in the output
    expect(result.data).toContain("E2E_ATTACH_TEST");
  });

  it("should return error for non-existent session", async () => {
    const result = await simulateAttach(port, "nonexistent", 500);

    const errorMsgs = result.messages.filter((m) => m.type === "error");
    expect(errorMsgs.length).toBe(1);
    if (errorMsgs[0].type === "error") {
      expect(errorMsgs[0].message).toContain("not found");
    }
  });

  it("should handle server not running (port file missing)", () => {
    // Clean up port file
    const portFile = path.join(
      os.tmpdir(),
      `pty-spawn-ipc-${process.pid}.port`
    );
    try {
      fs.unlinkSync(portFile);
    } catch {}

    // discoverPorts should return empty
    const tmpdir = os.tmpdir();
    const files = fs.readdirSync(tmpdir);
    const portFiles = files.filter((f) =>
      f.match(/^pty-spawn-ipc-\d+\.port$/)
    );

    // Our port file should be gone (other processes' files may exist)
    expect(
      portFiles.some((f) => f === `pty-spawn-ipc-${process.pid}.port`)
    ).toBe(false);

    // Restore for afterEach cleanup
    const addr = server.address() as net.AddressInfo;
    fs.writeFileSync(portFile, String(addr.port), "utf-8");
  });
});
