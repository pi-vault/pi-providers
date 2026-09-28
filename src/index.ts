import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCommandCode } from "./providers/command-code.ts";
import { registerMiniMax } from "./providers/minimax-openai.ts";
import { registerStepFun } from "./providers/stepfun-ai.ts";
import { registerTypeSafeDecisionTool } from "./tools/typesafe-decide.ts";

export default function createExtension(pi: ExtensionAPI): void {
  registerCommandCode(pi);
  registerMiniMax(pi);
  registerStepFun(pi);
  registerTypeSafeDecisionTool(pi);
}
