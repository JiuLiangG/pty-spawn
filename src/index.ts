import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerPtyBashTool } from "./pty-bash-tool.js";
import { killAllPtys } from "./pty-manager.js";

export default function (pi: ExtensionAPI) {
  // Register the pty_bash tool
  registerPtyBashTool(pi);

  // Clean up all active PTYs when the session ends
  pi.on("session_shutdown", async () => {
    killAllPtys();
  });
}
