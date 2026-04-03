import OpenAI from "openai";

function createClient(): OpenAI {
  // Prefer Replit's managed OpenRouter integration over personal key
  // (Replit integration has higher tier access)
  const replitBaseURL = process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL;
  const replitApiKey = process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY;

  if (replitBaseURL && replitApiKey) {
    console.log("[integrations-openrouter] Using Replit managed OpenRouter integration.");
    return new OpenAI({
      baseURL: replitBaseURL,
      apiKey: replitApiKey,
    });
  }

  // Fallback to personal key
  const personalKey = process.env.OPENROUTER_API_KEY;
  if (personalKey) {
    console.log("[integrations-openrouter] Using personal OPENROUTER_API_KEY (free tier).");
    return new OpenAI({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: personalKey,
      defaultHeaders: {
        "HTTP-Referer": "https://reposcope.replit.app",
        "X-Title": "RepoScope",
      },
    });
  }

  console.warn(
    "[integrations-openrouter] No OpenRouter key configured. OpenRouter engines will be unavailable.",
  );
  return new OpenAI({ baseURL: "https://openrouter.ai/api/v1", apiKey: "placeholder" });
}

export const openrouter = createClient();
