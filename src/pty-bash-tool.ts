import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { spawnPty } from "./pty-manager.js";

/**
 * Strip ANSI escape sequences and PTY artifacts from a string.
 *
 * Covers:
 * - CSI sequences: \x1b[ + optional prefix (?>=!) + params + final byte
 *   e.g. \x1b[31m (SGR), \x1b[?25h (DEC show cursor), \x1b[2J (clear)
 * - OSC sequences: \x1b] ... BEL or \x1b] ... ST
 *   e.g. \x1b]0;title\x07 (set window title)
 * - Charset designators: \x1b( \x1b)
 * - Single-char escapes: \x1b= \x1b> \x1bN \x1bO \x1b7 \x1b8 etc.
 * - Carriage returns: PTY sends \r\n, we strip \r
 * - BEL character: \x07
 *
 * Good enough for line-oriented output; full-screen TUI output will lose layout.
 */
function stripAnsi(str: string): string {
  return (
    str
      // CSI sequences: \x1b[ + optional ?>=! prefix + digits/semicolons + final byte
      .replace(/\x1b\[[?>=!]?[0-9;]*[A-Za-z@`~]/g, "")
      // OSC sequences terminated by BEL (\x07) or ST (\x1b\\)
      .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
      // Charset designators: \x1b( or \x1b) followed by a letter/digit
      .replace(/\x1b[()][A-Z0-9]/g, "")
      // Single-character escapes: \x1b followed by one char (=, >, <, N, O, 7, 8, etc.)
      .replace(/\x1b[>=<NO78~]/g, "")
      // BEL character
      .replace(/\x07/g, "")
      // Carriage returns (PTY sends \r\n line endings)
      .replace(/\r/g, "")
  );
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
            // Stream partial output so pi knows the command is still running
            onUpdate?.({
              content: [{ type: "text", text: stripAnsi(output) }],
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
                  text: stripAnsi(output),
                },
              ],
              details: { exitCode },
            });
          },
        });

        // Timeout
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          handle.kill();
          resolve({
            content: [
              {
                type: "text",
                text:
                  stripAnsi(output) +
                  "\n[Timed out after " +
                  (params.timeout ?? 120) +
                  "s]",
              },
            ],
            details: { exitCode: -1 },
          });
        }, timeout);

        // Escape cancellation
        signal?.addEventListener("abort", () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          handle.kill();
          resolve({
            content: [
              {
                type: "text",
                text: stripAnsi(output) + "\n[Cancelled]",
              },
            ],
            details: { exitCode: -1 },
          });
        });
      });
    },
  });
}
