import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import Compare from "@/pages/compare";
import Events from "@/pages/events";
import HistoryPage from "@/pages/history";
import Skills from "@/pages/skills";
import Settings from "@/pages/settings";
import DeepArchive from "@/pages/deep-archive";
import TrainBuddy from "@/pages/train-buddy";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/compare" component={Compare} />
      <Route path="/events" component={Events} />
      <Route path="/history" component={HistoryPage} />
      <Route path="/skills" component={Skills} />
      <Route path="/settings" component={Settings} />
      <Route path="/deep-archive" component={DeepArchive} />
      <Route path="/train-buddy" component={TrainBuddy} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
