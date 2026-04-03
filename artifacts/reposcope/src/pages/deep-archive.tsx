import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Layout } from "@/components/layout";
import { Loader2, Plus, X, Archive, ExternalLink, CheckCircle, AlertCircle } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const DEFAULT_REPOS = [
  "adminsairolotech-bit/awesome-claude-code",
  "adminsairolotech-bit/ui-ux-pro-max-skill",
  "adminsairolotech-bit/everything-claude-code",
  "adminsairolotech-bit/cloude-ai-agiant-superpowers",
  "adminsairolotech-bit/multi-ai-system_prompts_leaks",
  "adminsairolotech-bit/second-brain-skills",
  "adminsairolotech-bit/HowToHunt",
];

interface JobStatus {
  jobId: string;
  status: "running" | "done" | "error";
  logs: string[];
  repoUrl?: string;
  totalFiles?: number;
  error?: string;
  elapsedMs?: number;
}

export default function DeepArchive() {
  const [repos, setRepos] = useState<string[]>(DEFAULT_REPOS);
  const [newRepo, setNewRepo] = useState("");
  const [targetName, setTargetName] = useState("adminsairolotech-bit-ultimate-archive");
  const [running, setRunning] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auto-scroll logs
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [jobStatus?.logs.length]);

  // Polling effect
  useEffect(() => {
    if (!jobId) return;

    const poll = async () => {
      try {
        const res = await fetch(`${BASE}/api/repos/deep-archive-status/${jobId}`);
        if (!res.ok) return;
        const data = await res.json() as JobStatus;
        setJobStatus(data);
        if (data.status === "done" || data.status === "error") {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setRunning(false);
        }
      } catch { /* ignore */ }
    };

    poll(); // immediate first poll
    pollRef.current = setInterval(poll, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [jobId]);

  const addRepo = () => {
    const v = newRepo.trim();
    if (!v || repos.includes(v)) { setNewRepo(""); return; }
    setRepos(prev => [...prev, v]);
    setNewRepo("");
  };

  const removeRepo = (r: string) => setRepos(prev => prev.filter(x => x !== r));

  const runArchive = async () => {
    if (repos.length === 0) return;
    setRunning(true);
    setJobId(null);
    setJobStatus(null);

    try {
      const res = await fetch(`${BASE}/api/repos/deep-archive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repos, newRepoName: targetName }),
      });
      const data = await res.json() as { jobId?: string; error?: string; message?: string };
      if (!res.ok || !data.jobId) {
        setJobStatus({ jobId: "", status: "error", logs: [], error: data.message ?? data.error ?? "Failed to start" });
        setRunning(false);
        return;
      }
      setJobId(data.jobId);
    } catch (e) {
      setJobStatus({ jobId: "", status: "error", logs: [], error: e instanceof Error ? e.message : "Network error" });
      setRunning(false);
    }
  };

  const elapsed = jobStatus?.elapsedMs ? Math.round(jobStatus.elapsedMs / 1000) : 0;
  const isDone = jobStatus?.status === "done";
  const isError = jobStatus?.status === "error";

  return (
    <Layout>
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        <div className="flex items-center gap-3">
          <Archive className="w-7 h-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Deep Archive</h1>
            <p className="text-sm text-muted-foreground">
              Copy 100% of all code files from multiple repos into one new GitHub repo — powered by Codex 5.3
            </p>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-5 space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium">Target Repo Name</label>
            <Input
              value={targetName}
              onChange={e => setTargetName(e.target.value)}
              placeholder="my-combined-archive"
              disabled={running}
            />
            <p className="text-xs text-muted-foreground">New GitHub repo will be created under your account</p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Source Repos ({repos.length})</label>
            <div className="flex flex-wrap gap-2">
              {repos.map(r => (
                <Badge key={r} variant="secondary" className="flex items-center gap-1 text-xs py-1 px-2">
                  <span>{r}</span>
                  <button
                    onClick={() => removeRepo(r)}
                    disabled={running}
                    className="ml-1 hover:text-destructive transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </Badge>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                value={newRepo}
                onChange={e => setNewRepo(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addRepo()}
                placeholder="owner/repo-name"
                disabled={running}
                className="flex-1"
              />
              <Button variant="outline" size="icon" onClick={addRepo} disabled={running}>
                <Plus className="w-4 h-4" />
              </Button>
            </div>
          </div>

          <Button
            className="w-full"
            onClick={runArchive}
            disabled={running || repos.length === 0}
          >
            {running ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Archiving... {elapsed > 0 ? `(${elapsed}s elapsed)` : "(starting...)"}
              </>
            ) : (
              <><Archive className="w-4 h-4 mr-2" /> Start Deep Archive — Copy 100% Code</>
            )}
          </Button>
        </div>

        {isDone && jobStatus?.repoUrl && (
          <div className="rounded-xl border border-green-500/40 bg-green-500/10 p-4 flex items-center gap-3">
            <CheckCircle className="w-5 h-5 text-green-500 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-green-700 dark:text-green-400">
                ✅ {(jobStatus.totalFiles ?? 0).toLocaleString()} files archived successfully in {Math.round((jobStatus.elapsedMs ?? 0) / 1000)}s!
              </p>
              <a
                href={jobStatus.repoUrl}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-primary flex items-center gap-1 hover:underline truncate"
              >
                {jobStatus.repoUrl} <ExternalLink className="w-3 h-3 shrink-0" />
              </a>
            </div>
          </div>
        )}

        {isError && (
          <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-destructive shrink-0" />
            <p className="text-sm text-destructive">{jobStatus?.error ?? "Archive failed"}</p>
          </div>
        )}

        {(jobStatus?.logs.length ?? 0) > 0 && (
          <div className="rounded-xl border bg-card overflow-hidden">
            <div className="border-b px-4 py-2 flex items-center gap-2">
              <span className="text-sm font-medium">Live Progress</span>
              {running && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
              {running && <span className="text-xs text-muted-foreground ml-auto">Polling every 3s</span>}
              {isDone && <CheckCircle className="w-3 h-3 text-green-500 ml-auto" />}
            </div>
            <div
              ref={logRef}
              className="p-4 font-mono text-xs max-h-96 overflow-y-auto space-y-0.5 bg-muted/20"
            >
              {(jobStatus?.logs ?? []).map((line, i) => (
                <div
                  key={i}
                  className={
                    line.includes("❌") ? "text-destructive" :
                    line.includes("✅") ? "text-green-500 font-semibold" :
                    line.includes("🤖") ? "text-purple-400" :
                    line.includes("✔") ? "text-green-400" :
                    "text-foreground/80"
                  }
                >
                  {line}
                </div>
              ))}
              {running && (
                <div className="text-muted-foreground animate-pulse">⟳ Working...</div>
              )}
            </div>
          </div>
        )}

        <div className="rounded-xl border bg-muted/30 p-4 space-y-2">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-green-500" /> What Deep Archive Does
          </h3>
          <ul className="text-xs text-muted-foreground space-y-1">
            <li>• Fetches ALL text/code files from each repo (up to 500 per repo)</li>
            <li>• Skips only binary files (images, executables, fonts)</li>
            <li>• Preserves 100% of directory structure under <code className="bg-muted px-1 rounded">owner__repo/</code> subdirectory</li>
            <li>• Creates a single GitHub repo commit with all files at once (Git Data API)</li>
            <li>• Codex 5.3 generates a master INDEX.md linking all source repos</li>
            <li>• Runs fully in background — page polling every 3 seconds (no timeout!)</li>
          </ul>
          <div className="flex items-center gap-2 pt-1">
            <AlertCircle className="w-4 h-4 text-yellow-500" />
            <p className="text-xs text-muted-foreground">
              Large repos (20k+ files) may take 5–10 minutes. Job runs in background — safe to wait.
            </p>
          </div>
        </div>
      </div>
    </Layout>
  );
}
