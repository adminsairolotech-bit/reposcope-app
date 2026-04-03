import { useState } from "react";
import { useGetRepoEvents } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Layout } from "@/components/layout";
import { Loader2, Plus, X, Activity, RefreshCw } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const EVENT_COLORS: Record<string, string> = {
  PushEvent: "bg-blue-500/10 text-blue-600",
  PullRequestEvent: "bg-purple-500/10 text-purple-600",
  IssuesEvent: "bg-red-500/10 text-red-600",
  ForkEvent: "bg-green-500/10 text-green-600",
  WatchEvent: "bg-yellow-500/10 text-yellow-600",
  CreateEvent: "bg-teal-500/10 text-teal-600",
  DeleteEvent: "bg-orange-500/10 text-orange-600",
  ReleaseEvent: "bg-indigo-500/10 text-indigo-600",
};

export default function Events() {
  const [repoInputs, setRepoInputs] = useState<string[]>([""]);
  const eventsMutation = useGetRepoEvents();

  const handleFetch = () => {
    const repos = repoInputs.filter(r => r.trim());
    if (!repos.length) return;
    eventsMutation.mutate({ data: { repos, perPage: 30 } });
  };

  const addInput = () => setRepoInputs(prev => [...prev, ""]);
  const removeInput = (i: number) => setRepoInputs(prev => prev.filter((_, idx) => idx !== i));
  const updateInput = (i: number, val: string) =>
    setRepoInputs(prev => prev.map((v, idx) => idx === i ? val : v));

  const events = eventsMutation.data?.events ?? [];

  return (
    <Layout>
      <div className="p-6 max-w-4xl mx-auto space-y-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Events Feed</h1>
          <p className="text-sm text-muted-foreground mt-1">Real-time GitHub events across your repos</p>
        </div>

        <div className="border rounded-lg p-5 bg-card space-y-4">
          <div className="space-y-2">
            {repoInputs.map((val, i) => (
              <div key={i} className="flex gap-2">
                <Input
                  value={val}
                  onChange={e => updateInput(i, e.target.value)}
                  placeholder="owner/repo"
                  className="font-mono text-sm"
                  data-testid={`events-input-${i}`}
                />
                {repoInputs.length > 1 && (
                  <Button variant="ghost" size="icon" onClick={() => removeInput(i)}>
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={addInput} className="gap-1">
              <Plus className="h-3.5 w-3.5" /> Add repo
            </Button>
            <Button
              size="sm"
              onClick={handleFetch}
              disabled={eventsMutation.isPending}
              data-testid="fetch-events-btn"
              className="gap-1"
            >
              {eventsMutation.isPending
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <Activity className="h-4 w-4" />
              }
              Fetch Events
            </Button>
            {events.length > 0 && (
              <Button variant="outline" size="sm" onClick={handleFetch} className="gap-1">
                <RefreshCw className="h-3.5 w-3.5" /> Refresh
              </Button>
            )}
          </div>
        </div>

        {events.length > 0 && (
          <div className="space-y-3" data-testid="events-list">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-medium">{events.length} events</h2>
            </div>
            <div className="space-y-2">
              {events.map((event: any) => {
                const colorClass = EVENT_COLORS[event.type] ?? "bg-muted text-muted-foreground";
                return (
                  <div
                    key={event.id}
                    className="flex items-start gap-3 p-3 border rounded-lg bg-card"
                    data-testid={`event-${event.id}`}
                  >
                    <div className="shrink-0 mt-0.5">
                      {event.actorAvatar && (
                        <img src={event.actorAvatar} alt={event.actor} className="h-7 w-7 rounded-full" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-medium">{event.actor}</span>
                        <Badge className={`text-[10px] px-1.5 py-0 rounded-sm font-normal ${colorClass}`}>
                          {event.type?.replace("Event", "")}
                        </Badge>
                        <span className="text-xs text-muted-foreground">{event.repo}</span>
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        {formatDistanceToNow(new Date(event.createdAt), { addSuffix: true })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {events.length === 0 && !eventsMutation.isPending && eventsMutation.isSuccess && (
          <div className="text-center py-12 text-sm text-muted-foreground">
            No events found for the specified repositories.
          </div>
        )}

        {!eventsMutation.isSuccess && !eventsMutation.isPending && (
          <div className="text-center py-16 text-muted-foreground">
            <Activity className="h-8 w-8 mx-auto mb-3 opacity-30" />
            <p className="text-sm">Enter a repository to see its live event stream</p>
          </div>
        )}
      </div>
    </Layout>
  );
}
