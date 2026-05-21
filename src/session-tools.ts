import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  createSession,
  sendToSession,
  readSession,
  closeSession,
  getSessionStatus,
} from "./session-manager.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Convert literal escape sequences in tool input to real control characters.
 *
 * When the AI model constructs JSON tool calls, it often writes
 * "python\\n" which arrives as the literal string "python\n" (backslash + n)
 * rather than "python" + newline. This function fixes that.
 *
 * Additionally, \n is mapped to \r (carriage return) because in any PTY,
 * pressing Enter sends CR (0x0D), not LF (0x0A). The terminal driver
 * handles CR→LF conversion for the application. This is true on all
 * platforms (Windows, Unix, macOS).
 */
function unescapeInput(input: string): string {
  return input.replace(
    /\\(n|r|t|\\)|\\x([0-9a-fA-F]{2})/g,
    (match, simple, hex) => {
      if (hex) return String.fromCharCode(parseInt(hex, 16));
      switch (simple) {
        case "n":
          return "\r"; // Enter = CR in PTY
        case "r":
          return "\r";
        case "t":
          return "\t";
        case "\\":
          return "\\";
        default:
          return match;
      }
    }
  );
}

export function registerSessionTools(pi: ExtensionAPI) {
  // pty_start — Start a new interactive session
  pi.registerTool({
    name: "pty_start",
    label: "PTY Start Session",
    description:
      "Start a new persistent interactive terminal session. " +
      "Returns a sessionId for use with pty_send, pty_read, pty_close. " +
      "Use for multi-turn interactions (REPLs, ssh, mysql, etc.).",
    promptSnippet:
      "Start a persistent terminal session for multi-turn interaction",
    promptGuidelines: [
      "Use pty_start to begin an interactive session (ssh, python, mysql, etc.).",
      "Use pty_send to send commands or keystrokes. Always include \\n for Enter.",
      "Use pty_read to check output without sending input.",
      "Use pty_close when done. Sessions are NOT auto-cleaned.",
      "For one-shot commands, prefer pty_bash instead.",
      "Send Ctrl+C as \\x03, Ctrl+D as \\x04, Tab as \\t.",
    ],
    parameters: Type.Object({
      cwd: Type.Optional(
        Type.String({ description: "Working directory for the session" })
      ),
    }),

    async execute(
      toolCallId: string,
      params: { cwd?: string },
      signal: AbortSignal | undefined,
      onUpdate: ((update: any) => void) | undefined,
      ctx: { cwd: string }
    ) {
      const session = createSession(params.cwd ?? ctx.cwd);
      // Wait for shell prompt to appear
      await sleep(500);
      const output = await readSession(session.id);
      return {
        content: [
          {
            type: "text",
            text: "Session started: " + session.id + "\n\n" + output,
          },
        ],
        details: { sessionId: session.id },
      };
    },
  });

  // pty_send — Send input to a session
  pi.registerTool({
    name: "pty_send",
    label: "PTY Send",
    description:
      "Send input (commands, keystrokes) to a persistent terminal session. " +
      "Does NOT auto-append newline — include \\n for Enter. " +
      "Returns the current screen after a brief wait.",
    promptSnippet: "Send input to a persistent terminal session",
    parameters: Type.Object({
      sessionId: Type.String({ description: "Session ID from pty_start" }),
      input: Type.String({
        description:
          "Input to send. Include \\n for Enter. " +
          "Special keys: \\t=Tab, \\x03=Ctrl+C, \\x04=Ctrl+D",
      }),
      wait: Type.Optional(
        Type.Number({
          description:
            "Milliseconds to wait before reading output. Default: 500",
        })
      ),
    }),

    async execute(
      toolCallId: string,
      params: { sessionId: string; input: string; wait?: number },
      signal: AbortSignal | undefined,
      onUpdate: ((update: any) => void) | undefined,
      ctx: { cwd: string }
    ) {
      const realInput = unescapeInput(params.input);
      sendToSession(params.sessionId, realInput);
      await sleep(params.wait ?? 500);
      const output = await readSession(params.sessionId);
      const status = getSessionStatus(params.sessionId);
      return {
        content: [{ type: "text", text: output }],
        details: { sessionId: params.sessionId, exited: status.exited },
      };
    },
  });

  // pty_read — Read current screen without sending input
  pi.registerTool({
    name: "pty_read",
    label: "PTY Read",
    description:
      "Read the current screen of a persistent terminal session " +
      "without sending any input. Use to poll long-running commands.",
    promptSnippet: "Read current terminal screen without sending input",
    parameters: Type.Object({
      sessionId: Type.String({ description: "Session ID from pty_start" }),
    }),

    async execute(
      toolCallId: string,
      params: { sessionId: string },
      signal: AbortSignal | undefined,
      onUpdate: ((update: any) => void) | undefined,
      ctx: { cwd: string }
    ) {
      const output = await readSession(params.sessionId);
      const status = getSessionStatus(params.sessionId);
      return {
        content: [{ type: "text", text: output }],
        details: { sessionId: params.sessionId, exited: status.exited },
      };
    },
  });

  // pty_close — Close a session
  pi.registerTool({
    name: "pty_close",
    label: "PTY Close Session",
    description:
      "Close a persistent terminal session, killing the process and " +
      "freeing resources.",
    promptSnippet: "Close a persistent terminal session",
    parameters: Type.Object({
      sessionId: Type.String({ description: "Session ID to close" }),
    }),

    async execute(
      toolCallId: string,
      params: { sessionId: string },
      signal: AbortSignal | undefined,
      onUpdate: ((update: any) => void) | undefined,
      ctx: { cwd: string }
    ) {
      closeSession(params.sessionId);
      return {
        content: [
          {
            type: "text",
            text: "Session " + params.sessionId + " closed.",
          },
        ],
        details: { closed: true },
      };
    },
  });
}
