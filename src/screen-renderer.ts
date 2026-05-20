import { Terminal } from "@xterm/headless";
import type { ScreenSnapshot } from "./types.js";

/**
 * Headless terminal emulator wrapping @xterm/headless.
 *
 * Every chunk from node-pty's onData is fed into write().
 * At any point, snapshot() or renderForLLM() reads the screen.
 *
 * This replaces the regex-based cleanOutput pipeline with a real
 * terminal emulator that correctly handles:
 * - Cursor positioning (\x1b[H, \x1b[row;colH)
 * - Screen clear (\x1b[2J)
 * - Alternate screen buffer (\x1b[?1049h/l)
 * - Line wrapping, scrolling, erase sequences
 * - All SGR attributes (silently consumed, not in output)
 */
export class ScreenRenderer {
  private terminal: Terminal;

  constructor(cols: number = 80, rows: number = 24) {
    this.terminal = new Terminal({
      cols,
      rows,
      allowProposedApi: true,
      // Keep scrollback bounded. For LLM consumption we mostly care
      // about the visible screen, but line-oriented command output
      // can exceed the visible area.
      scrollback: 100,
    });
  }

  /**
   * Feed raw PTY output into the terminal emulator.
   * Call this from the onData callback.
   */
  write(data: string): void {
    this.terminal.write(data);
  }

  /**
   * Capture the current terminal screen state.
   */
  snapshot(): ScreenSnapshot {
    const buffer = this.terminal.buffer.active;
    const lines: string[] = [];

    for (let y = 0; y < this.terminal.rows; y++) {
      const line = buffer.getLine(y);
      lines.push(line ? line.translateToString(true) : "");
    }

    return {
      lines,
      cursorX: buffer.cursorX,
      cursorY: buffer.cursorY,
      cols: this.terminal.cols,
      rows: this.terminal.rows,
      isAlternateBuffer: buffer.type === "alternate",
    };
  }

  /**
   * Render screen content as clean text for LLM consumption.
   *
   * For normal (main buffer) output:
   *   Returns scrollback + visible screen, trimmed of trailing blank lines.
   *
   * For alternate buffer (full-screen TUI) output:
   *   Returns only the visible screen with a header indicating TUI mode.
   */
  renderForLLM(): string {
    const buffer = this.terminal.buffer.active;
    const isAlt = buffer.type === "alternate";
    const allLines: string[] = [];

    if (isAlt) {
      // Alternate buffer: only visible screen matters
      for (let y = 0; y < this.terminal.rows; y++) {
        const line = buffer.getLine(y);
        allLines.push(line ? line.translateToString(true) : "");
      }
    } else {
      // Normal buffer: include scrollback + visible area
      const scrollback = buffer.baseY; // lines scrolled off top
      const totalLines = scrollback + this.terminal.rows;
      for (let y = 0; y < totalLines; y++) {
        const line = buffer.getLine(y);
        allLines.push(line ? line.translateToString(true) : "");
      }
    }

    // Trim trailing empty lines
    while (allLines.length > 0 && allLines[allLines.length - 1].trim() === "") {
      allLines.pop();
    }

    let result = allLines.join("\n");

    // For alternate buffer, add a hint so the LLM knows it's TUI output
    if (isAlt) {
      result =
        "[TUI screen " +
        this.terminal.cols +
        "x" +
        this.terminal.rows +
        "]\n" +
        result;
    }

    return result;
  }

  /**
   * Resize the terminal. Should be called in sync with PTY resize.
   */
  resize(cols: number, rows: number): void {
    this.terminal.resize(cols, rows);
  }

  /**
   * Dispose the terminal and free resources.
   */
  dispose(): void {
    this.terminal.dispose();
  }
}
