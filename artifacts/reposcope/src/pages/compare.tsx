import { useState } from "react";
import { useCompareRepos } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Layout } from "@/components/layout";
import { Loader2, Plus, X, Star, GitFork, AlertCircle, Trophy } from "lucide-react";

function fmt(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return String(n);
}

function ScoreBar({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-14 text-muted-foreground shrink-0">{label}</span>
      <div className="flex-1 bg-muted rounded-full h-1.5 overflow-hidden">
        <div
          className="h-full bg-primary rounded-full transition-all"
          style={{ width: `${Math.min(100, value)}%` }}
        />
      </div>
      <span className="w-8 text-right text-muted-foreground">{Math.round(value)}</span>
    </div>
  );
}

export default function Compare() {
  const [repoInputs, setRepoInputs] = useState<string[]>(["", ""]);
  const compareMutation = useCompareRepos();

  const handleCompare = () => {
    const repos = repoInputs.filter(r => r.trim());
    if (repos.length < 2) return;
    compareMutation.mutate({ data: { repos } });
  };

  const addInput = () => {
    if (repoInputs.length < 50) setRepoInputs(prev => [...prev, ""]);
  };
  const removeInput = (i: number) => {
    if (repoInputs.length > 2) setRepoInputs(prev => prev.filter((_, idx) => idx !== i));
  };
  const updateInput = (i: number, val: string) =>
    setRepoInputs(prev => prev.map((v, idx) => idx === i ? val : v));

  const ranked = compareMutation.data?.ranked ?? [];

  return (
    <Layout>
      <div className="p-6 max-w-5xl mx-auto space-y-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Compare Repositories</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Add up to 50 repos to compare with AI-powered scoring
          </p>
        </div>

        <div className="border rounded-lg p-5 bg-card space-y-4">
          <div className="space-y-2">
            {repoInputs.map((val, i) => (
              <div key={i} className="flex gap-2">
                <div className="flex items-center justify-center w-6 text-xs text-muted-foreground shrink-0">
                  {i + 1}
                </div>
                <Input
                  value={val}
                  onChange={e => updateInput(i, e.target.value)}
                  placeholder="owner/repo"
                  className="font-mono text-sm"
                  data-testid={`compare-input-${i}`}
                />
                {repoInputs.length > 2 && (
                  <Button variant="ghost" size="icon" onClick={() => removeInput(i)}>
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={addInput} disabled={repoInputs.length >= 50} className="gap-1">
              <Plus className="h-3.5 w-3.5" /> Add repo
            </Button>
            <Button
              size="sm"
              onClick={handleCompare}
              disabled={compareMutation.isPending || repoInputs.filter(r => r.trim()).length < 2}
              data-testid="compare-btn"
            >
              {compareMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Compare
            </Button>
          </div>
        </div>

        {compareMutation.isError && (
          <div className="text-sm text-destructive border border-destructive/20 rounded-lg p-4">
            Failed to compare repos. Please check the repository slugs and try again.
          </div>
        )}

        {ranked.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-medium">Results — Ranked by Score</h2>
            <div className="space-y-3">
              {ranked.map((item: any, idx: number) => (
                <div
                  key={item.slug}
                  className="border rounded-lg p-4 bg-card space-y-3"
                  data-testid={`compare-result-${idx}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {idx === 0 && <Trophy className="h-4 w-4 text-yellow-500" />}
                      {idx === 1 && <Trophy className="h-4 w-4 text-gray-400" />}
                      {idx === 2 && <Trophy className="h-4 w-4 text-amber-700" />}
                      {idx > 2 && <span className="text-sm text-muted-foreground w-4 text-center">#{idx + 1}</span>}
                      <a
                        href={`https://github.com/${item.slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-sm hover:underline"
                      >
                        {item.slug}
                      </a>
                      {item.repo?.language && (
                        <Badge variant="secondary" className="text-xs">{item.repo.language}</Badge>
                      )}
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold">{Math.round(item.score)}</div>
                      <div className="text-[10px] text-muted-foreground">score</div>
                    </div>
                  </div>
                  {item.repo?.description && (
                    <p className="text-xs text-muted-foreground">{item.repo.description}</p>
                  )}
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Star className="h-3.5 w-3.5 text-yellow-500" />{fmt(item.repo?.stars ?? 0)}
                    </span>
                    <span className="flex items-center gap-1">
                      <GitFork className="h-3.5 w-3.5" />{fmt(item.repo?.forks ?? 0)}
                    </span>
                    <span className="flex items-center gap-1">
                      <AlertCircle className="h-3.5 w-3.5" />{fmt(item.repo?.openIssues ?? 0)} issues
                    </span>
                  </div>
                  {item.breakdown && (
                    <div className="space-y-1 pt-1">
                      <ScoreBar value={item.breakdown.stars} label="Stars" />
                      <ScoreBar value={item.breakdown.forks} label="Forks" />
                      <ScoreBar value={item.breakdown.issues} label="Issues" />
                      <ScoreBar value={item.breakdown.recency} label="Recency" />
                      <ScoreBar value={item.breakdown.size} label="Size" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {ranked.length === 0 && !compareMutation.isPending && compareMutation.isSuccess && (
          <div className="text-center py-12 text-sm text-muted-foreground">
            No results found. Check that all repository slugs are valid.
          </div>
        )}
      </div>
    </Layout>
  );
}
