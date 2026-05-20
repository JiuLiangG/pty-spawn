/**
 * G2a-level regex-based output cleaning pipeline.
 *
 * After G2b, this serves as the fallback when @xterm/headless
 * fails to load. The pipeline handles the most common PTY output
 * patterns but cannot correctly render full-screen TUI programs.
 */

/**
 * Preprocess raw PTY output to handle screen-oriented commands
 * before ANSI stripping.
 *
 * ConPTY (Windows) and some programs use cursor positioning to
 * redraw the screen. Without a terminal emulator, we simulate
 * the most common patterns:
 *
 * - \x1b[2J (clear screen): discard everything before it
 * - \x1b[H  (cursor home):  discard everything before it
 * - \x1b[nC (cursor forward n): replace with n spaces
 * - \x1b[nX (erase n chars):   remove (chars already blanked)
 */
export function preprocessScreenCommands(str: string): string {
  let lastRedrawEnd = 0;

  // \x1b[2J — clear entire screen
  let idx = str.lastIndexOf("\x1b[2J");
  if (idx >= 0) {
    lastRedrawEnd = Math.max(lastRedrawEnd, idx + 4);
  }

  // \x1b[H — cursor home (row 1, col 1)
  const homeSeq = "\x1b[H";
  idx = str.lastIndexOf(homeSeq);
  if (idx >= 0) {
    lastRedrawEnd = Math.max(lastRedrawEnd, idx + 3);
  }

  if (lastRedrawEnd > 0) {
    str = str.slice(lastRedrawEnd);
  }

  // \x1b[nC — cursor forward n columns → replace with n spaces
  str = str.replace(/\x1b\[(\d+)C/g, (_, n) => " ".repeat(parseInt(n, 10)));

  // \x1b[nX — erase n characters → remove
  str = str.replace(/\x1b\[\d*X/g, "");

  return str;
}

/**
 * Strip ANSI escape sequences from a string.
 */
export function stripAnsiCodes(str: string): string {
  return (
    str
      .replace(/\x1b\[[?>=!]?[0-9;]*[A-Za-z@`~]/g, "")
      .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
      .replace(/\x1b[()][A-Z0-9]/g, "")
      .replace(/\x1b[>=<NO78~]/g, "")
      .replace(/\x07/g, "")
  );
}

/**
 * Simulate carriage return (\r) behavior.
 * \r\n → normal newline. Standalone \r → keep only text after last \r.
 */
export function processCarriageReturns(str: string): string {
  let result = str.replace(/\r\n/g, "\n");
  result = result
    .split("\n")
    .map((line) => {
      if (!line.includes("\r")) return line;
      const parts = line.split("\r");
      for (let i = parts.length - 1; i >= 0; i--) {
        if (parts[i].length > 0) return parts[i];
      }
      return "";
    })
    .join("\n");
  return result;
}

/**
 * Clean PTY output for LLM consumption using regex-based pipeline.
 *
 * Pipeline:
 * 1. Preprocess screen commands (handle ConPTY redraw, cursor forward, erase)
 * 2. Strip remaining ANSI escape sequences
 * 3. Simulate \r carriage return behavior
 * 4. Trim whitespace and collapse excessive blank lines
 */
export function cleanOutput(str: string): string {
  let result = preprocessScreenCommands(str);
  result = stripAnsiCodes(result);
  result = processCarriageReturns(result);
  result = result
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n");
  result = result.replace(/\n{3,}/g, "\n\n");
  result = result.trim();
  return result;
}
