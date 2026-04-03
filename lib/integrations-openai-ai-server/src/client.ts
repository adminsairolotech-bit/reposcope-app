import OpenAI from "openai";

function createClient(): OpenAI {
  const replitBaseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const replitApiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  const personalApiKey = process.env.OPENAI_API_KEY;

  if (replitBaseURL && replitApiKey) {
    console.log("[integrations-openai] Using Replit managed OpenAI integration.");
    return new OpenAI({ baseURL: replitBaseURL, apiKey: replitApiKey });
  }

  if (personalApiKey) {
    console.log("[integrations-openai] Using personal OPENAI_API_KEY.");
    return new OpenAI({ baseURL: "https://api.openai.com/v1", apiKey: personalApiKey });
  }

  console.warn(
    "[integrations-openai] AI_INTEGRATIONS_OPENAI_BASE_URL or AI_INTEGRATIONS_OPENAI_API_KEY not set. " +
    "Synthesize and auto-update features require OpenAI AI integration."
  );
  return new OpenAI({ baseURL: "https://api.openai.com/v1", apiKey: "placeholder" });
}

export const openai = createClient();
