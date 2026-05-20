import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { spawnPty } from "./pty-manager.js";
import { ScreenRenderer } from "./screen-renderer.js";
import { cleanOutput } from "./clean-output.js";

/**
 * Try to create a ScreenRenderer. If @xterm/headless is unavailable
 * at runtime (e.g. not installed), return null and fall back to
 * the regex-based cleanOutput pipeline.
 */
function tryCreateRenderer(
  cols: number,
  rows: number
): ScreenRenderer | null {
  try {
    return new ScreenRenderer(cols, rows);
  } catch {
    return null;
  }
}

export function registerPtyBashTool(pi: ExtensionAPI) {
  pi.registerTool({
    name: "pty_bash",
    label: "PTY Bash",
    description:
      "Execute a command in a real PTY (isatty=true). Use instead of " +
      "bash when the command needs interactive input, produces colored " +
      "output, or detects terminal presence. Supports full-screen TUI " +
      "programs (vim, htop, etc.) via headless terminal emulation.",
    promptSnippet:
      "Run a command in a real PTY terminal with isatty()=true",
    promptGuidelines: [
      "Use pty_bash instead of bash when the command is interactive or " +
        "produces colored TUI output, or checks isatty().",
      "Use regular bash for simple non-interactive commands (ls, cat, grep).",
      "Full-screen TUI programs (vim, htop, top) are supported — output " +
        "is rendered via headless terminal emulation.",
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
      const renderer = tryCreateRenderer(80, 24);

      /** Get clean text from either the renderer or the regex fallback. */
      function getOutput(rawBuf: string): string {
        if (renderer) {
          return renderer.renderForLLM();
        }
        return cleanOutput(rawBuf);
      }

      return new Promise<any>((resolve) => {
        let settled = false;
        let rawOutput = "";

        const handle = spawnPty({
          command: params.command,
          cwd: ctx.cwd,
          onData: (chunk) => {
            if (settled) return;
            rawOutput += chunk;
            renderer?.write(chunk);
            onUpdate?.({
              content: [{ type: "text", text: getOutput(rawOutput) }],
            });
          },
          onExit: (exitCode) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            const text = getOutput(rawOutput);
            renderer?.dispose();
            resolve({
              content: [{ type: "text", text }],
              details: { exitCode },
            });
          },
        });

        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          handle.kill();
          const text = getOutput(rawOutput);
          renderer?.dispose();
          resolve({
            content: [
              {
                type: "text",
                text:
                  text +
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
          const text = getOutput(rawOutput);
          renderer?.dispose();
          resolve({
            content: [
              {
                type: "text",
                text: text + "\n[Cancelled]",
              },
            ],
            details: { exitCode: -1 },
          });
        });
      });
    },
  });
}
