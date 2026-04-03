import { useState } from "react";
import { useGetTrendingRepos, useGetGeminiPoolStatus, useListSkills, useFetchRepos } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { RepoCard } from "@/components/repo-card";
import { Layout } from "@/components/layout";
import { Loader2, Search, TrendingUp, Zap, BookOpen, Plus, X } from "lucide-react";
import { useLocation } from "wouter";

export default function Home() {
  const [, setLocation] = useLocation();
  const [repoInputs, setRepoInputs] = useState<string[]>([""]);
  const [fetchedRepos, setFetchedRepos] = useState<any[]>([]);
  const [fetchErrors, setFetchErrors] = useState<any[]>([]);

  const trendingQuery = useGetTrendingRepos();
  const geminiQuery = useGetGeminiPoolStatus();
  const skillsQuery = useListSkills();
  const fetchMutation = useFetchRepos();

  const handleFetch = async () => {
    const repos = repoInputs.filter(r => r.trim());
    if (!repos.length) return;
    const result = await fetchMutation.mutateAsync({ data: { repos } });
    setFetchedRepos(result.repos ?? []);
    setFetchErrors(result.errors ?? []);
  };

  const addInput = () => setRepoInputs(prev => [...prev, ""]);
  const removeInput = (i: number) => setRepoInputs(prev => prev.filter((_, idx) => idx !== i));
  const updateInput = (i: number, val: string) => setRepoInputs(prev => prev.map((v, idx) => idx === i ? val : v));

  return (
    <Layout>
      <div className="p-6 max-w-6xl mx-auto space-y-8">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
            <p className="text-sm text-muted-foreground mt-1">GitHub repository intelligence at a glance</p>
          </div>
          <div className="flex items-center gap-3">
            {geminiQuery.data && (
              <div className="flex items-center gap-1.5 text-xs border rounded-full px-3 py-1.5" data-testid="gemini-pool-status">
                <Zap className={`h-3 w-3 ${geminiQuery.data.readyKeys > 0 ? "text-green-500" : "text-muted-foreground"}`} />
                <span>{geminiQuery.data.readyKeys}/{geminiQuery.data.totalKeys} Gemini keys ready</span>
              </div>
            )}
            {skillsQuery.data && (
              <div className="flex items-center gap-1.5 text-xs border rounded-full px-3 py-1.5">
                <BookOpen className="h-3 w-3 text-blue-500" />
                <span>{skillsQuery.data.total} skills</span>
              </div>
            )}
          </div>
        </div>

        <div className="border rounded-lg p-5 bg-card space-y-4">
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-medium">Fetch Repositories</h2>
          </div>
          <div className="space-y-2">
            {repoInputs.map((val, i) => (
              <div key={i} className="flex gap-2">
                <Input
                  value={val}
                  onChange={e => updateInput(i, e.target.value)}
                  placeholder="owner/repo or GitHub URL"
                  className="font-mono text-sm"
                  data-testid={`repo-input-${i}`}
                  onKeyDown={e => e.key === "Enter" && handleFetch()}
                />
                {repoInputs.length > 1 && (
                  <Button variant="ghost" size="icon" onClick={() => removeInput(i)} data-testid={`remove-input-${i}`}>
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={addInput} className="gap-1" data-testid="add-repo-input">
              <Plus className="h-3.5 w-3.5" /> Add repo
            </Button>
            <Button
              size="sm"
              onClick={handleFetch}
              disabled={fetchMutation.isPending || !repoInputs.some(r => r.trim())}
              data-testid="fetch-repos-btn"
            >
              {fetchMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Fetch
            </Button>
            {fetchedRepos.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLocation("/compare")}
                data-testid="go-to-compare"
              >
                Compare {fetchedRepos.length} repos
              </Button>
            )}
          </div>
          {fetchErrors.length > 0 && (
            <div className="text-xs text-destructive space-y-1">
              {fetchErrors.map((e: any, i) => (
                <div key={i}>{e.slug}: {e.error}</div>
              ))}
            </div>
          )}
          {fetchedRepos.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
              {fetchedRepos.map((repo: any) => (
                <RepoCard key={repo.id} repo={repo} />
              ))}
            </div>
          )}
        </div>

        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-medium">Trending Repositories</h2>
          </div>
          {trendingQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />Loading trending repos...
            </div>
          ) : (
            <div className="flex flex-wrap gap-2" data-testid="trending-repos">
              {trendingQuery.data?.repos.map((repo) => (
                <button
                  key={repo.slug}
                  onClick={() => {
                    setRepoInputs([repo.slug]);
                    window.scrollTo(0, 0);
                  }}
                  data-testid={`trending-repo-${repo.slug.replace("/", "-")}`}
                  className="text-xs"
                >
                  <Badge variant="outline" className="gap-1 cursor-pointer hover:bg-accent transition-colors py-1">
                    {repo.slug}
                    <span className="text-[10px] text-muted-foreground">{repo.category}</span>
                  </Badge>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
