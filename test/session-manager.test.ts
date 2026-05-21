import { describe, it, expect, afterEach } from "vitest";
import {
  createSession,
  sendToSession,
  readSession,
  closeSession,
  closeAllSessions,
  getSessionStatus,
} from "../src/session-manager.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

afterEach(() => {
  closeAllSessions();
});

describe("session-manager", () => {
  it("createSession returns a valid session", () => {
    const session = createSession();
    expect(session.id).toMatch(/^s\d+$/);
    expect(session.exited).toBe(false);
    expect(session.handle.isAlive).toBe(true);
  });

  it("sendToSession + readSession captures output", async () => {
    const session = createSession();
    await sleep(500); // wait for shell prompt

    const cmd =
      process.platform === "win32" ? "echo hello\r\n" : "echo hello\n";
    sendToSession(session.id, cmd);
    await sleep(500);

    const output = await readSession(session.id);
    expect(output).toContain("hello");
  });

  it("multiple sessions are isolated", async () => {
    const s1 = createSession();
    const s2 = createSession();
    await sleep(500);

    const cmd1 =
      process.platform === "win32"
        ? "echo session_one\r\n"
        : "echo session_one\n";
    const cmd2 =
      process.platform === "win32"
        ? "echo session_two\r\n"
        : "echo session_two\n";

    sendToSession(s1.id, cmd1);
    sendToSession(s2.id, cmd2);
    await sleep(500);

    const out1 = await readSession(s1.id);
    const out2 = await readSession(s2.id);

    expect(out1).toContain("session_one");
    expect(out1).not.toContain("session_two");
    expect(out2).toContain("session_two");
    expect(out2).not.toContain("session_one");
  });

  it("closeSession removes session and kills process", () => {
    const session = createSession();
    expect(getSessionStatus(session.id).exists).toBe(true);

    closeSession(session.id);
    expect(getSessionStatus(session.id).exists).toBe(false);
    expect(session.handle.isAlive).toBe(false);
  });

  it("closeAllSessions cleans up everything", () => {
    const s1 = createSession();
    const s2 = createSession();
    const s3 = createSession();

    closeAllSessions();

    expect(getSessionStatus(s1.id).exists).toBe(false);
    expect(getSessionStatus(s2.id).exists).toBe(false);
    expect(getSessionStatus(s3.id).exists).toBe(false);
  });

  it("detects process exit", async () => {
    const session = createSession();
    await sleep(500);

    const cmd =
      process.platform === "win32" ? "exit\r\n" : "exit\n";
    sendToSession(session.id, cmd);
    // Windows ConPTY fires onExit later than onData — need extra time
    await sleep(2000);

    const output = await readSession(session.id);
    expect(output).toContain("[Process exited with code");
    expect(session.exited).toBe(true);
  });
});
