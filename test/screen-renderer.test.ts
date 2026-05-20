import { ScreenRenderer } from "../src/screen-renderer.js";
import { describe, test, expect, afterEach } from "vitest";

describe("ScreenRenderer", () => {
  let renderer: ScreenRenderer;

  afterEach(() => {
    renderer?.dispose();
  });

  test("renders plain text output", () => {
    renderer = new ScreenRenderer(80, 24);
    renderer.write("hello world\r\n");
    renderer.write("second line\r\n");
    const text = renderer.renderForLLM();
    expect(text).toContain("hello world");
    expect(text).toContain("second line");
  });

  test("handles cursor-home redraw (ConPTY pattern)", () => {
    renderer = new ScreenRenderer(80, 24);
    // Simulate ConPTY: write partial, then cursor home + full redraw
    renderer.write("partial content");
    renderer.write("\x1b[H"); // cursor home
    renderer.write("LICENSE  node_modules  README.md\r\n");
    renderer.write("src      package.json  tsconfig.json\r\n");
    const text = renderer.renderForLLM();
    // "partial content" should be overwritten, not duplicated
    expect(text).not.toContain("partial content");
    expect(text).toContain("LICENSE");
    expect(text).toContain("tsconfig.json");
  });

  test("handles ANSI color codes (stripped in output)", () => {
    renderer = new ScreenRenderer(80, 24);
    renderer.write("\x1b[31mred text\x1b[0m normal\r\n");
    const text = renderer.renderForLLM();
    expect(text).toContain("red text");
    expect(text).toContain("normal");
    expect(text).not.toContain("\x1b");
  });

  test("handles clear screen", () => {
    renderer = new ScreenRenderer(80, 24);
    renderer.write("old content\r\n");
    renderer.write("\x1b[2J\x1b[H"); // clear + home
    renderer.write("new content\r\n");
    const text = renderer.renderForLLM();
    expect(text).not.toContain("old content");
    expect(text).toContain("new content");
  });

  test("detects alternate buffer (TUI mode)", () => {
    renderer = new ScreenRenderer(80, 24);
    renderer.write("\x1b[?1049h"); // enter alternate screen
    renderer.write("TUI content here\r\n");
    const snap = renderer.snapshot();
    expect(snap.isAlternateBuffer).toBe(true);
    const text = renderer.renderForLLM();
    expect(text).toContain("[TUI screen");
    expect(text).toContain("TUI content here");
  });

  test("handles carriage return overwrite (progress bar)", () => {
    renderer = new ScreenRenderer(80, 24);
    renderer.write("Progress: 50%\r");
    renderer.write("Progress: 100%\r\n");
    const text = renderer.renderForLLM();
    // Should only show final state
    expect(text).toContain("Progress: 100%");
    expect(text).not.toMatch(/Progress: 50%/);
  });

  test("cursor forward produces spacing", () => {
    renderer = new ScreenRenderer(80, 24);
    renderer.write("A\x1b[5CB\r\n"); // A, then 5 cols forward, then B
    const text = renderer.renderForLLM();
    // A and B should be separated by spaces
    expect(text).toMatch(/A\s+B/);
  });

  test("returns to normal after leaving alternate buffer", () => {
    renderer = new ScreenRenderer(80, 24);
    renderer.write("before TUI\r\n");
    renderer.write("\x1b[?1049h"); // enter alt
    renderer.write("TUI stuff\r\n");
    renderer.write("\x1b[?1049l"); // leave alt
    const snap = renderer.snapshot();
    expect(snap.isAlternateBuffer).toBe(false);
    const text = renderer.renderForLLM();
    expect(text).toContain("before TUI");
    expect(text).not.toContain("[TUI screen");
  });
});
