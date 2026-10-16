import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { FileText, Menu, Pencil, Plus } from "lucide-react";
import { api, ApiError } from "../api/client";
import type { Conversation, Message } from "../api/types";
import { useApp } from "../state/AppState";
import { Composer, type ComposerHandle } from "./Composer";
import { MessageView, type UiMessage } from "./MessageView";
import { ModelPicker } from "./ModelPicker";
import { useToast } from "./Toasts";
import { InlineEdit, Spinner } from "./ui";

const tmpId = () => `tmp-${Math.random().toString(36).slice(2, 10)}`;

export function ChatView() {
  const app = useApp();
  const toast = useToast();
  const brain = app.brain!;
  const convId = app.route.convId;

  const [conv, setConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [draftModel, setDraftModel] = useState<string | null>(null);
  const [modelBusy, setModelBusy] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingDesc, setEditingDesc] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const skipLoadRef = useRef<string | null>(null);
  const composerRef = useRef<ComposerHandle>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  /* ---------- load conversation ---------- */
  useEffect(() => {
    if (convId && skipLoadRef.current === convId) {
      // we just created this conversation and are already streaming into it
      skipLoadRef.current = null;
      return;
    }
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
    setEditingTitle(false);
    if (!convId) {
      setConv(null);
      setMessages([]);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setMessages([]);
    api
      .getConversation(convId, { quiet: true })
      .then((r) => {
        if (!alive) return;
        if (r.conversation.brainId && r.conversation.brainId !== brain.id) {
          app.selectConversation(null, { replace: true });
          return;
        }
        setConv(r.conversation);
        setMessages(r.messages ?? []);
        stickRef.current = true;
      })
      .catch((e: ApiError) => {
        if (!alive) return;
        if (e.status === 404) toast.error("That conversation no longer exists.");
        else if (e.status !== 401) toast.error(e.message);
        app.selectConversation(null, { replace: true });
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convId, brain.id]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // keep local conv in sync with sidebar renames
  const listed = app.conversations.find((c) => c.id === conv?.id);
  useEffect(() => {
    if (listed && conv && listed.title !== conv.title) setConv((c) => (c ? { ...c, title: listed.title } : c));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listed?.title]);

  /* ---------- scroll ---------- */
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  /* ---------- keyboard shortcuts ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.closest("input, textarea, select, [contenteditable=true]");
      if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey && !document.querySelector("dialog[open]")) {
        e.preventDefault();
        composerRef.current?.focus();
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "o" || e.key === "O")) {
        e.preventDefault();
        app.selectConversation(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [app]);

  /* ---------- model ---------- */
  const model = conv?.model || draftModel || app.defaultModel;

  const changeModel = async (id: string) => {
    if (!conv) {
      setDraftModel(id);
      return;
    }
    const prev = conv.model;
    setConv({ ...conv, model: id });
    setModelBusy(true);
    try {
      const c = await api.updateConversation(conv.id, { model: id });
      setConv((cur) => (cur && cur.id === c.id ? { ...cur, ...c } : cur));
      app.upsertConversation(c);
    } catch {
      setConv((cur) => (cur ? { ...cur, model: prev } : cur));
    } finally {
      setModelBusy(false);
    }
  };

  /* ---------- send ---------- */
  const patchMsg = (id: string, f: (m: UiMessage) => UiMessage) =>
    setMessages((list) => list.map((m) => (m.id === id ? f(m) : m)));

  const send = useCallback(
    async (text: string) => {
      if (streaming) return;
      let c = conv;
      if (!c) {
        try {
          c = await api.createConversation(brain.id, model || undefined);
        } catch {
          return;
        }
        skipLoadRef.current = c.id;
        setConv(c);
        app.upsertConversation(c);
        app.selectConversation(c.id);
        setDraftModel(null);
      }
      const conversation = c;
      const now = new Date().toISOString();
      const userId = tmpId();
      let asstId = tmpId();
      const userMsg: UiMessage = {
        id: userId,
        conversationId: conversation.id,
        role: "user",
        content: text,
        model: null,
        citations: [],
        createdAt: now,
      };
      const asst: UiMessage = {
        id: asstId,
        conversationId: conversation.id,
        role: "assistant",
        content: "",
        model: conversation.model || model,
        citations: [],
        createdAt: now,
        streaming: true,
      };
      stickRef.current = true;
      setMessages((list) => [...list, userMsg, asst]);
      setStreaming(true);

      const ctrl = new AbortController();
      abortRef.current = ctrl;

      // batch tokens per animation frame to keep markdown rendering cheap
      let pending = "";
      let raf = 0;
      const flush = () => {
        raf = 0;
        if (!pending) return;
        const chunk = pending;
        pending = "";
        patchMsg(asstId, (m) => ({ ...m, content: m.content + chunk }));
      };

      await api.sendMessage(
        conversation.id,
        { content: text, model: conversation.model || model || undefined },
        {
          onMeta: (meta) => {
            flush();
            const oldA = asstId;
            asstId = meta.assistantMessageId || asstId;
            setMessages((list) =>
              list.map((m) =>
                m.id === userId
                  ? { ...m, id: meta.userMessageId || m.id }
                  : m.id === oldA
                    ? { ...m, id: asstId, model: meta.model || m.model }
                    : m,
              ),
            );
          },
          onCitations: (cits) => patchMsg(asstId, (m) => ({ ...m, citations: cits })),
          onToken: (t) => {
            pending += t;
            if (!raf) raf = requestAnimationFrame(flush);
          },
          onDone: (msg: Message) => {
            if (raf) cancelAnimationFrame(raf);
            flush();
            const finalId = asstId;
            setMessages((list) =>
              list.map((m) =>
                m.id === finalId
                  ? {
                      ...m,
                      ...msg,
                      content: msg?.content ?? m.content,
                      citations: msg?.citations ?? m.citations,
                      streaming: false,
                    }
                  : m,
              ),
            );
            if (msg?.id) asstId = msg.id;
          },
          onError: (e) => {
            if (raf) cancelAnimationFrame(raf);
            flush();
            patchMsg(asstId, (m) => ({ ...m, streaming: false, error: e.message || "Something went wrong." }));
          },
        },
        ctrl.signal,
      );

      if (raf) cancelAnimationFrame(raf);
      flush();
      if (ctrl.signal.aborted) {
        patchMsg(asstId, (m) => (m.streaming ? { ...m, streaming: false, stopped: true } : m));
      } else {
        patchMsg(asstId, (m) => (m.streaming ? { ...m, streaming: false } : m));
      }
      if (abortRef.current === ctrl) abortRef.current = null;
      setStreaming(false);

      // pick up auto-title / counts
      try {
        const r = await api.getConversation(conversation.id, { quiet: true });
        setConv((cur) => (cur && cur.id === r.conversation.id ? { ...cur, ...r.conversation } : cur));
        app.upsertConversation(r.conversation);
      } catch {
        /* ignore */
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [conv, streaming, brain.id, model, app],
  );

  const stop = () => abortRef.current?.abort();

  /* ---------- render ---------- */
  const docCount = app.documentsLoaded ? app.documents.length : brain.documentCount;
  const showEmpty = !convId && messages.length === 0;
  const examples = [
    `What are ${brain.name}'s most important ideas?`,
    `What does ${brain.name} say is the biggest mistake beginners make?`,
    `Give me three actionable takeaways, with quotes.`,
  ];

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <header className="flex min-h-14 items-center gap-2 border-b border-line px-3 py-2 sm:px-4">
        <button
          className="icon-btn lg:hidden"
          onClick={() => app.setSidebarOpen(true)}
          aria-label="Open sidebar"
          aria-controls="sidebar"
          aria-expanded={app.sidebarOpen}
        >
          <Menu className="size-5" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="shrink-0 truncate text-[15px] font-semibold">{brain.name}</h1>
            {conv && (
              <>
                <span className="text-faint" aria-hidden>
                  /
                </span>
                {editingTitle ? (
                  <InlineEdit
                    value={conv.title}
                    ariaLabel="Conversation title"
                    className="max-w-xs"
                    onCancel={() => setEditingTitle(false)}
                    onSave={async (v) => {
                      setEditingTitle(false);
                      setConv({ ...conv, title: v });
                      await app.renameConversation(conv.id, v);
                    }}
                  />
                ) : (
                  <button
                    className="group/t flex min-w-0 items-center gap-1 rounded-md px-1 text-sm text-muted hover:bg-surface-2 hover:text-fg"
                    onClick={() => setEditingTitle(true)}
                    title="Rename conversation"
                  >
                    <span className="truncate">{conv.title || "New chat"}</span>
                    <Pencil className="size-3 shrink-0 opacity-0 group-hover/t:opacity-100" aria-hidden />
                  </button>
                )}
              </>
            )}
          </div>
          {editingDesc ? (
            <div className="mt-1 max-w-md">
              <InlineEdit
                value={brain.description}
                ariaLabel="Brain description"
                placeholder="One-line description, e.g. business and marketing"
                maxLength={200}
                onCancel={() => setEditingDesc(false)}
                onSave={async (v) => {
                  setEditingDesc(false);
                  await app.updateBrain(brain.id, { description: v });
                }}
              />
            </div>
          ) : (
            <button
              className="block max-w-full truncate text-left text-xs text-muted hover:text-fg"
              onClick={() => setEditingDesc(true)}
              title="Edit description"
            >
              {brain.description || <span className="text-faint">Add a description…</span>}
            </button>
          )}
        </div>
        <ModelPicker
          models={app.models}
          value={model}
          defaultModel={app.defaultModel}
          onChange={(id) => void changeModel(id)}
          busy={modelBusy}
          disabled={streaming}
        />
      </header>

      <div ref={scrollRef} onScroll={onScroll} className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <Spinner className="size-5 text-muted" label="Loading conversation" />
          </div>
        ) : showEmpty ? (
          <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center px-6 py-12 text-center">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-lg font-semibold text-accent-soft-fg">
              {brain.name.slice(0, 1).toUpperCase()}
            </div>
            <h2 className="mt-4 text-2xl font-semibold tracking-tight">Ask {brain.name} anything</h2>
            <p className="mt-2 max-w-md text-sm text-muted">
              Answers quote {brain.name} directly from {docCount} document{docCount === 1 ? "" : "s"}, with sources you can open.
            </p>
            {docCount === 0 ? (
              <button className="btn btn-primary mt-6" onClick={() => app.setDocsOpen(true)}>
                <Plus className="size-4" aria-hidden /> Add documents first
              </button>
            ) : (
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                {examples.map((q) => (
                  <button
                    key={q}
                    className="rounded-full border border-line-strong bg-surface px-3.5 py-2 text-left text-sm text-fg hover:border-accent hover:bg-accent-soft"
                    onClick={() => void send(q)}
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}
            {docCount > 0 && (
              <button className="mt-6 inline-flex items-center gap-1.5 text-xs text-muted hover:text-fg" onClick={() => app.setDocsOpen(true)}>
                <FileText className="size-3.5" aria-hidden /> Manage documents
              </button>
            )}
          </div>
        ) : (
          <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 sm:px-6" role="log" aria-live="polite" aria-relevant="additions">
            {messages.map((m) => (
              <MessageView key={m.id} message={m} modelLabel={app.modelLabel(m.model)} />
            ))}
          </div>
        )}
      </div>

      <div className="bg-bg pt-2">
        <Composer
          ref={composerRef}
          onSend={(t) => void send(t)}
          onStop={stop}
          streaming={streaming}
          disabled={loading}
          placeholder={`Ask ${brain.name}…`}
        />
      </div>
    </div>
  );
}
