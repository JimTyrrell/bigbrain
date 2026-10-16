import { useEffect, useRef, useState, type FormEvent } from "react";
import { ChevronDown, ExternalLink, KeyRound } from "lucide-react";
import { api, ApiError } from "../api/client";
import { useApp } from "../state/AppState";
import { Modal } from "./Dialog";
import { useToast } from "./Toasts";
import { Spinner } from "./ui";
import { StrengthMeter } from "./LockScreen";
import { cx, formatTokens } from "../lib/format";
import { ResetPinGuide } from "./ResetPinGuide";

const SITE_URL = "https://bigbrain.designaticlabs.com";

export function SettingsModal() {
  const app = useApp();
  return (
    <Modal open={app.settingsOpen} onClose={() => app.setSettingsOpen(false)} title="Settings" size="md">
      {app.settingsOpen && <SettingsBody />}
    </Modal>
  );
}

function SettingsBody() {
  const app = useApp();
  const [defaultModel, setDefaultModel] = useState(app.defaultModel);
  const [models, setModels] = useState(app.models);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .getSettings()
      .then((s) => {
        if (s.models?.length) setModels(s.models);
        if (s.defaultModel) setDefaultModel(s.defaultModel);
      })
      .catch(() => {});
  }, []);

  const saveModel = async (id: string) => {
    setDefaultModel(id);
    setSaving(true);
    await app.setDefaultModel(id);
    setSaving(false);
  };

  const current = models.find((m) => m.id === defaultModel);
  const here = window.location.origin;

  return (
    <div className="space-y-8">
      <section aria-labelledby="set-model">
        <h3 id="set-model" className="text-sm font-semibold">
          Default model
        </h3>
        <p className="mt-1 text-sm text-muted">Used for new conversations. You can switch per conversation in the chat header.</p>
        <div className="mt-3 flex items-center gap-2">
          <select
            className="input"
            value={defaultModel}
            onChange={(e) => void saveModel(e.target.value)}
            aria-label="Default model"
            disabled={saving || models.length === 0}
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} — {m.vendor}, {formatTokens(m.contextWindow)} context{m.recommended ? " (recommended)" : ""}
              </option>
            ))}
          </select>
          {saving && <Spinner className="size-4 shrink-0 text-muted" />}
        </div>
        {current?.note && <p className="mt-2 text-xs text-muted">{current.note}</p>}
      </section>

      <ChangePin />

      <ResetInstructions />

      <section aria-labelledby="set-site" className="text-sm">
        <h3 id="set-site" className="text-sm font-semibold">
          Site
        </h3>
        <a
          href={SITE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-flex items-center gap-1.5 text-accent hover:underline"
        >
          {SITE_URL.replace(/^https:\/\//, "")}
          <ExternalLink className="size-3.5" aria-hidden />
        </a>
        {here !== SITE_URL && <p className="mt-1 text-xs text-faint">You're currently on {here}</p>}
      </section>
    </div>
  );
}

function ResetInstructions() {
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    requestAnimationFrame(() => toggleRef.current?.focus());
  };
  return (
    <section aria-labelledby="set-forgot">
      <h3 id="set-forgot" className="flex items-center gap-2 text-sm font-semibold">
        <KeyRound className="size-4 text-muted" aria-hidden />
        Reset access
      </h3>
      <p className="mt-1 text-sm text-muted">
        If you ever get locked out, you can reset the PIN from the Cloudflare dashboard. These steps are also on the lock
        screen.
      </p>
      <button
        ref={toggleRef}
        type="button"
        className="btn btn-secondary btn-sm mt-3"
        aria-expanded={open}
        aria-controls="settings-reset-guide"
        onClick={() => (open ? close() : setOpen(true))}
      >
        {open ? "Hide reset instructions" : "Show reset instructions"}
        <ChevronDown className={cx("size-4 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div id="settings-reset-guide" className="mt-3">
          <ResetPinGuide onClose={close} focusOnMount />
        </div>
      )}
    </section>
  );
}

function ChangePin() {
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const digits = (v: string) => v.replace(/\D/g, "").slice(0, 12);
  const valid = /^\d{6,12}$/.test(current) && /^\d{6,12}$/.test(next) && next === confirm;
  const mismatch = confirm.length > 0 && confirm.length >= next.length && confirm !== next;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.changePin(current, next);
      toast.success("PIN changed");
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (err) {
      const ae = err as ApiError;
      if (ae.status === 401) setError("Current PIN is incorrect.");
      else if (ae.status === 429) setError("Too many attempts. Try again later.");
      else if (ae.code === "invalid_pin") setError("New PIN must be 6–12 digits.");
      else setError(ae.message);
    } finally {
      setBusy(false);
    }
  };

  const field = (id: string, label: string, value: string, set: (v: string) => void, ac: string, invalid?: boolean) => (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="input font-mono tracking-widest"
        type="password"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete={ac}
        value={value}
        aria-invalid={invalid || undefined}
        onChange={(e) => set(digits(e.target.value))}
        disabled={busy}
      />
    </div>
  );

  return (
    <section aria-labelledby="set-pin">
      <h3 id="set-pin" className="text-sm font-semibold">
        Change PIN
      </h3>
      <form onSubmit={submit} className="mt-3 space-y-3" noValidate>
        {field("cp-current", "Current PIN", current, setCurrent, "current-password")}
        <div className="grid gap-3 sm:grid-cols-2">
          {field("cp-new", "New PIN", next, setNext, "new-password")}
          {field("cp-confirm", "Confirm new PIN", confirm, setConfirm, "new-password", mismatch)}
        </div>
        <StrengthMeter pin={next} />
        {mismatch && <p className="text-xs text-danger">New PINs don't match.</p>}
        {error && (
          <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex justify-end">
          <button type="submit" className="btn btn-primary" disabled={!valid || busy}>
            {busy && <Spinner />}
            Change PIN
          </button>
        </div>
      </form>
    </section>
  );
}
