import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { LoaderCircle } from "lucide-react";
import { cx } from "../lib/format";

export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <LoaderCircle
      className={cx("animate-spin motion-reduce:animate-none", className ?? "size-4")}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      role={label ? "status" : undefined}
    />
  );
}

type InlineEditProps = {
  value: string;
  onSave: (v: string) => void | Promise<void>;
  onCancel: () => void;
  ariaLabel: string;
  className?: string;
  placeholder?: string;
  maxLength?: number;
};

/** Text input that saves on Enter/blur and cancels on Escape. */
export function InlineEdit({ value, onSave, onCancel, ariaLabel, className, placeholder, maxLength = 120 }: InlineEditProps) {
  const [v, setV] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const commit = () => {
    if (done.current) return;
    done.current = true;
    const t = v.trim();
    if (!t || t === value) onCancel();
    else void onSave(t);
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      done.current = true;
      onCancel();
    }
  };

  return (
    <input
      ref={ref}
      className={cx("input h-8 px-2 text-sm", className)}
      value={v}
      maxLength={maxLength}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onChange={(e) => setV(e.target.value)}
      onKeyDown={onKey}
      onBlur={commit}
    />
  );
}
