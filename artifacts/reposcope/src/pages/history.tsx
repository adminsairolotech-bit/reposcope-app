import { useState } from "react";
import { useGetHistory, useDeleteHistory, getListSkillsQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Layout } from "@/components/layout";
import { Loader2, History, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";

export default function HistoryPage() {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const historyMutation = useGetHistory();
  const deleteMutation = useDeleteHistory();

  const loadHistory = () => {
    historyMutation.mutate({ data: {} });
    setLoaded(true);
  };

  const handleDelete = async (id: string) => {
    await deleteMutation.mutateAsync({ id });
    historyMutation.mutate({ data: {} });
  };

  const records = historyMutation.data?.records ?? [];

  const TYPE_LABELS: Record<string, string> = {
    analyze: "Analysis",
    compare: "Comparison",
    fetch: "Fetch",
    chat: "Chat",
    synthesize: "Synthesize",
    "code-analyze": "Code Analysis",
  };

  return (
    <Layout>
      <div className="p-6 max-w-4xl mx-auto space-y-8">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Analysis History</h1>
            <p className="text-sm text-muted-foreground mt-1">Past analyses, comparisons, and queries</p>
          </div>
          <Button
            size="sm"
            onClick={loadHistory}
            disabled={historyMutation.isPending}
            data-testid="load-history-btn"
          >
            {historyMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            {loaded ? "Refresh" : "Load History"}
          </Button>
        </div>

        {!loaded && (
          <div className="text-center py-16 text-muted-foreground">
            <History className="h-8 w-8 mx-auto mb-3 opacity-30" />
            <p className="text-sm">Click "Load History" to view past analyses</p>
          </div>
        )}

        {loaded && records.length === 0 && !historyMutation.isPending && (
          <div className="text-center py-16 text-muted-foreground">
            <History className="h-8 w-8 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No history yet. Run analyses to see them here.</p>
          </div>
        )}

        {records.length > 0 && (
          <div className="space-y-2" data-testid="history-list">
            {records.map((record: any) => (
              <div
                key={record.id}
                className="border rounded-lg bg-card overflow-hidden"
                data-testid={`history-item-${record.id}`}
              >
                <div
                  className="flex items-center gap-3 p-4 cursor-pointer hover:bg-accent/50 transition-colors"
                  onClick={() => setExpanded(expanded === record.id ? null : record.id)}
                >
                  {expanded === record.id
                    ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                    : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  }
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="secondary" className="text-xs">
                        {TYPE_LABELS[record.type] ?? record.type}
                      </Badge>
                      <span className="text-xs font-mono text-muted-foreground truncate">
                        {record.repos?.slice(0, 3).join(", ")}
                        {record.repos?.length > 3 && ` +${record.repos.length - 3} more`}
                      </span>
                    </div>
                    {record.summary && (
                      <p className="text-xs text-muted-foreground mt-1 truncate">{record.summary}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(record.createdAt), { addSuffix: true })}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={e => { e.stopPropagation(); handleDelete(record.id); }}
                      disabled={deleteMutation.isPending}
                      data-testid={`delete-history-${record.id}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                {expanded === record.id && record.summary && (
                  <div className="px-11 pb-4">
                    <div className="text-xs text-muted-foreground whitespace-pre-wrap border-t pt-3">
                      {record.summary}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
