import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Markdown, { type Components } from "react-markdown";
import { Check, CircleAlert, Copy, ExternalLink } from "lucide-react";
import type { Citation, Message } from "../api/types";
import { linkCitations } from "../lib/citations";
import { clockTime, cx } from "../lib/format";

export type UiMessage = Message & { streaming?: boolean; error?: string; stopped?: boolean };

export const MessageView = memo(function MessageView({
  message,
  modelLabel,
}: {
  message: UiMessage;
  modelLabel: string;
}) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-[15px] leading-6 whitespace-pre-wrap text-accent-fg sm:max-w-[75%]">
          {message.content}
        </div>
      </div>
    );
  }
  return <AssistantMessage message={message} modelLabel={modelLabel} />;
});

function AssistantMessage({ message, modelLabel }: { message: UiMessage; modelLabel: string }) {
  const [flash, setFlash] = useState<{ n: number; k: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const citations = useMemo(
    () => [...(message.citations ?? [])].sort((a, b) => a.n - b.n),
    [message.citations],
  );
  const known = useMemo(() => new Set(citations.map((c) => c.n)), [citations]);
  const cardId = (n: number) => `src-${message.id}-${n}`;

  const jump = useCallback(
    (n: number) => {
      const el = document.getElementById(`src-${message.id}-${n}`);
      if (!el) return;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "nearest" });
      setFlash((f) => ({ n, k: (f?.k ?? 0) + 1 }));
      el.focus({ preventScroll: true });
    },
    [message.id],
  );

  const components = useMemo<Components>(
    () => ({
      a: ({ href, children, node: _node, ...rest }) => {
        const m = href?.match(/^#cite-(\d+)$/);
        if (m) {
          const n = Number(m[1]);
          const c = citations.find((x) => x.n === n);
          return (
            <sup className="mx-px">
              <button
                type="button"
                className={cx(
                  "inline-flex h-[1.15rem] min-w-[1.15rem] items-center justify-center rounded-md px-1 align-baseline text-[10.5px] font-semibold not-italic no-underline transition-colors",
                  known.has(n)
                    ? "bg-accent-soft text-accent-soft-fg hover:bg-accent hover:text-accent-fg"
                    : "bg-surface-2 text-muted",
                )}
                onClick={() => jump(n)}
                aria-label={c ? `Source ${n}: ${c.documentTitle}${c.timestamp ? ` at ${c.timestamp}` : ""}` : `Source ${n}`}
                title={c ? `${c.documentTitle}${c.timestamp ? ` · ${c.timestamp}` : ""}` : undefined}
              >
                {n}
              </button>
            </sup>
          );
        }
        return (
          <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
            {children}
          </a>
        );
      },
    }),
    [citations, known, jump],
  );

  const text = useMemo(() => linkCitations(message.content ?? ""), [message.content]);
  const empty = !message.content;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="group flex flex-col items-start">
      <div className="w-full max-w-full">
        {empty && message.streaming ? (
          <div className="flex items-center gap-1.5 py-2" aria-label="Thinking">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="size-1.5 rounded-full bg-faint motion-safe:animate-bounce"
                style={{ animationDelay: `${i * 120}ms` }}
              />
            ))}
            <span className="ml-2 text-xs text-muted">
              {citations.length ? `Reading ${citations.length} passages…` : "Searching sources…"}
            </span>
          </div>
        ) : (
          <div className={cx("md", message.streaming && "stream-caret")}>
            <Markdown components={components}>{text}</Markdown>
          </div>
        )}

        {message.error && (
          <div role="alert" className="mt-3 flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            {message.error}
          </div>
        )}

        {citations.length > 0 && !message.streaming && (
          <div className="mt-4">
            <h3 className="mb-2 text-[11px] font-semibold tracking-wider text-faint uppercase">Sources</h3>
            <ol className="grid gap-2 sm:grid-cols-2">
              {citations.map((c) => (
                <SourceCard
                  key={c.n}
                  id={cardId(c.n)}
                  c={c}
                  flashKey={flash?.n === c.n ? flash.k : 0}
                />
              ))}
            </ol>
          </div>
        )}

        <div className="mt-2 flex h-6 items-center gap-2 text-[11px] text-faint">
          <span className="font-medium text-muted">{modelLabel}</span>
          {message.createdAt && (
            <>
              <span aria-hidden>·</span>
              <time dateTime={message.createdAt}>{clockTime(message.createdAt)}</time>
            </>
          )}
          {message.stopped && (
            <>
              <span aria-hidden>·</span>
              <span>stopped</span>
            </>
          )}
          {!message.streaming && message.content && (
            <button
              type="button"
              className="icon-btn icon-btn-sm opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
              onClick={() => void copy()}
              aria-label="Copy reply"
              title="Copy"
            >
              {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function SourceCard({ c, id, flashKey }: { c: Citation; id: string; flashKey: number }) {
  const [expanded, setExpanded] = useState(false);
  const long = (c.excerpt ?? "").length > 140;
  const href = c.link ?? c.sourceUrl;
  const ref = useRef<HTMLLIElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !flashKey) return;
    el.classList.remove("anim-flash");
    void el.offsetWidth; // restart the animation
    el.classList.add("anim-flash");
  }, [flashKey]);

  return (
    <li
      id={id}
      ref={ref}
      tabIndex={-1}
      className={cx("card flex flex-col p-3 text-sm outline-none", flashKey > 0 && "border-accent")}
    >
      <div className="flex items-start gap-2">
        <span className="mt-px inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-md bg-accent-soft px-1 text-[11px] font-semibold text-accent-soft-fg">
          {c.n}
        </span>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 leading-5 font-medium" title={c.documentTitle}>
            {c.documentTitle}
          </p>
          {c.timestamp && <p className="font-mono text-xs text-muted">{c.timestamp}</p>}
        </div>
      </div>
      {c.excerpt && (
        <>
          <p className={cx("mt-2 text-[13px] leading-5 text-muted", !expanded && "line-clamp-2")}>“{c.excerpt.trim()}”</p>
          {long && (
            <button
              type="button"
              className="mt-1 self-start text-xs font-medium text-accent hover:underline"
              onClick={() => setExpanded((e) => !e)}
              aria-expanded={expanded}
            >
              {expanded ? "Show less" : "Show more"}
            </button>
          )}
        </>
      )}
      {href && (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1 self-start text-xs font-medium text-accent hover:underline"
        >
          <ExternalLink className="size-3" aria-hidden />
          {c.link && c.timestamp ? `Open at ${c.timestamp}` : "Open source"}
        </a>
      )}
    </li>
  );
}
