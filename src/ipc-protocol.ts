/**
 * IPC Protocol for pty-spawn attach system.
 *
 * Communication between the MCP server process (IPC server) and
 * external CLI clients (pty-spawn attach/list) uses NDJSON
 * (newline-delimited JSON) over TCP localhost.
 *
 * PTY output data is base64-encoded to safely transport binary
 * and control characters through JSON.
 */

// ── Client → Server Messages ──────────────────────────────────────

export type ClientListMessage = {
  type: "list";
};

export type ClientAttachMessage = {
  type: "attach";
  sessionId: string;
};

export type ClientDetachMessage = {
  type: "detach";
  sessionId: string;
};

export type ClientMessage =
  | ClientListMessage
  | ClientAttachMessage
  | ClientDetachMessage;

// ── Server → Client Messages ──────────────────────────────────────

export type SessionInfo = {
  id: string;
  exited: boolean;
  exitCode: number | null;
};

export type ServerSessionListMessage = {
  type: "session_list";
  sessions: SessionInfo[];
};

export type ServerDataMessage = {
  type: "data";
  sessionId: string;
  /** Base64-encoded raw PTY output (preserves ANSI escapes, binary) */
  data: string;
};

export type ServerExitMessage = {
  type: "exit";
  sessionId: string;
  exitCode: number | null;
};

export type ServerErrorMessage = {
  type: "error";
  message: string;
};

export type ServerMessage =
  | ServerSessionListMessage
  | ServerDataMessage
  | ServerExitMessage
  | ServerErrorMessage;

// ── Helpers ───────────────────────────────────────────────────────

/**
 * Encode a message as an NDJSON line (JSON + newline).
 */
export function encodeMessage(msg: ClientMessage | ServerMessage): string {
  return JSON.stringify(msg) + "\n";
}

/**
 * Parse a single NDJSON line into a message object.
 * Returns null if parsing fails.
 */
export function parseMessage<T = ClientMessage | ServerMessage>(
  line: string
): T | null {
  try {
    return JSON.parse(line) as T;
  } catch {
    return null;
  }
}

/**
 * Process a buffer of incoming data, extracting complete NDJSON lines.
 * Returns an object with parsed messages and the remaining buffer.
 */
export function processBuffer<T = ClientMessage | ServerMessage>(
  buffer: string
): { messages: T[]; remaining: string } {
  const messages: T[] = [];
  let remaining = buffer;

  while (remaining.includes("\n")) {
    const idx = remaining.indexOf("\n");
    const line = remaining.slice(0, idx).trim();
    remaining = remaining.slice(idx + 1);

    if (line.length === 0) continue;

    const msg = parseMessage<T>(line);
    if (msg) messages.push(msg);
  }

  return { messages, remaining };
}
