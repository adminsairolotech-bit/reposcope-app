import React, { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Loader2, MessageSquare, Send, X, Copy, Check, Eye, Globe, Github,
  Zap, Brain, ChevronDown, ChevronUp, Maximize2, Users, FlaskConical,
  Code2, Search, Cpu, CheckCircle2, Circle
} from "lucide-react";
import { getApiKey } from "@workspace/api-client-react";

type ToolName = "web_fetch" | "github_search" | "artifact_hint" | null;

type AgentName = "orchestrator" | "research" | "code" | "web" | "synthesis";
type AgentStatus = "idle" | "planning" | "running" | "done";

interface AgentState {
  name: AgentName;
  status: AgentStatus;
  preview?: string;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  tool?: ToolName;
  isStreaming?: boolean;
  multiAgent?: boolean;
}

// ── Code block parser ──────────────────────────────────────────────────────────
function parseCodeBlocks(text: string): Array<{ type: "text" | "code"; content: string; lang?: string }> {
  const parts: Array<{ type: "text" | "code"; content: string; lang?: string }> = [];
  const regex = /```(\w*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: "text", content: text.slice(lastIndex, match.index) });
    }
    parts.push({ type: "code", lang: match[1] || "text", content: match[2] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push({ type: "text", content: text.slice(lastIndex) });
  }
  return parts;
}

// ── Inline markdown ─────────────────────────────────────────────────────────────
function renderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const re = /(\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(<span key={key++}>{text.slice(last, m.index)}</span>);
    if (m[2]) parts.push(<strong key={key++}>{m[2]}</strong>);
    else if (m[3]) parts.push(<em key={key++}>{m[3]}</em>);
    else if (m[4]) parts.push(<code key={key++} className="bg-muted px-1 py-0.5 rounded text-xs font-mono">{m[4]}</code>);
    else if (m[5]) parts.push(<a key={key++} href={m[6]} target="_blank" rel="noreferrer" className="text-blue-400 underline">{m[5]}</a>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(<span key={key++}>{text.slice(last)}</span>);
  return parts;
}

// ── Text renderer ─────────────────────────────────────────────────────────────
function TextRenderer({ text }: { text: string }) {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let listItems: string[] = [];
  let numItems: string[] = [];
  let listKey = 0;

  const flushList = () => {
    if (listItems.length) {
      elements.push(
        <ul key={`ul-${listKey++}`} className="list-disc list-inside my-1 space-y-0.5">
          {listItems.map((li, i) => <li key={i} className="text-sm">{renderInline(li)}</li>)}
        </ul>
      );
      listItems = [];
    }
    if (numItems.length) {
      elements.push(
        <ol key={`ol-${listKey++}`} className="list-decimal list-inside my-1 space-y-0.5">
          {numItems.map((li, i) => <li key={i} className="text-sm">{renderInline(li)}</li>)}
        </ol>
      );
      numItems = [];
    }
  };

  lines.forEach((line, i) => {
    if (/^#{1,3}\s/.test(line)) {
      flushList();
      const level = (line.match(/^(#{1,3})/) ?? ["#"])[0].length;
      const content = line.replace(/^#{1,3}\s/, "");
      const cls = level === 1 ? "text-base font-bold mt-3 mb-1" : level === 2 ? "text-sm font-semibold mt-2 mb-0.5" : "text-sm font-medium mt-1";
      elements.push(<div key={i} className={cls}>{renderInline(content)}</div>);
    } else if (/^[-*•]\s/.test(line)) {
      numItems.length && flushList();
      listItems.push(line.replace(/^[-*•]\s/, ""));
    } else if (/^\d+\.\s/.test(line)) {
      listItems.length && flushList();
      numItems.push(line.replace(/^\d+\.\s/, ""));
    } else if (line.trim() === "") {
      flushList();
      elements.push(<div key={i} className="h-1" />);
    } else {
      flushList();
      elements.push(<p key={i} className="text-sm leading-relaxed">{renderInline(line)}</p>);
    }
  });
  flushList();
  return <div className="space-y-0.5">{elements}</div>;
}

// ── Code block ─────────────────────────────────────────────────────────────────
function CodeBlock({ lang, code, onPreview }: { lang: string; code: string; onPreview?: () => void }) {
  const [copied, setCopied] = useState(false);
  const isHtml = lang === "html" || lang === "htm";
  const copy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="my-2 rounded-lg overflow-hidden border border-border/50">
      <div className="flex items-center justify-between px-3 py-1.5 bg-muted/80 text-xs text-muted-foreground">
        <span className="font-mono font-medium text-blue-400">{lang || "code"}</span>
        <div className="flex gap-1.5">
          {isHtml && onPreview && (
            <button onClick={onPreview} className="flex items-center gap-1 hover:text-green-400 transition-colors">
              <Eye className="h-3 w-3" /> Preview
            </button>
          )}
          <button onClick={copy} className="flex items-center gap-1 hover:text-foreground transition-colors">
            {copied ? <Check className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3" />}
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      </div>
      <pre className="p-3 bg-black/40 overflow-x-auto text-xs font-mono text-green-300 leading-relaxed max-h-64">
        {code}
      </pre>
    </div>
  );
}

// ── Tool badge ─────────────────────────────────────────────────────────────────
function ToolBadge({ tool }: { tool: ToolName }) {
  if (!tool) return null;
  const config: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
    web_fetch:     { icon: <Globe className="h-3 w-3" />,   label: "Fetching web",      color: "text-blue-400" },
    github_search: { icon: <Github className="h-3 w-3" />,  label: "Searching GitHub",  color: "text-purple-400" },
    artifact_hint: { icon: <Zap className="h-3 w-3" />,     label: "Artifact mode",     color: "text-yellow-400" },
  };
  const c = config[tool];
  if (!c) return null;
  return (
    <div className={`inline-flex items-center gap-1 text-xs ${c.color} opacity-75 mb-1`}>
      {c.icon} <span>{c.label}...</span>
    </div>
  );
}

// ── Multi-Agent Status Panel ───────────────────────────────────────────────────
const AGENT_CONFIG: Record<AgentName, { icon: React.ReactNode; label: string; color: string }> = {
  orchestrator: { icon: <Cpu className="h-3 w-3" />,         label: "Orchestrator",  color: "text-orange-400" },
  research:     { icon: <FlaskConical className="h-3 w-3" />, label: "Research",      color: "text-violet-400" },
  code:         { icon: <Code2 className="h-3 w-3" />,        label: "Code",          color: "text-cyan-400" },
  web:          { icon: <Globe className="h-3 w-3" />,        label: "Web",           color: "text-blue-400" },
  synthesis:    { icon: <Brain className="h-3 w-3" />,        label: "Synthesis",     color: "text-green-400" },
};

function AgentStatusPanel({ agents }: { agents: AgentState[] }) {
  if (agents.length === 0) return null;
  return (
    <div className="flex flex-col gap-1 p-2 rounded-lg bg-black/30 border border-border/30 mb-2">
      <div className="text-[10px] text-muted-foreground font-medium mb-0.5 flex items-center gap-1">
        <Users className="h-3 w-3 text-violet-400" /> Multi-Agent Team
      </div>
      {agents.map(agent => {
        const cfg = AGENT_CONFIG[agent.name];
        return (
          <div key={agent.name} className={`flex items-center gap-1.5 text-xs ${cfg.color}`}>
            {agent.status === "done"
              ? <CheckCircle2 className="h-3 w-3 text-green-400 shrink-0" />
              : agent.status === "running" || agent.status === "planning"
              ? <Loader2 className="h-3 w-3 animate-spin shrink-0" />
              : <Circle className="h-3 w-3 opacity-30 shrink-0" />
            }
            {cfg.icon}
            <span className="font-medium">{cfg.label}</span>
            <span className="text-muted-foreground text-[10px]">
              {agent.status === "planning" ? "planning..." :
               agent.status === "running" ? "working..." :
               agent.status === "done" ? "✓ done" : "waiting"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Message renderer ───────────────────────────────────────────────────────────
function MessageRenderer({ msg, onPreviewHtml }: { msg: Message; onPreviewHtml: (html: string) => void }) {
  const parts = parseCodeBlocks(msg.content);
  return (
    <div className="flex flex-col gap-0.5">
      {msg.tool && <ToolBadge tool={msg.tool} />}
      {msg.multiAgent && (
        <div className="inline-flex items-center gap-1 text-[10px] text-violet-400 opacity-75 mb-1">
          <Users className="h-3 w-3" /> <span>Multi-Agent Response</span>
        </div>
      )}
      {parts.map((part, i) =>
        part.type === "code" ? (
          <CodeBlock
            key={i}
            lang={part.lang ?? ""}
            code={part.content}
            onPreview={
              (part.lang === "html" || part.lang === "htm")
                ? () => onPreviewHtml(part.content)
                : undefined
            }
          />
        ) : (
          <TextRenderer key={i} text={part.content} />
        )
      )}
      {msg.isStreaming && <span className="inline-block w-1.5 h-3.5 bg-current animate-pulse ml-0.5 align-middle" />}
    </div>
  );
}

// ── HTML Preview Modal ─────────────────────────────────────────────────────────
function HtmlPreviewModal({ html, onClose }: { html: string; onClose: () => void }) {
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return (
    <div className="fixed inset-0 bg-black/70 z-[100] flex items-center justify-center p-4">
      <div className="bg-background rounded-xl border shadow-2xl w-full max-w-3xl h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-2 border-b">
          <span className="text-sm font-medium flex items-center gap-2">
            <Eye className="h-4 w-4 text-green-400" /> HTML Preview
          </span>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <iframe src={url} className="flex-1 rounded-b-xl" sandbox="allow-scripts" title="Artifact Preview" />
      </div>
    </div>
  );
}

// ── Thinking indicator ─────────────────────────────────────────────────────────
function ThinkingIndicator({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
      <Brain className="h-3.5 w-3.5 text-violet-400 animate-pulse" />
      <span>Buddy is thinking...</span>
    </div>
  );
}

// ── Main AiChat component ──────────────────────────────────────────────────────
export function AiChat() {
  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [multiAgentMode, setMultiAgentMode] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [liveAgents, setLiveAgents] = useState<AgentState[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  // ── Single-Agent submit ──────────────────────────────────────────────────────
  const submitSingleAgent = async (newMessages: Message[]) => {
    const token = getApiKey() || undefined;
    const response = await fetch("/api/repos/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        messages: newMessages.map(m => ({ role: m.role, content: m.content })),
      }),
    });
    if (!response.ok || !response.body) throw new Error("Request failed");

    const assistantIdx = newMessages.length;
    setMessages(prev => [...prev, { role: "assistant", content: "", isStreaming: true }]);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    let detectedTool: ToolName = null;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const payload = JSON.parse(line.slice(6));
          if (payload.tool) {
            detectedTool = payload.tool as ToolName;
            setIsThinking(false);
            setMessages(prev => {
              const updated = [...prev];
              if (updated[assistantIdx]) updated[assistantIdx] = { ...updated[assistantIdx], tool: detectedTool };
              return updated;
            });
          } else if (payload.delta) {
            setIsThinking(false);
            text += payload.delta;
            setMessages(prev => {
              const updated = [...prev];
              if (updated[assistantIdx]) updated[assistantIdx] = { ...updated[assistantIdx], content: text, isStreaming: true };
              return updated;
            });
          } else if (payload.done || payload.error) {
            setMessages(prev => {
              const updated = [...prev];
              if (updated[assistantIdx]) updated[assistantIdx] = { ...updated[assistantIdx], isStreaming: false };
              return updated;
            });
          }
        } catch { /* skip malformed */ }
      }
    }
  };

  // ── Multi-Agent submit ───────────────────────────────────────────────────────
  const submitMultiAgent = async (newMessages: Message[]) => {
    const token = getApiKey() || undefined;
    const response = await fetch("/api/repos/chat-multi-agent", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        messages: newMessages.map(m => ({ role: m.role, content: m.content })),
      }),
    });
    if (!response.ok || !response.body) throw new Error("Multi-agent request failed");

    const assistantIdx = newMessages.length;
    setMessages(prev => [...prev, { role: "assistant", content: "", isStreaming: true, multiAgent: true }]);

    // Init agent states
    const initAgents: AgentState[] = [
      { name: "orchestrator", status: "idle" },
      { name: "research", status: "idle" },
      { name: "code", status: "idle" },
      { name: "web", status: "idle" },
      { name: "synthesis", status: "idle" },
    ];
    setLiveAgents(initAgents);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const payload = JSON.parse(line.slice(6));

          if (payload.agent) {
            // Update agent status
            setIsThinking(false);
            setLiveAgents(prev => prev.map(a =>
              a.name === payload.agent
                ? { ...a, status: payload.status as AgentStatus, preview: payload.preview }
                : a
            ));
          } else if (payload.delta) {
            setIsThinking(false);
            text += payload.delta;
            setMessages(prev => {
              const updated = [...prev];
              if (updated[assistantIdx]) {
                updated[assistantIdx] = { ...updated[assistantIdx], content: text, isStreaming: true };
              }
              return updated;
            });
          } else if (payload.done || payload.error) {
            setMessages(prev => {
              const updated = [...prev];
              if (updated[assistantIdx]) {
                updated[assistantIdx] = { ...updated[assistantIdx], isStreaming: false };
              }
              return updated;
            });
            setLiveAgents([]);
          }
        } catch { /* skip malformed */ }
      }
    }
  };

  // ── Main submit handler ──────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput("");
    const newMessages: Message[] = [...messages, { role: "user", content: userMessage }];
    setMessages(newMessages);
    setIsLoading(true);
    setIsThinking(true);
    setLiveAgents([]);

    try {
      if (multiAgentMode) {
        await submitMultiAgent(newMessages);
      } else {
        await submitSingleAgent(newMessages);
      }
    } catch (err) {
      console.error(err);
      setMessages(prev => [
        ...prev,
        { role: "assistant", content: "**Error**: Could not reach Buddy AI. Add Gemini keys in Settings." },
      ]);
      setLiveAgents([]);
    } finally {
      setIsLoading(false);
      setIsThinking(false);
    }
  };

  const chatWidth = isExpanded ? "w-[720px]" : "w-[440px]";
  const chatHeight = isExpanded ? "h-[90vh]" : "h-[640px]";

  if (!isOpen) {
    return (
      <Button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 h-14 w-14 rounded-full shadow-xl bg-gradient-to-br from-violet-600 to-blue-600 hover:from-violet-500 hover:to-blue-500"
        size="icon"
      >
        <Brain className="h-6 w-6" />
      </Button>
    );
  }

  return (
    <>
      {previewHtml && (
        <HtmlPreviewModal html={previewHtml} onClose={() => setPreviewHtml(null)} />
      )}
      <Card className={`fixed bottom-6 right-6 ${chatWidth} ${chatHeight} flex flex-col shadow-2xl z-50 transition-all duration-200 border-violet-500/20`}>
        {/* ── Header ── */}
        <CardHeader className="flex flex-row items-center justify-between py-2.5 px-4 border-b bg-gradient-to-r from-violet-950/50 to-blue-950/50 rounded-t-xl shrink-0">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Brain className="h-4 w-4 text-violet-400" />
            <span className="bg-gradient-to-r from-violet-400 to-blue-400 bg-clip-text text-transparent">
              Buddy AI
            </span>
            <span className="text-[10px] font-normal text-muted-foreground bg-violet-500/10 px-1.5 py-0.5 rounded">
              {multiAgentMode ? "Multi-Agent" : "GOD LEVEL"}
            </span>
          </CardTitle>
          <div className="flex items-center gap-1.5">
            {/* Multi-Agent Toggle */}
            <button
              onClick={() => setMultiAgentMode(m => !m)}
              title={multiAgentMode ? "Switch to Single Agent" : "Switch to Multi-Agent Mode"}
              className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded-md border transition-all ${
                multiAgentMode
                  ? "border-violet-500/60 bg-violet-500/20 text-violet-300"
                  : "border-border/40 bg-muted/30 text-muted-foreground hover:text-foreground hover:border-violet-500/30"
              }`}
            >
              <Users className="h-3 w-3" />
              {multiAgentMode ? "Multi" : "Single"}
            </button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-foreground"
              onClick={() => setIsExpanded(e => !e)}
              title={isExpanded ? "Shrink" : "Expand"}
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setIsOpen(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>

        {/* ── Messages ── */}
        <CardContent className="flex-1 p-0 overflow-hidden">
          <ScrollArea className="h-full p-4">
            <div className="flex flex-col gap-4">
              {messages.length === 0 ? (
                <div className="text-center mt-8 space-y-3">
                  <Brain className="h-10 w-10 text-violet-400 mx-auto opacity-60" />
                  <p className="text-sm text-muted-foreground">
                    Buddy AI — 3,500+ knowledge chunks • 14 repos
                  </p>
                  {multiAgentMode && (
                    <div className="flex items-center justify-center gap-1.5 text-xs text-violet-400">
                      <Users className="h-3.5 w-3.5" />
                      <span>Multi-Agent Mode: Research + Code + Web agents in parallel</span>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2 mt-4">
                    {[
                      "Explain Claude hooks system",
                      "Write a React component",
                      "Search GitHub repos for AI agents",
                      "Create an HTML dashboard",
                    ].map(q => (
                      <button
                        key={q}
                        onClick={() => setInput(q)}
                        className="text-left text-xs p-2.5 rounded-lg border border-border/50 hover:border-violet-500/50 hover:bg-violet-500/5 transition-colors text-muted-foreground hover:text-foreground"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                messages.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[92%] rounded-xl px-3 py-2.5 text-sm ${
                        msg.role === "user"
                          ? "bg-gradient-to-br from-violet-600 to-blue-600 text-white"
                          : "bg-muted/60 text-foreground border border-border/30"
                      }`}
                    >
                      {msg.role === "assistant" && msg.content === "" && !isThinking ? (
                        <Loader2 className="h-4 w-4 animate-spin text-violet-400" />
                      ) : msg.role === "assistant" ? (
                        <MessageRenderer msg={msg} onPreviewHtml={setPreviewHtml} />
                      ) : (
                        <span>{msg.content}</span>
                      )}
                    </div>
                  </div>
                ))
              )}

              {/* Live agent status (during multi-agent processing) */}
              {liveAgents.length > 0 && (
                <div className="flex justify-start">
                  <div className="max-w-[92%] w-full">
                    <AgentStatusPanel agents={liveAgents} />
                  </div>
                </div>
              )}

              <ThinkingIndicator active={isThinking} />
              <div ref={messagesEndRef} />
            </div>
          </ScrollArea>
        </CardContent>

        {/* ── Footer ── */}
        <CardFooter className="p-3 border-t bg-muted/20 shrink-0">
          {multiAgentMode && (
            <div className="w-full mb-2 flex items-center gap-2 text-[10px] text-muted-foreground">
              <div className="flex items-center gap-1 text-violet-400">
                <FlaskConical className="h-3 w-3" /> Research
              </div>
              <span>+</span>
              <div className="flex items-center gap-1 text-cyan-400">
                <Code2 className="h-3 w-3" /> Code
              </div>
              <span>+</span>
              <div className="flex items-center gap-1 text-blue-400">
                <Globe className="h-3 w-3" /> Web
              </div>
              <span className="ml-auto text-[9px]">agents run in parallel</span>
            </div>
          )}
          <form onSubmit={handleSubmit} className="flex w-full gap-2">
            <Input
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder={multiAgentMode ? "Ask Buddy (multi-agent)..." : "Ask Buddy anything..."}
              disabled={isLoading}
              className="flex-1 bg-background/50 border-border/50 focus:border-violet-500/50 text-sm"
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e as unknown as React.FormEvent);
                }
              }}
            />
            <Button
              type="submit"
              size="icon"
              disabled={isLoading || !input.trim()}
              className={`shrink-0 ${multiAgentMode
                ? "bg-gradient-to-br from-violet-700 to-cyan-600 hover:from-violet-600 hover:to-cyan-500"
                : "bg-gradient-to-br from-violet-600 to-blue-600 hover:from-violet-500 hover:to-blue-500"
              }`}
            >
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </form>
        </CardFooter>
      </Card>
    </>
  );
}
