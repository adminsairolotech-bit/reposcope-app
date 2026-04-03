import { Badge } from "@/components/ui/badge";
import { Star, GitFork, AlertCircle, Globe, Lock } from "lucide-react";

interface RepoInfo {
  id: number;
  name: string;
  fullName: string;
  description?: string;
  stars: number;
  forks: number;
  openIssues: number;
  watchers?: number;
  language?: string;
  topics?: string[];
  license?: string;
  isArchived?: boolean;
  isPrivate?: boolean;
  ownerAvatarUrl?: string;
  ownerLogin?: string;
  updatedAt?: string;
}

function fmt(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return String(n);
}

export function RepoCard({ repo }: { repo: RepoInfo }) {
  return (
    <div className="border rounded-lg p-4 bg-card flex flex-col gap-3 hover:border-primary/50 transition-colors" data-testid={`repo-card-${repo.id}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {repo.ownerAvatarUrl && (
            <img src={repo.ownerAvatarUrl} alt={repo.ownerLogin} className="h-5 w-5 rounded-full shrink-0" />
          )}
          <a
            href={`https://github.com/${repo.fullName}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium hover:underline truncate"
            data-testid={`repo-link-${repo.id}`}
          >
            {repo.fullName}
          </a>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {repo.isPrivate ? (
            <Badge variant="secondary" className="text-xs gap-1"><Lock className="h-3 w-3" />Private</Badge>
          ) : (
            <Badge variant="outline" className="text-xs gap-1"><Globe className="h-3 w-3" />Public</Badge>
          )}
          {repo.isArchived && <Badge variant="secondary" className="text-xs">Archived</Badge>}
        </div>
      </div>
      {repo.description && (
        <p className="text-xs text-muted-foreground line-clamp-2">{repo.description}</p>
      )}
      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
        <span className="flex items-center gap-1" data-testid={`repo-stars-${repo.id}`}>
          <Star className="h-3.5 w-3.5 text-yellow-500" />{fmt(repo.stars)}
        </span>
        <span className="flex items-center gap-1" data-testid={`repo-forks-${repo.id}`}>
          <GitFork className="h-3.5 w-3.5" />{fmt(repo.forks)}
        </span>
        <span className="flex items-center gap-1" data-testid={`repo-issues-${repo.id}`}>
          <AlertCircle className="h-3.5 w-3.5" />{fmt(repo.openIssues)}
        </span>
        {repo.language && (
          <span className="font-medium text-foreground">{repo.language}</span>
        )}
      </div>
      {repo.topics && repo.topics.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {repo.topics.slice(0, 4).map(t => (
            <Badge key={t} variant="secondary" className="text-[10px] px-1.5 py-0">{t}</Badge>
          ))}
        </div>
      )}
    </div>
  );
}
