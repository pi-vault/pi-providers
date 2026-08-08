import { createProvider, envApiKeyAuth, type Provider } from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { COMMAND_CODE_BASE_URL, commandCodeModels } from "./command-code/models.ts";

export function createCommandCodeProvider(): Provider<"anthropic-messages" | "openai-completions"> {
  return createProvider({
    id: "command-code",
    name: "Command Code",
    baseUrl: COMMAND_CODE_BASE_URL,
    headers: process.env.CMD_ZDR === "1" ? { "x-cmd-zdr": "1" } : undefined,
    auth: { apiKey: envApiKeyAuth("Command Code API key", ["CMD_API_KEY"]) },
    models: commandCodeModels,
    api: {
      "anthropic-messages": anthropicMessagesApi(),
      "openai-completions": openAICompletionsApi(),
    },
  });
}
