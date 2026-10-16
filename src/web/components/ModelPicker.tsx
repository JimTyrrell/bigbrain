import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, Cpu, Sparkles } from "lucide-react";
import type { ModelInfo } from "../api/types";
import { cx, formatTokens } from "../lib/format";
import { Spinner } from "./ui";

export function ModelPicker({
  models,
  value,
  defaultModel,
  onChange,
  busy,
  disabled,
}: {
  models: ModelInfo[];
  value: string;
  defaultModel: string;
  onChange: (id: string) => void;
  busy?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const btnRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const current = models.find((m) => m.id === value);

  useEffect(() => {
    if (!open) return;
    const i = Math.max(0, models.findIndex((m) => m.id === value));
    setActive(i);
    requestAnimationFrame(() => listRef.current?.focus());
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, models, value]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const choose = (id: string) => {
    setOpen(false);
    btnRef.current?.focus();
    if (id !== value) onChange(id);
  };

  return (
    <div className="relative" ref={wrapRef}>
      <button
        ref={btnRef}
        type="button"
        className="flex h-8 max-w-[14rem] items-center gap-1.5 rounded-full border border-line-strong bg-surface pr-2 pl-3 text-[13px] font-medium hover:bg-surface-2 disabled:opacity-60"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`Model: ${current?.label ?? value ?? "none"}. Change model`}
        disabled={disabled || models.length === 0}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {busy ? <Spinner className="size-3.5 text-muted" /> : <Cpu className="size-3.5 text-muted" aria-hidden />}
        <span className="truncate">{current?.label ?? (value ? value.split("/").pop() : "Choose model")}</span>
        <ChevronDown className="size-3.5 text-muted" aria-hidden />
      </button>

      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          tabIndex={-1}
          aria-label="Choose a model"
          aria-activedescendant={`${listId}-${active}`}
          className="anim-pop scroll-thin absolute right-0 z-50 mt-2 max-h-[min(70vh,32rem)] w-[min(24rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-line bg-surface p-1.5 shadow-pop outline-none"
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(models.length - 1, a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === "Home") {
              e.preventDefault();
              setActive(0);
            } else if (e.key === "End") {
              e.preventDefault();
              setActive(models.length - 1);
            } else if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              const m = models[active];
              if (m) choose(m.id);
            } else if (e.key === "Escape" || e.key === "Tab") {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
              btnRef.current?.focus();
            }
          }}
        >
          {models.map((m, i) => {
            const selected = m.id === value;
            return (
              <li
                key={m.id}
                id={`${listId}-${i}`}
                data-index={i}
                role="option"
                aria-selected={selected}
                className={cx(
                  "flex cursor-pointer gap-3 rounded-lg px-3 py-2.5",
                  i === active ? "bg-surface-2" : "",
                )}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(m.id)}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-medium">{m.label}</span>
                    {m.recommended && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-1.5 py-px text-[10px] font-semibold text-accent-soft-fg uppercase">
                        <Sparkles className="size-2.5" aria-hidden /> Recommended
                      </span>
                    )}
                    {m.id === defaultModel && (
                      <span className="rounded-full border border-line-strong px-1.5 py-px text-[10px] font-medium text-muted uppercase">
                        Default
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-muted">
                    {m.vendor} · {formatTokens(m.contextWindow)} context
                  </div>
                  {m.note && <div className="mt-1 text-xs leading-5 text-fg/80">{m.note}</div>}
                </div>
                <Check className={cx("mt-0.5 size-4 shrink-0 text-accent", !selected && "invisible")} aria-hidden />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
