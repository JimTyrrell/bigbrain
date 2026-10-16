import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import { cx } from "../lib/format";

type ToastKind = "success" | "error" | "info";
type Toast = { id: number; kind: ToastKind; message: string };
type ToastApi = {
  show: (message: string, kind?: ToastKind) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
};

const Ctx = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useToast outside ToastProvider");
  return v;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const show = useCallback(
    (message: string, kind: ToastKind = "info") => {
      setToasts((t) => {
        // collapse identical consecutive messages
        if (t.some((x) => x.message === message && x.kind === kind)) return t;
        const id = ++seq.current;
        window.setTimeout(() => dismiss(id), kind === "error" ? 6000 : 3500);
        return [...t.slice(-3), { id, kind, message }];
      });
    },
    [dismiss],
  );

  // Toasts live in the top layer (popover) so they stay visible above open modal dialogs.
  const regionRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = regionRef.current as (HTMLDivElement & { showPopover?: () => void; hidePopover?: () => void }) | null;
    if (!el?.showPopover) return;
    try {
      if (el.matches(":popover-open")) el.hidePopover?.();
      if (toasts.length) el.showPopover();
    } catch {
      /* popover unsupported */
    }
  }, [toasts]);

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (m) => show(m, "success"),
      error: (m) => show(m, "error"),
      info: (m) => show(m, "info"),
    }),
    [show],
  );

  return (
    <Ctx.Provider value={api}>
      {children}
      <div
        ref={regionRef}
        popover="manual"
        className="pointer-events-none fixed inset-x-0 top-auto bottom-0 z-[100] m-0 flex w-full max-w-none flex-col items-center gap-2 overflow-visible border-0 bg-transparent p-4 sm:items-end [&:not(:popover-open)]:flex"
        role="region"
        aria-label="Notifications"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.kind === "error" ? "alert" : "status"}
            className="anim-pop pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-sm shadow-pop"
          >
            {t.kind === "success" && <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />}
            {t.kind === "error" && <CircleAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />}
            {t.kind === "info" && <Info className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />}
            <p className={cx("min-w-0 flex-1 leading-5", t.kind === "error" && "text-fg")}>{t.message}</p>
            <button className="icon-btn icon-btn-sm -my-1 -mr-2" onClick={() => dismiss(t.id)} aria-label="Dismiss">
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
