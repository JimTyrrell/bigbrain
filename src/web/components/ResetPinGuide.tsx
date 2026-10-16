import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Check, Copy, ExternalLink, KeyRound, X } from "lucide-react";
import { api } from "../api/client";
import type { ResetInfo } from "../api/types";

const DEFAULT_RESET: ResetInfo = {
  kvDashboardUrl: "https://dash.cloudflare.com/?to=/:account/workers/kv/namespaces",
  keys: ["pin_hash", "session_secret"],
};

let cached: Promise<ResetInfo> | null = null;

/** Reset info comes from the public /auth/status endpoint; fetched once per page load. */
function loadResetInfo(): Promise<ResetInfo> {
  cached ??= api
    .authStatus()
    .then((s) => s.reset ?? DEFAULT_RESET)
    .catch(() => {
      cached = null;
      return DEFAULT_RESET;
    });
  return cached;
}

function namespaceIdFrom(url: string): string | null {
  const m = /\/namespaces\/([^/?#]+)/.exec(url);
  return m ? decodeURIComponent(m[1]) : null;
}

const Code = ({ children }: { children: ReactNode }) => (
  <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[0.8em] text-fg">{children}</code>
);
const UI = ({ children }: { children: ReactNode }) => <strong className="font-semibold text-fg">{children}</strong>;

type Props = {
  /** Show a Close button and collapse on Escape. */
  onClose?: () => void;
  /** Move focus to the title when mounted (used when the guide is opened by a toggle). */
  focusOnMount?: boolean;
  className?: string;
};

/** Self-contained "Forgot your PIN?" guide, used on the lock screen and in Settings. */
export function ResetPinGuide({ onClose, focusOnMount, className }: Props) {
  const [reset, setReset] = useState<ResetInfo>(DEFAULT_RESET);
  const [copied, setCopied] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();

  useEffect(() => {
    let live = true;
    void loadResetInfo().then((r) => live && setReset(r));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (focusOnMount) titleRef.current?.focus();
  }, [focusOnMount]);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(t);
  }, [copied]);

  const keys = reset.keys.length ? reset.keys : DEFAULT_RESET.keys;
  const nsId = namespaceIdFrom(reset.kvDashboardUrl);

  const copyKeys = async () => {
    const text = keys.join("\n");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && onClose) {
      // Keep a surrounding <dialog> from closing too.
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  return (
    <section
      aria-labelledby={titleId}
      onKeyDown={onKeyDown}
      className={["rounded-xl border border-line bg-bg-subtle p-4 text-left", className].filter(Boolean).join(" ")}
    >
      <div className="flex items-start justify-between gap-3">
        <h3
          id={titleId}
          ref={titleRef}
          tabIndex={-1}
          className="flex items-center gap-2 text-base font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
        >
          <KeyRound className="size-4 text-accent" aria-hidden />
          Forgot your PIN?
        </h3>
        {onClose && (
          <button type="button" className="btn btn-ghost btn-sm -mr-1 -mt-1" onClick={onClose}>
            <X className="size-4" aria-hidden />
            Close
          </button>
        )}
      </div>
      <p className="mt-2 text-sm leading-6 text-muted">
        Your PIN is never stored, only a hash of it in Cloudflare KV, so resetting it means deleting that hash.
      </p>

      <ol className="mt-4 space-y-3 text-sm leading-6 text-muted">
        <Step n={1}>
          Open the Cloudflare dashboard.
          <div className="mt-2">
            <a href={reset.kvDashboardUrl} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-sm">
              Open KV in Cloudflare
              <ExternalLink className="size-3.5" aria-hidden />
            </a>
          </div>
        </Step>
        <Step n={2}>Sign in if asked and pick the account that hosts BigBrain.</Step>
        <Step n={3}>
          In <UI>Workers &amp; Pages → KV</UI>, open the namespace <UI>BIGBRAIN_KV</UI>.
        </Step>
        <Step n={4}>
          On the <UI>KV Pairs</UI> tab find <Code>pin_hash</Code>, open its row menu (<UI>⋯</UI>) and choose{" "}
          <UI>Delete</UI>; confirm.
        </Step>
        <Step n={5}>
          Do the same for <Code>session_secret</Code> (this logs out every device).
        </Step>
        <Step n={6}>
          Come back here and reload: you'll see <UI>Set your PIN</UI>.
        </Step>
      </ol>

      <figure className="mt-4">
        <KvIllustration />
        <figcaption className="mt-1.5 text-xs text-faint">
          Illustration of the KV Pairs tab (your dashboard may look slightly different).
        </figcaption>
      </figure>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void copyKeys()}>
          {copied ? <Check className="size-4 text-success" aria-hidden /> : <Copy className="size-4" aria-hidden />}
          {copied ? "Copied" : "Copy key names"}
        </button>
        <span className="sr-only" aria-live="polite">
          {copied ? "Key names copied" : ""}
        </span>
      </div>

      <p className="mt-3 text-xs leading-5 text-faint">
        Alternative with the CLI:{" "}
        <code className="break-all rounded bg-surface-2 px-1 py-0.5 font-mono text-muted">
          npx wrangler kv key delete --namespace-id {nsId ?? "<id>"} --remote pin_hash
        </code>{" "}
        (and <Code>session_secret</Code>).
      </p>
    </section>
  );
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden
        className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent-soft-fg"
      >
        {n}
      </span>
      <span className="min-w-0 flex-1">
        <span className="sr-only">Step {n}: </span>
        {children}
      </span>
    </li>
  );
}

/** Stylised (not a screenshot) KV Pairs table with the row menu open on pin_hash. */
function KvIllustration() {
  const v = (name: string) => `var(--${name})`;
  const mono = "ui-monospace, SFMono-Regular, Menlo, monospace";
  return (
    <svg
      viewBox="0 0 560 220"
      role="img"
      aria-label="Illustration: the BIGBRAIN_KV KV Pairs table with rows pin_hash and session_secret. The row menu on pin_hash is open, showing View, Edit and Delete, with Delete highlighted."
      className="h-auto w-full max-w-[560px] text-fg"
      fontFamily="Inter, ui-sans-serif, system-ui, sans-serif"
    >
      <rect x="0.5" y="0.5" width="559" height="219" rx="12" style={{ fill: v("surface"), stroke: v("line-strong") }} />
      {/* header bar */}
      <path d="M12.5 0.5h535a12 12 0 0 1 12 12v27.5h-559v-27.5a12 12 0 0 1 12-12z" style={{ fill: v("surface-2") }} />
      <line x1="0.5" y1="40" x2="559.5" y2="40" style={{ stroke: v("line-strong") }} />
      <circle cx="20" cy="20" r="4" style={{ fill: v("accent") }} />
      <text x="32" y="25" fontSize="14" fontWeight="600" fill="currentColor">
        BIGBRAIN_KV · KV Pairs
      </text>

      {/* column headings */}
      <text x="20" y="62" fontSize="11" fontWeight="600" letterSpacing="0.06em" style={{ fill: v("fg-faint") }}>
        KEY
      </text>
      <text x="220" y="62" fontSize="11" fontWeight="600" letterSpacing="0.06em" style={{ fill: v("fg-faint") }}>
        VALUE
      </text>
      <line x1="12" y1="74" x2="548" y2="74" style={{ stroke: v("line") }} />

      {/* row 1: pin_hash (menu open) */}
      <rect x="8" y="78" width="544" height="40" rx="8" style={{ fill: v("accent-soft") }} />
      <text x="20" y="103" fontSize="14" fontFamily={mono} fontWeight="600" fill="currentColor">
        pin_hash
      </text>
      <text x="220" y="103" fontSize="13" fontFamily={mono} style={{ fill: v("fg-muted") }}>
        pbkdf2$100000$…
      </text>
      <rect x="510" y="86" width="30" height="24" rx="6" style={{ fill: v("surface"), stroke: v("accent") }} />
      <g style={{ fill: v("accent") }}>
        <circle cx="517" cy="98" r="2" />
        <circle cx="525" cy="98" r="2" />
        <circle cx="533" cy="98" r="2" />
      </g>
      <line x1="12" y1="122" x2="548" y2="122" style={{ stroke: v("line") }} />

      {/* row 2: session_secret */}
      <text x="20" y="147" fontSize="14" fontFamily={mono} fill="currentColor">
        session_secret
      </text>
      <text x="220" y="147" fontSize="13" fontFamily={mono} style={{ fill: v("fg-muted") }}>
        ••••••••••••
      </text>
      <g style={{ fill: v("fg-faint") }}>
        <circle cx="517" cy="142" r="2" />
        <circle cx="525" cy="142" r="2" />
        <circle cx="533" cy="142" r="2" />
      </g>
      <line x1="12" y1="166" x2="548" y2="166" style={{ stroke: v("line") }} />

      {/* open row menu */}
      <rect x="392" y="118" width="150" height="96" rx="10" style={{ fill: "rgb(0 0 0 / 0.12)" }} />
      <rect x="388" y="114" width="150" height="96" rx="10" style={{ fill: v("surface"), stroke: v("line-strong") }} />
      <text x="404" y="139" fontSize="13" fill="currentColor">
        View
      </text>
      <text x="404" y="167" fontSize="13" fill="currentColor">
        Edit
      </text>
      <rect x="394" y="178" width="138" height="26" rx="6" style={{ fill: v("danger-soft"), stroke: v("danger") }} />
      <text x="404" y="195" fontSize="13" fontWeight="700" style={{ fill: v("danger") }}>
        Delete
      </text>
      {/* pointer from the ⋯ button to the menu */}
      <path d="M525 111 L525 114" style={{ stroke: v("accent") }} strokeWidth="2" />
    </svg>
  );
}
