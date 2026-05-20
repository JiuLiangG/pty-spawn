import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { spawnPty } from "./pty-manager.js";

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
 *   These handle the "partial write then full redraw" pattern.
 *
 * - \x1b[nC (cursor forward n): replace with n spaces
 * - \x1b[nX (erase n chars):   remove (chars already blanked)
 */
function preprocessScreenCommands(str: string): string {
  // Find the last cursor-home or clear-screen sequence.
  // Everything before it was overwritten on a real terminal.
  // We search for \x1b[H and \x1b[2J, taking the latest occurrence.
  let lastRedrawEnd = 0;

  // \x1b[2J — clear entire screen
  let idx = str.lastIndexOf("\x1b[2J");
  if (idx >= 0) {
    lastRedrawEnd = Math.max(lastRedrawEnd, idx + 4); // 4 = length of \x1b[2J
  }

  // \x1b[H — cursor home (row 1, col 1)
  // Search after the last clear-screen to find the latest home
  const homeSeq = "\x1b[H";
  idx = str.lastIndexOf(homeSeq);
  if (idx >= 0) {
    lastRedrawEnd = Math.max(lastRedrawEnd, idx + 3); // 3 = length of \x1b[H
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
 *
 * Covers:
 * - CSI sequences: \x1b[ + optional prefix (?>=!) + params + final byte
 * - OSC sequences: \x1b] ... BEL or \x1b] ... ST
 * - Charset designators: \x1b( \x1b)
 * - Single-char escapes: \x1b= \x1b> \x1bN \x1bO \x1b7 \x1b8 etc.
 * - BEL character: \x07
 */
function stripAnsiCodes(str: string): string {
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
function processCarriageReturns(str: string): string {
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
 * Clean PTY output for LLM consumption.
 *
 * Pipeline:
 * 1. Preprocess screen commands (handle ConPTY redraw, cursor forward, erase)
 * 2. Strip remaining ANSI escape sequences
 * 3. Simulate \r carriage return behavior
 * 4. Trim whitespace and collapse excessive blank lines
 */
function cleanOutput(str: string): string {
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

export function registerPtyBashTool(pi: ExtensionAPI) {
  pi.registerTool({
    name: "pty_bash",
    label: "PTY Bash",
    description:
      "Execute a command in a real PTY (isatty=true). Use instead of " +
      "bash when the command needs interactive input, produces colored " +
      "output, or detects terminal presence.",
    promptSnippet:
      "Run a command in a real PTY terminal with isatty()=true",
    promptGuidelines: [
      "Use pty_bash instead of bash when the command is interactive or " +
        "produces colored TUI output, or checks isatty().",
      "Use regular bash for simple non-interactive commands (ls, cat, grep).",
    ],
    parameters: Type.Object({
      command: Type.String({ description: "Shell command to execute" }),
      timeout: Type.Optional(
        Type.Number({ description: "Timeout in seconds. Default: 120" })
      ),
    }),

    async execute(
      toolCallId: string,
      params: { command: string; timeout?: number },
      signal: AbortSignal | undefined,
      onUpdate: ((update: any) => void) | undefined,
      ctx: { cwd: string }
    ) {
      const timeout = (params.timeout ?? 120) * 1000;

      return new Promise<any>((resolve) => {
        let settled = false;
        let output = "";

        const handle = spawnPty({
          command: params.command,
          cwd: ctx.cwd,
          onData: (chunk) => {
            if (settled) return;
            output += chunk;
            onUpdate?.({
              content: [{ type: "text", text: cleanOutput(output) }],
            });
          },
          onExit: (exitCode) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve({
              content: [
                {
                  type: "text",
                  text: cleanOutput(output),
                },
              ],
              details: { exitCode },
            });
          },
        });

        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          handle.kill();
          resolve({
            content: [
              {
                type: "text",
                text:
                  cleanOutput(output) +
                  "\n[Timed out after " +
                  (params.timeout ?? 120) +
                  "s]",
              },
            ],
            details: { exitCode: -1 },
          });
        }, timeout);

        signal?.addEventListener("abort", () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          handle.kill();
          resolve({
            content: [
              {
                type: "text",
                text: cleanOutput(output) + "\n[Cancelled]",
              },
            ],
            details: { exitCode: -1 },
          });
        });
      });
    },
  });
}
