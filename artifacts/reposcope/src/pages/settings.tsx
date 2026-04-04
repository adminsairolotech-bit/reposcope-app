import { useState, useEffect, useCallback } from "react";
import { setApiKey, getApiKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Layout } from "@/components/layout";
import { Key, Github, Eye, EyeOff, Check, Trash2, Zap, Plus, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface AIKeyInfo {
  id: number;
  label: string;
  active: boolean;
  useCount: number;
}

export default function Settings() {
  const { toast } = useToast();

  const [apiKey, setApiKeyState] = useState("");
  const [githubToken, setGithubToken] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [showGithubToken, setShowGithubToken] = useState(false);
  const [saved, setSaved] = useState(false);

  const [aiKeys, setAiKeys] = useState<string[]>(["", "", "", "", "", ""]);
  const [showAiKey, setShowAiKey] = useState<boolean[]>([false, false, false, false, false, false]);
  const [aiPool, setAiPool] = useState<AIKeyInfo[]>([]);
  const [poolReady, setPoolReady] = useState(0);
  const [savingKeys, setSavingKeys] = useState(false);
  const [loadingPool, setLoadingPool] = useState(false);

  useEffect(() => {
    const stored = getApiKey();
    if (stored) setApiKeyState(stored);
    const ghToken = localStorage.getItem("reposcope_github_token");
    if (ghToken) setGithubToken(ghToken);
    fetchPool();
  }, []);

  const fetchPool = useCallback(async () => {
    setLoadingPool(true);
    try {
      const [adminRes, statusRes] = await Promise.all([
        fetch(`${BASE}/api/repos/admin/gemini-keys`),
        fetch(`${BASE}/api/repos/gemini-pool-status`),
      ]);
      const adminData = await adminRes.json();
      const statusData = await statusRes.json();
      setAiPool((adminData.keys ?? []).filter((k: AIKeyInfo) => k.active));
      setPoolReady(statusData.readyKeys ?? 0);
    } catch { /* ignore */ }
    finally { setLoadingPool(false); }
  }, []);

  const handleSave = () => {
    setApiKey(apiKey || null);
    if (githubToken) {
      localStorage.setItem("reposcope_github_token", githubToken);
    } else {
      localStorage.removeItem("reposcope_github_token");
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    toast({ title: "Settings saved", description: "Your credentials have been saved." });
  };

  const handleSaveAiKeys = async () => {
    const keysToAdd = aiKeys.filter(k => k.trim().length > 0);
    if (keysToAdd.length === 0) {
      toast({ title: "No keys entered", description: "Enter at least one AI Engine key.", variant: "destructive" });
      return;
    }
    setSavingKeys(true);
    let added = 0;
    for (let i = 0; i < keysToAdd.length; i++) {
      try {
        const res = await fetch(`${BASE}/api/repos/admin/gemini-keys`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ apiKey: keysToAdd[i], label: `key_${i + 1}` }),
        });
        if (res.ok) added++;
      } catch { /* ignore */ }
    }
    setSavingKeys(false);
    setAiKeys(["", "", "", "", "", ""]);
    await fetchPool();
    toast({
      title: `${added} key${added !== 1 ? "s" : ""} saved`,
      description: "AI Engine keys added to pool and ready to use.",
    });
  };

  const handleRemoveKey = async (idx: number) => {
    try {
      await fetch(`${BASE}/api/repos/admin/gemini-keys/${idx}`, { method: "DELETE" });
      await fetchPool();
      toast({ title: "Key removed from pool" });
    } catch {
      toast({ title: "Failed to remove key", variant: "destructive" });
    }
  };

  const toggleShowKey = (i: number) => {
    setShowAiKey(prev => prev.map((v, idx) => idx === i ? !v : v));
  };

  return (
    <Layout>
      <div className="p-6 max-w-2xl mx-auto space-y-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="text-sm text-muted-foreground mt-1">Configure API credentials and preferences</p>
        </div>

        {/* ── AI Engine Pool ─────────────────────────────────────────── */}
        <div className="border rounded-lg bg-card">
          <div className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-yellow-500" />
                <h2 className="text-sm font-medium">AI Engine Pool</h2>
                <Badge variant="outline" className={`text-xs ${poolReady > 0 ? "text-green-600 border-green-200" : "text-muted-foreground"}`}>
                  {poolReady}/{aiPool.length} ready
                </Badge>
              </div>
              <Button variant="ghost" size="icon" onClick={fetchPool} disabled={loadingPool} title="Refresh pool">
                <RefreshCw className={`h-3.5 w-3.5 ${loadingPool ? "animate-spin" : ""}`} />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Add up to 6 AI Engine keys to power Buddy AI. Keys rotate automatically when one hits rate limits.
            </p>

            {/* Active pool */}
            {aiPool.length > 0 && (
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Active Keys</Label>
                {aiPool.map((k) => (
                  <div key={k.id} className="flex items-center gap-2 text-xs bg-muted/40 rounded px-3 py-2">
                    <span className="w-2 h-2 rounded-full flex-shrink-0 bg-green-500" />
                    <span className="font-mono text-muted-foreground flex-1 truncate">{k.label}</span>
                    <span className="text-muted-foreground">used {k.useCount}×</span>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleRemoveKey(k.id)} title="Remove key">
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {/* Add new keys */}
            {aiPool.length < 6 && (
              <div className="space-y-2 pt-2">
                <Label className="text-xs text-muted-foreground">Add Keys ({6 - aiPool.length} slots remaining)</Label>
                {aiKeys.slice(0, Math.max(1, 6 - aiPool.length)).map((k, i) => (
                  <div key={i} className="flex gap-2">
                    <div className="relative flex-1">
                      <Input
                        type={showAiKey[i] ? "text" : "password"}
                        value={k}
                        onChange={e => setAiKeys(prev => prev.map((v, idx) => idx === i ? e.target.value : v))}
                        placeholder={`AI Engine Key ${aiPool.length + i + 1}`}
                        className="pr-10 font-mono text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => toggleShowKey(i)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showAiKey[i] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                ))}
                <Button onClick={handleSaveAiKeys} disabled={savingKeys} size="sm" className="gap-2 mt-1">
                  <Plus className="h-3.5 w-3.5" />
                  {savingKeys ? "Saving..." : "Add to Pool"}
                </Button>
              </div>
            )}

            {aiPool.length >= 6 && (
              <p className="text-xs text-green-600 font-medium">Pool full — 6/6 keys active.</p>
            )}
          </div>
        </div>

        {/* ── Auth credentials ─────────────────────────────────────────── */}
        <div className="border rounded-lg bg-card divide-y">
          <div className="p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Key className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-medium">RepoScope API Key</h2>
              {getApiKey() && (
                <Badge variant="outline" className="text-xs gap-1 text-green-600 border-green-200">
                  <Check className="h-3 w-3" /> Active
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Required only if the server has REPOSCOPE_API_KEY set. Leave blank otherwise.
            </p>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  type={showApiKey ? "text" : "password"}
                  value={apiKey}
                  onChange={e => setApiKeyState(e.target.value)}
                  placeholder="Enter your RepoScope API key"
                  className="pr-10 font-mono text-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {getApiKey() && (
                <Button variant="ghost" size="icon" onClick={() => { setApiKey(null); setApiKeyState(""); toast({ title: "API key cleared" }); }} title="Clear">
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>

          <div className="p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Github className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-medium">GitHub Personal Access Token</h2>
              {githubToken && (
                <Badge variant="outline" className="text-xs gap-1 text-green-600 border-green-200">
                  <Check className="h-3 w-3" /> Active
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Increases GitHub API rate limits and enables private repository access.
            </p>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  type={showGithubToken ? "text" : "password"}
                  value={githubToken}
                  onChange={e => setGithubToken(e.target.value)}
                  placeholder="ghp_..."
                  className="pr-10 font-mono text-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowGithubToken(!showGithubToken)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showGithubToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {githubToken && (
                <Button variant="ghost" size="icon" onClick={() => { localStorage.removeItem("reposcope_github_token"); setGithubToken(""); toast({ title: "GitHub token cleared" }); }} title="Clear">
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </div>

        <Button onClick={handleSave} className="gap-2">
          {saved ? <Check className="h-4 w-4" /> : <Key className="h-4 w-4" />}
          {saved ? "Saved!" : "Save Settings"}
        </Button>

        <div className="border rounded-lg p-4 bg-muted/50 space-y-2">
          <h3 className="text-xs font-medium">Buddy AI Engine Tiers</h3>
          <div className="text-xs text-muted-foreground space-y-1">
            <p>⚡ <strong>Primary Engine</strong> — Runtime AI (chat, analyze, compare) — up to 6 keys rotate automatically</p>
            <p>🔄 <strong>Fallback Engine</strong> — Secondary routing when primary is rate-limited</p>
            <p>🔵 <strong>Synthesis Engine</strong> — Code synthesis &amp; deep editing features</p>
          </div>
        </div>
      </div>
    </Layout>
  );
}
