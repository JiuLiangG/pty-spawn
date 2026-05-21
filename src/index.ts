import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerPtyBashTool } from "./pty-bash-tool.js";
import { registerSessionTools } from "./session-tools.js";
import { killAllPtys } from "./pty-manager.js";
import { closeAllSessions } from "./session-manager.js";
import { startIpcServer, stopIpcServer } from "./ipc-server.js";

export default function (pi: ExtensionAPI) {
  // Register the pty_bash tool (one-shot commands)
  registerPtyBashTool(pi);

  // Register persistent session tools (pty_start/send/read/close)
  registerSessionTools(pi);

  // Start IPC server for CLI attach/list support ("internal livestream")
  const ipcServer = startIpcServer();

  // Clean up all active PTYs, sessions, and IPC server when the session ends
  pi.on("session_shutdown", async () => {
    closeAllSessions();
    killAllPtys();
    stopIpcServer(ipcServer);
  });
}
