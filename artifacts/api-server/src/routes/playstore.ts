import { Router, Request, Response } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { google } from "googleapis";

const router = Router();

// Multer storage — save uploaded APK/AAB to /tmp
const upload = multer({
  dest: "/tmp/playstore-uploads/",
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB max
  fileFilter: (req, file, cb) => {
    const ok = file.originalname.endsWith(".apk") || file.originalname.endsWith(".aab");
    if (ok) cb(null, true);
    else cb(new Error("Only .apk or .aab files allowed"));
  },
});

// Job store for tracking upload progress
interface UploadJob {
  id: string;
  status: "pending" | "signing" | "uploading" | "completing" | "done" | "error";
  progress: number;
  logs: string[];
  error?: string;
  result?: {
    versionCode?: number;
    track?: string;
    releaseNotes?: string;
  };
  startedAt: number;
}
const uploadJobs = new Map<string, UploadJob>();

function randomId() {
  return Math.random().toString(36).slice(2, 10);
}

// ─── Get Google Play API client ──────────────────────────────────────────────
async function getPlayClient() {
  const saPath = process.env.PLAY_SERVICE_ACCOUNT_PATH;
  if (!saPath || !fs.existsSync(saPath)) {
    throw new Error("Service account JSON not found at: " + saPath);
  }
  const auth = new google.auth.GoogleAuth({
    keyFile: saPath,
    scopes: ["https://www.googleapis.com/auth/androidpublisher"],
  });
  const client = await auth.getClient();
  google.options({ auth: client as any });
  return google.androidpublisher("v3");
}

// ─── Sign APK using jarsigner ─────────────────────────────────────────────────
async function signApk(
  apkPath: string,
  job: UploadJob
): Promise<string> {
  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const execFileAsync = promisify(execFile);

  const keystorePath = process.env.KEYSTORE_PATH || "artifacts/api-server/secure/keystore.jks";
  const keystorePassword = process.env.KEYSTORE_PASSWORD || "";
  const keyAlias = process.env.KEY_ALIAS || "";
  const keyPassword = process.env.KEY_PASSWORD || "";

  const absKeystore = path.resolve(keystorePath);
  if (!fs.existsSync(absKeystore)) {
    job.logs.push("⚠️ Keystore not found — uploading unsigned (for AAB with Google Play signing)");
    return apkPath;
  }

  const signedPath = apkPath + "-signed";
  fs.copyFileSync(apkPath, signedPath);
  job.logs.push(`🔏 Signing with keystore: ${path.basename(absKeystore)}`);

  try {
    await execFileAsync("jarsigner", [
      "-verbose",
      "-sigalg", "SHA256withRSA",
      "-digestalg", "SHA-256",
      "-keystore", absKeystore,
      "-storepass", keystorePassword,
      "-keypass", keyPassword,
      signedPath,
      keyAlias,
    ]);
    job.logs.push("✅ Signing complete");
    return signedPath;
  } catch (e: any) {
    job.logs.push(`⚠️ jarsigner not available — uploading as-is (Google Play App Signing handles it)`);
    return apkPath;
  }
}

// ─── Main upload runner ───────────────────────────────────────────────────────
async function _runUploadJob(
  job: UploadJob,
  filePath: string,
  fileName: string,
  packageName: string,
  track: string,
  releaseNotes: string
) {
  const log = (msg: string) => { job.logs.push(msg); console.log("[playstore]", msg); };

  try {
    log(`🚀 PLAY STORE UPLOAD STARTED`);
    log(`📦 Package: ${packageName}`);
    log(`🎯 Track: ${track}`);
    log(`📁 File: ${fileName}`);

    // Step 1: Sign APK (if .apk)
    let uploadPath = filePath;
    if (fileName.endsWith(".apk")) {
      job.status = "signing";
      job.progress = 10;
      uploadPath = await signApk(filePath, job);
    } else {
      log(`📦 AAB file — Google Play App Signing handles this`);
    }

    // Step 2: Get Play API client
    job.status = "uploading";
    job.progress = 20;
    log(`🔑 Authenticating with Google Play...`);
    const play = await getPlayClient();

    // Step 3: Create edit
    log(`📝 Creating edit session...`);
    const editRes = await play.edits.insert({ packageName });
    const editId = editRes.data.id!;
    log(`✅ Edit created: ${editId}`);
    job.progress = 30;

    // Step 4: Upload APK or AAB
    const isAab = fileName.endsWith(".aab");
    const mimeType = isAab
      ? "application/octet-stream"
      : "application/vnd.android.package-archive";

    log(`⬆️ Uploading ${isAab ? "AAB" : "APK"} to Play Store...`);
    job.progress = 40;

    const fileStream = fs.createReadStream(uploadPath);
    const fileSize = fs.statSync(uploadPath).size;
    log(`   File size: ${(fileSize / 1024 / 1024).toFixed(1)} MB`);

    let versionCode: number;

    if (isAab) {
      const aabRes = await play.edits.bundles.upload({
        packageName,
        editId,
        media: { mimeType, body: fileStream },
      });
      versionCode = aabRes.data.versionCode!;
    } else {
      const apkRes = await play.edits.apks.upload({
        packageName,
        editId,
        media: { mimeType, body: fileStream },
      });
      versionCode = apkRes.data.versionCode!;
    }

    log(`✅ Upload complete! Version code: ${versionCode}`);
    job.progress = 70;

    // Step 5: Assign to track
    job.status = "completing";
    log(`🎯 Assigning version ${versionCode} to track: ${track}...`);
    await play.edits.tracks.update({
      packageName,
      editId,
      track,
      requestBody: {
        track,
        releases: [{
          versionCodes: [versionCode],
          status: track === "production" ? "completed" : "draft",
          releaseNotes: releaseNotes
            ? [{ language: "en-IN", text: releaseNotes.slice(0, 500) }]
            : [],
        }],
      },
    });
    log(`✅ Assigned to ${track} track`);
    job.progress = 85;

    // Step 6: Commit edit
    log(`💾 Committing edit...`);
    await play.edits.commit({ packageName, editId });
    log(`✅ Edit committed!`);
    job.progress = 100;
    job.status = "done";

    job.result = { versionCode, track, releaseNotes };
    log(`\n🎉 SUCCESS! App published to ${track} track`);
    log(`   Version Code: ${versionCode}`);
    log(`   Package: ${packageName}`);
    log(`   Track: ${track}`);

    // Cleanup
    try { fs.unlinkSync(filePath); } catch {}
    if (uploadPath !== filePath) {
      try { fs.unlinkSync(uploadPath); } catch {}
    }

  } catch (err: any) {
    job.status = "error";
    job.error = err.message || String(err);
    job.logs.push(`\n❌ ERROR: ${job.error}`);
    if (err.response?.data) {
      job.logs.push(`   Details: ${JSON.stringify(err.response.data).slice(0, 300)}`);
    }
    console.error("[playstore] Error:", err);
  }
}

// ─── POST /playstore/upload ───────────────────────────────────────────────────
router.post(
  "/playstore/upload",
  upload.single("file"),
  async (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ error: "No file uploaded. Send .apk or .aab as 'file' field." });
      return;
    }

    const packageName = (req.body.packageName || "").trim();
    const track = (req.body.track || "internal").trim();
    const releaseNotes = (req.body.releaseNotes || "").trim();

    if (!packageName) {
      res.status(400).json({ error: "packageName is required (e.g. com.example.myapp)" });
      return;
    }

    const jobId = randomId();
    const job: UploadJob = {
      id: jobId,
      status: "pending",
      progress: 0,
      logs: [],
      startedAt: Date.now(),
    };
    uploadJobs.set(jobId, job);

    _runUploadJob(job, req.file.path, req.file.originalname, packageName, track, releaseNotes).catch(() => {});

    res.json({
      jobId,
      message: `Upload started! Poll /api/playstore/status/${jobId} for progress.`,
      file: req.file.originalname,
      packageName,
      track,
    });
  }
);

// ─── GET /playstore/status/:jobId ────────────────────────────────────────────
router.get("/playstore/status/:jobId", (req, res) => {
  const job = uploadJobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json({
    jobId: job.id,
    status: job.status,
    progress: job.progress,
    logs: job.logs,
    error: job.error,
    result: job.result,
    elapsedMs: Date.now() - job.startedAt,
  });
});

// ─── GET /playstore/config ────────────────────────────────────────────────────
router.get("/playstore/config", (req, res) => {
  const saPath = process.env.PLAY_SERVICE_ACCOUNT_PATH || "";
  const keystorePath = process.env.KEYSTORE_PATH || "";
  res.json({
    serviceAccountConfigured: !!saPath && fs.existsSync(saPath),
    keystoreConfigured: !!keystorePath && fs.existsSync(path.resolve(keystorePath)),
    serviceAccountEmail: process.env.PLAY_SERVICE_ACCOUNT_EMAIL || "",
    keystorePath: keystorePath ? path.basename(keystorePath) : "Not set",
  });
});

export default router;
