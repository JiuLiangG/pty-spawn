import { Terminal } from "@xterm/headless";
import type { ScreenSnapshot } from "./types.js";

/**
 * Headless terminal emulator wrapping @xterm/headless.
 *
 * Every chunk from node-pty's onData is fed into write().
 * At any point, snapshot() or renderForLLM() reads the screen.
 *
 * IMPORTANT: Terminal.write() is asynchronous — data is queued and
 * processed in the next microtask. In production this is fine because
 * reads happen well after writes (on exit or periodic updates).
 * For tests or synchronous reads, call await flush() first.
 */
export class ScreenRenderer {
  private terminal: Terminal;

  constructor(cols: number = 80, rows: number = 24) {
    this.terminal = new Terminal({
      cols,
      rows,
      allowProposedApi: true,
      scrollback: 100,
    });
  }

  /**
   * Feed raw PTY output into the terminal emulator.
   * Note: processing is asynchronous. Call flush() before reading
   * if you need the buffer to be up-to-date immediately.
   */
  write(data: string): void {
    this.terminal.write(data);
  }

  /**
   * Wait for all pending write data to be processed.
   * Call this before snapshot() or renderForLLM() when you need
   * guaranteed up-to-date buffer contents (mainly in tests).
   */
  flush(): Promise<void> {
    return new Promise((resolve) => {
      this.terminal.write("", resolve);
    });
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
      for (let y = 0; y < this.terminal.rows; y++) {
        const line = buffer.getLine(y);
        allLines.push(line ? line.translateToString(true) : "");
      }
    } else {
      const scrollback = buffer.baseY;
      const totalLines = scrollback + this.terminal.rows;
      for (let y = 0; y < totalLines; y++) {
        const line = buffer.getLine(y);
        allLines.push(line ? line.translateToString(true) : "");
      }
    }

    while (allLines.length > 0 && allLines[allLines.length - 1].trim() === "") {
      allLines.pop();
    }

    let result = allLines.join("\n");

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
