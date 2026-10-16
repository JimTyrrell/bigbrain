import { Hono } from "hono";
import type { AppEnv } from "../env";
import { runAi } from "../lib/ai";
import { toB64 } from "../lib/auth";
import { HttpError, badRequest } from "../lib/errors";

const app = new Hono<AppEnv>();

const MAX_AUDIO = 10 * 1024 * 1024;
const AUDIO_TYPE_RE = /^(audio\/|video\/(webm|mp4)|application\/octet-stream$)/;

app.post("/transcribe", async (c) => {
  if (!(c.req.header("Content-Type") ?? "").startsWith("multipart/form-data")) {
    throw new HttpError(415, "unsupported_type", "Send multipart/form-data with an audio field");
  }
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    throw badRequest("invalid_input", "Malformed multipart body");
  }
  const audio = form.get("audio");
  if (!audio || typeof audio === "string") throw badRequest("invalid_input", "audio is required");
  if (audio.size === 0) throw badRequest("invalid_input", "audio is empty");
  if (audio.size > MAX_AUDIO) throw new HttpError(413, "too_large", "Audio must be 10 MB or less");
  if (audio.type && !AUDIO_TYPE_RE.test(audio.type)) throw new HttpError(415, "unsupported_type", "Unsupported audio type");

  const b64 = toB64(new Uint8Array(await audio.arrayBuffer()));
  let res: { text?: string; transcription_info?: { language?: string; duration?: number } };
  try {
    res = (await runAi(c.env, c.env.WHISPER_MODEL, { audio: b64 })) as typeof res;
  } catch (err) {
    console.error("whisper failed", err);
    throw new HttpError(502, "ai_error", "Transcription failed");
  }
  return c.json({
    text: (res?.text ?? "").trim(),
    language: res?.transcription_info?.language ?? null,
    durationSeconds: res?.transcription_info?.duration ?? null,
  });
});

export default app;
