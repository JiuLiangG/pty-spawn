#!/usr/bin/env node
/**
 * pty-spawn CLI — command-line interface for observing PTY sessions.
 *
 * Usage:
 *   pty-spawn list              List all active sessions
 *   pty-spawn ls                Alias for list
 *   pty-spawn attach <id>       Attach to a session (real-time terminal mirror)
 *
 * The CLI connects to the IPC server running inside the pty-spawn
 * MCP extension process. The server must be running (i.e., Pi must
 * have pty-spawn loaded) for these commands to work.
 */

import { attach } from "./attach.js";
import { list } from "./list.js";

const USAGE = `pty-spawn — real-time PTY session observer

Usage:
  pty-spawn list              List all active sessions
  pty-spawn ls                Alias for list
  pty-spawn attach <id>       Attach to a session (real-time mirror)

Examples:
  pty-spawn list
  pty-spawn attach s1
`;

const [, , command, ...args] = process.argv;

switch (command) {
  case "attach":
    if (!args[0]) {
      console.error("Error: session ID required\n");
      console.error("Usage: pty-spawn attach <sessionId>");
      process.exit(1);
    }
    attach(args[0]);
    break;

  case "list":
  case "ls":
    list();
    break;

  case "--help":
  case "-h":
  case undefined:
    console.log(USAGE);
    break;

  default:
    console.error(`Unknown command: ${command}\n`);
    console.error(USAGE);
    process.exit(1);
}
