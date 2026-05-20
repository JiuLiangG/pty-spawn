import { describe, test, expect } from "vitest";
import { spawnPty, killAllPtys } from "../src/pty-manager.js";
import { cleanOutput } from "../src/clean-output.js";

/** Wait for PTY to exit + allow pending onData to flush. */
function runPty(command: string): Promise<{ output: string; exitCode: number }> {
  return new Promise((resolve) => {
    let output = "";
    let exited = false;
    let code = -1;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const settle = () => {
      if (timer) clearTimeout(timer);
      // Give ConPTY 500ms to flush remaining onData after onExit
      timer = setTimeout(() => resolve({ output, exitCode: code }), 500);
    };

    spawnPty({
      command,
      onData: (data) => {
        output += data;
        if (exited) settle();
      },
      onExit: (c) => {
        exited = true;
        code = c;
        settle();
      },
    });
  });
}

describe("pty-manager", () => {
  test("spawns command and captures output", async () => {
    const { exitCode, output } = await runPty("echo hello && echo world");
    expect(exitCode).toBe(0);
    expect(cleanOutput(output)).toContain("hello");
    expect(cleanOutput(output)).toContain("world");
  });

  test("isatty returns true in PTY", async () => {
    // node -p evaluates and prints; no quotes needed, avoids cmd.exe mangling
    const { output } = await runPty("node -p process.stdout.isTTY");
    const cleaned = cleanOutput(output);
    if (!cleaned.includes("true")) {
      console.log("raw output hex:", Buffer.from(output).toString("hex"));
      console.log("raw output repr:", JSON.stringify(output));
    }
    expect(cleaned).toContain("true");
  }, 10000);

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
