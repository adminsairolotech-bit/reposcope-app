import { useListSkills, useGetSkillsStats } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Layout } from "@/components/layout";
import { Loader2, BookOpen, Search } from "lucide-react";
import { useState } from "react";

const DIFFICULTY_COLORS: Record<string, string> = {
  beginner: "bg-green-500/10 text-green-600",
  intermediate: "bg-yellow-500/10 text-yellow-600",
  advanced: "bg-red-500/10 text-red-600",
};

export default function Skills() {
  const [search, setSearch] = useState("");
  const skillsQuery = useListSkills();
  const statsQuery = useGetSkillsStats();

  const skills = skillsQuery.data?.skills ?? [];
  const filtered = skills.filter(s =>
    !search ||
    s.title?.toLowerCase().includes(search.toLowerCase()) ||
    s.description?.toLowerCase().includes(search.toLowerCase()) ||
    s.category?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Layout>
      <div className="p-6 max-w-5xl mx-auto space-y-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Skills Library</h1>
          <p className="text-sm text-muted-foreground mt-1">Browse and search repository skills and patterns</p>
        </div>

        {statsQuery.data && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="border rounded-lg p-4 bg-card text-center">
              <div className="text-2xl font-bold">{statsQuery.data.total}</div>
              <div className="text-xs text-muted-foreground mt-1">Total Skills</div>
            </div>
            {Object.entries(statsQuery.data.byCategory ?? {}).slice(0, 3).map(([cat, count]) => (
              <div key={cat} className="border rounded-lg p-4 bg-card text-center">
                <div className="text-2xl font-bold">{count as number}</div>
                <div className="text-xs text-muted-foreground mt-1 capitalize">{cat}</div>
              </div>
            ))}
          </div>
        )}

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search skills..."
            className="pl-9"
            data-testid="skills-search"
          />
        </div>

        {skillsQuery.isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />Loading skills...
          </div>
        )}

        {!skillsQuery.isLoading && filtered.length === 0 && (
          <div className="text-center py-16 text-muted-foreground">
            <BookOpen className="h-8 w-8 mx-auto mb-3 opacity-30" />
            <p className="text-sm">
              {search ? "No skills match your search" : "No skills in the library yet"}
            </p>
            {!search && (
              <p className="text-xs mt-2">
                Skills are added by syncing repositories or via the Admin panel
              </p>
            )}
          </div>
        )}

        {filtered.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3" data-testid="skills-list">
            {filtered.map((skill: any) => (
              <div
                key={skill.id}
                className="border rounded-lg p-4 bg-card space-y-2"
                data-testid={`skill-${skill.id}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-medium">{skill.title || skill.name}</h3>
                  {skill.difficulty && (
                    <Badge className={`text-[10px] px-1.5 py-0 shrink-0 ${DIFFICULTY_COLORS[skill.difficulty] ?? "bg-muted text-muted-foreground"}`}>
                      {skill.difficulty}
                    </Badge>
                  )}
                </div>
                {skill.description && (
                  <p className="text-xs text-muted-foreground line-clamp-2">{skill.description}</p>
                )}
                <div className="flex items-center gap-2 flex-wrap">
                  {skill.category && (
                    <Badge variant="outline" className="text-[10px]">{skill.category}</Badge>
                  )}
                  {skill.tags?.slice(0, 3).map((tag: string) => (
                    <Badge key={tag} variant="secondary" className="text-[10px]">{tag}</Badge>
                  ))}
                  {skill.estimatedTime && (
                    <span className="text-[10px] text-muted-foreground">{skill.estimatedTime}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
