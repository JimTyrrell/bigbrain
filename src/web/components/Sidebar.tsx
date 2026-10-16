import { useState, type FormEvent } from "react";
import { FileText, Lock, MessageSquarePlus, Pencil, Plus, Settings, Trash, X } from "lucide-react";
import { useApp } from "../state/AppState";
import { useConfirm } from "./Dialog";
import { InlineEdit, Spinner } from "./ui";
import { Wordmark } from "./Logo";
import { cx, relativeTime } from "../lib/format";
import type { Brain } from "../api/types";

export function Sidebar() {
  const app = useApp();
  const { sidebarOpen, setSidebarOpen } = app;

  return (
    <>
      {/* mobile scrim */}
      <div
        className={cx(
          "fixed inset-0 z-30 bg-[var(--scrim)] transition-opacity lg:hidden",
          sidebarOpen ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={() => setSidebarOpen(false)}
        aria-hidden
      />
      <aside
        id="sidebar"
        aria-label="Sidebar"
        className={cx(
          "fixed inset-y-0 left-0 z-40 flex w-[288px] flex-col border-r border-line bg-bg-subtle transition-transform duration-200",
          "lg:static lg:z-auto lg:translate-x-0",
          sidebarOpen ? "translate-x-0 shadow-pop" : "-translate-x-full",
        )}
        onKeyDown={(e) => {
          if (e.key === "Escape" && sidebarOpen) setSidebarOpen(false);
        }}
      >
        <div className="flex h-14 items-center justify-between px-4">
          <Wordmark />
          <button className="icon-btn lg:hidden" onClick={() => setSidebarOpen(false)} aria-label="Close sidebar">
            <X className="size-5" />
          </button>
        </div>

        <nav className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          <BrainList />
          {app.brain && <BrainDetail key={app.brain.id} />}
        </nav>

        <div className="flex items-center gap-1 border-t border-line p-2">
          <button className="btn btn-ghost btn-sm flex-1 justify-start" onClick={() => app.setSettingsOpen(true)}>
            <Settings className="size-4" aria-hidden />
            Settings
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => void app.lock()} title="Lock BigBrain">
            <Lock className="size-4" aria-hidden />
            Lock
          </button>
        </div>
      </aside>
    </>
  );
}

function SectionLabel({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex h-8 items-center justify-between px-2 pt-2">
      <h2 className="text-[11px] font-semibold tracking-wider text-faint uppercase">{children}</h2>
      {action}
    </div>
  );
}

function BrainList() {
  const app = useApp();
  const [adding, setAdding] = useState(false);

  return (
    <section aria-labelledby="brains-h">
      <SectionLabel
        action={
          <button className="icon-btn icon-btn-sm" onClick={() => setAdding(true)} aria-label="New brain" title="New brain">
            <Plus className="size-4" />
          </button>
        }
      >
        <span id="brains-h">Brains</span>
      </SectionLabel>
      {!app.brainsLoaded && (
        <div className="flex items-center gap-2 px-2 py-2 text-sm text-muted">
          <Spinner /> Loading…
        </div>
      )}
      <ul className="space-y-0.5">
        {app.brains.map((b) => (
          <BrainRow key={b.id} brain={b} />
        ))}
      </ul>
      {adding ? (
        <NewBrainForm onDone={() => setAdding(false)} />
      ) : (
        <button
          className="mt-1 flex h-9 w-full items-center gap-2 rounded-lg px-2 text-sm text-muted hover:bg-surface-2 hover:text-fg"
          onClick={() => setAdding(true)}
        >
          <Plus className="size-4" aria-hidden />
          New brain
        </button>
      )}
    </section>
  );
}

export function NewBrainForm({ onDone, cancellable = true }: { onDone: () => void; cancellable?: boolean }) {
  const app = useApp();
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    const b = await app.createBrain(n, desc.trim() || undefined);
    setBusy(false);
    if (b) onDone();
  };

  return (
    <form
      onSubmit={submit}
      className="card mt-2 space-y-2 p-2"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onDone();
        }
      }}
    >
      <input
        className="input h-9 text-sm"
        placeholder="Name, e.g. Alex Hormozi"
        aria-label="Brain name"
        value={name}
        maxLength={80}
        autoFocus
        onChange={(e) => setName(e.target.value)}
      />
      <input
        className="input h-9 text-sm"
        placeholder="One-line description (optional)"
        aria-label="Brain description"
        value={desc}
        maxLength={200}
        onChange={(e) => setDesc(e.target.value)}
      />
      <div className="flex justify-end gap-2">
        {cancellable && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onDone}>
            Cancel
          </button>
        )}
        <button type="submit" className="btn btn-primary btn-sm" disabled={!name.trim() || busy}>
          {busy && <Spinner />}
          Create
        </button>
      </div>
    </form>
  );
}

function BrainRow({ brain }: { brain: Brain }) {
  const app = useApp();
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const active = app.route.brainId === brain.id;

  const onDelete = async () => {
    const ok = await confirm({
      title: `Delete “${brain.name}”?`,
      message: (
        <>
          This permanently deletes the brain, <strong>all of its documents</strong> (and their search index), and{" "}
          <strong>all of its conversations</strong>. This can't be undone.
        </>
      ),
      confirmLabel: "Delete brain",
      danger: true,
    });
    if (ok) await app.deleteBrain(brain.id);
  };

  if (editing) {
    return (
      <li className="px-1 py-0.5">
        <InlineEdit
          value={brain.name}
          ariaLabel="Rename brain"
          onCancel={() => setEditing(false)}
          onSave={async (v) => {
            setEditing(false);
            await app.updateBrain(brain.id, { name: v });
          }}
        />
      </li>
    );
  }

  return (
    <li className="group relative">
      <button
        className={cx(
          "flex h-9 w-full items-center gap-2 rounded-lg pr-16 pl-2 text-left text-sm transition-colors",
          active ? "bg-surface font-medium text-fg shadow-[0_0_0_1px_var(--line)]" : "text-muted hover:bg-surface-2 hover:text-fg",
        )}
        aria-current={active ? "true" : undefined}
        onClick={() => app.selectBrain(brain.id)}
        title={brain.description || brain.name}
      >
        <span
          className={cx(
            "flex size-5 shrink-0 items-center justify-center rounded-md text-[10px] font-semibold",
            active ? "bg-accent text-accent-fg" : "bg-surface-2 text-muted",
          )}
          aria-hidden
        >
          {brain.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="truncate">{brain.name}</span>
      </button>
      <div className="absolute inset-y-0 right-1 flex items-center gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
        <button className="icon-btn icon-btn-sm" onClick={() => setEditing(true)} aria-label={`Rename ${brain.name}`} title="Rename">
          <Pencil className="size-3.5" />
        </button>
        <button
          className="icon-btn icon-btn-sm hover:!text-danger"
          onClick={() => void onDelete()}
          aria-label={`Delete ${brain.name}`}
          title="Delete"
        >
          <Trash className="size-3.5" />
        </button>
      </div>
    </li>
  );
}

function BrainDetail() {
  const app = useApp();
  const confirm = useConfirm();
  const brain = app.brain!;
  const docCount = app.documentsLoaded ? app.documents.length : brain.documentCount;
  const pending = app.documents.filter((d) => d.indexStatus === "pending").length;

  const deleteAll = async () => {
    const ok = await confirm({
      title: "Delete all conversations?",
      message: `This deletes every conversation in “${brain.name}”. Documents are kept.`,
      confirmLabel: "Delete all",
      danger: true,
    });
    if (ok) await app.deleteAllConversations();
  };

  return (
    <>
      <section aria-labelledby="docs-h" className="mt-4">
        <SectionLabel>
          <span id="docs-h">Documents</span>
        </SectionLabel>
        <button
          className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm hover:bg-surface-2"
          onClick={() => app.setDocsOpen(true)}
        >
          <FileText className="size-4 shrink-0 text-muted" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block text-fg">Manage documents</span>
            <span className="flex items-center gap-1.5 text-xs text-muted">
              {docCount} document{docCount === 1 ? "" : "s"}
              {pending > 0 && (
                <>
                  <span aria-hidden>·</span>
                  <Spinner className="size-3" /> {pending} indexing
                </>
              )}
            </span>
          </span>
        </button>
      </section>

      <section aria-labelledby="convs-h" className="mt-4">
        <SectionLabel
          action={
            <button
              className="icon-btn icon-btn-sm"
              onClick={() => app.selectConversation(null)}
              aria-label="New chat"
              title="New chat"
            >
              <MessageSquarePlus className="size-4" />
            </button>
          }
        >
          <span id="convs-h">Conversations</span>
        </SectionLabel>
        <button
          className={cx(
            "mb-1 flex h-9 w-full items-center gap-2 rounded-lg px-2 text-sm",
            !app.route.convId ? "bg-accent-soft font-medium text-accent-soft-fg" : "text-muted hover:bg-surface-2 hover:text-fg",
          )}
          onClick={() => app.selectConversation(null)}
        >
          <Plus className="size-4" aria-hidden />
          New chat
        </button>
        {!app.conversationsLoaded && (
          <div className="flex items-center gap-2 px-2 py-2 text-sm text-muted">
            <Spinner /> Loading…
          </div>
        )}
        {app.conversationsLoaded && app.conversations.length === 0 && (
          <p className="px-2 py-2 text-xs text-faint">No conversations yet.</p>
        )}
        <ul className="space-y-0.5">
          {app.conversations.map((c) => (
            <ConversationRow key={c.id} id={c.id} title={c.title} updatedAt={c.updatedAt} />
          ))}
        </ul>
        {app.conversations.length > 0 && (
          <button
            className="mt-3 flex h-8 w-full items-center gap-2 rounded-lg px-2 text-xs text-faint hover:bg-danger-soft hover:text-danger"
            onClick={() => void deleteAll()}
          >
            <Trash className="size-3.5" aria-hidden />
            Delete all conversations
          </button>
        )}
      </section>
    </>
  );
}

function ConversationRow({ id, title, updatedAt }: { id: string; title: string; updatedAt: string }) {
  const app = useApp();
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const active = app.route.convId === id;

  if (editing) {
    return (
      <li className="px-1 py-0.5">
        <InlineEdit
          value={title}
          ariaLabel="Rename conversation"
          onCancel={() => setEditing(false)}
          onSave={async (v) => {
            setEditing(false);
            await app.renameConversation(id, v);
          }}
        />
      </li>
    );
  }

  return (
    <li className="group relative">
      <button
        className={cx(
          "flex w-full flex-col rounded-lg py-1.5 pr-16 pl-2 text-left transition-colors",
          active ? "bg-surface shadow-[0_0_0_1px_var(--line)]" : "hover:bg-surface-2",
        )}
        aria-current={active ? "page" : undefined}
        onClick={() => app.selectConversation(id)}
      >
        <span className={cx("w-full truncate text-sm", active ? "font-medium text-fg" : "text-fg/90")}>
          {title || "New chat"}
        </span>
        <span className="text-[11px] text-faint">{relativeTime(updatedAt)}</span>
      </button>
      <div className="absolute inset-y-0 right-1 flex items-center gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
        <button className="icon-btn icon-btn-sm" onClick={() => setEditing(true)} aria-label={`Rename ${title}`} title="Rename">
          <Pencil className="size-3.5" />
        </button>
        <button
          className="icon-btn icon-btn-sm hover:!text-danger"
          aria-label={`Delete ${title}`}
          title="Delete"
          onClick={async () => {
            const ok = await confirm({
              title: "Delete conversation?",
              message: `“${title}” and all its messages will be deleted.`,
              confirmLabel: "Delete",
              danger: true,
            });
            if (ok) await app.deleteConversation(id);
          }}
        >
          <Trash className="size-3.5" />
        </button>
      </div>
    </li>
  );
}
