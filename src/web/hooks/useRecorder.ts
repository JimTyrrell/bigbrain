import { useCallback, useEffect, useRef, useState } from "react";

export type RecorderState = "idle" | "starting" | "recording" | "transcribing";

const MIN_MS = 400;

function pickMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  return candidates.find((m) => {
    try {
      return MediaRecorder.isTypeSupported(m);
    } catch {
      return false;
    }
  });
}

function extFor(mime: string): string {
  if (mime.includes("webm")) return "webm";
  if (mime.includes("mp4") || mime.includes("aac") || mime.includes("m4a")) return "mp4";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("mpeg")) return "mp3";
  return "webm";
}

export function micErrorMessage(e: unknown): string {
  const name = (e as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "SecurityError")
    return "Microphone access is blocked. Allow it in your browser's site settings, then try again.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No microphone was found on this device.";
  if (name === "NotReadableError") return "The microphone is in use by another app.";
  if (name === "Unsupported") return "Voice input isn't supported in this browser.";
  return "Couldn't start the microphone.";
}

/**
 * MediaRecorder wrapper. `start()` asks for the mic and begins recording; `stop()` finishes and
 * hands the blob to `onAudio`. Calling `stop()` while still starting stops as soon as it starts.
 */
export function useRecorder(opts: {
  onAudio: (blob: Blob, filename: string) => Promise<void>;
  onError: (message: string) => void;
  onTooShort?: () => void;
}) {
  const [state, setState] = useState<RecorderState>("idle");
  const [elapsed, setElapsed] = useState(0);
  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const stopRequestedRef = useRef(false);
  const cancelledRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const cleanup = useCallback(() => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recRef.current = null;
  }, []);

  useEffect(
    () => () => {
      cancelledRef.current = true;
      try {
        recRef.current?.stop();
      } catch {
        /* ignore */
      }
      cleanup();
    },
    [cleanup],
  );

  const stop = useCallback(() => {
    const rec = recRef.current;
    if (!rec) {
      stopRequestedRef.current = true;
      return;
    }
    if (rec.state !== "inactive") rec.stop();
  }, []);

  const start = useCallback(async () => {
    if (recRef.current || state !== "idle") return;
    stopRequestedRef.current = false;
    cancelledRef.current = false;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      optsRef.current.onError(micErrorMessage({ name: "Unsupported" }));
      return;
    }
    setState("starting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });
    } catch (e) {
      setState("idle");
      optsRef.current.onError(micErrorMessage(e));
      return;
    }
    if (cancelledRef.current) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    const mime = pickMime();
    let rec: MediaRecorder;
    try {
      rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    } catch (e) {
      stream.getTracks().forEach((t) => t.stop());
      setState("idle");
      optsRef.current.onError(micErrorMessage(e));
      return;
    }
    streamRef.current = stream;
    recRef.current = rec;
    chunksRef.current = [];
    rec.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
    };
    rec.onstop = async () => {
      const duration = Date.now() - startedAtRef.current;
      const type = rec.mimeType || mime || "audio/webm";
      cleanup();
      if (cancelledRef.current) return;
      const blob = new Blob(chunksRef.current, { type });
      chunksRef.current = [];
      if (duration < MIN_MS || blob.size < 1000) {
        setState("idle");
        optsRef.current.onTooShort?.();
        return;
      }
      setState("transcribing");
      try {
        await optsRef.current.onAudio(blob, `recording.${extFor(type)}`);
      } finally {
        setState("idle");
      }
    };
    startedAtRef.current = Date.now();
    setElapsed(0);
    rec.start(250);
    setState("recording");
    timerRef.current = window.setInterval(() => setElapsed((Date.now() - startedAtRef.current) / 1000), 200);
    if (stopRequestedRef.current) {
      // released before the mic was ready: give it a moment so there's something to send
      window.setTimeout(() => rec.state !== "inactive" && rec.stop(), MIN_MS);
    }
  }, [cleanup, state]);

  return { state, elapsed, start, stop };
}
