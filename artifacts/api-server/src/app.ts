import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { apiKeyAuth } from "./middlewares/apiKey";

const app: Express = express();

app.disable("x-powered-by");
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.removeHeader("Server");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  next();
});

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "RepoScope", version: "1.0.0", timestamp: new Date().toISOString() });
});
app.get("/api/healthz", (_req, res) => {
  res.json({ status: "ok", service: "RepoScope", version: "1.0.0", timestamp: new Date().toISOString() });
});

app.get("/api/docs", (_req, res) => {
  const base = process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}`
    : "http://localhost:3000";
  res.json({
    service: "RepoScope",
    version: "1.0.0",
    description: "GitHub repository intelligence platform powered by Buddy AI",
    auth: {
      header: "x-api-key: <your_key>",
      query: "?api_key=<your_key>",
      bearer: "Authorization: Bearer <your_key>",
    },
    baseUrl: base,
    endpoints: {
      "GET /api/health": "Health check — no key needed",
      "GET /api/docs": "This documentation — no key needed",
      "POST /api/repos/fetch": "Fetch metadata for up to 50 repos",
      "POST /api/repos/compare": "Compare repos side by side with scoring",
      "POST /api/repos/analyze": "Deep Buddy AI analysis (streaming)",
      "POST /api/repos/synthesize": "Synthesize repos into new GitHub repo (streaming)",
      "POST /api/repos/auto-update": "Buddy AI rewrites & pushes README (streaming)",
      "POST /api/repos/events": "Fetch real-time GitHub Events",
      "POST /api/repos/code-analyze": "Static code analysis (streaming)",
      "POST /api/repos/history": "Retrieve past analysis history",
      "DELETE /api/repos/history/:id": "Delete a history entry",
      "GET /api/repos/trending": "Get trending repos list",
      "POST /api/repos/chat": "Buddy AI chat (streaming)",
      "POST /api/repos/image-generate": "Generate images with Imagen 4",
      "GET /api/repos/skills": "List skills library",
      "GET /api/repos/skills/stats": "Skills library stats",
      "GET /api/repos/skills/detail": "Get skill detail by id",
      "GET /api/repos/gemini-pool-status": "Gemini key pool status",
      "GET /api/repos/admin/gemini-keys": "List Gemini keys (admin)",
      "POST /api/repos/admin/gemini-keys": "Add Gemini key (admin)",
      "DELETE /api/repos/admin/gemini-keys/:id": "Deactivate Gemini key (admin)",
      "POST /api/repos/admin/gemini-keys/sync": "Sync Gemini pool from DB (admin)",
    },
  });
});

app.use("/api", apiKeyAuth);
app.use("/api", router);

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "not_found", message: "Endpoint not found" });
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err }, "Unhandled error");
  res.status(500).json({ error: "internal_error", message: "An unexpected error occurred" });
});

export default app;
