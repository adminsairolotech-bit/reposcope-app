import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { GitCompare, Home, Activity, History, BookOpen, Settings, Github, Archive, Brain } from "lucide-react";
import { AiChat } from "@/components/ai-chat";

const navItems = [
  { href: "/", label: "Dashboard", icon: Home },
  { href: "/compare", label: "Compare", icon: GitCompare },
  { href: "/events", label: "Events", icon: Activity },
  { href: "/history", label: "History", icon: History },
  { href: "/skills", label: "Skills", icon: BookOpen },
  { href: "/deep-archive", label: "Deep Archive", icon: Archive },
  { href: "/train-buddy", label: "Train Buddy", icon: Brain },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  return (
    <div className="min-h-screen flex bg-background">
      <aside className="w-56 border-r flex flex-col shrink-0">
        <div className="p-4 border-b flex items-center gap-2">
          <div className="h-7 w-7 rounded-md bg-primary flex items-center justify-center">
            <Github className="h-4 w-4 text-primary-foreground" />
          </div>
          <span className="font-semibold text-sm tracking-tight">RepoScope</span>
        </div>
        <nav className="flex-1 p-2 flex flex-col gap-0.5">
          {navItems.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors",
                location === href
                  ? "bg-primary text-primary-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent"
              )}
              data-testid={`nav-${label.toLowerCase()}`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </Link>
          ))}
        </nav>
        <div className="p-3 border-t">
          <p className="text-[10px] text-muted-foreground">RepoScope v1.0</p>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">
        {children}
      </main>
      <AiChat />
    </div>
  );
}
