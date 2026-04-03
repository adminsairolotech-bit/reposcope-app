import { Request, Response, NextFunction } from "express";

const REPOSCOPE_API_KEY = process.env.REPOSCOPE_API_KEY;
const APP_DOMAIN = process.env.REPLIT_DEV_DOMAIN ?? "";

export function apiKeyAuth(req: Request, res: Response, next: NextFunction) {
  const PUBLIC = ["/health", "/healthz", "/docs", "/repos/trending", "/repos/gemini-pool-status", "/repos/skills"];
  if (PUBLIC.some(p => req.path === p || req.path.startsWith(p))) return next();

  if (!REPOSCOPE_API_KEY) return next();

  const referer = (req.headers.referer ?? req.headers.referrer ?? "") as string;
  const origin = (req.headers.origin ?? "") as string;
  if (APP_DOMAIN && (referer.includes(APP_DOMAIN) || origin.includes(APP_DOMAIN))) {
    return next();
  }

  const headerKey = req.headers["x-api-key"];
  const queryKey = req.query["api_key"];
  const authHeader = req.headers["authorization"];
  const key =
    (typeof headerKey === "string" ? headerKey : undefined) ??
    (typeof queryKey === "string" ? queryKey : undefined) ??
    (typeof authHeader === "string" ? authHeader.replace("Bearer ", "") : undefined);

  if (!key || key !== REPOSCOPE_API_KEY) {
    return res.status(401).json({
      error: "unauthorized",
      message: "API key required. Pass it as 'x-api-key' header, '?api_key=...' query param, or 'Authorization: Bearer ...'",
      docs: "/api/docs",
    });
  }

  next();
}
