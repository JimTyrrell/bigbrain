import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { TriangleAlert, X } from "lucide-react";
import { cx } from "../lib/format";

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  /** "center" = modal, "right" = slide-over sheet */
  variant?: "center" | "right";
  size?: "sm" | "md" | "lg";
  /** Element to focus first (otherwise first focusable in body) */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  /** Prevent closing via Esc/backdrop (e.g. while saving) */
  busy?: boolean;
};

/** Accessible modal built on native <dialog> (focus trap, Esc, inert background for free). */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  variant = "center",
  size = "md",
  initialFocusRef,
  busy,
}: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const d = ref.current;
    if (!d) return;
    const restore = document.activeElement as HTMLElement | null;
    if (!d.open) d.showModal();
    requestAnimationFrame(() => {
      const target =
        initialFocusRef?.current ??
        d.querySelector<HTMLElement>("[data-autofocus]") ??
        d.querySelector<HTMLElement>(".bb-modal-body input, .bb-modal-body textarea, .bb-modal-body select");
      target?.focus();
    });
    return () => {
      if (d.open) d.close();
      if (restore && document.contains(restore)) restore.focus();
    };
  }, [open, initialFocusRef]);

  if (!open) return null;

  const widths = { sm: "max-w-md", md: "max-w-lg", lg: "max-w-2xl" };

  return (
    <dialog
      ref={ref}
      className={cx("bb-dialog", variant === "right" && "bb-sheet")}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onCloseRef.current();
      }}
      onMouseDown={(e) => {
        // click on the backdrop (the dialog element itself) closes
        if (e.target === e.currentTarget && !busy) onCloseRef.current();
      }}
    >
      <div
        className={cx(
          "fixed inset-0 flex pointer-events-none",
          variant === "center" ? "items-end justify-center p-0 sm:items-center sm:p-4" : "justify-end",
        )}
      >
        <div
          className={cx(
            "pointer-events-auto flex flex-col bg-surface shadow-pop",
            variant === "center"
              ? cx("anim-pop max-h-[92vh] w-full rounded-t-2xl border border-line sm:rounded-2xl", widths[size])
              : "bb-sheet-panel h-full w-full max-w-2xl border-l border-line",
          )}
        >
          <header className="flex items-start gap-4 border-b border-line px-6 py-4">
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="text-base font-semibold leading-6">
                {title}
              </h2>
              {description && (
                <div id={descId} className="mt-1 text-sm text-muted">
                  {description}
                </div>
              )}
            </div>
            <button className="icon-btn -mr-2" onClick={() => !busy && onClose()} aria-label="Close" disabled={busy}>
              <X className="size-5" />
            </button>
          </header>
          {children && <div className="bb-modal-body scroll-thin min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>}
          {footer && (
            <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-6 py-4">{footer}</footer>
          )}
        </div>
      </div>
    </dialog>
  );
}

/* ---------- Promise-based confirm dialog ---------- */

type ConfirmOptions = {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};
type ConfirmFn = (o: ConfirmOptions) => Promise<boolean>;
const ConfirmCtx = createContext<ConfirmFn | null>(null);

export function useConfirm(): ConfirmFn {
  const v = useContext(ConfirmCtx);
  if (!v) throw new Error("useConfirm outside ConfirmProvider");
  return v;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const confirm = useCallback<ConfirmFn>(
    (o) => new Promise<boolean>((resolve) => setState({ ...o, resolve })),
    [],
  );

  const finish = (v: boolean) => {
    state?.resolve(v);
    setState(null);
  };

  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <Modal
        open={!!state}
        onClose={() => finish(false)}
        size="sm"
        initialFocusRef={cancelRef}
        title={
          <span className="flex items-center gap-2">
            {state?.danger && <TriangleAlert className="size-5 text-danger" aria-hidden />}
            {state?.title}
          </span>
        }
        footer={
          <>
            <button ref={cancelRef} className="btn btn-secondary" onClick={() => finish(false)}>
              {state?.cancelLabel ?? "Cancel"}
            </button>
            <button className={cx("btn", state?.danger ? "btn-danger" : "btn-primary")} onClick={() => finish(true)}>
              {state?.confirmLabel ?? "Confirm"}
            </button>
          </>
        }
      >
        {state?.message && <div className="text-sm leading-6 text-muted">{state.message}</div>}
      </Modal>
    </ConfirmCtx.Provider>
  );
}
