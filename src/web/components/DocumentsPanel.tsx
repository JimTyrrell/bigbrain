import { useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import { ArrowUp, CircleAlert, ClipboardPaste, FileText, FileUp, Pencil, Plus, RefreshCw, Trash, Upload } from "lucide-react";
import { api } from "../api/client";
import type { BrainDocument } from "../api/types";
import { useApp } from "../state/AppState";
import { Modal, useConfirm } from "./Dialog";
import { useToast } from "./Toasts";
import { Spinner } from "./ui";
import { cx, formatBytes, relativeTime } from "../lib/format";

const ACCEPT =
  ".pdf,.docx,.xlsx,.pptx,.html,.htm,.csv,.txt,.md,.markdown,.vtt,.srt,.png,.jpg,.jpeg,.webp,.svg,image/*,text/plain,text/markdown,text/csv,text/html,application/pdf";
const ACCEPT_LABEL = "PDF, DOCX, XLSX, PPTX, HTML, CSV, images, TXT, MD, VTT/SRT";
const MAX_BYTES = 25 * 1024 * 1024;

type View = { kind: "list" } | { kind: "add" } | { kind: "edit"; id: string };

export function DocumentsPanel() {
  const app = useApp();
  const [view, setView] = useState<View>({ kind: "list" });
  const open = app.docsOpen && !!app.brain;

  useEffect(() => {
    if (!open) setView({ kind: "list" });
    else void app.refreshDocuments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const title =
    view.kind === "add" ? "Add document" : view.kind === "edit" ? "Edit document" : `Documents`;

  return (
    <Modal
      open={open}
      onClose={() => app.setDocsOpen(false)}
      variant="right"
      title={title}
      description={
        view.kind === "list" ? (
          <>
            Sources <strong className="font-medium text-fg">{app.brain?.name}</strong> answers from.
          </>
        ) : undefined
      }
    >
      {view.kind === "list" && (
        <DocumentList onAdd={() => setView({ kind: "add" })} onEdit={(id) => setView({ kind: "edit", id })} />
      )}
      {view.kind === "add" && <AddDocument onDone={() => setView({ kind: "list" })} />}
      {view.kind === "edit" && <EditDocument id={view.id} onDone={() => setView({ kind: "list" })} />}
    </Modal>
  );
}

/* ---------- list ---------- */

function StatusPill({ doc }: { doc: BrainDocument }) {
  if (doc.indexStatus === "pending")
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning">
        <Spinner className="size-3" /> Indexing
      </span>
    );
  if (doc.indexStatus === "error")
    return (
      <span
        className="inline-flex max-w-[16rem] items-center gap-1.5 rounded-full bg-danger-soft px-2 py-0.5 text-xs font-medium text-danger"
        title={doc.indexError ?? "Indexing failed"}
      >
        <CircleAlert className="size-3 shrink-0" aria-hidden />
        <span className="truncate">Error{doc.indexError ? `: ${doc.indexError}` : ""}</span>
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-2 py-0.5 text-xs font-medium text-success">
      {doc.chunkCount} chunk{doc.chunkCount === 1 ? "" : "s"}
    </span>
  );
}

const TYPE_LABEL: Record<string, string> = { upload: "Upload", text: "Text", transcript: "Transcript" };

function DocumentList({ onAdd, onEdit }: { onAdd: () => void; onEdit: (id: string) => void }) {
  const app = useApp();
  const confirm = useConfirm();
  const toast = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);
  const docs = [...app.documents].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));

  const reindex = async (d: BrainDocument) => {
    setBusyId(d.id);
    try {
      const doc = await api.reindexDocument(d.id);
      app.upsertDocument(doc ?? { ...d, indexStatus: "pending" });
      toast.info(`Re-indexing “${d.title}”…`);
    } catch {
      /* toasted */
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (d: BrainDocument) => {
    const ok = await confirm({
      title: "Delete document?",
      message: `“${d.title}” and its search index will be removed from this brain.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    setBusyId(d.id);
    try {
      await api.deleteDocument(d.id);
      app.removeDocument(d.id);
      void app.refreshDocuments();
      toast.success("Document deleted");
    } catch {
      /* toasted */
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted">
          {docs.length} document{docs.length === 1 ? "" : "s"}
        </p>
        <button className="btn btn-primary" onClick={onAdd}>
          <Plus className="size-4" aria-hidden /> Add document
        </button>
      </div>

      {!app.documentsLoaded && (
        <div className="flex justify-center py-10">
          <Spinner className="size-5 text-muted" label="Loading documents" />
        </div>
      )}

      {app.documentsLoaded && docs.length === 0 && (
        <div className="rounded-xl border border-dashed border-line-strong px-6 py-12 text-center">
          <FileText className="mx-auto size-8 text-faint" aria-hidden />
          <p className="mt-3 font-medium">No documents yet</p>
          <p className="mt-1 text-sm text-muted">Upload a file or paste a transcript to give this brain something to say.</p>
          <button className="btn btn-secondary mt-4" onClick={onAdd}>
            <Plus className="size-4" aria-hidden /> Add the first document
          </button>
        </div>
      )}

      <ul className="space-y-2">
        {docs.map((d) => (
          <li key={d.id} className="card group flex items-start gap-3 p-3">
            <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted">
              <FileText className="size-4" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium" title={d.title}>
                {d.title}
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                <span className="rounded-md border border-line px-1.5 py-0.5">{TYPE_LABEL[d.sourceType] ?? d.sourceType}</span>
                <StatusPill doc={d} />
                <span>{formatBytes(d.bytes)}</span>
                <span aria-hidden>·</span>
                <span>{relativeTime(d.updatedAt || d.createdAt)}</span>
              </div>
              {d.sourceUrl && (
                <a
                  href={d.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 block truncate text-xs text-accent hover:underline"
                >
                  {d.sourceUrl}
                </a>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              {busyId === d.id ? (
                <Spinner className="m-2 size-4 text-muted" />
              ) : (
                <>
                  <button className="icon-btn" onClick={() => onEdit(d.id)} aria-label={`Edit ${d.title}`} title="Edit">
                    <Pencil className="size-4" />
                  </button>
                  <button
                    className="icon-btn"
                    onClick={() => void reindex(d)}
                    aria-label={`Re-index ${d.title}`}
                    title="Re-index"
                    disabled={d.indexStatus === "pending"}
                  >
                    <RefreshCw className="size-4" />
                  </button>
                  <button
                    className="icon-btn hover:!text-danger"
                    onClick={() => void remove(d)}
                    aria-label={`Delete ${d.title}`}
                    title="Delete"
                  >
                    <Trash className="size-4" />
                  </button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------- add ---------- */

function AddDocument({ onDone }: { onDone: () => void }) {
  const [tab, setTab] = useState<"upload" | "text">("upload");
  const tabs = [
    { id: "upload" as const, label: "Upload file", icon: FileUp },
    { id: "text" as const, label: "Paste text", icon: ClipboardPaste },
  ];
  return (
    <div className="space-y-5">
      <div role="tablist" aria-label="Add document method" className="inline-flex rounded-xl bg-surface-2 p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            className={cx(
              "flex h-8 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors",
              tab === t.id ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg",
            )}
            onClick={() => setTab(t.id)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                e.preventDefault();
                const next = tab === "upload" ? "text" : "upload";
                setTab(next);
                document.getElementById(`tab-${next}`)?.focus();
              }
            }}
          >
            <t.icon className="size-4" aria-hidden />
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "upload" ? <UploadForm onDone={onDone} /> : <PasteForm onDone={onDone} />}
      </div>
    </div>
  );
}

function UploadForm({ onDone }: { onDone: () => void }) {
  const app = useApp();
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const pick = (f: File | undefined | null) => {
    if (!f) return;
    if (f.size > MAX_BYTES) {
      toast.error("That file is larger than 25 MB.");
      return;
    }
    setFile(f);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    pick(e.dataTransfer.files?.[0]);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file || !app.brain || busy) return;
    setBusy(true);
    try {
      const doc = await api.uploadDocument(app.brain.id, file, {
        title: title.trim() || undefined,
        sourceUrl: sourceUrl.trim() || undefined,
      });
      if (doc) app.upsertDocument(doc);
      void app.refreshDocuments();
      toast.success(`Added “${doc?.title ?? file.name}”. Indexing…`);
      onDone();
    } catch {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div
        className={cx(
          "flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors",
          drag ? "border-accent bg-accent-soft" : "border-line-strong hover:border-accent/60",
        )}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
      >
        <Upload className="size-7 text-muted" aria-hidden />
        {file ? (
          <>
            <p className="mt-3 max-w-full truncate text-sm font-medium">{file.name}</p>
            <p className="text-xs text-muted">{formatBytes(file.size)}</p>
            <button type="button" className="btn btn-ghost btn-sm mt-2" onClick={() => inputRef.current?.click()}>
              Choose a different file
            </button>
          </>
        ) : (
          <>
            <p className="mt-3 text-sm">
              Drag a file here, or{" "}
              <button
                type="button"
                className="font-medium text-accent underline-offset-2 hover:underline"
                onClick={() => inputRef.current?.click()}
              >
                browse
              </button>
            </p>
            <p className="mt-1 text-xs text-muted">{ACCEPT_LABEL} · up to 25 MB</p>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          className="sr-only"
          accept={ACCEPT}
          aria-label="Choose file to upload"
          onChange={(e) => {
            pick(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="up-title">
            Title <span className="font-normal text-faint">(optional)</span>
          </label>
          <input
            id="up-title"
            className="input"
            value={title}
            placeholder={file?.name.replace(/\.[^.]+$/, "") ?? "Defaults to file name"}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="up-url">
            Source URL <span className="font-normal text-faint">(optional)</span>
          </label>
          <input
            id="up-url"
            className="input"
            type="url"
            inputMode="url"
            value={sourceUrl}
            placeholder="https://youtube.com/watch?v=…"
            onChange={(e) => setSourceUrl(e.target.value)}
          />
        </div>
      </div>
      <p className="text-xs text-muted">
        Tip: for YouTube, upload the <span className="font-mono">.vtt</span>/<span className="font-mono">.srt</span> captions and
        set the video URL so citations can jump to the exact moment.
      </p>
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" className="btn btn-secondary" onClick={onDone} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={!file || busy}>
          {busy ? <Spinner /> : <ArrowUp className="size-4" aria-hidden />}
          {busy ? "Uploading…" : "Upload"}
        </button>
      </div>
    </form>
  );
}

function PasteForm({ onDone }: { onDone: () => void }) {
  const app = useApp();
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const looksLikeTranscript = /\[\d{1,2}:\d{2}(?::\d{2})?\]/.test(content);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!app.brain || !title.trim() || !content.trim() || busy) return;
    setBusy(true);
    try {
      const doc = await api.createTextDocument(app.brain.id, {
        title: title.trim(),
        content,
        sourceUrl: sourceUrl.trim() || undefined,
        sourceType: looksLikeTranscript ? "transcript" : "text",
      });
      if (doc) app.upsertDocument(doc);
      void app.refreshDocuments();
      toast.success(`Added “${title.trim()}”. Indexing…`);
      onDone();
    } catch {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="tx-title">
            Title
          </label>
          <input
            id="tx-title"
            className="input"
            required
            value={title}
            placeholder="e.g. How to price your offer"
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="tx-url">
            Source URL <span className="font-normal text-faint">(optional)</span>
          </label>
          <input
            id="tx-url"
            className="input"
            type="url"
            inputMode="url"
            value={sourceUrl}
            placeholder="https://youtube.com/watch?v=…"
            onChange={(e) => setSourceUrl(e.target.value)}
          />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="tx-content">
          Content <span className="font-normal text-faint">(Markdown or plain text)</span>
        </label>
        <textarea
          id="tx-content"
          className="input min-h-[18rem] resize-y font-mono text-[13px]"
          value={content}
          placeholder={"[00:00] Paste the transcript or article here…"}
          onChange={(e) => setContent(e.target.value)}
        />
        <p className="mt-1.5 text-xs text-muted">
          {content.length.toLocaleString()} characters
          {looksLikeTranscript && " · timestamps detected, saved as a transcript"}
        </p>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" className="btn btn-secondary" onClick={onDone} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={!title.trim() || !content.trim() || busy}>
          {busy && <Spinner />}
          {busy ? "Saving…" : "Add document"}
        </button>
      </div>
    </form>
  );
}

/* ---------- edit ---------- */

function EditDocument({ id, onDone }: { id: string; onDone: () => void }) {
  const app = useApp();
  const toast = useToast();
  const [doc, setDoc] = useState<BrainDocument | null>(null);
  const [title, setTitle] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .getDocument(id)
      .then((d) => {
        if (!alive) return;
        setDoc(d);
        setTitle(d.title);
        setSourceUrl(d.sourceUrl ?? "");
        setContent(d.content ?? "");
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [id]);

  if (failed)
    return (
      <div className="py-10 text-center text-sm text-muted">
        Couldn't load this document.
        <div className="mt-4">
          <button className="btn btn-secondary" onClick={onDone}>
            Back
          </button>
        </div>
      </div>
    );
  if (!doc)
    return (
      <div className="flex justify-center py-10">
        <Spinner className="size-5 text-muted" label="Loading document" />
      </div>
    );

  const contentChanged = content !== (doc.content ?? "");
  const patch: { title?: string; sourceUrl?: string | null; content?: string } = {};
  if (title.trim() && title.trim() !== doc.title) patch.title = title.trim();
  if (sourceUrl.trim() !== (doc.sourceUrl ?? "")) patch.sourceUrl = sourceUrl.trim() || null;
  if (contentChanged) patch.content = content;
  const dirty = Object.keys(patch).length > 0;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!dirty || busy) return;
    setBusy(true);
    try {
      const d = await api.updateDocument(id, patch);
      app.upsertDocument(d ?? { ...doc, ...patch, indexStatus: contentChanged ? "pending" : doc.indexStatus } as BrainDocument);
      void app.refreshDocuments();
      toast.success(contentChanged ? "Saved. Re-indexing…" : "Saved");
      onDone();
    } catch {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} className="flex h-full min-h-[calc(100vh-10rem)] flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="ed-title">
            Title
          </label>
          <input id="ed-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="ed-url">
            Source URL
          </label>
          <input
            id="ed-url"
            className="input"
            type="url"
            inputMode="url"
            value={sourceUrl}
            placeholder="https://…"
            onChange={(e) => setSourceUrl(e.target.value)}
          />
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <label className="label" htmlFor="ed-content">
          Content (Markdown)
        </label>
        <textarea
          id="ed-content"
          className="input min-h-[24rem] flex-1 resize-y font-mono text-[13px] leading-relaxed"
          value={content}
          spellCheck={false}
          onChange={(e) => setContent(e.target.value)}
        />
        <p className="mt-1.5 text-xs text-muted">
          {content.length.toLocaleString()} characters
          {contentChanged && " · saving will re-index this document"}
        </p>
      </div>
      <div className="sticky bottom-0 -mx-6 -mb-5 flex justify-end gap-2 border-t border-line bg-surface px-6 py-4">
        <button type="button" className="btn btn-secondary" onClick={onDone} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={!dirty || busy}>
          {busy && <Spinner />}
          {busy ? (contentChanged ? "Re-indexing…" : "Saving…") : "Save"}
        </button>
      </div>
    </form>
  );
}
