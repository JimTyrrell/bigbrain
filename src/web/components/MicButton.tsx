import { useRef } from "react";
import { Mic, Square } from "lucide-react";
import { api, ApiError } from "../api/client";
import { useRecorder } from "../hooks/useRecorder";
import { useToast } from "./Toasts";
import { Spinner } from "./ui";
import { cx, formatDuration } from "../lib/format";

const HOLD_MS = 350;

function transcribeErrorMessage(e: unknown, blob: Blob): string {
  if (e instanceof ApiError) {
    switch (e.code) {
      case "too_large":
        return "That recording is too long to transcribe (10 MB max). Try a shorter one.";
      case "unsupported_type":
        return `The server couldn't read this browser's audio format (${blob.type || "unknown"}).`;
      case "network":
        return "Couldn't reach the server to transcribe. Check your connection.";
      default:
        return `Transcription failed: ${e.message}`;
    }
  }
  return `Transcription failed: ${(e as Error)?.message || "unknown error"}`;
}

/**
 * Push-to-talk: hold to record, release to transcribe.
 * A quick click (or Enter/Space) toggles recording on, and a second click stops it.
 * If the button is released before the mic is live (typically while the browser's permission
 * prompt is showing on first use), it switches to click-to-stop instead of throwing the take away.
 */
export function MicButton({ onText, disabled }: { onText: (text: string) => void; disabled?: boolean }) {
  const toast = useToast();
  const pressRef = useRef<{ at: number; startedHere: boolean } | null>(null);
  const toggleModeRef = useRef(false);

  const rec = useRecorder({
    onAudio: async (blob, filename) => {
      try {
        const r = await api.transcribe(blob, filename);
        const text = (r?.text ?? "").trim();
        if (text) onText(text);
        else toast.info("Didn't catch that. Try again a little closer to the mic.");
      } catch (e) {
        console.error("[voice] transcription failed", { size: blob.size, type: blob.type, filename }, e);
        toast.error(transcribeErrorMessage(e, blob));
      }
    },
    onError: (m) => toast.error(m),
    onTooShort: () => {
      toast.info(
        toggleModeRef.current
          ? "That was too short to transcribe. Click the mic, speak, then click again to stop."
          : "Too short to transcribe. Hold the mic button while you speak, or click once to start and again to stop.",
      );
    },
  });

  const recording = rec.state === "recording" || rec.state === "starting";
  const busy = rec.state === "transcribing";

  const toggle = () => {
    if (busy) return;
    if (recording) {
      toggleModeRef.current = false;
      rec.stop();
    } else {
      toggleModeRef.current = true;
      void rec.start();
    }
  };

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 || disabled || busy) return;
    e.preventDefault(); // keep focus/caret in the composer
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (recording) {
      pressRef.current = { at: Date.now(), startedHere: false };
      return;
    }
    pressRef.current = { at: Date.now(), startedHere: true };
    toggleModeRef.current = false;
    void rec.start();
  };

  const onPointerUp = () => {
    const p = pressRef.current;
    pressRef.current = null;
    if (!p) return;
    if (!p.startedHere) {
      // second click in toggle mode stops
      toggleModeRef.current = false;
      rec.stop();
      return;
    }
    const held = Date.now() - p.at;
    if (held >= HOLD_MS && rec.isLive()) {
      rec.stop();
      return;
    }
    // Quick click, or released before the mic was live (e.g. to answer the permission prompt):
    // keep recording until the next click.
    toggleModeRef.current = true;
    if (held >= HOLD_MS) toast.info("Recording… click the mic again to stop.");
  };

  const label = busy
    ? "Transcribing"
    : recording
      ? "Stop recording"
      : "Voice input: hold to talk, or click to start";

  return (
    <div className="flex items-center gap-2">
      {recording && (
        <span className="flex items-center gap-1.5 text-xs font-medium text-danger tabular-nums" aria-live="polite">
          <span className="size-2 rounded-full bg-danger motion-safe:animate-pulse" aria-hidden />
          {rec.state === "starting" ? "Starting mic…" : formatDuration(rec.elapsed)}
          {rec.state === "recording" && toggleModeRef.current && (
            <span className="font-normal text-muted">· click to stop</span>
          )}
        </span>
      )}
      {busy && (
        <span className="flex items-center gap-1.5 text-xs text-muted" aria-live="polite">
          <Spinner className="size-3.5" /> Transcribing…
        </span>
      )}
      <button
        type="button"
        className={cx(
          "flex size-9 shrink-0 items-center justify-center rounded-full transition-colors select-none touch-none",
          recording ? "anim-recording bg-danger text-white" : "text-muted hover:bg-surface-2 hover:text-fg",
        )}
        aria-label={label}
        aria-pressed={recording}
        title={label}
        disabled={disabled || busy}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onContextMenu={(e) => e.preventDefault()}
        onClick={(e) => {
          // keyboard activation (Enter/Space) reports detail === 0
          if (e.detail === 0) toggle();
        }}
      >
        {busy ? <Spinner className="size-4" /> : recording ? <Square className="size-3.5 fill-current" /> : <Mic className="size-[18px]" />}
      </button>
    </div>
  );
}
