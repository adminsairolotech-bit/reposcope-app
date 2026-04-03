import pg from "pg";

const { Pool } = pg;

let pool: InstanceType<typeof Pool> | null = null;

export function getPool(): InstanceType<typeof Pool> {
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });
  }
  return pool;
}

export async function initDb(): Promise<void> {
  const db = getPool();
  await db.query(`
    CREATE TABLE IF NOT EXISTS analysis_history (
      id          SERIAL PRIMARY KEY,
      type        TEXT NOT NULL,
      repos       TEXT[] NOT NULL,
      question    TEXT,
      result      TEXT,
      tokens_used INTEGER,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_history_type ON analysis_history(type);
    CREATE INDEX IF NOT EXISTS idx_history_created ON analysis_history(created_at DESC);
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS skills_library (
      id          SERIAL PRIMARY KEY,
      skill_id    TEXT NOT NULL UNIQUE,
      repo        TEXT NOT NULL,
      category    TEXT NOT NULL,
      name        TEXT NOT NULL,
      description TEXT,
      content     TEXT,
      synced_at   TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_skills_repo ON skills_library(repo)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_skills_category ON skills_library(category)`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS gemini_keys (
      id         SERIAL PRIMARY KEY,
      label      TEXT NOT NULL,
      api_key    TEXT NOT NULL UNIQUE,
      provider   TEXT NOT NULL DEFAULT 'google',
      active     BOOLEAN NOT NULL DEFAULT true,
      added_at   TIMESTAMPTZ DEFAULT NOW(),
      last_used  TIMESTAMPTZ,
      use_count  INTEGER DEFAULT 0
    )
  `);
}

export async function loadGeminiKeys(): Promise<string[]> {
  try {
    const db = getPool();
    const { rows } = await db.query(
      `SELECT api_key FROM gemini_keys WHERE active = true ORDER BY id ASC`
    );
    return rows.map((r) => r.api_key as string);
  } catch {
    return [];
  }
}

export async function addGeminiKey(apiKey: string, label?: string): Promise<{ id: number; label: string }> {
  const db = getPool();
  const lbl = label ?? `key_${Date.now()}`;
  const { rows } = await db.query(
    `INSERT INTO gemini_keys (label, api_key)
     VALUES ($1, $2)
     ON CONFLICT (api_key) DO UPDATE SET active = true, label = EXCLUDED.label
     RETURNING id, label`,
    [lbl, apiKey]
  );
  return { id: rows[0].id as number, label: rows[0].label as string };
}

export async function removeGeminiKey(apiKey: string): Promise<boolean> {
  const db = getPool();
  const { rowCount } = await db.query(
    `UPDATE gemini_keys SET active = false WHERE api_key = $1`,
    [apiKey]
  );
  return (rowCount ?? 0) > 0;
}

export async function listGeminiKeys(): Promise<{ id: number; label: string; active: boolean; addedAt: string; useCount: number }[]> {
  const db = getPool();
  const { rows } = await db.query(
    `SELECT id, label, active, added_at, use_count FROM gemini_keys ORDER BY id ASC`
  );
  return rows.map((r) => ({
    id: r.id as number,
    label: r.label as string,
    active: r.active as boolean,
    addedAt: (r.added_at as Date).toISOString(),
    useCount: r.use_count as number,
  }));
}

export async function incrementKeyUse(apiKey: string): Promise<void> {
  try {
    const db = getPool();
    await db.query(
      `UPDATE gemini_keys SET use_count = use_count + 1, last_used = NOW() WHERE api_key = $1`,
      [apiKey]
    );
  } catch { /* non-critical */ }
}

export async function saveHistory(opts: {
  type: string;
  repos: string[];
  question?: string;
  result?: string;
  tokensUsed?: number;
}): Promise<number> {
  const db = getPool();
  const { rows } = await db.query(
    `INSERT INTO analysis_history (type, repos, question, result, tokens_used)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [opts.type, opts.repos, opts.question ?? null, opts.result ?? null, opts.tokensUsed ?? null]
  );
  return rows[0].id as number;
}

export async function getHistory(opts: {
  type?: string;
  limit?: number;
}): Promise<{
  id: number;
  type: string;
  repos: string[];
  question: string | null;
  result: string | null;
  tokensUsed: number | null;
  createdAt: string;
}[]> {
  const db = getPool();
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (opts.type && opts.type !== "all") {
    conditions.push(`type = $${params.length + 1}`);
    params.push(opts.type);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = opts.limit ?? 20;
  params.push(limit);

  const { rows } = await db.query(
    `SELECT id, type, repos, question, result, tokens_used, created_at
     FROM analysis_history ${where}
     ORDER BY created_at DESC
     LIMIT $${params.length}`,
    params
  );

  return rows.map((r) => ({
    id: r.id as number,
    type: r.type as string,
    repos: r.repos as string[],
    question: r.question as string | null,
    result: r.result as string | null,
    tokensUsed: r.tokens_used as number | null,
    createdAt: (r.created_at as Date).toISOString(),
  }));
}

export interface Skill {
  id: number;
  skillId: string;
  repo: string;
  category: string;
  name: string;
  description: string;
}

export interface SkillDetail extends Skill {
  content: string;
}

export async function listSkills(opts: { repo?: string; category?: string; q?: string; limit?: number; offset?: number } = {}): Promise<{ skills: Skill[]; total: number }> {
  const db = getPool();
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (opts.repo) { params.push(opts.repo); conditions.push(`repo = $${params.length}`); }
  if (opts.category) { params.push(opts.category + '%'); conditions.push(`category ILIKE $${params.length}`); }
  if (opts.q) { params.push('%' + opts.q + '%'); conditions.push(`(name ILIKE $${params.length} OR description ILIKE $${params.length} OR category ILIKE $${params.length})`); }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;

  const [{ rows }, { rows: countRows }] = await Promise.all([
    db.query(`SELECT id, skill_id, repo, category, name, description FROM skills_library ${where} ORDER BY repo, name LIMIT ${limit} OFFSET ${offset}`, params),
    db.query(`SELECT COUNT(*) FROM skills_library ${where}`, params),
  ]);

  return {
    skills: rows.map(r => ({ id: r.id, skillId: r.skill_id, repo: r.repo, category: r.category, name: r.name, description: r.description })),
    total: parseInt(countRows[0].count, 10),
  };
}

export async function getSkillContent(skillId: string): Promise<SkillDetail | null> {
  const db = getPool();
  const { rows } = await db.query(`SELECT id, skill_id, repo, category, name, description, content FROM skills_library WHERE skill_id = $1`, [skillId]);
  if (!rows[0]) return null;
  const r = rows[0];
  return { id: r.id, skillId: r.skill_id, repo: r.repo, category: r.category, name: r.name, description: r.description, content: r.content };
}

export async function getSkillsStats(): Promise<{ repo: string; count: number; categories: string[] }[]> {
  const db = getPool();
  const { rows } = await db.query(`SELECT repo, COUNT(*) as count, array_agg(DISTINCT split_part(category,':',1)) as categories FROM skills_library GROUP BY repo ORDER BY count DESC`);
  return rows.map(r => ({ repo: r.repo, count: parseInt(r.count, 10), categories: r.categories }));
}

// ─── Buddy Knowledge (Training) ───────────────────────────────────────────────

export async function initBuddyKnowledge(): Promise<void> {
  const db = getPool();
  await db.query(`
    CREATE TABLE IF NOT EXISTS buddy_knowledge (
      id          SERIAL PRIMARY KEY,
      source_repo TEXT NOT NULL,
      source_file TEXT NOT NULL,
      category    TEXT NOT NULL DEFAULT 'general',
      title       TEXT NOT NULL,
      content     TEXT NOT NULL,
      keywords    TEXT[] DEFAULT '{}',
      trained_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_bk_repo ON buddy_knowledge(source_repo)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_bk_category ON buddy_knowledge(category)`);
}

export async function saveBuddyKnowledge(entries: {
  source_repo: string;
  source_file: string;
  category: string;
  title: string;
  content: string;
  keywords: string[];
}[]): Promise<number> {
  if (entries.length === 0) return 0;
  const db = getPool();
  let saved = 0;
  for (const e of entries) {
    try {
      await db.query(
        `INSERT INTO buddy_knowledge (source_repo, source_file, category, title, content, keywords)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT DO NOTHING`,
        [e.source_repo, e.source_file, e.category, e.title, e.content, e.keywords]
      );
      saved++;
    } catch { /* skip duplicate */ }
  }
  return saved;
}

export async function loadBuddyKnowledge(limit = 50): Promise<{ title: string; category: string; content: string; source_repo: string }[]> {
  const db = getPool();
  const { rows } = await db.query(
    `SELECT title, category, content, source_repo FROM buddy_knowledge ORDER BY trained_at DESC LIMIT $1`,
    [limit]
  );
  return rows.map(r => ({ title: r.title, category: r.category, content: r.content, source_repo: r.source_repo }));
}

export async function searchBuddyKnowledge(
  query: string,
  limit = 100
): Promise<{ title: string; category: string; content: string; source_repo: string }[]> {
  const db = getPool();

  // Extract meaningful keywords (>3 chars, not stopwords)
  const stopwords = new Set(["what","this","that","with","from","have","will","your","they","them","then","than","when","where","which","about","into","would","there","their","these","those","been","were","also","more","some","such","very","just","like","only","over","even","after","other","know","take","make","much","many","most","both","each","well","need","does","must","should"]);
  const keywords = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(k => k.length > 3 && !stopwords.has(k))
    .slice(0, 6);

  if (keywords.length === 0) return loadBuddyKnowledge(limit);

  // Score-based search: more keyword matches = higher relevance
  const conditions = keywords.map((k, i) =>
    `(CASE WHEN title ILIKE $${i+1} THEN 3 ELSE 0 END +
      CASE WHEN content ILIKE $${i+1} THEN 2 ELSE 0 END +
      CASE WHEN category ILIKE $${i+1} THEN 1 ELSE 0 END)`
  ).join(" + ");

  const params = keywords.map(k => `%${k}%`);

  const { rows } = await db.query(
    `SELECT title, category, content, source_repo,
            (${conditions}) AS relevance_score
     FROM buddy_knowledge
     WHERE (${conditions}) > 0
     ORDER BY relevance_score DESC, trained_at DESC
     LIMIT $${keywords.length + 1}`,
    [...params, limit]
  );

  // If not enough results, supplement with general knowledge
  if (rows.length < limit / 2) {
    const extra = await loadBuddyKnowledge(limit - rows.length);
    const seen = new Set(rows.map((r: Record<string,unknown>) => r.title));
    for (const e of extra) {
      if (!seen.has(e.title)) rows.push({ ...e, relevance_score: 0 });
    }
  }

  return rows.map((r: Record<string,unknown>) => ({
    title: r.title as string,
    category: r.category as string,
    content: r.content as string,
    source_repo: r.source_repo as string
  }));
}

export async function getBuddyKnowledgeStats(): Promise<{ total: number; repos: { repo: string; count: number }[] }> {
  const db = getPool();
  const [countRes, repoRes] = await Promise.all([
    db.query(`SELECT COUNT(*) FROM buddy_knowledge`),
    db.query(`SELECT source_repo, COUNT(*) as count FROM buddy_knowledge GROUP BY source_repo ORDER BY count DESC`)
  ]);
  return {
    total: parseInt(countRes.rows[0].count, 10),
    repos: repoRes.rows.map(r => ({ repo: r.source_repo, count: parseInt(r.count, 10) }))
  };
}

export async function clearBuddyKnowledge(): Promise<void> {
  const db = getPool();
  await db.query(`DELETE FROM buddy_knowledge`);
}
