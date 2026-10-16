import { useEffect, useRef, useState, type FormEvent } from "react";
import { KeyRound, Lock } from "lucide-react";
import { api, ApiError } from "../api/client";
import { useApp } from "../state/AppState";
import { Spinner } from "./ui";
import { cx, formatDuration } from "../lib/format";
import { Logo } from "./Logo";

const PIN_RE = /^\d{6,12}$/;

export function pinStrength(pin: string): { level: 0 | 1 | 2 | 3; label: string } {
  if (!pin) return { level: 0, label: "6–12 digits" };
  if (!/^\d+$/.test(pin)) return { level: 0, label: "Digits only" };
  if (pin.length < 6) return { level: 0, label: `${6 - pin.length} more digit${pin.length === 5 ? "" : "s"}` };
  const allSame = /^(\d)\1+$/.test(pin);
  const digits = pin.split("").map(Number);
  const seqUp = digits.every((d, i) => i === 0 || d === (digits[i - 1] + 1) % 10);
  const seqDown = digits.every((d, i) => i === 0 || d === (digits[i - 1] + 9) % 10);
  const unique = new Set(digits).size;
  if (allSame || seqUp || seqDown || unique <= 2) return { level: 1, label: "Weak — easy to guess" };
  if (pin.length >= 8 && unique >= 5) return { level: 3, label: "Strong" };
  return { level: 2, label: "Good" };
}

function PinInput(props: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
  autoComplete?: string;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
}) {
  return (
    <div>
      <label htmlFor={props.id} className="label">
        {props.label}
      </label>
      <input
        id={props.id}
        className={cx(
          "input h-12 text-center font-mono text-xl tracking-[0.4em]",
          props.invalid && "border-danger focus:border-danger",
        )}
        type="password"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete={props.autoComplete ?? "current-password"}
        maxLength={12}
        value={props.value}
        disabled={props.disabled}
        autoFocus={props.autoFocus}
        aria-invalid={props.invalid || undefined}
        aria-describedby={props.describedBy}
        onChange={(e) => props.onChange(e.target.value.replace(/\D/g, "").slice(0, 12))}
      />
    </div>
  );
}

export function StrengthMeter({ pin, id }: { pin: string; id?: string }) {
  const s = pinStrength(pin);
  const colors = ["bg-line-strong", "bg-danger", "bg-warning", "bg-success"];
  return (
    <div id={id} aria-live="polite">
      <div className="flex gap-1" aria-hidden>
        {[1, 2, 3].map((i) => (
          <span key={i} className={cx("h-1 flex-1 rounded-full", s.level >= i ? colors[s.level] : "bg-line")} />
        ))}
      </div>
      <p className="mt-1.5 text-xs text-muted">{s.label}</p>
    </div>
  );
}

export function LockScreen() {
  const { auth, onAuthenticated, checkAuth } = useApp();

  return (
    <main className="flex min-h-full items-center justify-center bg-bg-subtle px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo className="size-12" />
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">BigBrain</h1>
        </div>
        <div className="card p-6 shadow-pop">
          {auth === "loading" && (
            <div className="flex justify-center py-8">
              <Spinner className="size-6 text-muted" label="Loading" />
            </div>
          )}
          {auth === "offline" && (
            <div className="space-y-4 text-center">
              <p className="text-sm text-muted">Can't reach the server right now.</p>
              <button className="btn btn-primary w-full" onClick={() => void checkAuth()}>
                Try again
              </button>
            </div>
          )}
          {auth === "setup" && <SetupForm onDone={onAuthenticated} />}
          {auth === "login" && <LoginForm onDone={onAuthenticated} />}
        </div>
        <p className="mt-6 text-center text-xs text-faint">Private. Your PIN never leaves this site in clear.</p>
      </div>
    </main>
  );
}

function SetupForm({ onDone }: { onDone: () => void }) {
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mismatch = confirm.length > 0 && confirm.length >= pin.length && confirm !== pin;
  const valid = PIN_RE.test(pin) && pin === confirm;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.setupPin(pin);
      onDone();
    } catch (err) {
      const ae = err as ApiError;
      setError(ae.code === "pin_already_set" ? "A PIN is already set. Reload to sign in." : ae.message);
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="flex items-center gap-2">
        <KeyRound className="size-5 text-accent" aria-hidden />
        <h2 className="text-lg font-semibold">Set your PIN</h2>
      </div>
      <p className="text-sm text-muted">Choose 6–12 digits. You'll use it to unlock BigBrain on any device.</p>
      <PinInput
        id="pin-new"
        label="New PIN"
        value={pin}
        onChange={setPin}
        autoFocus
        autoComplete="new-password"
        disabled={busy}
        describedBy="pin-strength"
      />
      <StrengthMeter pin={pin} id="pin-strength" />
      <PinInput
        id="pin-confirm"
        label="Enter it again"
        value={confirm}
        onChange={setConfirm}
        autoComplete="new-password"
        disabled={busy}
        invalid={mismatch}
        describedBy={mismatch ? "pin-mismatch" : undefined}
      />
      {mismatch && (
        <p id="pin-mismatch" className="text-xs text-danger">
          PINs don't match.
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <button type="submit" className="btn btn-primary h-11 w-full" disabled={!valid || busy}>
        {busy ? <Spinner /> : null}
        Set PIN and continue
      </button>
    </form>
  );
}

function LoginForm({ onDone }: { onDone: () => void }) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const inputWrap = useRef<HTMLDivElement>(null);

  const remaining = lockedUntil ? Math.max(0, Math.ceil((lockedUntil - now) / 1000)) : 0;
  const locked = remaining > 0;

  useEffect(() => {
    if (!lockedUntil) return;
    const t = window.setInterval(() => {
      const n = Date.now();
      setNow(n);
      if (n >= lockedUntil) {
        setLockedUntil(null);
        setError(null);
        window.clearInterval(t);
        requestAnimationFrame(() => inputWrap.current?.querySelector("input")?.focus());
      }
    }, 1000);
    return () => window.clearInterval(t);
  }, [lockedUntil]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!PIN_RE.test(pin) || busy || locked) return;
    setBusy(true);
    setError(null);
    try {
      await api.login(pin);
      onDone();
    } catch (err) {
      const ae = err as ApiError;
      setPin("");
      if (ae.status === 429) {
        const secs = ae.retryAfterSeconds ?? 15 * 60;
        setNow(Date.now());
        setLockedUntil(Date.now() + secs * 1000);
        setError("Too many attempts. Login is locked.");
      } else if (ae.status === 401 || ae.status === 400) {
        setError("That PIN didn't work. Try again.");
      } else {
        setError(ae.message || "Something went wrong.");
      }
      setBusy(false);
      requestAnimationFrame(() => inputWrap.current?.querySelector("input")?.focus());
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="flex items-center gap-2">
        <Lock className="size-5 text-accent" aria-hidden />
        <h2 className="text-lg font-semibold">Enter PIN</h2>
      </div>
      <div ref={inputWrap}>
        <PinInput
          id="pin-login"
          label="PIN"
          value={pin}
          onChange={setPin}
          autoFocus
          disabled={busy || locked}
          invalid={!!error && !locked}
          describedBy={error ? "login-error" : undefined}
        />
      </div>
      {error && (
        <div id="login-error" role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
          {locked && (
            <span className="mt-1 block font-mono text-base tabular-nums">Try again in {formatDuration(remaining)}</span>
          )}
        </div>
      )}
      <button type="submit" className="btn btn-primary h-11 w-full" disabled={!PIN_RE.test(pin) || busy || locked}>
        {busy ? <Spinner /> : null}
        Unlock
      </button>
    </form>
  );
}
