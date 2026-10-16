import { useRef } from "react";
import { Mic, Square } from "lucide-react";
import { api } from "../api/client";
import { useRecorder } from "../hooks/useRecorder";
import { useToast } from "./Toasts";
import { Spinner } from "./ui";
import { cx, formatDuration } from "../lib/format";

const HOLD_MS = 350;

/**
 * Push-to-talk: hold to record, release to transcribe.
 * A quick click (or Enter/Space) toggles recording on, and a second click stops it.
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
        toast.error((e as Error).message || "Transcription failed.");
      }
    },
    onError: (m) => toast.error(m),
    onTooShort: () => {
      if (!toggleModeRef.current) toast.info("Hold the mic button while you speak.");
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
    if (held >= HOLD_MS) rec.stop();
    else toggleModeRef.current = true; // quick click: keep recording until clicked again
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
          {rec.state === "starting" ? "Starting…" : formatDuration(rec.elapsed)}
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
