import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { spawnPty } from "./pty-manager.js";

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
      // CSI sequences: \x1b[ + optional ?>=! prefix + digits/semicolons + final byte
      .replace(/\x1b\[[?>=!]?[0-9;]*[A-Za-z@`~]/g, "")
      // OSC sequences terminated by BEL (\x07) or ST (\x1b\\)
      .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
      // Charset designators: \x1b( or \x1b) followed by a letter/digit
      .replace(/\x1b[()][A-Z0-9]/g, "")
      // Single-character escapes: \x1b followed by one char
      .replace(/\x1b[>=<NO78~]/g, "")
      // BEL character
      .replace(/\x07/g, "")
  );
}

/**
 * Simulate carriage return (\r) behavior.
 *
 * In a real terminal, \r moves the cursor back to column 0 and subsequent
 * characters overwrite what was there. Programs like `ls` may write a partial
 * line, then \r-overwrite it with the final formatted output.
 *
 * Simply deleting \r would concatenate both versions. Instead, for each line
 * we only keep the content after the last standalone \r.
 *
 * \r\n is treated as a normal line break (newline), not a rewrite.
 */
function processCarriageReturns(str: string): string {
  // First, normalize \r\n to \n (these are line breaks, not rewrites)
  let result = str.replace(/\r\n/g, "\n");
  // Then, for standalone \r (line rewrite), keep only the last segment
  result = result
    .split("\n")
    .map((line) => {
      if (!line.includes("\r")) return line;
      const parts = line.split("\r");
      // Keep the last non-empty part (the final overwrite)
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
 * 1. Strip ANSI escape sequences
 * 2. Simulate \r carriage return behavior
 * 3. Trim trailing whitespace and collapse excessive blank lines
 */
function cleanOutput(str: string): string {
  let result = stripAnsiCodes(str);
  result = processCarriageReturns(result);
  // Trim trailing whitespace from each line
  result = result
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n");
  // Collapse 3+ consecutive blank lines into 2
  result = result.replace(/\n{3,}/g, "\n\n");
  // Trim leading/trailing whitespace from the whole output
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
            // Stream partial output so pi knows the command is still running
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
                  cleanOutput(output) +
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
