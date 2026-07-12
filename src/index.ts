import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerMiniMax } from "./providers/minimax-openai.ts";
import { registerStepFun } from "./providers/stepfun-ai.ts";

export default function createExtension(pi: ExtensionAPI): void {
  registerMiniMax(pi);
  registerStepFun(pi);
}
