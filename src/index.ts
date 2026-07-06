import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { makeProvider } from "./providers/minimax-openai.ts";

export default function createExtension(pi: ExtensionAPI): void {
  makeProvider(pi, "minimax-openai", "https://api.minimax.io/v1", "$MINIMAX_API_KEY", "MiniMax (OpenAI)");
  makeProvider(pi, "minimax-openai-cn", "https://api.minimaxi.com/v1", "$MINIMAX_CN_API_KEY", "MiniMax CN (OpenAI)");
}
