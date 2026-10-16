import { cx } from "../lib/format";

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cx("shrink-0", className ?? "size-7")} aria-hidden>
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <path
        d="M12 9a4 4 0 0 0-4 4 4 4 0 0 0 0 6 4 4 0 0 0 4 4h1V9h-1Zm8 0a4 4 0 0 1 4 4 4 4 0 0 1 0 6 4 4 0 0 1-4 4h-1V9h1Z"
        fill="var(--accent-fg)"
      />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="flex items-center gap-2.5">
      <Logo className="size-7" />
      <span className="text-[15px] font-semibold tracking-tight">BigBrain</span>
    </span>
  );
}
