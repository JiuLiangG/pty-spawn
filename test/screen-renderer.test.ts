import { ScreenRenderer } from "../src/screen-renderer.js";
import { describe, test, expect, afterEach } from "vitest";

describe("ScreenRenderer", () => {
  let renderer: ScreenRenderer;

  afterEach(() => {
    renderer?.dispose();
  });

  test("renders plain text output", async () => {
    renderer = new ScreenRenderer(80, 24);
    renderer.write("hello world\r\n");
    renderer.write("second line\r\n");
    await renderer.flush();
    const text = renderer.renderForLLM();
    expect(text).toContain("hello world");
    expect(text).toContain("second line");
  });

  test("handles cursor-home redraw (ConPTY pattern)", async () => {
    renderer = new ScreenRenderer(80, 24);
    renderer.write("partial content");
    renderer.write("\x1b[H");
    renderer.write("LICENSE  node_modules  README.md\r\n");
    renderer.write("src      package.json  tsconfig.json\r\n");
    await renderer.flush();
    const text = renderer.renderForLLM();
    expect(text).not.toContain("partial content");
    expect(text).toContain("LICENSE");
    expect(text).toContain("tsconfig.json");
  });

  test("handles ANSI color codes (stripped in output)", async () => {
    renderer = new ScreenRenderer(80, 24);
    renderer.write("\x1b[31mred text\x1b[0m normal\r\n");
    await renderer.flush();
    const text = renderer.renderForLLM();
    expect(text).toContain("red text");
    expect(text).toContain("normal");
    expect(text).not.toContain("\x1b");
  });

  test("handles clear screen", async () => {
    renderer = new ScreenRenderer(80, 24);
    renderer.write("old content\r\n");
    renderer.write("\x1b[2J\x1b[H");
    renderer.write("new content\r\n");
    await renderer.flush();
    const text = renderer.renderForLLM();
    expect(text).not.toContain("old content");
    expect(text).toContain("new content");
  });

  test("detects alternate buffer (TUI mode)", async () => {
    renderer = new ScreenRenderer(80, 24);
    renderer.write("\x1b[?1049h");
    renderer.write("TUI content here\r\n");
    await renderer.flush();
    const snap = renderer.snapshot();
    expect(snap.isAlternateBuffer).toBe(true);
    const text = renderer.renderForLLM();
    expect(text).toContain("[TUI screen");
    expect(text).toContain("TUI content here");
  });

  test("handles carriage return overwrite (progress bar)", async () => {
    renderer = new ScreenRenderer(80, 24);
    renderer.write("Progress: 50%\r");
    renderer.write("Progress: 100%\r\n");
    await renderer.flush();
    const text = renderer.renderForLLM();
    expect(text).toContain("Progress: 100%");
    expect(text).not.toMatch(/Progress: 50%/);
  });

  test("cursor forward produces spacing", async () => {
    renderer = new ScreenRenderer(80, 24);
    renderer.write("A\x1b[5CB\r\n");
    await renderer.flush();
    const text = renderer.renderForLLM();
    expect(text).toMatch(/A\s+B/);
  });

  test("returns to normal after leaving alternate buffer", async () => {
    renderer = new ScreenRenderer(80, 24);
    renderer.write("before TUI\r\n");
    renderer.write("\x1b[?1049h");
    renderer.write("TUI stuff\r\n");
    renderer.write("\x1b[?1049l");
    await renderer.flush();
    const snap = renderer.snapshot();
    expect(snap.isAlternateBuffer).toBe(false);
    const text = renderer.renderForLLM();
    expect(text).toContain("before TUI");
    expect(text).not.toContain("[TUI screen");
  });
});
