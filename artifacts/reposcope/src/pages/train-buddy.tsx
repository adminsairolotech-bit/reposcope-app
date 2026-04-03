import { useState, useEffect, useRef } from "react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API = `${BASE}/api`;

interface TrainStatus {
  jobId: string;
  status: "running" | "done" | "error";
  logs: string[];
  totalFiles: number;
  processedFiles: number;
  extractedChunks: number;
  error?: string;
  elapsedMs: number;
  progress: number;
}

interface KnowledgeStats {
  total: number;
  repos: { repo: string; count: number }[];
}

export default function TrainBuddy() {
  const DEFAULT_REPOS = [
    "adminsairolotech-bit/awesome-claude-code",
    "adminsairolotech-bit/ui-ux-pro-max-skill",
    "adminsairolotech-bit/everything-claude-code",
    "adminsairolotech-bit/cloude-ai-agiant-superpowers",
    "adminsairolotech-bit/multi-ai-system_prompts_leaks",
    "adminsairolotech-bit/second-brain-skills",
    "adminsairolotech-bit/HowToHunt",
  ];
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<TrainStatus | null>(null);
  const [stats, setStats] = useState<KnowledgeStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const logsRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStats = async () => {
    try {
      const r = await fetch(`${API}/repos/train-buddy-stats`);
      if (r.ok) setStats(await r.json());
    } catch {}
  };

  useEffect(() => {
    fetchStats();
  }, []);

  useEffect(() => {
    if (logsRef.current) {
      logsRef.current.scrollTop = logsRef.current.scrollHeight;
    }
  }, [status?.logs]);

  const startTraining = async () => {
    setLoading(true);
    setStatus(null);
    try {
      const r = await fetch(`${API}/repos/train-buddy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repos: DEFAULT_REPOS }),
      });
      const data = await r.json();
      if (data.jobId) {
        setJobId(data.jobId);
        pollRef.current = setInterval(async () => {
          const pr = await fetch(`${API}/repos/train-buddy-status/${data.jobId}`);
          if (pr.ok) {
            const ps: TrainStatus = await pr.json();
            setStatus(ps);
            if (ps.status !== "running") {
              clearInterval(pollRef.current!);
              setLoading(false);
              fetchStats();
            }
          }
        }, 3000);
      }
    } catch (e) {
      setLoading(false);
    }
  };

  const clearKnowledge = async () => {
    setClearing(true);
    try {
      await fetch(`${API}/repos/train-buddy`, { method: "DELETE" });
      setStats({ total: 0, repos: [] });
    } finally {
      setClearing(false);
    }
  };

  const progressPct = status
    ? status.totalFiles > 0
      ? Math.round((status.processedFiles / status.totalFiles) * 100)
      : 0
    : 0;

  return (
    <div style={{ padding: "2rem", maxWidth: 900, margin: "0 auto", fontFamily: "sans-serif" }}>
      {/* Header */}
      <div style={{ marginBottom: "2rem" }}>
        <h1 style={{ fontSize: "1.8rem", fontWeight: 700, margin: 0, color: "#e2e8f0" }}>
          🧠 Train Buddy AI
        </h1>
        <p style={{ color: "#94a3b8", marginTop: "0.5rem" }}>
          Use all 1,479 files from 7 GitHub repos to build Buddy&apos;s knowledge base with Codex 5.3
        </p>
      </div>

      {/* Knowledge Stats Card */}
      {stats && (
        <div style={{
          background: stats.total > 0 ? "rgba(34,197,94,0.1)" : "rgba(51,65,85,0.5)",
          border: `1px solid ${stats.total > 0 ? "#22c55e40" : "#334155"}`,
          borderRadius: 12, padding: "1.25rem", marginBottom: "1.5rem"
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "1rem" }}>
            <div>
              <div style={{ fontSize: "2.5rem", fontWeight: 800, color: stats.total > 0 ? "#22c55e" : "#64748b" }}>
                {stats.total.toLocaleString()}
              </div>
              <div style={{ color: "#94a3b8", fontSize: "0.9rem" }}>knowledge chunks in Buddy&apos;s brain</div>
            </div>
            {stats.total > 0 && (
              <div>
                <div style={{ color: "#94a3b8", fontSize: "0.8rem", marginBottom: "0.5rem" }}>By source repo:</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                  {stats.repos.map(r => (
                    <span key={r.repo} style={{
                      background: "#1e293b", border: "1px solid #334155",
                      borderRadius: 20, padding: "0.2rem 0.7rem", fontSize: "0.75rem", color: "#94a3b8"
                    }}>
                      {r.repo.split("/").pop() ?? r.repo}: <strong style={{ color: "#e2e8f0" }}>{r.count}</strong>
                    </span>
                  ))}
                </div>
              </div>
            )}
            {stats.total > 0 && (
              <button onClick={clearKnowledge} disabled={clearing} style={{
                background: "transparent", border: "1px solid #ef4444", color: "#ef4444",
                borderRadius: 8, padding: "0.4rem 1rem", cursor: "pointer", fontSize: "0.85rem"
              }}>
                {clearing ? "Clearing..." : "🗑️ Clear"}
              </button>
            )}
          </div>
          {stats.total > 0 && (
            <div style={{ marginTop: "0.75rem", padding: "0.5rem 0.75rem", background: "rgba(34,197,94,0.08)", borderRadius: 8 }}>
              <span style={{ color: "#22c55e", fontSize: "0.85rem" }}>
                ✅ Buddy AI is TRAINED — 40 knowledge chunks auto-injected into every chat response
              </span>
            </div>
          )}
        </div>
      )}

      {/* Training Config */}
      <div style={{
        background: "rgba(15,23,42,0.8)", border: "1px solid #1e293b",
        borderRadius: 12, padding: "1.5rem", marginBottom: "1.5rem"
      }}>
        <div style={{ color: "#94a3b8", fontSize: "0.85rem", marginBottom: "0.75rem" }}>
          7 Source Repos (each fetched individually — 100% files, no truncation)
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginBottom: "1.25rem" }}>
          {DEFAULT_REPOS.map(r => (
            <span key={r} style={{
              background: "#0f172a", border: "1px solid #334155", borderRadius: 6,
              padding: "0.2rem 0.6rem", fontSize: "0.75rem", color: "#94a3b8"
            }}>
              {r.split("/")[1]}
            </span>
          ))}
        </div>

        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
          <button
            onClick={startTraining}
            disabled={loading}
            style={{
              background: loading ? "#334155" : "linear-gradient(135deg,#6366f1,#8b5cf6)",
              border: "none", borderRadius: 10, padding: "0.75rem 1.5rem",
              color: "#fff", fontWeight: 700, fontSize: "1rem", cursor: loading ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center", gap: "0.5rem"
            }}
          >
            {loading ? "⏳ Training..." : "🚀 Train All 7 Repos with Codex 5.3"}
          </button>
          <span style={{ color: "#64748b", fontSize: "0.8rem" }}>
            ~1,100+ text files • Codex 5.3 in batches of 8 • ~30-35 min
          </span>
        </div>
      </div>

      {/* Progress Bar */}
      {status && (
        <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 12, padding: "1.25rem", marginBottom: "1.5rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
            <span style={{ color: "#94a3b8", fontSize: "0.9rem" }}>
              {status.status === "running" ? "🔄 Processing..." : status.status === "done" ? "✅ Complete!" : "❌ Error"}
            </span>
            <span style={{ color: "#6366f1", fontWeight: 700 }}>{progressPct}%</span>
          </div>
          <div style={{ background: "#1e293b", borderRadius: 99, height: 8, marginBottom: "1rem" }}>
            <div style={{
              background: status.status === "error" ? "#ef4444" : "linear-gradient(90deg,#6366f1,#22c55e)",
              borderRadius: 99, height: "100%", width: `${progressPct}%`, transition: "width 0.4s"
            }} />
          </div>
          <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap" }}>
            {[
              { label: "Files Processed", val: `${status.processedFiles} / ${status.totalFiles}` },
              { label: "Knowledge Chunks Saved", val: status.extractedChunks.toLocaleString() },
              { label: "Elapsed", val: `${Math.round(status.elapsedMs / 1000)}s` },
            ].map(s => (
              <div key={s.label}>
                <div style={{ color: "#64748b", fontSize: "0.75rem" }}>{s.label}</div>
                <div style={{ color: "#e2e8f0", fontWeight: 700, fontSize: "1.1rem" }}>{s.val}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Live Logs */}
      {status && status.logs.length > 0 && (
        <div style={{ background: "#020617", border: "1px solid #1e293b", borderRadius: 12, padding: "1rem" }}>
          <div style={{ color: "#64748b", fontSize: "0.75rem", marginBottom: "0.5rem", fontFamily: "monospace" }}>
            LIVE LOGS — Codex 5.3 Training Output
          </div>
          <div
            ref={logsRef}
            style={{
              height: 320, overflowY: "auto", fontFamily: "monospace",
              fontSize: "0.78rem", lineHeight: 1.6
            }}
          >
            {status.logs.map((log, i) => {
              const color = log.startsWith("✅") || log.startsWith("🎉")
                ? "#22c55e"
                : log.startsWith("❌")
                ? "#ef4444"
                : log.startsWith("⚠️")
                ? "#f59e0b"
                : log.startsWith("🔄") || log.startsWith("📤")
                ? "#6366f1"
                : "#94a3b8";
              return (
                <div key={i} style={{ color, padding: "0.1rem 0" }}>
                  {log}
                </div>
              );
            })}
            {status.status === "running" && (
              <div style={{ color: "#6366f1", animation: "pulse 1s infinite" }}>▋</div>
            )}
          </div>
        </div>
      )}

      {/* How it works */}
      <div style={{
        marginTop: "2rem", background: "rgba(99,102,241,0.05)", border: "1px solid #6366f120",
        borderRadius: 12, padding: "1.25rem"
      }}>
        <div style={{ color: "#6366f1", fontWeight: 700, marginBottom: "0.75rem" }}>
          🔬 How This Works (Proof of Codex 5.3 Usage)
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0.75rem" }}>
          {[
            { icon: "📥", title: "Step 1: Fetch", desc: "All 1,479 files downloaded from the 7-repo archive" },
            { icon: "🤖", title: "Step 2: Codex 5.3", desc: "Batches of 8 files each sent to Codex 5.3 for knowledge extraction" },
            { icon: "💾", title: "Step 3: Store", desc: "Extracted knowledge chunks saved to PostgreSQL buddy_knowledge table" },
            { icon: "💬", title: "Step 4: Inject", desc: "Top 40 chunks auto-injected into Buddy's system prompt on every chat" },
          ].map(step => (
            <div key={step.title} style={{ background: "#0f172a", borderRadius: 8, padding: "0.75rem" }}>
              <div style={{ fontSize: "1.5rem" }}>{step.icon}</div>
              <div style={{ color: "#e2e8f0", fontWeight: 600, fontSize: "0.9rem" }}>{step.title}</div>
              <div style={{ color: "#64748b", fontSize: "0.8rem", marginTop: "0.25rem" }}>{step.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
