import { useState, useRef } from "react";
import { Layout } from "../components/layout";

const API = import.meta.env.BASE_URL + "api";

type Track = "internal" | "alpha" | "beta" | "production";
type JobStatus = "pending" | "signing" | "uploading" | "completing" | "done" | "error";

interface UploadJob {
  jobId: string;
  status: JobStatus;
  progress: number;
  logs: string[];
  error?: string;
  result?: { versionCode?: number; track?: string; releaseNotes?: string };
  elapsedMs: number;
}

const STATUS_LABELS: Record<JobStatus, string> = {
  pending: "⏳ Taiyar ho raha hai...",
  signing: "🔏 APK Sign ho rahi hai...",
  uploading: "⬆️ Play Store pe Upload ho raha hai...",
  completing: "✅ Track assign ho raha hai...",
  done: "🎉 PUBLISHED!",
  error: "❌ Error",
};

const STATUS_COLORS: Record<JobStatus, string> = {
  pending: "text-yellow-400",
  signing: "text-blue-400",
  uploading: "text-purple-400",
  completing: "text-cyan-400",
  done: "text-green-400",
  error: "text-red-400",
};

export default function PlayStorePage() {
  const [file, setFile] = useState<File | null>(null);
  const [packageName, setPackageName] = useState("");
  const [track, setTrack] = useState<Track>("internal");
  const [releaseNotes, setReleaseNotes] = useState("");
  const [autoNotes, setAutoNotes] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [job, setJob] = useState<UploadJob | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const handleFile = (f: File) => {
    if (!f.name.endsWith(".apk") && !f.name.endsWith(".aab")) {
      alert("Sirf .apk ya .aab file allowed hai!");
      return;
    }
    setFile(f);
  };

  const startPoll = (jobId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      const res = await fetch(`${API}/playstore/status/${jobId}`);
      const data: UploadJob = await res.json();
      setJob(data);
      if (data.status === "done" || data.status === "error") {
        clearInterval(pollRef.current!);
        setUploading(false);
      }
    }, 2000);
  };

  const handleUpload = async () => {
    if (!file || !packageName.trim()) return;
    setUploading(true);
    setJob(null);

    const form = new FormData();
    form.append("file", file);
    form.append("packageName", packageName.trim());
    form.append("track", track);
    form.append("releaseNotes", releaseNotes);

    try {
      const res = await fetch(`${API}/playstore/upload`, { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      setJob({ jobId: data.jobId, status: "pending", progress: 0, logs: [], elapsedMs: 0 });
      startPoll(data.jobId);
    } catch (e: any) {
      setUploading(false);
      alert("Error: " + e.message);
    }
  };

  const reset = () => {
    setFile(null); setJob(null); setUploading(false);
    if (pollRef.current) clearInterval(pollRef.current);
  };

  return (
    <Layout>
      <div className="max-w-2xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-4xl">🤖</span>
            <div>
              <h1 className="text-2xl font-bold text-white">Play Store Agent</h1>
              <p className="text-gray-400 text-sm">Auto upload APK/AAB to Google Play Store</p>
            </div>
          </div>
          <div className="flex gap-2 mt-3 text-xs">
            <span className="bg-green-900/50 text-green-400 px-2 py-1 rounded border border-green-800">✅ Service Account Ready</span>
            <span className="bg-blue-900/50 text-blue-400 px-2 py-1 rounded border border-blue-800">🔏 Keystore Ready</span>
          </div>
        </div>

        {/* Upload Form */}
        {!job && (
          <div className="space-y-5">
            {/* File Drop Zone */}
            <div
              className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
                dragOver ? "border-purple-400 bg-purple-900/20" :
                file ? "border-green-500 bg-green-900/10" : "border-gray-600 hover:border-gray-400"
              }`}
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
            >
              <input
                ref={fileRef} type="file" accept=".apk,.aab" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
              />
              {file ? (
                <div>
                  <div className="text-4xl mb-2">📦</div>
                  <div className="text-green-400 font-medium">{file.name}</div>
                  <div className="text-gray-500 text-sm mt-1">{(file.size / 1024 / 1024).toFixed(1)} MB</div>
                  <button onClick={(e) => { e.stopPropagation(); setFile(null); }} className="mt-2 text-xs text-red-400 hover:text-red-300">Remove</button>
                </div>
              ) : (
                <div>
                  <div className="text-4xl mb-2">📲</div>
                  <div className="text-gray-300 font-medium">APK ya AAB file yahan drop karo</div>
                  <div className="text-gray-500 text-sm mt-1">Ya click karke select karo</div>
                </div>
              )}
            </div>

            {/* Package Name */}
            <div>
              <label className="block text-sm text-gray-400 mb-1.5">App Package Name *</label>
              <input
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:border-purple-500"
                placeholder="com.amazingwebdesign.sairolotech"
                value={packageName}
                onChange={(e) => setPackageName(e.target.value)}
              />
              <p className="text-xs text-gray-500 mt-1">Play Console → Dashboard pe milega</p>
            </div>

            {/* Track */}
            <div>
              <label className="block text-sm text-gray-400 mb-1.5">Release Track</label>
              <div className="grid grid-cols-4 gap-2">
                {(["internal", "alpha", "beta", "production"] as Track[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTrack(t)}
                    className={`py-2 rounded-lg text-sm font-medium capitalize transition-all border ${
                      track === t
                        ? t === "production"
                          ? "bg-red-600 border-red-500 text-white"
                          : "bg-purple-600 border-purple-500 text-white"
                        : "bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500"
                    }`}
                  >
                    {t === "internal" ? "🔒 Internal" : t === "alpha" ? "🧪 Alpha" : t === "beta" ? "🔬 Beta" : "🚀 Production"}
                  </button>
                ))}
              </div>
              {track === "production" && (
                <div className="mt-2 bg-red-900/30 border border-red-800 rounded-lg p-3 text-sm text-red-400">
                  ⚠️ Production track pe upload karte waqt sure rehna — sabko visible ho jayega!
                </div>
              )}
            </div>

            {/* Release Notes */}
            <div>
              <label className="block text-sm text-gray-400 mb-1.5">Release Notes (optional)</label>
              <textarea
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:border-purple-500 resize-none"
                rows={3}
                placeholder="Kya naya hai is update mein..."
                value={releaseNotes}
                onChange={(e) => setReleaseNotes(e.target.value)}
                maxLength={500}
              />
              <p className="text-xs text-gray-500 mt-1">{releaseNotes.length}/500 characters</p>
            </div>

            {/* Upload Button */}
            <button
              onClick={handleUpload}
              disabled={!file || !packageName.trim() || uploading}
              className="w-full py-3 rounded-xl font-bold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-base"
            >
              🚀 Play Store pe Upload Karo
            </button>
          </div>
        )}

        {/* Job Progress */}
        {job && (
          <div className="space-y-4">
            {/* Status Header */}
            <div className={`text-center text-2xl font-bold ${STATUS_COLORS[job.status]}`}>
              {STATUS_LABELS[job.status]}
            </div>

            {/* Progress Bar */}
            <div className="bg-gray-800 rounded-full h-3 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  job.status === "done" ? "bg-green-500" :
                  job.status === "error" ? "bg-red-500" :
                  "bg-gradient-to-r from-purple-500 to-blue-500"
                }`}
                style={{ width: `${job.progress}%` }}
              />
            </div>
            <div className="text-center text-sm text-gray-400">{job.progress}%</div>

            {/* Logs */}
            <div className="bg-gray-900 border border-gray-700 rounded-xl p-4 max-h-64 overflow-y-auto font-mono text-xs">
              {job.logs.map((log, i) => (
                <div key={i} className={`py-0.5 ${
                  log.includes("✅") ? "text-green-400" :
                  log.includes("❌") || log.includes("Error") ? "text-red-400" :
                  log.includes("⬆️") || log.includes("🔏") ? "text-blue-400" :
                  log.includes("🎉") ? "text-yellow-400" :
                  "text-gray-300"
                }`}>
                  {log}
                </div>
              ))}
              {(job.status !== "done" && job.status !== "error") && (
                <div className="text-gray-500 animate-pulse mt-1">Processing...</div>
              )}
            </div>

            {/* Result */}
            {job.status === "done" && job.result && (
              <div className="bg-green-900/30 border border-green-700 rounded-xl p-5 text-center">
                <div className="text-4xl mb-2">🎉</div>
                <div className="text-green-400 font-bold text-lg">Play Store pe Publish Ho Gaya!</div>
                <div className="text-gray-300 text-sm mt-2">
                  Version Code: <span className="text-white font-mono">{job.result.versionCode}</span>
                  &nbsp;|&nbsp; Track: <span className="text-white capitalize">{job.result.track}</span>
                </div>
                <a
                  href={`https://play.google.com/console`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-block text-sm text-blue-400 hover:text-blue-300 underline"
                >
                  Play Console mein dekho →
                </a>
              </div>
            )}

            {/* Error */}
            {job.status === "error" && (
              <div className="bg-red-900/30 border border-red-700 rounded-xl p-4">
                <div className="text-red-400 font-medium text-sm">{job.error}</div>
              </div>
            )}

            {/* New Upload Button */}
            {(job.status === "done" || job.status === "error") && (
              <button
                onClick={reset}
                className="w-full py-2.5 rounded-xl border border-gray-600 text-gray-300 hover:text-white hover:border-gray-400 transition-all text-sm"
              >
                Naya Upload Karo
              </button>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}
