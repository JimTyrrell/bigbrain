import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { ArrowUp, Square } from "lucide-react";
import { useAutoGrow } from "../hooks/useAutoGrow";
import { MicButton } from "./MicButton";
import { cx } from "../lib/format";

export type ComposerHandle = { focus: () => void; insert: (text: string) => void; setValue: (v: string) => void };

export function Composer({
  ref,
  onSend,
  onStop,
  streaming,
  disabled,
  placeholder,
}: {
  ref?: Ref<ComposerHandle>;
  onSend: (text: string) => void;
  onStop: () => void;
  streaming: boolean;
  disabled?: boolean;
  placeholder: string;
}) {
  const [value, setValue] = useState("");
  const ta = useRef<HTMLTextAreaElement>(null);
  const caret = useRef<{ start: number; end: number } | null>(null);
  useAutoGrow(ta, value);

  const rememberCaret = () => {
    const el = ta.current;
    if (el) caret.current = { start: el.selectionStart, end: el.selectionEnd };
  };

  const insert = (text: string) => {
    const el = ta.current;
    const cur = el?.value ?? value;
    const pos = caret.current ?? { start: cur.length, end: cur.length };
    const before = cur.slice(0, pos.start);
    const after = cur.slice(pos.end);
    const pad = before && !/\s$/.test(before) ? " " : "";
    const padAfter = after && !/^\s/.test(after) ? " " : "";
    const next = before + pad + text + padAfter + after;
    const caretAt = (before + pad + text).length;
    setValue(next);
    caret.current = { start: caretAt, end: caretAt };
    requestAnimationFrame(() => {
      const t = ta.current;
      if (!t) return;
      t.focus();
      t.setSelectionRange(caretAt, caretAt);
    });
  };

  useImperativeHandle(ref, () => ({
    focus: () => ta.current?.focus(),
    insert,
    setValue: (v: string) => {
      setValue(v);
      requestAnimationFrame(() => ta.current?.focus());
    },
  }));

  useEffect(() => {
    if (!disabled) ta.current?.focus();
  }, [disabled]);

  const submit = () => {
    const t = value.trim();
    if (!t || streaming || disabled) return;
    onSend(t);
    setValue("");
    caret.current = null;
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-4 sm:px-6">
      <div
        className={cx(
          "flex items-end gap-2 rounded-2xl border border-line-strong bg-surface p-2 pl-4 shadow-sm transition-shadow",
          "focus-within:border-accent focus-within:shadow-[0_0_0_3px_var(--ring)]",
        )}
      >
        <label htmlFor="composer" className="sr-only">
          Message
        </label>
        <textarea
          id="composer"
          ref={ta}
          rows={1}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          className="max-h-60 min-h-[2.25rem] flex-1 resize-none bg-transparent py-2 text-[15px] leading-6 outline-none placeholder:text-faint focus-visible:outline-none"
          onChange={(e) => {
            setValue(e.target.value);
            caret.current = { start: e.target.selectionStart, end: e.target.selectionEnd };
          }}
          onSelect={rememberCaret}
          onKeyUp={rememberCaret}
          onClick={rememberCaret}
          onBlur={rememberCaret}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            } else if (e.key === "Escape" && streaming) {
              e.preventDefault();
              onStop();
            }
          }}
        />
        <div className="flex items-center gap-1 pb-0.5">
          <MicButton onText={insert} disabled={disabled} />
          {streaming ? (
            <button
              type="button"
              className="flex size-9 items-center justify-center rounded-full bg-fg text-bg transition-opacity hover:opacity-85"
              onClick={onStop}
              aria-label="Stop generating"
              title="Stop (Esc)"
            >
              <Square className="size-3.5 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              className="flex size-9 items-center justify-center rounded-full bg-accent text-accent-fg transition-colors hover:bg-accent-hover disabled:bg-surface-2 disabled:text-faint"
              onClick={submit}
              disabled={!value.trim() || disabled}
              aria-label="Send message"
              title="Send (Enter)"
            >
              <ArrowUp className="size-[18px]" />
            </button>
          )}
        </div>
      </div>
      <p className="mt-2 hidden text-center text-[11px] text-faint sm:block">
        <span className="kbd">Enter</span> to send · <span className="kbd">Shift</span> + <span className="kbd">Enter</span> for a new
        line · hold <span className="kbd">mic</span> to talk
      </p>
    </div>
  );
}
