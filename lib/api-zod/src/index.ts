export * from "./generated/api";
export * from "./generated/types";

import * as zod from "zod";

export const AnalyzeReposBody = zod.object({
  repos: zod.array(zod.string()).min(1).max(50),
  question: zod.string().optional(),
  githubToken: zod.string().optional(),
  saveHistory: zod.boolean().optional(),
});

export const CodeAnalyzeBody = zod.object({
  repos: zod.array(zod.string()).min(1).max(10),
  analysisType: zod.string().optional(),
  githubToken: zod.string().optional(),
});

export const ImageGenerateBody = zod.object({
  prompt: zod.string().min(1),
  style: zod.string().optional(),
  quality: zod.string().optional(),
  aspectRatio: zod.string().optional(),
  repoContext: zod.string().optional(),
  count: zod.number().int().min(1).max(4).optional(),
});

export const RepoEventsBody = zod.object({
  repos: zod.array(zod.string()).min(1).max(10),
  githubToken: zod.string().optional(),
  perPage: zod.number().int().optional(),
});

export const HistoryQueryBody = zod.object({
  limit: zod.number().int().optional(),
  offset: zod.number().int().optional(),
});
