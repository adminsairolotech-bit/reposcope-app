import { ReplitConnectors } from "@replit/connectors-sdk";

let connectors: ReplitConnectors | null = null;
let connectorToken: string | null = null;
let tokenFetchedAt = 0;
const TOKEN_TTL_MS = 55 * 60 * 1000; // refresh every 55 min

function getConnectors(): ReplitConnectors {
  if (!connectors) {
    connectors = new ReplitConnectors();
  }
  return connectors;
}

export async function getGitHubConnectorToken(): Promise<string | null> {
  if (connectorToken && Date.now() - tokenFetchedAt < TOKEN_TTL_MS) {
    return connectorToken;
  }
  try {
    const c = getConnectors();
    const res = await c.proxy("github", "/user", { method: "GET" });
    const authHeader = (res as any)?.request?.headers?.authorization as string | undefined;
    if (authHeader?.startsWith("Bearer ") || authHeader?.startsWith("token ")) {
      connectorToken = authHeader.replace(/^(Bearer |token )/, "");
      tokenFetchedAt = Date.now();
      return connectorToken;
    }
    return null;
  } catch {
    return null;
  }
}

export async function githubConnectorFetch(
  path: string,
  options?: { method?: string; body?: string }
): Promise<Response> {
  const c = getConnectors();
  const res = await c.proxy("github", path, {
    method: (options?.method ?? "GET") as any,
    ...(options?.body ? { body: options.body } : {}),
  });
  return res as unknown as Response;
}
