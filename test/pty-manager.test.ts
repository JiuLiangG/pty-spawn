import { describe, test, expect } from "vitest";
import { spawnPty, killAllPtys } from "../src/pty-manager.js";
import { cleanOutput } from "../src/clean-output.js";

describe("pty-manager", () => {
  test("spawns command and captures output", async () => {
    let output = "";
    const exitCode = await new Promise<number>((resolve) => {
      spawnPty({
        command: "echo hello && echo world",
        onData: (data) => {
          output += data;
        },
        onExit: (code) => resolve(code),
      });
    });
    expect(exitCode).toBe(0);
    expect(cleanOutput(output)).toContain("hello");
    expect(cleanOutput(output)).toContain("world");
  });

  test("isatty returns true in PTY", async () => {
    let output = "";
    await new Promise<number>((resolve) => {
      spawnPty({
        command: 'node -e "console.log(process.stdout.isTTY)"',
        onData: (data) => {
          output += data;
        },
        onExit: (code) => resolve(code),
      });
    });
    expect(cleanOutput(output)).toContain("true");
  });

  test("kill terminates process", () => {
    const handle = spawnPty({
      command: "sleep 999",
      onData: () => {},
      onExit: () => {},
    });
    expect(handle.isAlive).toBe(true);
    handle.kill();
    expect(handle.isAlive).toBe(false);
  });

  test("killAllPtys cleans up all active PTYs", () => {
    const h1 = spawnPty({
      command: "sleep 999",
      onData: () => {},
      onExit: () => {},
    });
    const h2 = spawnPty({
      command: "sleep 999",
      onData: () => {},
      onExit: () => {},
    });
    expect(h1.isAlive).toBe(true);
    expect(h2.isAlive).toBe(true);
    killAllPtys();
    expect(h1.isAlive).toBe(false);
    expect(h2.isAlive).toBe(false);
  });
});
