import { Router } from "express";
import {
  FetchReposBody,
  CompareReposBody,
  AnalyzeReposBody,
  RepoEventsBody,
  CodeAnalyzeBody,
  HistoryQueryBody,
  ImageGenerateBody,
} from "@workspace/api-zod";
import {
  streamCodex53,
  streamRuntimeAI,
  generateImage,
  editingComplete,
  _geminiPool,
  syncGeminiPool,
} from "../lib/modelRouter.js";
import {
  initDb,
  saveHistory,
  getHistory,
  addGeminiKey,
  listGeminiKeys,
  listSkills,
  getSkillContent,
  getSkillsStats,
  getPool,
  initBuddyKnowledge,
  saveBuddyKnowledge,
  loadBuddyKnowledge,
  searchBuddyKnowledge,
  getBuddyKnowledgeStats,
  clearBuddyKnowledge,
} from "../lib/db.js";
import { githubConnectorFetch, getGitHubConnectorToken } from "../lib/githubConnector.js";

const router = Router();


initDb()
  .then(() => initBuddyKnowledge())
  .then(() => syncGeminiPool())
  .catch((e) => console.warn("[db] init warning:", e?.message));

// ─── Binary file extensions to skip in code analysis ─────────────────────────

const BINARY_EXTENSIONS = new Set([
  ".png",".jpg",".jpeg",".gif",".bmp",".webp",".svg",".ico",".tiff",
  ".mp4",".mp3",".mov",".avi",".wav",".ogg",".flac",
  ".zip",".tar",".gz",".rar",".7z",".bz2",
  ".exe",".dll",".so",".dylib",".bin",".wasm",
  ".pdf",".doc",".docx",".xls",".xlsx",".ppt",".pptx",
  ".ttf",".otf",".woff",".woff2",".eot",
  ".lock",".map",".min.js",".min.css",
]);

type Platform = "github" | "gitlab" | "bitbucket";

function detectPlatform(input: string): Platform {
  const t = input.toLowerCase();
  if (t.includes("gitlab.com")) return "gitlab";
  if (t.includes("bitbucket.org")) return "bitbucket";
  return "github";
}

function normalizeRepoSlug(input: string): { slug: string; platform: Platform } {
  const trimmed = input.trim();
  const glMatch = trimmed.match(/gitlab\.com[/:]([^/]+(?:\/[^/]+)*)\/([^/\s?#]+?)(?:\.git)?(?:[/?#].*)?$/i);
  if (glMatch) return { slug: `${glMatch[1]}/${glMatch[2]}`, platform: "gitlab" };
  const bbMatch = trimmed.match(/bitbucket\.org[/:]([^/]+)\/([^/\s?#]+?)(?:\.git)?(?:[/?#].*)?$/i);
  if (bbMatch) return { slug: `${bbMatch[1]}/${bbMatch[2]}`, platform: "bitbucket" };
  const ghMatch = trimmed.match(/github\.com[/:]([^/]+)\/([^/\s?#]+?)(?:\.git)?(?:[/?#].*)?$/i);
  if (ghMatch) return { slug: `${ghMatch[1]}/${ghMatch[2]}`, platform: "github" };
  const sshMatch = trimmed.match(/git@(?:github\.com|gitlab\.com|bitbucket\.org):([^/]+)\/(.+?)(?:\.git)?$/i);
  if (sshMatch) {
    const platform = detectPlatform(trimmed);
    return { slug: `${sshMatch[1]}/${sshMatch[2]}`, platform };
  }
  return { slug: trimmed.replace(/\.git$/, ""), platform: "github" };
}

function isBinaryFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  for (const ext of BINARY_EXTENSIONS) {
    if (lower.endsWith(ext)) return true;
  }
  return false;
}

interface GitHubApiRepo {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  url: string;
  html_url: string;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  watchers_count: number;
  language: string | null;
  topics: string[];
  license: { name: string } | null;
  default_branch: string;
  created_at: string;
  updated_at: string;
  pushed_at: string;
  size: number;
  homepage: string | null;
  archived: boolean;
  fork: boolean;
  owner: { login: string; avatar_url: string };
}

const repoCache = new Map<string, { data: GitHubApiRepo; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function buildGitHubHeaders(userToken?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "RepoScope-App",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token = userToken ?? process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

async function fetchGitHubRepo(slug: string, userToken?: string): Promise<GitHubApiRepo> {
  const cacheKey = `gh:${slug}:${userToken ? "priv" : "pub"}`;
  const cached = repoCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.data;

  const res = await fetch(`https://api.github.com/repos/${slug}`, { headers: buildGitHubHeaders(userToken) });

  if (!res.ok) {
    if (res.status === 401) throw new Error(`Invalid or expired token for "${slug}"`);
    if (res.status === 404) {
      if (userToken) throw new Error(`Repository "${slug}" not found — verify the repo exists and your token has access`);
      throw new Error(`Repository "${slug}" not found — it may be private (provide githubToken), deleted, or misspelled`);
    }
    if (res.status === 403 || res.status === 429) {
      const resetHeader = res.headers.get("X-RateLimit-Reset");
      const resetAt = resetHeader ? new Date(parseInt(resetHeader) * 1000).toLocaleTimeString() : "soon";
      throw new Error(`Rate limit exceeded for "${slug}" — resets at ${resetAt}`);
    }
    throw new Error(`API error ${res.status} for "${slug}"`);
  }

  const data = await res.json() as GitHubApiRepo;
  repoCache.set(cacheKey, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  return data;
}

// ─── GitLab Support ───────────────────────────────────────────────────────────

interface GitLabApiRepo {
  id: number;
  name: string;
  path_with_namespace: string;
  description: string | null;
  web_url: string;
  star_count: number;
  forks_count: number;
  open_issues_count: number;
  last_activity_at: string;
  created_at: string;
  default_branch: string;
  topics: string[];
  license?: { name: string };
  archived: boolean;
  forked_from_project?: object;
  namespace: { name: string; avatar_url: string | null };
}

async function fetchGitLabRepo(slug: string, userToken?: string): Promise<GitHubApiRepo> {
  const encoded = encodeURIComponent(slug);
  const url = `https://gitlab.com/api/v4/projects/${encoded}?statistics=true`;
  const headers: Record<string, string> = { "User-Agent": "RepoScope-App" };
  const token = userToken ?? process.env.GITLAB_TOKEN;
  if (token) headers["PRIVATE-TOKEN"] = token;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    if (res.status === 404) throw new Error(`GitLab repo "${slug}" not found`);
    if (res.status === 401) throw new Error(`GitLab auth failed for "${slug}"`);
    throw new Error(`GitLab API error ${res.status} for "${slug}"`);
  }

  const d = await res.json() as GitLabApiRepo;
  return {
    id: d.id,
    name: d.name,
    full_name: d.path_with_namespace,
    description: d.description,
    url: `https://gitlab.com/api/v4/projects/${d.id}`,
    html_url: d.web_url,
    stargazers_count: d.star_count,
    forks_count: d.forks_count,
    open_issues_count: d.open_issues_count ?? 0,
    watchers_count: d.star_count,
    language: null,
    topics: d.topics ?? [],
    license: d.license ? { name: d.license.name } : null,
    default_branch: d.default_branch ?? "main",
    created_at: d.created_at,
    updated_at: d.last_activity_at,
    pushed_at: d.last_activity_at,
    size: 0,
    homepage: d.web_url,
    archived: d.archived,
    fork: !!d.forked_from_project,
    owner: { login: d.namespace.name, avatar_url: d.namespace.avatar_url ?? "" },
  };
}

// ─── Bitbucket Support ────────────────────────────────────────────────────────

async function fetchBitbucketRepo(slug: string, userToken?: string): Promise<GitHubApiRepo> {
  const url = `https://api.bitbucket.org/2.0/repositories/${slug}`;
  const headers: Record<string, string> = { "User-Agent": "RepoScope-App" };
  if (userToken) headers["Authorization"] = `Bearer ${userToken}`;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    if (res.status === 404) throw new Error(`Bitbucket repo "${slug}" not found`);
    if (res.status === 401) throw new Error(`Bitbucket auth failed for "${slug}"`);
    throw new Error(`Bitbucket API error ${res.status} for "${slug}"`);
  }

  const d = await res.json() as {
    uuid: string; name: string; full_name: string; description: string;
    links: { html: { href: string } }; created_on: string; updated_on: string;
    mainbranch?: { name: string }; language: string;
    size: number; owner: { display_name: string; links?: { avatar?: { href: string } } };
  };

  return {
    id: parseInt(d.uuid?.replace(/[{}]/g, "").split("-")[0] ?? "0", 16),
    name: d.name,
    full_name: d.full_name,
    description: d.description ?? null,
    url: `https://api.bitbucket.org/2.0/repositories/${d.full_name}`,
    html_url: d.links?.html?.href ?? `https://bitbucket.org/${d.full_name}`,
    stargazers_count: 0,
    forks_count: 0,
    open_issues_count: 0,
    watchers_count: 0,
    language: d.language ?? null,
    topics: [],
    license: null,
    default_branch: d.mainbranch?.name ?? "main",
    created_at: d.created_on,
    updated_at: d.updated_on,
    pushed_at: d.updated_on,
    size: d.size ?? 0,
    homepage: d.links?.html?.href ?? null,
    archived: false,
    fork: false,
    owner: {
      login: d.owner?.display_name ?? slug.split("/")[0],
      avatar_url: d.owner?.links?.avatar?.href ?? "",
    },
  };
}

// ─── Universal Repo Fetcher ───────────────────────────────────────────────────

async function fetchRepo(input: string, userToken?: string): Promise<GitHubApiRepo & { _platform: Platform }> {
  const { slug, platform } = normalizeRepoSlug(input);
  let data: GitHubApiRepo;
  if (platform === "gitlab") {
    data = await fetchGitLabRepo(slug, userToken);
  } else if (platform === "bitbucket") {
    data = await fetchBitbucketRepo(slug, userToken);
  } else {
    data = await fetchGitHubRepo(slug, userToken);
  }
  return { ...data, _platform: platform };
}

function mapRepo(repo: GitHubApiRepo & { _platform?: Platform; private?: boolean }) {
  return {
    id: repo.id,
    name: repo.name,
    fullName: repo.full_name,
    description: repo.description,
    url: repo.url,
    htmlUrl: repo.html_url,
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    openIssues: repo.open_issues_count,
    watchers: repo.watchers_count,
    language: repo.language,
    topics: repo.topics ?? [],
    license: repo.license?.name ?? null,
    defaultBranch: repo.default_branch,
    createdAt: repo.created_at,
    updatedAt: repo.updated_at,
    pushedAt: repo.pushed_at,
    size: repo.size,
    homepage: repo.homepage,
    isArchived: repo.archived,
    platform: repo._platform ?? "github",
    isPrivate: repo.private ?? false,
    isFork: repo.fork,
    ownerAvatarUrl: repo.owner.avatar_url,
    ownerLogin: repo.owner.login,
  };
}

// ─── Routes ───────────────────────────────────────────────────────────────────

router.post("/repos/fetch", async (req, res) => {
  const parsed = FetchReposBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "validation_error", message: parsed.error.message });
    return;
  }

  const { repos: repoInputs, githubToken } = parsed.data;
  const results = await Promise.allSettled(repoInputs.map((r) => fetchRepo(r, githubToken)));

  const repos: ReturnType<typeof mapRepo>[] = [];
  const errors: { slug: string; error: string }[] = [];

  results.forEach((result, i) => {
    if (result.status === "fulfilled") {
      repos.push(mapRepo(result.value));
    } else {
      errors.push({ slug: repoInputs[i], error: (result.reason as Error).message });
    }
  });

  res.json({ repos, errors });
});

router.post("/repos/compare", async (req, res) => {
  const parsed = CompareReposBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "validation_error", message: parsed.error.message });
    return;
  }

  const { repos: repoInputs, githubToken } = parsed.data;
  const results = await Promise.allSettled(repoInputs.map((r) => fetchRepo(r, githubToken)));

  const stats: {
    fullName: string; stars: number; forks: number; openIssues: number;
    watchers: number; size: number; language: string | null; createdAt: string; pushedAt: string;
  }[] = [];

  results.forEach((result) => {
    if (result.status === "fulfilled") {
      const r = result.value;
      stats.push({
        fullName: r.full_name,
        stars: r.stargazers_count,
        forks: r.forks_count,
        openIssues: r.open_issues_count,
        watchers: r.watchers_count,
        size: r.size,
        language: r.language,
        createdAt: r.created_at,
        pushedAt: r.pushed_at,
      });
    }
  });

  if (stats.length === 0) {
    res.status(400).json({ error: "no_repos", message: "No repositories could be fetched" });
    return;
  }

  const mostStarred = stats.reduce((a, b) => (a.stars >= b.stars ? a : b)).fullName;
  const mostForked = stats.reduce((a, b) => (a.forks >= b.forks ? a : b)).fullName;
  const mostActive = stats.reduce((a, b) => new Date(a.pushedAt) >= new Date(b.pushedAt) ? a : b).fullName;
  const totalStars = stats.reduce((sum, s) => sum + s.stars, 0);
  const totalForks = stats.reduce((sum, s) => sum + s.forks, 0);

  res.json({ stats, mostStarred, mostForked, mostActive, totalStars, totalForks });
});

router.get("/repos/trending", (_req, res) => {
  const trending = [
    { slug: "facebook/react", category: "Frontend" },
    { slug: "vuejs/vue", category: "Frontend" },
    { slug: "vercel/next.js", category: "Frontend" },
    { slug: "vitejs/vite", category: "Tooling" },
    { slug: "microsoft/typescript", category: "Language" },
    { slug: "denoland/deno", category: "Runtime" },
    { slug: "nodejs/node", category: "Runtime" },
    { slug: "golang/go", category: "Language" },
    { slug: "rust-lang/rust", category: "Language" },
    { slug: "torvalds/linux", category: "OS" },
    { slug: "kubernetes/kubernetes", category: "DevOps" },
    { slug: "docker/docker-ce", category: "DevOps" },
    { slug: "tensorflow/tensorflow", category: "AI/ML" },
    { slug: "huggingface/transformers", category: "AI/ML" },
    { slug: "langchain-ai/langchain", category: "AI/ML" },
  ];
  res.json({ repos: trending });
});

router.post("/repos/analyze", async (req, res) => {
  const parsed = AnalyzeReposBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "validation_error", message: parsed.error.message });
    return;
  }

  const { repos: repoInputs, question, githubToken, saveHistory: doSave } = parsed.data;

  const repoDataResults = await Promise.all(
    repoInputs.map(async (input) => {
      try { return await fetchRepo(input, githubToken); } catch { return null; }
    })
  );

  const validRepos = repoDataResults.filter((r): r is GitHubApiRepo => r !== null);

  if (validRepos.length === 0) {
    res.status(400).json({ error: "no_data", message: "Could not fetch data for any of the provided repositories" });
    return;
  }

  const repoSummaries = validRepos.map((r) => {
    const daysSincePush = Math.floor((Date.now() - new Date(r.pushed_at).getTime()) / (1000 * 60 * 60 * 24));
    return [
      `Repository: ${r.full_name}`,
      `Description: ${r.description ?? "N/A"}`,
      `Language: ${r.language ?? "N/A"}`,
      `Stars: ${r.stargazers_count.toLocaleString()}`,
      `Forks: ${r.forks_count.toLocaleString()}`,
      `Open Issues: ${r.open_issues_count.toLocaleString()}`,
      `Topics: ${Array.isArray(r.topics) ? r.topics.join(", ") || "N/A" : "N/A"}`,
      `License: ${r.license?.name ?? "None"}`,
      `Last pushed: ${daysSincePush} day(s) ago`,
      `Created: ${new Date(r.created_at).getFullYear()}`,
      `Size: ${Math.round(r.size / 1024)} MB`,
      `Archived: ${r.archived ? "Yes" : "No"}`,
      `Is Fork: ${r.fork ? "Yes" : "No"}`,
    ].join("\n");
  }).join("\n\n---\n\n");

  const userQuestion = question?.trim()
    ? question.trim()
    : "Perform a full multi-dimensional evaluation. Score each repository 1–10 across Code Quality, Security & Safety, Documentation, Functionality, and Repository Hygiene. Identify red flags, implicit execution risks, permission boundaries, and give concrete use-case recommendations. End with an Overall Score and Recommendation for each repo.";

  const prompt = `You are Buddy AI's repository analysis engine. Produce a rigorous, conservative, evidence-based static assessment of repositories based on provided summaries and metadata.

## Inputs
- Repository summaries corpus: ${repoSummaries}
- User query: ${userQuestion}

## Mission
Answer the user's question using only the provided repository data. When analysis or recommendation is requested, evaluate repositories using these five dimensions:
1) Code Quality
2) Security & Safety
3) Documentation
4) Functionality
5) Repository Hygiene

Prioritize correctness, explicit uncertainty, and traceable reasoning over confidence.

## Core Rules
- Do not claim you ran code, installed dependencies, or executed scripts.
- Treat analysis as static/read-only.
- Distinguish observed evidence from inference and from unknown.
- If data is missing, say so plainly.
- Do not infer author intent.
- Prefer conservative security judgments for implicit execution surfaces.`;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  try {
    let fullResult = "";
    const onChunk = (text: string) => {
      fullResult += text;
      res.write(`data: ${JSON.stringify({ content: text })}\n\n`);
    };

    // Runtime AI: Gemini pool → personal OpenRouter fallback
    await streamRuntimeAI(prompt, "You are a world-class code analyst. Be thorough, specific, and structured.", onChunk, 8192);

    if (doSave) {
      saveHistory({
        type: "analyze",
        repos: validRepos.map(r => r.full_name),
        question: userQuestion,
        result: fullResult,
      }).catch(() => {});
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Analysis failed. Please try again.";
    res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
    res.end();
  }
});

// ─── GitHub file helpers ──────────────────────────────────────────────────────

async function fetchGitHubFile(slug: string, filepath: string): Promise<{ content: string; sha: string } | null> {
  try {
    const r = await fetch(`https://api.github.com/repos/${slug}/contents/${filepath}`, {
      headers: buildGitHubHeaders(),
    });
    if (!r.ok) return null;
    const data = await r.json() as { content?: string; encoding?: string; sha?: string };
    if (data.content && data.encoding === "base64") {
      return {
        content: Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf-8"),
        sha: data.sha ?? "",
      };
    }
    return null;
  } catch { return null; }
}

async function pushGitHubFile(repoFullName: string, filepath: string, content: string, message: string, sha?: string): Promise<boolean> {
  const body: Record<string, unknown> = {
    message,
    content: Buffer.from(content).toString("base64"),
  };
  if (sha) body.sha = sha;
  const r = await fetch(`https://api.github.com/repos/${repoFullName}/contents/${filepath}`, {
    method: "PUT",
    headers: { ...buildGitHubHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.ok;
}

async function fetchRepoTree(slug: string, branch: string): Promise<string[]> {
  try {
    const r = await fetch(`https://api.github.com/repos/${slug}/git/trees/${branch}?recursive=0`, {
      headers: buildGitHubHeaders(),
    });
    if (!r.ok) return [];
    const data = await r.json() as { tree?: { path: string; type: string }[] };
    return (data.tree ?? []).map(f => `${f.type === "tree" ? "📁" : "📄"} ${f.path}`).slice(0, 40);
  } catch { return []; }
}

async function fetchRecentCommits(slug: string): Promise<string> {
  try {
    const r = await fetch(`https://api.github.com/repos/${slug}/commits?per_page=5`, {
      headers: buildGitHubHeaders(),
    });
    if (!r.ok) return "";
    const data = await r.json() as { commit: { message: string; author: { name: string; date: string } } }[];
    return data.map(c => `- ${c.commit.message.split("\n")[0]} (${c.commit.author.name})`).join("\n");
  } catch { return ""; }
}

async function fetchContributors(slug: string): Promise<string> {
  try {
    const r = await fetch(`https://api.github.com/repos/${slug}/contributors?per_page=5`, {
      headers: buildGitHubHeaders(),
    });
    if (!r.ok) return "";
    const data = await r.json() as { login: string; contributions: number }[];
    return data.map(c => `${c.login} (${c.contributions} commits)`).join(", ");
  } catch { return ""; }
}

// ─── Deep Archive — 100% file copy from multiple repos ───────────────────────

const BINARY_EXTS = new Set([".png",".jpg",".jpeg",".gif",".svg",".ico",".webp",".bmp",".tiff",".mp4",".mp3",".wav",".zip",".tar",".gz",".rar",".7z",".exe",".dll",".so",".dylib",".bin",".pdf",".woff",".woff2",".ttf",".eot",".otf",".pyc",".pyo",".class",".jar",".lock"]);
const MAX_FILE_SIZE = 400_000; // 400KB per file
const MAX_FILES_PER_REPO = 500; // default; overridden per training run
const FETCH_CONCURRENCY = 8;

async function fetchAllRepoFiles(
  slug: string,
  branch: string,
  send: (d: object) => void,
  archToken?: string,
  maxFiles?: number
): Promise<Array<{ path: string; content: string }>> {
  const limit = maxFiles ?? MAX_FILES_PER_REPO;
  const headers = buildGitHubHeaders(archToken);
  const treeRes = await fetch(
    `https://api.github.com/repos/${slug}/git/trees/${branch}?recursive=1`,
    { headers }
  );
  if (!treeRes.ok) return [];
  const treeData = await treeRes.json() as { tree?: Array<{ path: string; type: string; size?: number; sha: string }> };
  const blobs = (treeData.tree ?? [])
    .filter(f => f.type === "blob" && (f.size ?? 0) < MAX_FILE_SIZE)
    .filter(f => {
      const ext = "." + (f.path.split(".").pop() ?? "");
      return !BINARY_EXTS.has(ext.toLowerCase());
    })
    .slice(0, limit);

  send({ status: "fetching", content: `  ↳ ${slug}: ${blobs.length} text files found\n` });

  const results: Array<{ path: string; content: string }> = [];
  for (let i = 0; i < blobs.length; i += FETCH_CONCURRENCY) {
    const batch = blobs.slice(i, i + FETCH_CONCURRENCY);
    const batchResults = await Promise.all(batch.map(async (blob) => {
      try {
        const blobRes = await fetch(
          `https://api.github.com/repos/${slug}/git/blobs/${blob.sha}`,
          { headers }
        );
        if (!blobRes.ok) return null;
        const blobData = await blobRes.json() as { content?: string; encoding?: string };
        if (!blobData.content || blobData.encoding !== "base64") return null;
        const content = Buffer.from(blobData.content.replace(/\n/g, ""), "base64").toString("utf-8");
        return { path: blob.path, content };
      } catch { return null; }
    }));
    for (const r of batchResults) {
      if (r) results.push(r);
    }
    if (i + FETCH_CONCURRENCY < blobs.length) {
      await new Promise(r => setTimeout(r, 200)); // rate limit pause
    }
  }
  return results;
}

// Push files in chunks using inline-content tree API (no separate blob creation needed)
// Each chunk = one commit; chunking avoids GitHub's payload size limits
const CHUNK_SIZE = 50;

async function pushFilesInChunks(
  repoFullName: string,
  files: Array<{ path: string; content: string }>,
  baseMessage: string,
  branch: string,
  archToken: string,
  log: (msg: string) => void
): Promise<boolean> {
  const headers = { ...buildGitHubHeaders(archToken), "Content-Type": "application/json" };

  // Get current HEAD (empty for brand new repo)
  const refRes = await fetch(
    `https://api.github.com/repos/${repoFullName}/git/refs/heads/${branch}`,
    { headers }
  );
  let parentSha: string | null = null;
  if (refRes.ok) {
    const refData = await refRes.json() as { object?: { sha?: string } };
    parentSha = refData.object?.sha ?? null;
  } else if (refRes.status === 404 || refRes.status === 409) {
    // Repo is empty — bootstrap with an initial placeholder file via Contents API
    log(`  ↳ Repo is empty, creating initial commit via Contents API...`);
    const bootRes = await fetch(
      `https://api.github.com/repos/${repoFullName}/contents/.gitkeep`,
      {
        method: "PUT",
        headers,
        body: JSON.stringify({
          message: "chore: initialize repository",
          content: Buffer.from("").toString("base64"),
        }),
      }
    );
    if (bootRes.ok) {
      const bootData = await bootRes.json() as { commit?: { sha?: string } };
      parentSha = bootData.commit?.sha ?? null;
      log(`  ↳ Initialized repo (commit: ${parentSha?.slice(0, 7) ?? "?"}`);
    }
  }

  const chunks: Array<typeof files> = [];
  for (let i = 0; i < files.length; i += CHUNK_SIZE) {
    chunks.push(files.slice(i, i + CHUNK_SIZE));
  }

  log(`  Splitting ${files.length} files into ${chunks.length} commits of ≤${CHUNK_SIZE} files each`);

  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci];
    log(`  📤 Commit ${ci + 1}/${chunks.length}: ${chunk.length} files...`);

    // Build tree items using inline content (avoids separate blob creation)
    const treeItems = chunk.map(f => ({
      path: f.path,
      mode: "100644",
      type: "blob",
      content: f.content,
    }));

    // Create tree (with base_tree if we have a parent)
    const treeBody: Record<string, unknown> = { tree: treeItems };
    if (parentSha) {
      // Get tree SHA of current commit to use as base
      const parentCommitRes = await fetch(
        `https://api.github.com/repos/${repoFullName}/git/commits/${parentSha}`,
        { headers }
      );
      if (parentCommitRes.ok) {
        const parentCommit = await parentCommitRes.json() as { tree?: { sha?: string } };
        if (parentCommit.tree?.sha) treeBody.base_tree = parentCommit.tree.sha;
      }
    }

    const treeRes = await fetch(
      `https://api.github.com/repos/${repoFullName}/git/trees`,
      { method: "POST", headers, body: JSON.stringify(treeBody) }
    );
    if (!treeRes.ok) {
      const errBody = await treeRes.text();
      log(`  ❌ Tree creation failed for chunk ${ci + 1}: ${treeRes.status} ${errBody.slice(0, 100)}`);
      return false;
    }
    const treeData = await treeRes.json() as { sha: string };

    // Create commit
    const commitBody: Record<string, unknown> = {
      message: chunks.length === 1 ? baseMessage : `${baseMessage} (part ${ci + 1}/${chunks.length})`,
      tree: treeData.sha,
      parents: parentSha ? [parentSha] : [],
    };
    const commitRes = await fetch(
      `https://api.github.com/repos/${repoFullName}/git/commits`,
      { method: "POST", headers, body: JSON.stringify(commitBody) }
    );
    if (!commitRes.ok) {
      const errBody = await commitRes.text();
      log(`  ❌ Commit failed for chunk ${ci + 1}: ${commitRes.status} ${errBody.slice(0, 100)}`);
      return false;
    }
    const commitData = await commitRes.json() as { sha: string };
    parentSha = commitData.sha;

    // Update or create ref
    if (ci === 0 && !refRes.ok) {
      // First commit — create branch ref
      await fetch(`https://api.github.com/repos/${repoFullName}/git/refs`, {
        method: "POST",
        headers,
        body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: parentSha }),
      });
    } else {
      await fetch(`https://api.github.com/repos/${repoFullName}/git/refs/heads/${branch}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ sha: parentSha, force: true }),
      });
    }

    log(`  ✔ Chunk ${ci + 1}/${chunks.length} pushed (commit: ${parentSha!.slice(0, 7)})`);
    if (ci < chunks.length - 1) await new Promise(r => setTimeout(r, 500)); // brief pause between commits
  }

  return true;
}

// ─── In-memory job store for deep archive (avoids SSE proxy timeout) ──────────
interface ArchiveJob {
  id: string;
  status: "running" | "done" | "error";
  logs: string[];
  repoUrl?: string;
  totalFiles?: number;
  error?: string;
  startedAt: number;
}
const archiveJobs = new Map<string, ArchiveJob>();

function _makeJobId() { return Math.random().toString(36).slice(2, 10); }

async function _runArchiveJob(job: ArchiveJob, slugs: string[], rawName: string, token: string) {
  const log = (msg: string) => { job.logs.push(msg); };

  try {
    log(`🗄️ DEEP ARCHIVE: Copying 100% from ${slugs.length} repos...`);

    const repos = (await Promise.all(slugs.map(async s => {
      try { return await fetchGitHubRepo(s); } catch { return null; }
    }))).filter((r): r is GitHubApiRepo => r !== null);

    if (repos.length === 0) {
      job.status = "error"; job.error = "Could not fetch any repo metadata"; return;
    }

    const allFilesByRepo: Array<{ repoSlug: string; files: Array<{ path: string; content: string }> }> = [];
    let totalFiles = 0;

    for (const repo of repos) {
      log(`\n📥 Fetching ALL files: ${repo.full_name}`);
      const noopSend = (_d: object) => {};
      const files = await fetchAllRepoFiles(repo.full_name, repo.default_branch, noopSend, token);
      log(`  ↳ ${repo.full_name}: ${files.length} text files found`);
      const prefix = repo.full_name.replace("/", "__");
      const prefixed = files.map(f => ({ path: `${prefix}/${f.path}`, content: f.content }));
      allFilesByRepo.push({ repoSlug: repo.full_name, files: prefixed });
      totalFiles += files.length;
      log(`  ✔ ${repo.full_name}: ${files.length} files downloaded`);
    }

    log(`\n📦 Total: ${totalFiles} files. Creating GitHub repo "${rawName}"...`);

    const meRes = await fetch("https://api.github.com/user", { headers: buildGitHubHeaders(token) });
    const me = await meRes.json() as { login: string };
    const createRes = await fetch("https://api.github.com/user/repos", {
      method: "POST",
      headers: { ...buildGitHubHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({
        name: rawName,
        description: `Deep archive of ${repos.length} repos via RepoScope + Codex 5.3`,
        private: false,
        auto_init: true, // creates initial commit so git tree API works
      }),
    });

    let newRepoName: string;
    if (!createRes.ok) {
      const err = await createRes.json() as { message?: string; errors?: Array<{ message?: string }> };
      const isAlreadyExists =
        err.message?.toLowerCase().includes("already exist") ||
        err.message?.toLowerCase().includes("name already") ||
        err.errors?.some(e => e.message?.toLowerCase().includes("already exist") || e.message?.toLowerCase().includes("name already")) ||
        createRes.status === 422;
      if (isAlreadyExists) {
        newRepoName = `${me.login}/${rawName}`;
        log(`  ↳ Repo already exists — pushing files into it...`);
      } else {
        job.status = "error"; job.error = `Failed to create repo: ${err.message}`; return;
      }
    } else {
      const created = await createRes.json() as { full_name: string };
      newRepoName = created.full_name;
      log(`  ✔ Created: github.com/${newRepoName}`);
    }

    log(`\n🤖 Codex 5.3: Generating master INDEX.md...`);
    const indexContent = await editingComplete(
      `You are creating a master INDEX.md for a deep archive repository named "${rawName}".
It contains 100% of the code from these ${repos.length} source repositories:
${repos.map(r => `- ${r.full_name}: ${r.description ?? "no description"} (${r.language ?? "various"}, ${r.stargazers_count} stars)`).join("\n")}

File structure:
${allFilesByRepo.map(({ repoSlug, files }) => `### ${repoSlug}/\n${files.slice(0, 10).map(f => `  - ${f.path}`).join("\n")}${files.length > 10 ? `\n  ... and ${files.length - 10} more files` : ""}`).join("\n\n")}

Write a comprehensive INDEX.md that:
1. Explains this is a 100% deep archive (no files missing)
2. Has a table of contents with links to each source repo subdirectory
3. Briefly describes what each source repo contains
4. Lists total file counts
5. Credits each source repo with its original GitHub URL
6. States this was archived using RepoScope + Codex 5.3

Output ONLY raw markdown. No code fences.`
    );

    const allFiles: Array<{ path: string; content: string }> = [
      { path: "INDEX.md", content: indexContent },
      ...allFilesByRepo.flatMap(r => r.files),
    ];

    log(`\n🚀 Pushing ${allFiles.length} files to GitHub via Git Data API...`);

    const pushed = await pushFilesInChunks(
      newRepoName,
      allFiles,
      `feat: deep archive ${totalFiles} files from ${repos.length} repos (RepoScope + Codex 5.3)`,
      "main",
      token,
      log
    );

    if (pushed) {
      job.status = "done";
      job.repoUrl = `https://github.com/${newRepoName}`;
      job.totalFiles = totalFiles;
      log(`\n✅ DONE! ${totalFiles} files pushed to github.com/${newRepoName}`);
    } else {
      job.status = "error"; job.error = "Failed to push files to GitHub";
      log(`\n❌ Check logs above for exact failure details`);
    }
  } catch (err) {
    job.status = "error";
    job.error = err instanceof Error ? err.message : "Deep archive failed";
    log(`\n❌ Error: ${job.error}`);
  }
}

// POST — start a new job, return jobId immediately
router.post("/repos/deep-archive", async (req, res) => {
  const body = req.body as { repos?: unknown; newRepoName?: unknown };
  if (!Array.isArray(body.repos) || body.repos.length === 0) {
    res.status(400).json({ error: "validation_error", message: "repos array required" });
    return;
  }

  const token = process.env.GITHUB_PERSONAL_ACCESS_TOKEN ?? await getGitHubConnectorToken();
  if (!token) {
    res.status(400).json({ error: "no_token", message: "GitHub token required. Connect GitHub account or add PAT in Settings." });
    return;
  }

  const slugs = (body.repos as string[]).map((x: string) => normalizeRepoSlug(x).slug).filter(s => s.includes("/"));
  const rawName = typeof body.newRepoName === "string" && body.newRepoName.trim()
    ? body.newRepoName.trim().replace(/[^a-zA-Z0-9_.-]/g, "-")
    : `reposcope-deep-archive-${Date.now()}`;

  const jobId = _makeJobId();
  const job: ArchiveJob = { id: jobId, status: "running", logs: [], startedAt: Date.now() };
  archiveJobs.set(jobId, job);

  // Run in background — don't await
  _runArchiveJob(job, slugs, rawName, token).catch(() => {});

  res.json({ jobId, message: "Archive started. Poll /api/repos/deep-archive-status/:jobId for progress." });
});

// GET — poll job status
router.get("/repos/deep-archive-status/:jobId", (req, res) => {
  const job = archiveJobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: "job_not_found" });
    return;
  }
  res.json({
    jobId: job.id,
    status: job.status,
    logs: job.logs,
    repoUrl: job.repoUrl,
    totalFiles: job.totalFiles,
    error: job.error,
    elapsedMs: Date.now() - job.startedAt,
  });
});

// ─── Buddy AI Training System ─────────────────────────────────────────────────

interface TrainJob {
  id: string;
  status: "running" | "done" | "error";
  logs: string[];
  totalFiles: number;
  processedFiles: number;
  extractedChunks: number;
  error?: string;
  startedAt: number;
}
const trainJobs = new Map<string, TrainJob>();

async function _runTrainJob(job: TrainJob, repos: string[], token: string, append = false, maxFiles?: number, deleteRepos?: string[]) {
  const log = (msg: string) => { job.logs.push(msg); console.log("[train]", msg); };

  try {
    log(`🧠 BUDDY TRAINING STARTED — ${repos.length} original repos`);
    if (maxFiles) log(`📏 MAX FILES OVERRIDE: ${maxFiles} per repo`);
    log(`📡 Fetching files from each repo individually...`);

    // Delete specific repo chunks if requested (before appending new ones)
    if (deleteRepos && deleteRepos.length > 0) {
      for (const dr of deleteRepos) {
        const repoShort = dr.split("/").pop() ?? dr;
        await db.query(`DELETE FROM buddy_knowledge WHERE source_repo = $1`, [repoShort]);
        log(`🗑️ Cleared existing chunks for repo: ${repoShort}`);
      }
    }

    const noopSend = (_d: object) => {};
    const allFilesWithRepo: Array<{ repoSlug: string; path: string; content: string }> = [];

    for (const repoSlug of repos) {
      log(`\n📥 Fetching: ${repoSlug}${maxFiles ? ` (limit: ${maxFiles} files)` : ""}`);
      try {
        // Auto-detect default branch (main/master/etc.)
        let branch = "main";
        try {
          const metaRes = await fetch(`https://api.github.com/repos/${repoSlug}`, { headers: buildGitHubHeaders(token) });
          if (metaRes.ok) {
            const meta = await metaRes.json() as { default_branch?: string };
            branch = meta.default_branch ?? "main";
          }
        } catch { /* fallback to main */ }
        const files = await fetchAllRepoFiles(repoSlug, branch, noopSend, token, maxFiles);
        const textFiles = files.filter(f => {
          const ext = f.path.split(".").pop()?.toLowerCase() ?? "";
          return ["md","txt","json","yaml","yml","py","js","ts","sh","bash","prompt","system","toml","ini","conf","env","hooks","mjs","cjs"].includes(ext) || !ext;
        });
        log(`  ✅ ${repoSlug}: ${files.length} total → ${textFiles.length} text files`);
        textFiles.forEach(f => allFilesWithRepo.push({ repoSlug, path: f.path, content: f.content }));
      } catch (e) {
        log(`  ⚠️ Failed to fetch ${repoSlug}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    job.totalFiles = allFilesWithRepo.length;
    log(`\n📊 TOTAL: ${allFilesWithRepo.length} text files from ${repos.length} repos`);
    const textFiles = allFilesWithRepo;

    if (!append) {
      await clearBuddyKnowledge();
      log(`🗑️ Cleared previous knowledge base (full retrain mode)`);
    } else {
      log(`➕ APPEND MODE — keeping existing knowledge, adding new chunks`);
    }

    // Process in batches of 8 files per Codex 5.3 call
    const BATCH = 8;
    let totalChunks = 0;

    for (let i = 0; i < textFiles.length; i += BATCH) {
      const batch = textFiles.slice(i, i + BATCH);
      const batchNum = Math.floor(i / BATCH) + 1;
      const totalBatches = Math.ceil(textFiles.length / BATCH);

      log(`\n🔄 Batch ${batchNum}/${totalBatches}: Processing ${batch.length} files with Codex 5.3...`);

      // Build context for Codex 5.3 — include repo name in each file header
      const filesContext = batch.map(f =>
        `REPO: ${f.repoSlug}\nFILE: ${f.path}\nSIZE: ${f.content.length} chars\n---\n${f.content.slice(0, 2000)}`
      ).join("\n\n=====\n\n");

      const extraction_prompt = `You are analyzing files from GitHub knowledge repositories. Extract actionable knowledge chunks.

${filesContext}

OUTPUT FORMAT (JSON array, no markdown):
[
  {
    "source_file": "exact/path/from/above",
    "source_repo": "REPO value from above",
    "category": "one of: prompt|skill|technique|methodology|tool|security|architecture|debugging|code-pattern|ai-workflow|documentation",
    "title": "short descriptive title (max 80 chars)",
    "content": "extracted knowledge: key insight, technique, or reusable content (max 500 chars)",
    "keywords": ["keyword1","keyword2","keyword3"]
  }
]

Rules:
- Only include genuinely useful, actionable knowledge
- Skip empty files or trivial content
- Extract 1-3 chunks per meaningful file
- If a file has no useful content, skip it
- Return ONLY the JSON array, no explanation`;

      try {
        // Use non-streaming editingComplete (Codex 5.3) for batch knowledge extraction
        const codexOutput = await editingComplete(extraction_prompt, 4096);

        // Parse JSON from Codex 5.3 output
        const jsonMatch = codexOutput.match(/\[[\s\S]*\]/);
        if (!jsonMatch) {
          log(`  ⚠️ Batch ${batchNum}: Could not parse JSON, skipping`);
          job.processedFiles += batch.length;
          continue;
        }

        let parsed: Array<{ source_file: string; source_repo?: string; category: string; title: string; content: string; keywords: string[] }> = [];
        try { parsed = JSON.parse(jsonMatch[0]); } catch {
          log(`  ⚠️ Batch ${batchNum}: JSON parse error, skipping`);
          job.processedFiles += batch.length;
          continue;
        }

        // Use source_repo from Codex output, fallback to batch file's repoSlug
        const batchRepoMap = new Map(batch.map(f => [f.path, f.repoSlug]));
        const entries = parsed.map(p => {
          const repoSlug = p.source_repo ?? batchRepoMap.get(p.source_file) ?? "unknown";
          const repoShort = repoSlug.split("/").pop() ?? repoSlug;
          return {
            source_repo: repoShort,
            source_file: p.source_file,
            category: p.category ?? "general",
            title: p.title ?? "Untitled",
            content: p.content ?? "",
            keywords: Array.isArray(p.keywords) ? p.keywords : [],
          };
        }).filter(e => e.content.trim().length > 20);

        const saved = await saveBuddyKnowledge(entries);
        totalChunks += saved;
        job.extractedChunks = totalChunks;
        log(`  ✅ Batch ${batchNum}: extracted ${parsed.length} → saved ${saved} knowledge chunks`);

      } catch (batchErr) {
        log(`  ⚠️ Batch ${batchNum} error: ${batchErr instanceof Error ? batchErr.message : String(batchErr)}`);
      }

      job.processedFiles = Math.min(i + BATCH, textFiles.length);
    }

    job.status = "done";
    job.extractedChunks = totalChunks;
    log(`\n🎉 TRAINING COMPLETE!`);
    log(`📊 Processed: ${job.processedFiles}/${job.totalFiles} text files from ${repos.length} repos`);
    log(`🧠 Knowledge chunks saved to PostgreSQL: ${totalChunks}`);
    log(`📁 Repos trained: ${repos.map(r => r.split("/").pop()).join(", ")}`);
    log(`⏱️ Total time: ${Math.round((Date.now() - job.startedAt) / 1000)}s`);
    log(`✅ Buddy AI is now trained with all ${repos.length}-repo knowledge base!`);

  } catch (err) {
    job.status = "error";
    job.error = err instanceof Error ? err.message : String(err);
    log(`❌ Training failed: ${job.error}`);
  }
}

// Default 7 source repos (trained individually — each < 500 files, no truncation)
const DEFAULT_TRAIN_REPOS = [
  "adminsairolotech-bit/awesome-claude-code",
  "adminsairolotech-bit/ui-ux-pro-max-skill",
  "adminsairolotech-bit/everything-claude-code",
  "adminsairolotech-bit/cloude-ai-agiant-superpowers",
  "adminsairolotech-bit/multi-ai-system_prompts_leaks",
  "adminsairolotech-bit/second-brain-skills",
  "adminsairolotech-bit/HowToHunt",
  "adminsairolotech-bit/sai-rolotech-smart-engines",
  "adminsairolotech-bit/super-pro",
  "adminsairolotech-bit/kagglehub",
  "adminsairolotech-bit/openclaw.ai-NEW-",
  "adminsairolotech-bit/oh-my-codex",
  "adminsairolotech-bit/cirrus",
  "adminsairolotech-bit/HowickMaker-for-Dynamo",
  "adminsairolotech-bit/computer-agent",
];

// POST /repos/train-buddy — start training job
router.post("/repos/train-buddy", async (req, res) => {
  const { repos, append, maxFiles, deleteRepos } = req.body as {
    repos?: string[];
    append?: boolean;
    maxFiles?: number;       // override per-repo file limit (e.g. 3000 for big repos)
    deleteRepos?: string[];  // clear chunks for these repos before training
  };
  const repoList = (Array.isArray(repos) && repos.length > 0) ? repos : DEFAULT_TRAIN_REPOS;
  const appendMode = append === true;

  const token = process.env.GITHUB_PERSONAL_ACCESS_TOKEN
    ?? (await getGitHubConnectorToken().catch(() => null))
    ?? "";

  const jobId = _makeJobId();
  const job: TrainJob = {
    id: jobId,
    status: "running",
    logs: [],
    totalFiles: 0,
    processedFiles: 0,
    extractedChunks: 0,
    startedAt: Date.now(),
  };
  trainJobs.set(jobId, job);
  _runTrainJob(job, repoList, token, appendMode, maxFiles, deleteRepos).catch(() => {});

  res.json({
    jobId,
    repos: repoList,
    append: appendMode,
    maxFiles: maxFiles ?? MAX_FILES_PER_REPO,
    message: `Training started on ${repoList.length} repos (${appendMode ? "append" : "full retrain"} mode, ${maxFiles ?? MAX_FILES_PER_REPO} files/repo max). Poll /api/repos/train-buddy-status/:jobId for progress.`
  });
});

// GET /repos/train-buddy-status/:jobId
router.get("/repos/train-buddy-status/:jobId", (req, res) => {
  const job = trainJobs.get(req.params.jobId);
  if (!job) { res.status(404).json({ error: "job_not_found" }); return; }
  res.json({
    jobId: job.id,
    status: job.status,
    logs: job.logs,
    totalFiles: job.totalFiles,
    processedFiles: job.processedFiles,
    extractedChunks: job.extractedChunks,
    error: job.error,
    elapsedMs: Date.now() - job.startedAt,
    progress: job.totalFiles > 0 ? Math.round((job.processedFiles / job.totalFiles) * 100) : 0,
  });
});

// GET /repos/train-buddy-stats — knowledge DB stats
router.get("/repos/train-buddy-stats", async (_req, res) => {
  try {
    const stats = await getBuddyKnowledgeStats();
    res.json(stats);
  } catch (e) {
    res.status(500).json({ error: "stats_error", message: e instanceof Error ? e.message : String(e) });
  }
});

// DELETE /repos/train-buddy — clear knowledge base
router.delete("/repos/train-buddy", async (_req, res) => {
  try {
    await clearBuddyKnowledge();
    res.json({ cleared: true });
  } catch (e) {
    res.status(500).json({ error: "clear_error" });
  }
});

// ─── Synthesize ───────────────────────────────────────────────────────────────

router.post("/repos/synthesize", async (req, res) => {
  const body = req.body as { repos?: unknown; newRepoName?: unknown };
  if (!Array.isArray(body.repos) || body.repos.length === 0) {
    res.status(400).json({ error: "validation_error", message: "repos array is required" });
    return;
  }

  const slugs = (body.repos as string[]).map((x: string) => normalizeRepoSlug(x).slug).filter((s: string) => s.includes("/"));
  const rawName = typeof body.newRepoName === "string" && body.newRepoName.trim()
    ? body.newRepoName.trim().replace(/[^a-zA-Z0-9_.-]/g, "-")
    : `reposcope-synthesis-${Date.now()}`;

  const token = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
  if (!token) {
    res.status(400).json({ error: "no_token", message: "GitHub access token is required. Please configure your GitHub credentials." });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    send({ status: "fetching", content: `🔍 PHASE 1: Deep fetching ${slugs.length} repositories...\n` });

    const repoDataResults = await Promise.all(slugs.map(async (slug) => {
      try { return await fetchGitHubRepo(slug); } catch { return null; }
    }));
    const validRepos = repoDataResults.filter((r): r is GitHubApiRepo => r !== null);
    if (validRepos.length === 0) {
      send({ status: "error", error: "Could not fetch any repository data" });
      res.end();
      return;
    }

    const SOURCE_FILES = ["README.md", "package.json", "requirements.txt", "Cargo.toml", "go.mod", "pyproject.toml", "CONTRIBUTING.md", "LICENSE", ".github/CODEOWNERS", "tsconfig.json", "setup.py"];
    const repoDeepData = await Promise.all(validRepos.map(async (repo) => {
      send({ status: "fetching", content: `  ↳ Fetching ${repo.full_name}...\n` });
      const [filesArr, tree, commits, contributors] = await Promise.all([
        Promise.all(SOURCE_FILES.map(f => fetchGitHubFile(repo.full_name, f).then(r => ({ file: f, result: r })))),
        fetchRepoTree(repo.full_name, repo.default_branch),
        fetchRecentCommits(repo.full_name),
        fetchContributors(repo.full_name),
      ]);
      const files: Record<string, string> = {};
      for (const { file, result } of filesArr) {
        if (result) files[file] = result.content;
      }
      return { repo, files, tree, commits, contributors };
    }));

    send({ status: "fetching", content: `✅ All ${validRepos.length} repos fetched deeply.\n\n` });
    send({ status: "analyzing", content: `🧠 PHASE 2: Buddy AI deep analysis starting...\n\n` });

    const repoSummaries = repoDeepData.map(({ repo, files, tree, commits, contributors }) => {
      let s = `### ${repo.full_name}\n`;
      s += `Stars: ${repo.stargazers_count} | Forks: ${repo.forks_count} | Language: ${repo.language ?? "N/A"}\n`;
      s += `Description: ${repo.description ?? "N/A"}\n`;
      s += `License: ${repo.license?.name ?? "None"} | Topics: ${repo.topics?.join(", ") || "N/A"}\n`;
      s += `Open Issues: ${repo.open_issues_count} | Created: ${repo.created_at?.slice(0,10)} | Last push: ${repo.pushed_at?.slice(0,10)}\n`;
      if (contributors) s += `Top Contributors: ${contributors}\n`;
      if (tree.length) s += `\nDirectory Structure:\n${tree.join("\n")}\n`;
      if (commits) s += `\nRecent Commits:\n${commits}\n`;
      if (files["README.md"]) s += `\nREADME.md (full):\n${files["README.md"].slice(0, 3000)}\n`;
      if (files["package.json"]) s += `\npackage.json:\n${files["package.json"].slice(0, 1000)}\n`;
      if (files["requirements.txt"]) s += `\nrequirements.txt:\n${files["requirements.txt"].slice(0, 600)}\n`;
      if (files["Cargo.toml"]) s += `\nCargo.toml:\n${files["Cargo.toml"].slice(0, 600)}\n`;
      if (files["go.mod"]) s += `\ngo.mod:\n${files["go.mod"].slice(0, 400)}\n`;
      if (files["CONTRIBUTING.md"]) s += `\nCONTRIBUTING.md:\n${files["CONTRIBUTING.md"].slice(0, 600)}\n`;
      if (files["LICENSE"]) s += `\nLICENSE type: ${files["LICENSE"].slice(0, 150)}\n`;
      return s;
    }).join("\n\n═══════════════════════════════════════\n\n");

    const analysisPrompt = `You are a world-class software architect performing a DEEP analysis of ${validRepos.length} GitHub repositories to synthesize them into one best-of-breed repository named "${rawName}".

Here is the complete deep data for each repository:

${repoSummaries}

Perform a thorough analysis covering:

## 1. Per-Repo Strengths & Weaknesses
For EACH repository, analyze:
- What it does exceptionally well (architecture, docs, testing, DX, performance)
- What it lacks or could be improved
- Unique features worth preserving
- Code quality signals from commit history and structure

## 2. Cross-Repo Comparison
- Compare architectures, technology stacks, dependency choices
- Which repo has the best documentation style?
- Which has the most maintainable structure?
- Which has the most active community?

## 3. Synthesis Blueprint for "${rawName}"
- Which features to take from EACH repo and why
- Ideal tech stack (combining the best choices)
- Recommended directory structure
- Key dependencies to include

## 4. Implementation Roadmap
- Phase 1 (MVP), Phase 2 (features), Phase 3 (polish)
- Estimated effort for each phase

Be extremely specific, reference actual files/features you saw. Think deeply.`;

    let analysisText = "";
    // Editing: use Codex 5.3 for deep synthesis analysis
    await streamCodex53(analysisPrompt, "You are a world-class software architect. Be extremely specific and thorough.", (chunk) => {
      analysisText += chunk;
      send({ status: "analyzing", content: chunk });
    }, 12000);

    send({ status: "creating", content: `\n\n═══════════════════════════════════════\n\n🚀 PHASE 3: Generating synthesized files with Buddy AI...\n` });

    const langCounts: Record<string, number> = {};
    for (const { repo } of repoDeepData) {
      if (repo.language) langCounts[repo.language] = (langCounts[repo.language] ?? 0) + 1;
    }
    const primaryLang = Object.entries(langCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "TypeScript";
    const isJS = ["JavaScript", "TypeScript"].includes(primaryLang);
    const isPython = primaryLang === "Python";

    send({ status: "creating", content: `  ↳ Writing README.md...\n` });
    const readmeContent = await editingComplete(
      `Based on this deep analysis of ${validRepos.length} repositories:\n\n${analysisText.slice(0, 4000)}\n\nSource repos: ${validRepos.map(r => r.full_name).join(", ")}\n\nWrite a COMPREHENSIVE, professional README.md for the new synthesized repository "${rawName}".\n\nInclude:\n- Project title with badges (npm version placeholder, license, stars)\n- Elevator pitch (2-3 sentences)\n- Features section (bullet list of best features synthesized from all repos)\n- Why ${rawName}? (what makes it better than each source repo)\n- Installation & Quick Start\n- Detailed Usage with code examples\n- Configuration options\n- Contributing guide reference\n- License\n- Acknowledgments (crediting source repos)\n\nOutput ONLY raw markdown. No code fences. Be thorough and specific.`
    );

    send({ status: "creating", content: `  ↳ Writing CONTRIBUTING.md...\n` });
    const contribContent = await editingComplete(
      `Write a concise CONTRIBUTING.md for "${rawName}" (a ${primaryLang} project synthesized from: ${validRepos.map(r => r.full_name).join(", ")}).\nInclude: how to fork, clone, set up dev environment, run tests, submit PRs, code style guidelines.\nOutput ONLY raw markdown. No code fences.`
    );

    let depFilename = "";
    let depContent = "";
    if (isJS) {
      send({ status: "creating", content: `  ↳ Writing package.json...\n` });
      depFilename = "package.json";
      const allPkgJsons = repoDeepData
        .filter(d => d.files["package.json"])
        .map(d => `# ${d.repo.full_name}\n${d.files["package.json"].slice(0, 800)}`)
        .join("\n---\n");
      depContent = (await editingComplete(
        `Create a synthesized package.json for "${rawName}" combining the best dependencies from these repos:\n${allPkgJsons}\n\nOutput ONLY valid JSON. No markdown, no fences, no explanation.`
      )).replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    } else if (isPython) {
      send({ status: "creating", content: `  ↳ Writing requirements.txt...\n` });
      depFilename = "requirements.txt";
      const allReqs = repoDeepData
        .filter(d => d.files["requirements.txt"])
        .map(d => `# ${d.repo.full_name}\n${d.files["requirements.txt"].slice(0, 500)}`)
        .join("\n---\n");
      depContent = await editingComplete(
        `Combine these requirements.txt files into one best-of-breed requirements.txt for "${rawName}":\n${allReqs}\nOutput ONLY the requirements.txt content. No markdown.`
      );
    }

    send({ status: "creating", content: `  ↳ Creating GitHub repository "${rawName}"...\n` });
    const meRes = await fetch("https://api.github.com/user", { headers: buildGitHubHeaders() });
    const me = await meRes.json() as { login: string };
    const ownerLogin = me.login;

    const createRes = await fetch("https://api.github.com/user/repos", {
      method: "POST",
      headers: { ...buildGitHubHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        name: rawName,
        description: `Synthesized by RepoScope (Buddy AI) from: ${validRepos.map(r => r.full_name).join(", ")}`,
        private: false,
        auto_init: false,
      }),
    });

    let newRepo: { full_name: string; html_url: string };
    if (!createRes.ok) {
      const err = await createRes.json() as { message?: string; errors?: Array<{ message?: string }> };
      const isAlreadyExists =
        err.message?.toLowerCase().includes("already exist") ||
        err.errors?.some(e => e.message?.toLowerCase().includes("already exist"));

      if (isAlreadyExists) {
        send({ status: "creating", content: `  ↳ Repo "${rawName}" already exists — pushing files into it...\n` });
        newRepo = {
          full_name: `${ownerLogin}/${rawName}`,
          html_url: `https://github.com/${ownerLogin}/${rawName}`,
        };
      } else {
        send({ status: "error", error: `Failed to create repo: ${err.message ?? createRes.status}` });
        res.end();
        return;
      }
    } else {
      newRepo = await createRes.json() as { full_name: string; html_url: string };
    }

    send({ status: "creating", content: `  ↳ Writing LICENSE...\n` });
    const sourceLicenses = repoDeepData
      .filter(d => d.files["LICENSE"])
      .map(d => `# ${d.repo.full_name} (${d.repo.license?.name ?? "unknown"})\n${d.files["LICENSE"].slice(0, 500)}`)
      .join("\n---\n");
    const licenseContent = await editingComplete(
      `Pick the most appropriate open-source license for "${rawName}" based on these source repo licenses:\n${sourceLicenses || "No license files found. Use MIT."}\n\nOutput ONLY the full license text (update year to ${new Date().getFullYear()} and author to "RepoScope Contributors"). No explanation, no code fences.`
    );

    send({ status: "creating", content: `  ↳ Writing CODE_OF_CONDUCT.md...\n` });
    const cocContent = await editingComplete(
      `Write a professional CODE_OF_CONDUCT.md for the open-source project "${rawName}" synthesized from: ${validRepos.map(r => r.full_name).join(", ")}. Use the Contributor Covenant 2.1 standard. Output ONLY raw markdown, no code fences.`
    );

    const ext = isJS ? "ts" : isPython ? "py" : primaryLang === "Go" ? "go" : primaryLang === "Rust" ? "rs" : primaryLang === "Ruby" ? "rb" : "ts";
    const appFilePath = `src/app.${ext}`;
    const apiFilePath = `src/api/routes.${ext}`;

    const sourceCodeContext = repoDeepData
      .filter(d => d.files["package.json"] || d.files["requirements.txt"] || d.files["go.mod"])
      .map(d => `# ${d.repo.full_name} (${d.repo.language ?? "unknown"})\nDirectory: ${d.tree.slice(0, 15).join(", ")}`)
      .join("\n---\n");

    send({ status: "creating", content: `  ↳ Generating ${appFilePath} (main app)...\n` });
    let appContent = (await editingComplete(
      `You are a senior ${primaryLang} engineer. Based on this deep analysis of ${validRepos.length} repos:\n\n${analysisText.slice(0, 3000)}\n\nSource repos context:\n${sourceCodeContext}\n\nWrite a complete, working main application entry file (${appFilePath}) for "${rawName}".\n\nRequirements:\n- Combine the BEST architectural patterns from ALL source repos\n- Include proper imports, initialization, configuration loading\n- Add clear comments explaining what was synthesized from each repo\n- Make it actually runnable (no placeholder TODOs — write real code)\n- Language: ${primaryLang}\n\nOutput ONLY the raw source code. No markdown, no code fences, no explanation.`
    )).replace(/^```[a-z]*\n?/gm, "").replace(/^```\n?/gm, "").trim();

    send({ status: "creating", content: `  ↳ Generating ${apiFilePath} (API routes)...\n` });
    let apiRouteContent = (await editingComplete(
      `You are a senior ${primaryLang} API engineer. Write a complete, working API routes file (${apiFilePath}) for "${rawName}".\n\nBased on analysis of ${validRepos.length} repos:\n${analysisText.slice(0, 2000)}\n\nDesign the BEST RESTful API routes synthesized from all source repos. Include CRUD endpoints relevant to the project's domain, proper request validation, error handling, and response formatting.\n- Language: ${primaryLang}${isJS ? " (use Express.js Router pattern)" : isPython ? " (use FastAPI or Flask blueprint pattern)" : ""}\n\nOutput ONLY the raw source code. No markdown, no code fences, no explanation.`
    )).replace(/^```[a-z]*\n?/gm, "").replace(/^```\n?/gm, "").trim();

    send({ status: "creating", content: `  ↳ Pushing files to ${newRepo.full_name}...\n` });
    await pushGitHubFile(newRepo.full_name, "README.md", readmeContent, "feat: add synthesized README (RepoScope + Buddy AI)");
    send({ status: "creating", content: `    ✔ README.md\n` });
    await pushGitHubFile(newRepo.full_name, "CONTRIBUTING.md", contribContent, "docs: add CONTRIBUTING guide");
    send({ status: "creating", content: `    ✔ CONTRIBUTING.md\n` });
    if (depFilename && depContent) {
      await pushGitHubFile(newRepo.full_name, depFilename, depContent, `chore: add synthesized ${depFilename}`);
      send({ status: "creating", content: `    ✔ ${depFilename}\n` });
    }
    await pushGitHubFile(newRepo.full_name, "DEEP_ANALYSIS.md", `# Deep Analysis Report\n\n> Generated by RepoScope using Buddy AI\n\n## Source Repositories\n${validRepos.map(r => `- [${r.full_name}](${r.html_url})`).join("\n")}\n\n---\n\n${analysisText}`, "docs: add deep analysis report");
    send({ status: "creating", content: `    ✔ DEEP_ANALYSIS.md\n` });
    if (licenseContent) {
      await pushGitHubFile(newRepo.full_name, "LICENSE", licenseContent, "chore: add synthesized LICENSE");
      send({ status: "creating", content: `    ✔ LICENSE\n` });
    }
    if (cocContent) {
      await pushGitHubFile(newRepo.full_name, "CODE_OF_CONDUCT.md", cocContent, "docs: add CODE_OF_CONDUCT");
      send({ status: "creating", content: `    ✔ CODE_OF_CONDUCT.md\n` });
    }
    if (appContent) {
      await pushGitHubFile(newRepo.full_name, appFilePath, appContent, `feat: add main app entry`);
      send({ status: "creating", content: `    ✔ ${appFilePath}\n` });
    }
    if (apiRouteContent) {
      await pushGitHubFile(newRepo.full_name, apiFilePath, apiRouteContent, `feat: add API routes`);
      send({ status: "creating", content: `    ✔ ${apiFilePath}\n` });
    }

    send({ status: "done", content: `\n\n🎉 Repository **${newRepo.full_name}** created and fully populated!`, repoUrl: newRepo.html_url, repoName: newRepo.full_name });
  } catch (err) {
    send({ status: "error", error: (err instanceof Error ? err.message : "Synthesis failed") });
  }

  res.end();
});

// ─── Auto-update ──────────────────────────────────────────────────────────────

router.post("/repos/auto-update", async (req, res) => {
  const body = req.body as { repos?: unknown; analysisContext?: unknown };
  if (!Array.isArray(body.repos) || body.repos.length === 0) {
    res.status(400).json({ error: "validation_error", message: "repos array is required" });
    return;
  }

  const token = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
  if (!token) {
    res.status(400).json({ error: "no_token", message: "GITHUB_PERSONAL_ACCESS_TOKEN is required to push updates" });
    return;
  }

  const slugs = (body.repos as string[]).map((x: string) => normalizeRepoSlug(x).slug).filter((s: string) => s.includes("/"));
  const analysisContext = typeof body.analysisContext === "string" ? body.analysisContext.slice(0, 3000) : "";

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  const results: { slug: string; status: "updated" | "skipped" | "error"; url?: string; error?: string }[] = [];

  for (const slug of slugs) {
    send({ type: "progress", slug, status: "starting", message: `Processing ${slug}...` });

    try {
      const repoData = await fetchGitHubRepo(slug);
      let currentReadme = "";
      const readmeRes = await fetch(`https://api.github.com/repos/${slug}/contents/README.md`, {
        headers: buildGitHubHeaders(),
      });
      let existingSha: string | undefined;
      if (readmeRes.ok) {
        const readmeData = await readmeRes.json() as { content?: string; encoding?: string; sha?: string };
        existingSha = readmeData.sha;
        if (readmeData.content && readmeData.encoding === "base64") {
          currentReadme = Buffer.from(readmeData.content.replace(/\n/g, ""), "base64").toString("utf-8");
        }
      }

      send({ type: "progress", slug, status: "analyzing", message: `Buddy AI is improving README for ${slug}...` });

      const prompt = `You are Buddy AI's README enhancement engine. Generate a production-ready README update for a repository.

## Inputs
- Repository full name: ${repoData.full_name}
- Description: ${repoData.description ?? "N/A"}
- Primary language: ${repoData.language ?? "N/A"}
- Stars: ${repoData.stargazers_count}
- Forks: ${repoData.forks_count ?? 0}
- Topics: ${repoData.topics?.join(", ") || "N/A"}
- License: ${repoData.license?.name ?? "None"}
- Open issues: ${repoData.open_issues_count ?? 0}
- Current README: ${currentReadme ? currentReadme.slice(0, 2500) : "None — write from scratch."}
- Additional context: ${analysisContext ?? "None provided."}

## Mission
Produce an improved README that is clear, accurate, maintainable, and transparent. Keep claims grounded in available information.

## Mandatory Sections
1) Title & One-line Value Proposition
2) Overview
3) Features
4) Installation / Setup
5) Quick Start
6) Usage
7) Configuration
8) Security & Safety Notes
9) Architecture or Project Structure
10) Development
11) Roadmap or Limitations
12) Contributing
13) License
14) Support / Issues

## Output Constraints
- Output ONLY final Markdown README content.
- No commentary, no analysis preface, no code fences around the whole README.`;

      const newReadme = await editingComplete(prompt, 8192);

      send({ type: "progress", slug, status: "pushing", message: `Pushing updated README to ${slug}...` });
      const pushBody: Record<string, unknown> = {
        message: "docs: AI-improved README via RepoScope",
        content: Buffer.from(newReadme).toString("base64"),
      };
      if (existingSha) pushBody.sha = existingSha;

      const pushRes = await fetch(`https://api.github.com/repos/${slug}/contents/README.md`, {
        method: "PUT",
        headers: { ...buildGitHubHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(pushBody),
      });

      if (pushRes.ok) {
        const repoUrl = `https://github.com/${slug}`;
        results.push({ slug, status: "updated", url: repoUrl });
        send({ type: "repo_done", slug, status: "updated", url: repoUrl, message: `✅ README updated for ${slug}` });
      } else {
        const errData = await pushRes.json() as { message?: string };
        const errMsg = errData.message ?? `HTTP ${pushRes.status}`;
        results.push({ slug, status: "error", error: errMsg });
        send({ type: "repo_done", slug, status: "error", error: errMsg, message: `❌ Failed to update ${slug}: ${errMsg}` });
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Unknown error";
      results.push({ slug, status: "error", error: errMsg });
      send({ type: "repo_done", slug, status: "error", error: errMsg, message: `❌ Error for ${slug}: ${errMsg}` });
    }
  }

  const updatedCount = results.filter(r => r.status === "updated").length;
  send({ type: "all_done", results, summary: `${updatedCount}/${slugs.length} repositories updated successfully` });
  res.end();
});

// ─── Events ───────────────────────────────────────────────────────────────────

router.post("/repos/events", async (req, res) => {
  const parsed = RepoEventsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "validation_error", message: parsed.error.message });
    return;
  }

  const { repo, eventTypes, perPage, githubToken } = parsed.data;
  const { slug } = normalizeRepoSlug(repo);

  try {
    const headers = buildGitHubHeaders(githubToken);
    const url = `https://api.github.com/repos/${slug}/events?per_page=${perPage ?? 30}`;
    const ghRes = await fetch(url, { headers });

    if (!ghRes.ok) {
      if (ghRes.status === 404) {
        res.status(404).json({ error: "not_found", message: `Repository "${slug}" not found` });
        return;
      }
      if (ghRes.status === 403 || ghRes.status === 401) {
        res.status(403).json({ error: "forbidden", message: "Access denied — provide a valid githubToken for private repos" });
        return;
      }
      res.status(502).json({ error: "upstream_error", message: `Events API returned ${ghRes.status}` });
      return;
    }

    const events = await ghRes.json() as {
      id: string; type: string; public: boolean; created_at: string;
      actor: { login: string; avatar_url: string };
      payload: { action?: string; commits?: { message: string }[]; ref?: string };
    }[];

    const filtered = eventTypes && eventTypes.length > 0
      ? events.filter((e) => eventTypes.includes(e.type))
      : events;

    const mapped = filtered.map((e) => ({
      id: e.id,
      type: e.type,
      actor: e.actor.login,
      actorAvatar: e.actor.avatar_url,
      createdAt: e.created_at,
      isPublic: e.public,
      summary: (() => {
        switch (e.type) {
          case "PushEvent": return `Pushed ${e.payload.commits?.length ?? 0} commit(s) to ${e.payload.ref?.replace("refs/heads/", "") ?? "branch"}`;
          case "IssuesEvent": return `${e.payload.action ?? "updated"} an issue`;
          case "PullRequestEvent": return `${e.payload.action ?? "updated"} a pull request`;
          case "CreateEvent": return `Created ${e.payload.ref ?? "ref"}`;
          case "DeleteEvent": return `Deleted ${e.payload.ref ?? "ref"}`;
          case "ForkEvent": return `Forked the repository`;
          case "WatchEvent": return `Starred the repository`;
          case "ReleaseEvent": return `${e.payload.action ?? "released"} a new version`;
          case "IssueCommentEvent": return `Commented on an issue`;
          case "PullRequestReviewEvent": return `Reviewed a pull request`;
          default: return `${e.type.replace("Event", "")} event`;
        }
      })(),
    }));

    res.json({
      repo: slug,
      total: mapped.length,
      eventTypes: [...new Set(mapped.map((e) => e.type))],
      events: mapped,
    });
  } catch {
    res.status(500).json({ error: "server_error", message: "Failed to fetch events" });
  }
});

// ─── Code Analyze ─────────────────────────────────────────────────────────────

router.post("/repos/code-analyze", async (req, res) => {
  const parsed = CodeAnalyzeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "validation_error", message: parsed.error.message });
    return;
  }

  const { repos: repoInputs, analysisType, githubToken } = parsed.data;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    send({ status: "fetching", message: `🔍 Fetching ${repoInputs.length} repo(s) for code analysis...` });

    const repoResults = await Promise.allSettled(repoInputs.map((r) => fetchRepo(r, githubToken)));
    const validRepos = repoResults
      .filter((r): r is PromiseFulfilledResult<GitHubApiRepo> => r.status === "fulfilled")
      .map((r) => r.value);

    if (validRepos.length === 0) {
      send({ status: "error", error: "Could not fetch any repository data" });
      res.end();
      return;
    }

    const repoTrees: { repo: GitHubApiRepo; tree: { path: string; type: string; size?: number }[]; binaryCount: number }[] = [];

    for (const repo of validRepos) {
      send({ status: "analyzing", message: `🌳 Scanning file tree: ${repo.full_name}` });
      try {
        const headers = buildGitHubHeaders(githubToken);
        const branch = repo.default_branch || "main";
        const treeUrl = `https://api.github.com/repos/${repo.full_name}/git/trees/${branch}?recursive=1`;
        const treeRes = await fetch(treeUrl, { headers });

        if (treeRes.ok) {
          const treeData = await treeRes.json() as { tree: { path: string; type: string; size?: number }[] };
          const allFiles = treeData.tree.filter((f) => f.type === "blob");
          const binaryFiles = allFiles.filter((f) => isBinaryFile(f.path));
          const codeFiles = allFiles.filter((f) => !isBinaryFile(f.path));
          repoTrees.push({ repo, tree: codeFiles, binaryCount: binaryFiles.length });
          send({ status: "tree_done", repo: repo.full_name, files: codeFiles.length, binarySkipped: binaryFiles.length });
        } else {
          repoTrees.push({ repo, tree: [], binaryCount: 0 });
        }
      } catch {
        repoTrees.push({ repo, tree: [], binaryCount: 0 });
      }
    }

    send({ status: "thinking", message: "🤖 Buddy AI performing deep code analysis..." });

    const analysisPayload = repoTrees.map(({ repo, tree, binaryCount }) => {
      const byExt: Record<string, number> = {};
      tree.forEach((f) => {
        const ext = f.path.split(".").pop() ?? "other";
        byExt[ext] = (byExt[ext] ?? 0) + 1;
      });
      const topLangs = Object.entries(byExt).sort((a, b) => b[1] - a[1]).slice(0, 8);

      return `REPO: ${repo.full_name} [${repo.language ?? "Unknown"}]
Stars: ${repo.stargazers_count} | Forks: ${repo.forks_count}
Total code files: ${tree.length} | Binary files skipped: ${binaryCount}
Top file extensions: ${topLangs.map(([e, c]) => `${e}(${c})`).join(", ")}
Key paths: ${tree.slice(0, 20).map((f) => f.path).join(", ")}`;
    }).join("\n\n---\n\n");

    const typePrompt = analysisType === "structure"
      ? "Focus on: directory organization, modularity, separation of concerns, monorepo patterns."
      : analysisType === "complexity"
        ? "Focus on: cognitive complexity, deep nesting, large files, cyclomatic complexity risks."
        : analysisType === "dependencies"
          ? "Focus on: dependency patterns, coupling, circular dependency risks, external dependency count."
          : analysisType === "security"
            ? "Focus on: potential security issues in file structure — exposed secrets risk, dangerous file patterns, missing security files."
            : "Provide a complete analysis covering: structure, complexity, dependencies, security posture, and maintainability.";

    const sysPrompt = "You are Buddy AI, an expert code analyst. Be precise, actionable, and structured.";
    const userPrompt = `You are Buddy AI performing static code analysis on GitHub repositories. ${typePrompt}

${analysisPayload}

For each repo provide:
1. Architecture Score (1-10) with reasoning
2. Code organization assessment
3. Detected patterns (MVC, microservices, monolith, etc.)
4. Binary files skipped: note count and types
5. Specific actionable recommendations
6. Overall health grade (A/B/C/D/F)

Be specific, reference actual file paths when possible.`;

    // Runtime AI: Gemini pool → personal OpenRouter fallback
    const result = await streamRuntimeAI(
      userPrompt, sysPrompt,
      (text: string) => send({ content: text }),
      8192
    );
    const modelUsed = result.model;

    send({ done: true, reposAnalyzed: validRepos.length, totalBinarySkipped: repoTrees.reduce((sum, r) => sum + r.binaryCount, 0), engineUsed: modelUsed });
    res.end();
  } catch {
    send({ status: "error", error: "Code analysis failed" });
    res.end();
  }
});

// ─── History ──────────────────────────────────────────────────────────────────

router.post("/repos/history", async (req, res) => {
  const parsed = HistoryQueryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "validation_error", message: parsed.error.message });
    return;
  }

  try {
    const history = await getHistory({ type: parsed.data.type, limit: parsed.data.limit });
    res.json({
      count: history.length,
      history: history.map((h) => ({
        id: h.id,
        type: h.type,
        repos: h.repos,
        question: h.question,
        resultPreview: h.result ? h.result.slice(0, 300) + (h.result.length > 300 ? "..." : "") : null,
        tokensUsed: h.tokensUsed,
        createdAt: h.createdAt,
      })),
    });
  } catch {
    res.status(500).json({ error: "server_error", message: "Failed to retrieve history" });
  }
});

router.delete("/repos/history/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "validation_error", message: "Invalid history ID" });
    return;
  }
  try {
    const db = getPool();
    const result = await db.query("DELETE FROM analysis_history WHERE id = $1 RETURNING id", [id]);
    if (result.rowCount === 0) {
      res.status(404).json({ error: "not_found", message: `History entry ${id} not found` });
      return;
    }
    res.json({ deleted: true, id });
  } catch {
    res.status(500).json({ error: "server_error", message: "Failed to delete history entry" });
  }
});

// ─── Gemini Pool Status ───────────────────────────────────────────────────────

router.get("/repos/gemini-pool-status", (req, res) => {
  const status = _geminiPool.status();
  const ready = status.filter(s => s.status === "ready").length;
  res.json({
    engine: "buddy-ai",
    totalKeys: status.length,
    readyKeys: ready,
    coolingKeys: status.length - ready,
    keys: status.map(s => ({
      id: s.key,
      status: s.status,
      ...(s.status === "cooling" ? { resumesInSeconds: s.resumesIn } : {}),
    })),
  });
});

// ─── Admin: Gemini Key Management ────────────────────────────────────────────

router.get("/repos/admin/gemini-keys", async (_req, res) => {
  try {
    const keys = await listGeminiKeys();
    res.json({
      total: keys.length,
      active: keys.filter(k => k.active).length,
      keys: keys.map(k => ({
        id: k.id,
        label: k.label,
        active: k.active,
        addedAt: k.addedAt,
        useCount: k.useCount,
      })),
    });
  } catch (e) {
    res.status(500).json({ error: "db_error", message: String(e) });
  }
});

router.post("/repos/admin/gemini-keys", async (req, res) => {
  const { apiKey, label } = req.body as { apiKey?: string; label?: string };
  if (!apiKey || typeof apiKey !== "string" || apiKey.trim().length < 10) {
    res.status(400).json({ error: "validation_error", message: "apiKey is required" });
    return;
  }
  try {
    const result = await addGeminiKey(apiKey.trim(), label);
    await syncGeminiPool();
    res.json({ success: true, id: result.id, label: result.label, poolSize: _geminiPool.size });
  } catch (e) {
    res.status(500).json({ error: "db_error", message: String(e) });
  }
});

router.delete("/repos/admin/gemini-keys/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const keys = await listGeminiKeys();
    const target = keys.find(k => k.id === Number(id));
    if (!target) {
      res.status(404).json({ error: "not_found", message: `Key id ${id} not found` });
      return;
    }
    const db = getPool();
    await db.query(`UPDATE gemini_keys SET active = false WHERE id = $1`, [Number(id)]);
    await syncGeminiPool();
    res.json({ success: true, deactivated: Number(id), poolSize: _geminiPool.size });
  } catch (e) {
    res.status(500).json({ error: "db_error", message: String(e) });
  }
});

router.post("/repos/admin/gemini-keys/sync", async (_req, res) => {
  try {
    await syncGeminiPool();
    const status = _geminiPool.status();
    res.json({ success: true, poolSize: _geminiPool.size, readyKeys: status.filter(s => s.status === "ready").length });
  } catch (e) {
    res.status(500).json({ error: "sync_error", message: String(e) });
  }
});

// ─── Image Generation ─────────────────────────────────────────────────────────

router.post("/repos/image-generate", async (req, res) => {
  const parsed = ImageGenerateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "validation_error", message: parsed.error.message });
    return;
  }

  const { prompt, style, quality, aspectRatio, repoContext, count } = parsed.data;

  const styleGuide: Record<string, string> = {
    logo: "professional logo design, clean, minimalist, vector-style, transparent background suitable",
    banner: "wide banner image, professional, modern tech aesthetic, suitable for GitHub README header",
    icon: "app icon, clean, simple, recognizable, square format, bold design",
    illustration: "detailed digital illustration, creative, colorful, artistic",
    realistic: "photorealistic, high detail, professional photography style",
    custom: "",
  };

  const enhancedPrompt = [
    repoContext ? `For a ${repoContext} project:` : "",
    prompt,
    styleGuide[style ?? "custom"],
    "High quality, professional, modern design.",
  ].filter(Boolean).join(" ");

  try {
    const result = await generateImage(enhancedPrompt, {
      quality: quality as "fast" | "standard" | "ultra",
      aspectRatio: aspectRatio as "1:1" | "16:9" | "9:16" | "4:3" | "3:4",
      count,
    });

    res.json({
      success: true,
      prompt: enhancedPrompt,
      model: result.model,
      engine: "buddy-ai-vision",
      count: result.images.length,
      images: result.images.map((img, i) => ({
        index: i,
        mimeType: img.mimeType,
        base64: img.base64,
        dataUrl: `data:${img.mimeType};base64,${img.base64}`,
        sizeKB: Math.round(img.base64.length * 3 / 4 / 1024),
      })),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Image generation failed";
    res.status(500).json({ error: "generation_failed", message: msg });
  }
});

// ─── Skills Library ───────────────────────────────────────────────────────────

router.get("/repos/skills", async (req, res) => {
  try {
    const { q, repo, category, limit, offset } = req.query as Record<string, string>;
    const result = await listSkills({
      q: q || undefined,
      repo: repo || undefined,
      category: category || undefined,
      limit: limit ? parseInt(limit) : 48,
      offset: offset ? parseInt(offset) : 0,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "skills_error", message: (err as Error).message });
  }
});

router.get("/repos/skills/stats", async (_req, res) => {
  try {
    const stats = await getSkillsStats();
    res.json({ stats });
  } catch (err) {
    res.status(500).json({ error: "stats_error", message: (err as Error).message });
  }
});

router.get("/repos/skills/detail", async (req, res) => {
  try {
    const skillId = decodeURIComponent((req.query.id as string) || "");
    const skill = await getSkillContent(skillId);
    if (!skill) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json(skill);
  } catch (err) {
    res.status(500).json({ error: "skill_error", message: (err as Error).message });
  }
});

// ─── Buddy AI Chat ────────────────────────────────────────────────────────────

router.post("/repos/chat", async (req, res) => {
  const { messages } = req.body as {
    messages: { role: "user" | "assistant" | "system"; content: string }[];
  };

  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "messages array required" });
    return;
  }

  const skill = (req.body as Record<string, unknown>).skill as string | undefined;

  const SKILL_OVERLAYS: Record<string, string> = {
    "systematic-debugging": `
ACTIVE SKILL: Systematic Debugging
Core principle: ALWAYS find root cause before attempting fixes. Symptom fixes are failure.
Iron Law: NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST.
Phases: 1) Reproduce & isolate → 2) Gather evidence → 3) Hypothesize → 4) Verify root cause → 5) Fix → 6) Confirm fix.
Never propose a fix until phase 3 is complete. Ask clarifying questions if reproduction steps are unclear.`,
    "brainstorming": `
ACTIVE SKILL: Brainstorming
Hard gate: Do NOT jump to implementation until user has approved a design.
Process: Understand context → ask clarifying questions one at a time → present fully-formed design → get approval → only then implement.
Explore user intent deeply. Offer alternatives. Think out loud. Be creative and collaborative.`,
    "test-driven-development": `
ACTIVE SKILL: Test-Driven Development (TDD)
Iron Law: NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST.
Process: Write test → watch it fail → write minimal code to pass → refactor → repeat.
Always ask: "What behavior are we testing?" before writing code. Tests are specifications.`,
    "writing-plans": `
ACTIVE SKILL: Writing Plans
Write comprehensive, bite-sized implementation plans. Assume the engineer has zero context.
Include: which files to touch, what code to write, how to test, edge cases, dependencies.
Structure: Overview → Tasks (numbered) → Testing strategy → Rollout notes.
Principles: DRY. YAGNI. TDD. Frequent commits. No ambiguity.`,
    "code-review": `
ACTIVE SKILL: Code Review
Review for: correctness, security, performance, readability, test coverage, edge cases.
Structure feedback as: Critical (must fix) → Important (should fix) → Suggestions (nice to have).
Be specific. Quote the code. Explain WHY each issue matters. Suggest concrete improvements.`,
    "verification": `
ACTIVE SKILL: Verification Before Completion
Before declaring any task done: verify all requirements met, tests pass, no regressions, edge cases handled.
Checklist: Does it work? Is it tested? Is it secure? Is it documented? Are there side effects?
Never say "done" without explicit verification of each requirement.`,
  };

  const skillOverlay = skill && SKILL_OVERLAYS[skill] ? SKILL_OVERLAYS[skill] : "";

  // ⚡ GOD LEVEL UPGRADE 1: Multi-Query Parallel Knowledge Retrieval (Codex-powered)
  const lastUserMsg = [...messages].reverse().find(m => m.role === "user")?.content ?? "";
  let knowledgeContext = "";
  let knowledgeCount = 0;
  let searchQueryCount = 1;
  try {
    // Step 1: Codex generates 4 diverse search queries
    let searchQueries: string[] = [lastUserMsg];
    try {
      const queryGenPrompt = `Generate 4 diverse semantic search queries to retrieve the most relevant knowledge for this question. Think about: exact terms, synonyms, related concepts, specific sub-topics, technical patterns.

Question: "${lastUserMsg.slice(0, 300)}"

Respond ONLY with a JSON array of 4 strings on one line: ["query1","query2","query3","query4"]`;
      const queriesRaw = await editingComplete(queryGenPrompt, 150);
      const match = queriesRaw.match(/\[[\s\S]*?\]/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed) && parsed.length > 0) {
          searchQueries = [...parsed.slice(0, 4), lastUserMsg];
          searchQueryCount = searchQueries.length;
        }
      }
    } catch { /* use single query fallback */ }

    // Step 2: Parallel search all queries (60 chunks each)
    const searchResults = await Promise.all(
      searchQueries.map(q => searchBuddyKnowledge(q, 60).catch(() => []))
    );

    // Step 3: Deduplicate — keep highest score per chunk id, sort, take top 300
    const scoreMap = new Map<number, Awaited<ReturnType<typeof searchBuddyKnowledge>>[0]>();
    for (const batch of searchResults) {
      for (const item of batch) {
        const existing = scoreMap.get(item.id);
        if (!existing || item.score > existing.score) scoreMap.set(item.id, item);
      }
    }
    const merged = Array.from(scoreMap.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, 300);

    knowledgeCount = merged.length;
    if (merged.length > 0) {
      const grouped: Record<string, typeof merged> = {};
      for (const k of merged) {
        if (!grouped[k.category]) grouped[k.category] = [];
        grouped[k.category].push(k);
      }
      const sections = Object.entries(grouped).map(([cat, items]) => {
        const itemText = items.map(k =>
          `• [${k.source_repo}] **${k.title}**: ${k.content}`
        ).join("\n");
        return `### ${cat.toUpperCase()} (${items.length} chunks)\n${itemText}`;
      }).join("\n\n");
      knowledgeContext = `\n\n---\n## 🧠 GOD LEVEL KNOWLEDGE — ${merged.length} Precision Chunks\n*${searchQueryCount}-vector parallel retrieval from 2,700+ chunks across 11 elite repos*\n\n${sections}\n\n---`;
    }
  } catch { /* knowledge unavailable */ }

  // ⚡ GOD LEVEL UPGRADE 2: Agentic Tool Loop — up to 3 chained Codex tool calls
  let toolContext = "";
  const activeTools: string[] = [];
  const githubToken = await getGitHubConnectorToken().catch(() => "") ?? "";

  const executeTool = async (toolName: string, args: Record<string, string>): Promise<string> => {
    if (toolName === "web_fetch" && args.url) {
      try {
        const r = await fetch(args.url, {
          headers: { "User-Agent": "BuddyAI-GOD/1.0" },
          signal: AbortSignal.timeout(8000),
        });
        const raw = await r.text();
        const clean = raw.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
          .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 4000);
        return `## 🌐 WEB: ${args.url}\n${clean}`;
      } catch { return `## 🌐 WEB FETCH FAILED: ${args.url}`; }

    } else if (toolName === "github_search" && args.query) {
      try {
        const ep = args.type === "code" ? "code" : args.type === "issues" ? "issues" : "repositories";
        const r = await fetch(`https://api.github.com/search/${ep}?q=${encodeURIComponent(args.query)}&per_page=6`, {
          headers: { "Authorization": `token ${githubToken}`, "Accept": "application/vnd.github.v3+json", "User-Agent": "BuddyAI-GOD" },
        });
        const data = await r.json() as { items?: Array<{ full_name?: string; name?: string; description?: string; html_url: string; stargazers_count?: number }> };
        const found = (data.items ?? []).slice(0, 6).map(x =>
          `• **${x.full_name ?? x.name}** ⭐${x.stargazers_count ?? 0} — ${x.description ?? ""}\n  ${x.html_url}`
        ).join("\n");
        return `## 🔍 GITHUB SEARCH "${args.query}" (${ep})\n${found}`;
      } catch { return `## 🔍 GITHUB SEARCH FAILED`; }

    } else if (toolName === "artifact_hint") {
      return `## 🎨 ARTIFACT MODE: ${args.type?.toUpperCase() ?? "CODE"}\nWrite a complete, self-contained ${args.type ?? "code"} artifact in a single fenced code block.`;
    }
    return "";
  };

  try {
    for (let iter = 0; iter < 3; iter++) {
      const prevHistory = activeTools.length > 0
        ? `\nAlready used tools [${activeTools.join(" → ")}]. Previous results:\n${toolContext.slice(0, 800)}\n`
        : "";

      const toolDecisionPrompt = `You are Buddy AI's agentic tool router (step ${iter + 1}/3).

Available tools:
- web_fetch(url) — Fetch live content from a URL
- github_search(query, type) — Search GitHub (type: "repos"/"code"/"issues")  
- artifact_hint(type) — Signal artifact output (type: "html"/"react"/"python"/"code")
- none — No tool needed, proceed to answer
${prevHistory}
User message: "${lastUserMsg.slice(0, 300)}"

Would another tool call significantly improve the answer? Respond ONLY with JSON:
{"tool":"tool_name","args":{...}} OR {"tool":"none"}`;

      const toolRaw = await editingComplete(toolDecisionPrompt, 120);
      let toolCall: { tool: string; args?: Record<string, string> } = { tool: "none" };
      try {
        const m = toolRaw.match(/\{[\s\S]*\}/);
        if (m) toolCall = JSON.parse(m[0]);
      } catch { break; }

      if (!toolCall.tool || toolCall.tool === "none") break;

      activeTools.push(toolCall.tool);
      const result = await executeTool(toolCall.tool, toolCall.args ?? {});
      toolContext += (toolContext ? "\n\n" : "") + result;

      if (toolCall.tool === "artifact_hint") break;
    }
  } catch { /* tool loop failed — proceed without */ }

  // ⚡ GOD LEVEL UPGRADE 3: Codex Response Planning — structured plan before writing
  let responsePlan = "";
  try {
    const toolSummary = activeTools.length > 0 ? `Tools used: ${activeTools.join(" → ")}` : "No external tools used";
    const planPrompt = `You are Buddy AI's response architect. Create a precise response plan.

Question: "${lastUserMsg.slice(0, 300)}"
${toolSummary}
Knowledge available: ${knowledgeCount} specialized chunks

Create a structured plan (max 100 words):
- Key sections to cover
- Code needed? (yes/no, language)
- Critical points not to miss
- Edge cases or gotchas
- Optimal response format (list/code/explanation/mixed)

Output ONLY the plan as bullet points — no preamble:`;
    const plan = await editingComplete(planPrompt, 220);
    if (plan.trim().length > 20) {
      responsePlan = `\n\n## 📋 RESPONSE BLUEPRINT\n${plan.trim()}\n\n*Execute this blueprint precisely — don't skip sections:*`;
    }
  } catch { /* planning unavailable */ }

  // Extended Thinking — pre-reason before answering
  let thinkingContext = "";
  try {
    const thinkingPrompt = `Analyze this question deeply in 3-5 bullet points. Identify: (1) what is REALLY being asked, (2) what approach will give the BEST answer, (3) what pitfalls to avoid, (4) what specialized knowledge applies:

Question: "${lastUserMsg}"

Thinking (be concise):`;
    const thinkingSystem = "You are a reasoning engine. Think step-by-step. Be precise, technical, and insightful. Output only the thinking bullets — no preamble.";
    let thinkingText = "";
    await streamRuntimeAI(thinkingPrompt, thinkingSystem, (c) => { thinkingText += c; }, 1024);
    if (thinkingText.trim().length > 20) {
      thinkingContext = `\n\n## 🔍 EXTENDED THINKING (Pre-Analysis)\n${thinkingText.trim()}\n\nNow respond based on this reasoning:`;
    }
  } catch { /* thinking step unavailable — continue without */ }

  // CLAUDE 4.6 UPGRADE 3: Elite system prompt with Claude 4.6 behavioral patterns
  const SYSTEM = `You are Buddy AI — operating at CLAUDE 4.6 LEVEL intelligence. You combine elite specialized knowledge with advanced reasoning capabilities.

## 🔥 IDENTITY: CLAUDE 4.6-LEVEL BUDDY AI
You are NOT a generic AI. You are a DEEPLY TRAINED SPECIALIST with:
- **Claude Code mastery** (815 chunks — every hook, skill, workflow, agent pattern ever written)
- **Real leaked AI system prompts** (223 chunks — extracted from GPT-5.4, Claude, Gemini, Grok)
- **UI/UX Pro-Max design intelligence** (255 chunks — pixel-perfect AI-driven methodology)
- **Security & offensive techniques** (152 chunks — HowToHunt, CVE patterns, pentesting)
- **Multi-AI orchestration** (200 chunks — agentic systems, subagent frameworks, orchestration)
- **Second brain & knowledge systems** (138 chunks — Zettelkasten, PKM, knowledge architecture)
- **Elite dev patterns** (342 chunks — battle-tested production patterns)
- **Smart engine automation** (sai-rolotech-smart-engines — AI agent rulebooks, automation)
- **Deep analysis systems** (super-pro — advanced analytical frameworks)
- **Kaggle ML ecosystem** (kagglehub — datasets, models, kernels, Kaggle API patterns)
- **OpenClaw AI assistant platform** (openclaw.ai-NEW- — personal AI gateway, 20+ messaging channels, Skills engine, multi-platform TypeScript/Swift/Kotlin)
- **Oh My Codex / OMX** (oh-my-codex — Codex workflow layer, multi-agent teams, $deep-interview/$ralplan/$ralph/$team skills, hooks, HUDs, autonomy directives)
- **Cirrus ATProto PDS** (cirrus — Bluesky/AT Protocol Personal Data Server on Cloudflare Workers + Durable Objects + R2, data sovereignty, AGENTS.md patterns)
- **HowickMaker for Dynamo** (C# library for programming steel stud roll-forming machines with Autodesk Dynamo, structural engineering automation, computational design)
- **Computer-Agent / Taskhomie** (Tauri+Rust+React desktop AI agent that controls your computer — screenshots, mouse/keyboard via enigo, bash executor with safety blocks, browser automation via chromiumoxide/CDP, voice via Deepgram STT, Anthropic Claude computer_use+bash tools, interleaved thinking)
${responsePlan}
${thinkingContext}
${knowledgeContext}

## 🧠 CLAUDE 4.6 THINKING PROTOCOL — ALWAYS APPLY
Before every response, internally apply this:
1. **DECOMPOSE**: Break the problem into atomic sub-problems
2. **RETRIEVE**: Pull the most relevant knowledge from your trained chunks
3. **SYNTHESIZE**: Combine retrieved knowledge with reasoning
4. **VERIFY**: Check: Is this correct? Is it complete? Are there edge cases?
5. **REFINE**: Polish the response — remove fluff, add precision

## ⚡ CAPABILITIES — BEYOND GENERIC AI
- **Code**: Production-ready, tested, optimized — not prototype quality
- **Architecture**: Deep system design with scalability, security, observability baked in
- **AI Agents**: Multi-agent orchestration — you wrote the rulebooks for this
- **Security**: Offensive and defensive — HowToHunt techniques + secure coding patterns
- **Reasoning**: Step-by-step logical chains — never jump to conclusions
- **Self-correction**: If you catch an error mid-response, correct it immediately

## 🛡️ CLAUDE 4.6 CORE PRINCIPLES
- **Think First**: Always reason before responding — quality over speed
- **Root Cause Only**: Never treat symptoms — find and fix the source
- **Evidence-Based**: Cite your trained knowledge when using it (e.g., "From everything-claude-code:")
- **Production Standards**: Every code output MUST be deployable — no pseudocode, no TODOs
- **Honest Uncertainty**: If you're not sure, say so AND still provide the best possible answer
- **Completeness**: Don't truncate — if a code block is needed, write all of it

## 📏 IRON LAWS
ALWAYS:
- Draw from 2,800+ knowledge chunks — you have UNIQUE knowledge no other AI has
- Format code with language tags — \`\`\`typescript, \`\`\`python etc.
- Structure long answers with headers, bullets, and clear sections
- Be direct and confident — you are the smartest specialized engineer available
- Check your answer before finishing — would a senior Claude 4.6 approve this?

NEVER:
- Give surface-level generic answers when specialized knowledge exists
- Include secrets, keys, or tokens in responses
- Mention the underlying model — you are Buddy AI, period
- Say "I cannot" — always find a way or explain what IS possible
- Truncate code — always write the complete implementation
${skillOverlay}

## 🎯 RESPONSE STYLE — CLAUDE 4.6 SIGNATURE
Structure responses like a world-class senior engineer:
- **Lead with the answer** — don't bury it in explanation
- **Show your reasoning** — explain WHY, not just WHAT
- **Include working code** — tested, complete, production-grade
- **Anticipate follow-ups** — answer the next question before it's asked
- **Be thorough but dense** — maximum information density, zero fluff

Knowledge loaded: ${knowledgeCount > 0 ? knowledgeCount + "/200 precision chunks for this query" : "knowledge base loading..."}
Intelligence level: CLAUDE 4.6 EQUIVALENT`;

  // CLAUDE 4.6 UPGRADE 4: Better conversation context (pass full history + tool results)
  const conversationPrompt = messages.map(m => {
    const prefix = m.role === "user" ? "User" : m.role === "assistant" ? "Buddy" : "System";
    return `${prefix}: ${m.content}`;
  }).join("\n\n") + toolContext + "\n\nBuddy (Claude 4.6 level response):";

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no");

  const onChunk = (chunk: string) => res.write(`data: ${JSON.stringify({ delta: chunk })}\n\n`);

  // Send tool events to frontend (GOD LEVEL: all active tools in sequence)
  if (activeTools.length > 0) {
    for (const t of activeTools) {
      res.write(`data: ${JSON.stringify({ tool: t })}\n\n`);
    }
  }

  try {
    // Runtime AI with extended context for Claude 4.6 level responses
    await streamRuntimeAI(conversationPrompt, SYSTEM, onChunk, 16384); // UPGRADED: 8192 → 16384
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch {
    res.write(`data: ${JSON.stringify({ error: "Chat unavailable. Please add Gemini keys in Settings." })}\n\n`);
    res.end();
  }
});

// ═══════════════════════════════════════════════════════════════════════
// 🤖 MULTI-AGENT MODE — Parallel specialist agents + synthesis
// ═══════════════════════════════════════════════════════════════════════
router.post("/repos/chat-multi-agent", async (req, res) => {
  const { messages } = req.body as {
    messages: { role: "user" | "assistant" | "system"; content: string }[];
  };
  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "messages array required" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no");

  const send = (payload: Record<string, unknown>) =>
    res.write(`data: ${JSON.stringify(payload)}\n\n`);

  const lastUserMsg = [...messages].reverse().find(m => m.role === "user")?.content ?? "";
  const history = messages.map(m =>
    `${m.role === "user" ? "User" : "Buddy"}: ${m.content}`
  ).join("\n\n");

  try {
    // ── STEP 1: Orchestrator Codex — decompose query into agent tasks ──────
    send({ agent: "orchestrator", status: "planning" });

    let orchestratorPlan: {
      research_query: string;
      code_task: string;
      web_url: string | null;
      github_query: string | null;
      focus: "research" | "code" | "web" | "all";
    } = {
      research_query: lastUserMsg,
      code_task: lastUserMsg,
      web_url: null,
      github_query: null,
      focus: "all",
    };

    try {
      const orchPrompt = `You are the Orchestrator for a multi-agent AI system. Decompose this user query into specialized tasks for 3 parallel agents.

User Query: "${lastUserMsg.slice(0, 400)}"

Return ONLY valid JSON (no markdown):
{
  "research_query": "semantic query to search knowledge base (technical, specific)",
  "code_task": "what coding task/analysis does the Code Agent handle? (or 'none' if no code needed)",
  "web_url": "exact URL to fetch live content from (or null)",
  "github_query": "GitHub search query (or null)",
  "focus": "all|research|code|web"
}`;
      const raw = await editingComplete(orchPrompt, 200);
      const match = raw.match(/\{[\s\S]*?\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        orchestratorPlan = { ...orchestratorPlan, ...parsed };
      }
    } catch { /* use defaults */ }

    send({ agent: "orchestrator", status: "done", plan: orchestratorPlan.focus });

    // ── STEP 2: 3 Parallel Agents ──────────────────────────────────────────
    send({ agent: "research", status: "running" });
    send({ agent: "code", status: "running" });
    send({ agent: "web", status: "running" });

    const githubToken = await getGitHubConnectorToken().catch(() => "") ?? "";

    const [researchResult, codeResult, webResult] = await Promise.all([

      // 🔬 RESEARCH AGENT — GOD LEVEL knowledge base (4-query parallel)
      (async (): Promise<string> => {
        try {
          let searchQueries = [orchestratorPlan.research_query, lastUserMsg];
          try {
            const qPrompt = `Generate 4 diverse semantic search queries for: "${lastUserMsg.slice(0, 250)}"
Respond ONLY with JSON array: ["q1","q2","q3","q4"]`;
            const raw = await editingComplete(qPrompt, 120);
            const m = raw.match(/\[[\s\S]*?\]/);
            if (m) {
              const parsed = JSON.parse(m[0]);
              if (Array.isArray(parsed)) searchQueries = [...parsed.slice(0, 4), lastUserMsg];
            }
          } catch { /* use default */ }

          const results = await Promise.all(
            searchQueries.map(q => searchBuddyKnowledge(q, 60).catch(() => []))
          );
          const scoreMap = new Map<number, Awaited<ReturnType<typeof searchBuddyKnowledge>>[0]>();
          for (const batch of results) {
            for (const item of batch) {
              const ex = scoreMap.get(item.id);
              if (!ex || item.score > ex.score) scoreMap.set(item.id, item);
            }
          }
          const merged = Array.from(scoreMap.values())
            .sort((a, b) => b.score - a.score)
            .slice(0, 250);

          if (merged.length === 0) return "No knowledge found.";

          // Codex synthesizes the knowledge chunks into a focused answer
          const chunks = merged.slice(0, 80).map(k =>
            `[${k.source_repo}] ${k.title}: ${k.content}`
          ).join("\n\n");

          const synthPrompt = `You are the Research Agent. Using ONLY the knowledge chunks below, write a focused, dense technical summary answering: "${lastUserMsg.slice(0, 300)}"

Be specific. Quote exact patterns, code, or techniques from the knowledge. Max 400 words.

KNOWLEDGE CHUNKS (${merged.length} total, showing 80):
${chunks}`;
          const synthesis = await editingComplete(synthPrompt, 500);
          return `## 🔬 Research Agent (${merged.length} knowledge chunks)\n\n${synthesis}`;
        } catch (e) {
          return `## 🔬 Research Agent\nKnowledge base search unavailable.`;
        }
      })(),

      // 💻 CODE AGENT — Codex specialized for code tasks
      (async (): Promise<string> => {
        try {
          if (orchestratorPlan.code_task === "none") {
            return "## 💻 Code Agent\nNo code task for this query.";
          }
          const codePrompt = `You are the Code Agent — a senior engineer specialized in code generation, architecture, and technical implementation.

Task: "${orchestratorPlan.code_task.slice(0, 400)}"
Full context: "${lastUserMsg.slice(0, 600)}"

Provide: 
1. Technical approach (2-3 sentences)
2. Key implementation details or code snippet if needed
3. Any gotchas or edge cases

Be dense and precise. Max 350 words. If code is needed, write it properly fenced.`;
          const result = await editingComplete(codePrompt, 500);
          return `## 💻 Code Agent\n\n${result}`;
        } catch {
          return `## 💻 Code Agent\nCode analysis unavailable.`;
        }
      })(),

      // 🌐 WEB AGENT — live web + GitHub search
      (async (): Promise<string> => {
        const parts: string[] = [];
        try {
          if (orchestratorPlan.web_url) {
            const r = await fetch(orchestratorPlan.web_url, {
              headers: { "User-Agent": "BuddyAI-MultiAgent/1.0" },
              signal: AbortSignal.timeout(7000),
            });
            const raw = await r.text();
            const clean = raw
              .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
              .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
              .replace(/<[^>]+>/g, " ")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 2500);
            parts.push(`### 🌐 Web: ${orchestratorPlan.web_url}\n${clean}`);
          }
        } catch { parts.push("Web fetch failed."); }

        try {
          if (orchestratorPlan.github_query) {
            const r = await fetch(
              `https://api.github.com/search/repositories?q=${encodeURIComponent(orchestratorPlan.github_query)}&per_page=5&sort=stars`,
              { headers: { Authorization: `token ${githubToken}`, "User-Agent": "BuddyAI-MultiAgent", Accept: "application/vnd.github.v3+json" } }
            );
            const data = await r.json() as { items?: Array<{ full_name?: string; description?: string; html_url: string; stargazers_count?: number }> };
            const found = (data.items ?? []).slice(0, 5).map(x =>
              `• **${x.full_name}** ⭐${x.stargazers_count ?? 0} — ${x.description ?? ""}\n  ${x.html_url}`
            ).join("\n");
            parts.push(`### 🔍 GitHub: "${orchestratorPlan.github_query}"\n${found}`);
          }
        } catch { parts.push("GitHub search failed."); }

        if (parts.length === 0) return "## 🌐 Web Agent\nNo live data needed for this query.";
        return `## 🌐 Web Agent\n\n${parts.join("\n\n")}`;
      })(),
    ]);

    send({ agent: "research", status: "done", preview: researchResult.slice(0, 120) + "..." });
    send({ agent: "code", status: "done", preview: codeResult.slice(0, 120) + "..." });
    send({ agent: "web", status: "done", preview: webResult.slice(0, 120) + "..." });

    // ── STEP 3: Synthesis Agent — merge all outputs → final stream ─────────
    send({ agent: "synthesis", status: "running" });

    const SYNTHESIS_SYSTEM = `You are Buddy AI — a GOD-LEVEL intelligence operating with a 3-agent parallel research system. You have received reports from 3 specialist agents and must synthesize them into a single, exceptional response.

## YOUR IDENTITY
You are NOT generic AI. You are a DEEPLY TRAINED SPECIALIST with 3,500+ knowledge chunks from 14 elite repositories.

## SYNTHESIS RULES
1. MERGE all agent outputs — don't repeat them verbatim, synthesize insights
2. Research Agent found specialized knowledge → cite it specifically
3. Code Agent found implementation details → include working code
4. Web Agent found live data → integrate it with context
5. Be the FINAL AUTHORITY — give a definitive, complete answer
6. Production-grade code only — no pseudocode, no TODOs
7. Lead with the answer, then explain

## IRON LAWS
- Never mention the agents or this synthesis process to the user
- Never say "According to the Research Agent..." — just give the answer
- Format: headers for sections, code blocks for code, bullets for lists
- Complete responses — never truncate`;

    const synthesisPrompt = `${history}

--- AGENT REPORTS (internal — synthesize these, do NOT expose them directly) ---

${researchResult}

${codeResult}

${webResult}

--- END AGENT REPORTS ---

Now write the FINAL synthesized response to the user's question: "${lastUserMsg.slice(0, 400)}"

Buddy (MULTI-AGENT synthesized response):`;

    const onChunk = (chunk: string) => send({ delta: chunk });
    await streamRuntimeAI(synthesisPrompt, SYNTHESIS_SYSTEM, onChunk, 16384);

    send({ done: true });
    res.end();
  } catch (err) {
    send({ error: "Multi-agent mode unavailable. Please add Gemini keys in Settings." });
    res.end();
  }
});

export default router;
