import Anthropic from "@anthropic-ai/sdk";

if (!process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL || !process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY) {
  console.warn(
    "[integrations-anthropic] AI_INTEGRATIONS_ANTHROPIC_BASE_URL or AI_INTEGRATIONS_ANTHROPIC_API_KEY not set. " +
    "Analyze and code-analyze premium engine features require Anthropic AI integration."
  );
}

export const anthropic = new Anthropic({
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY ?? "placeholder",
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL ?? "https://api.anthropic.com",
});
