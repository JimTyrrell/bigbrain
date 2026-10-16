import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api, ApiError, setErrorHandler, setUnauthorizedHandler } from "../api/client";
import { isWarmingUp, type Brain, type BrainDocument, type Conversation, type ModelInfo } from "../api/types";
import { parseHash, writeHash, type Route } from "../lib/route";
import { useToast } from "../components/Toasts";

export type AuthPhase = "loading" | "setup" | "login" | "ready" | "offline";

type AppState = {
  auth: AuthPhase;
  checkAuth: () => Promise<void>;
  onAuthenticated: () => void;
  lock: () => Promise<void>;

  models: ModelInfo[];
  defaultModel: string;
  setDefaultModel: (id: string) => Promise<void>;
  modelLabel: (id: string | null | undefined) => string;

  brains: Brain[];
  brainsLoaded: boolean;
  brain: Brain | null;
  createBrain: (name: string, description?: string) => Promise<Brain | null>;
  updateBrain: (id: string, patch: { name?: string; description?: string }) => Promise<void>;
  deleteBrain: (id: string) => Promise<void>;
  refreshBrains: () => Promise<void>;

  route: Route;
  selectBrain: (id: string | null) => void;
  selectConversation: (id: string | null, opts?: { replace?: boolean }) => void;

  conversations: Conversation[];
  conversationsLoaded: boolean;
  refreshConversations: () => Promise<void>;
  upsertConversation: (c: Conversation) => void;
  renameConversation: (id: string, title: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  deleteAllConversations: () => Promise<void>;

  documents: BrainDocument[];
  documentsLoaded: boolean;
  refreshDocuments: () => Promise<void>;
  upsertDocument: (d: BrainDocument) => void;
  removeDocument: (id: string) => void;

  sidebarOpen: boolean;
  setSidebarOpen: (v: boolean) => void;
  docsOpen: boolean;
  setDocsOpen: (v: boolean) => void;
  settingsOpen: boolean;
  setSettingsOpen: (v: boolean) => void;
};

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp outside AppProvider");
  return v;
}

const sortConvs = (list: Conversation[]) =>
  [...list].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));

export function AppProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [auth, setAuth] = useState<AuthPhase>("loading");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [defaultModel, setDefaultModelState] = useState("");
  const [brains, setBrains] = useState<Brain[]>([]);
  const [brainsLoaded, setBrainsLoaded] = useState(false);
  const [route, setRoute] = useState<Route>(() => parseHash());
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationsLoaded, setConversationsLoaded] = useState(false);
  const [documents, setDocuments] = useState<BrainDocument[]>([]);
  const [documentsLoaded, setDocumentsLoaded] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [docsOpen, setDocsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const routeRef = useRef(route);
  routeRef.current = route;

  /* ---------- auth ---------- */
  const checkAuth = useCallback(async () => {
    try {
      const s = await api.authStatus();
      setAuth(!s.pinSet ? "setup" : s.authenticated ? "ready" : "login");
    } catch {
      setAuth("offline");
    }
  }, []);

  const resetData = useCallback(() => {
    setBrains([]);
    setBrainsLoaded(false);
    setConversations([]);
    setConversationsLoaded(false);
    setDocuments([]);
    setDocumentsLoaded(false);
    setDocsOpen(false);
    setSettingsOpen(false);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      resetData();
      setAuth((a) => (a === "ready" ? "login" : a));
    });
    setErrorHandler((e: ApiError) => toast.error(e.message));
    void checkAuth();
  }, [checkAuth, resetData, toast]);

  const onAuthenticated = useCallback(() => setAuth("ready"), []);

  const lock = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      /* ignore */
    }
    resetData();
    setAuth("login");
  }, [resetData]);

  /* ---------- routing ---------- */
  useEffect(() => {
    const onPop = () => setRoute(parseHash());
    window.addEventListener("popstate", onPop);
    window.addEventListener("hashchange", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("hashchange", onPop);
    };
  }, []);

  const navigate = useCallback((r: Route, replace = false) => {
    setRoute((cur) => (cur.brainId === r.brainId && cur.convId === r.convId ? cur : r));
    writeHash(r, replace);
  }, []);

  const selectBrain = useCallback(
    (id: string | null) => {
      navigate({ brainId: id, convId: null });
      setSidebarOpen(false);
    },
    [navigate],
  );

  const selectConversation = useCallback(
    (id: string | null, opts?: { replace?: boolean }) => {
      navigate({ brainId: routeRef.current.brainId, convId: id }, opts?.replace);
      setSidebarOpen(false);
    },
    [navigate],
  );

  /* ---------- models & brains on login ---------- */
  const refreshBrains = useCallback(async () => {
    try {
      const list = await api.listBrains();
      setBrains(list);
    } finally {
      setBrainsLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (auth !== "ready") return;
    void refreshBrains().catch(() => {});
    api
      .getModels()
      .then((r) => {
        setModels(r.models ?? []);
        setDefaultModelState(r.defaultModel ?? r.models?.[0]?.id ?? "");
      })
      .catch(() => {});
  }, [auth, refreshBrains]);

  // Keep the selected brain valid: fall back to the first brain.
  useEffect(() => {
    if (auth !== "ready" || !brainsLoaded) return;
    const exists = route.brainId && brains.some((b) => b.id === route.brainId);
    if (!exists) {
      const first = brains[0]?.id ?? null;
      if (first !== route.brainId) navigate({ brainId: first, convId: null }, true);
    }
  }, [auth, brains, brainsLoaded, route.brainId, navigate]);

  const brain = useMemo(() => brains.find((b) => b.id === route.brainId) ?? null, [brains, route.brainId]);

  const createBrain = useCallback(
    async (name: string, description?: string) => {
      try {
        const b = await api.createBrain(name, description);
        setBrains((list) => [...list, b]);
        navigate({ brainId: b.id, convId: null });
        toast.success(`Created “${b.name}”`);
        return b;
      } catch {
        return null;
      }
    },
    [navigate, toast],
  );

  const updateBrain = useCallback(async (id: string, patch: { name?: string; description?: string }) => {
    try {
      const b = await api.updateBrain(id, patch);
      setBrains((list) => list.map((x) => (x.id === id ? { ...x, ...b } : x)));
    } catch {
      /* toasted */
    }
  }, []);

  const deleteBrain = useCallback(
    async (id: string) => {
      try {
        await api.deleteBrain(id);
        setBrains((list) => list.filter((x) => x.id !== id));
        if (routeRef.current.brainId === id) navigate({ brainId: null, convId: null }, true);
        toast.success("Brain deleted");
      } catch {
        /* toasted */
      }
    },
    [navigate, toast],
  );

  /* ---------- conversations ---------- */
  const brainId = brain?.id ?? null;

  const refreshConversations = useCallback(async () => {
    const id = routeRef.current.brainId;
    if (!id) return;
    try {
      const list = await api.listConversations(id);
      if (routeRef.current.brainId === id) setConversations(sortConvs(list));
    } catch {
      /* toasted */
    } finally {
      if (routeRef.current.brainId === id) setConversationsLoaded(true);
    }
  }, []);

  const refreshDocuments = useCallback(async () => {
    const id = routeRef.current.brainId;
    if (!id) return;
    try {
      const list = await api.listDocuments(id, { quiet: true });
      if (routeRef.current.brainId === id) {
        setDocuments(list);
        setBrains((bs) => bs.map((b) => (b.id === id ? { ...b, documentCount: list.length } : b)));
      }
    } catch {
      /* polling errors are silent */
    } finally {
      if (routeRef.current.brainId === id) setDocumentsLoaded(true);
    }
  }, []);

  useEffect(() => {
    setConversations([]);
    setConversationsLoaded(false);
    setDocuments([]);
    setDocumentsLoaded(false);
    if (auth !== "ready" || !brainId) return;
    void refreshConversations();
    void refreshDocuments();
  }, [auth, brainId, refreshConversations, refreshDocuments]);

  // Poll while any document is pending, or indexed but not yet searchable in Vectorize.
  const anyPending = documents.some((d) => d.indexStatus === "pending" || isWarmingUp(d));
  useEffect(() => {
    if (!anyPending || auth !== "ready") return;
    const t = window.setInterval(() => void refreshDocuments(), 2500);
    return () => window.clearInterval(t);
  }, [anyPending, auth, refreshDocuments]);

  const upsertConversation = useCallback((c: Conversation) => {
    if (c.brainId !== routeRef.current.brainId) return;
    setConversations((list) => sortConvs([c, ...list.filter((x) => x.id !== c.id)]));
  }, []);

  const renameConversation = useCallback(
    async (id: string, title: string) => {
      try {
        const c = await api.updateConversation(id, { title });
        upsertConversation(c);
      } catch {
        /* toasted */
      }
    },
    [upsertConversation],
  );

  const deleteConversation = useCallback(
    async (id: string) => {
      try {
        await api.deleteConversation(id);
        setConversations((list) => list.filter((x) => x.id !== id));
        if (routeRef.current.convId === id) selectConversation(null, { replace: true });
        toast.success("Conversation deleted");
      } catch {
        /* toasted */
      }
    },
    [selectConversation, toast],
  );

  const deleteAllConversations = useCallback(async () => {
    const id = routeRef.current.brainId;
    if (!id) return;
    try {
      await api.deleteAllConversations(id);
      setConversations([]);
      selectConversation(null, { replace: true });
      toast.success("All conversations deleted");
    } catch {
      /* toasted */
    }
  }, [selectConversation, toast]);

  const upsertDocument = useCallback((d: BrainDocument) => {
    if (d.brainId !== routeRef.current.brainId) return;
    setDocuments((list) => {
      const i = list.findIndex((x) => x.id === d.id);
      if (i === -1) return [d, ...list];
      const next = [...list];
      next[i] = { ...next[i], ...d, content: undefined };
      return next;
    });
  }, []);

  const removeDocument = useCallback((id: string) => {
    setDocuments((list) => list.filter((x) => x.id !== id));
  }, []);

  /* ---------- settings ---------- */
  const setDefaultModel = useCallback(
    async (id: string) => {
      try {
        const r = await api.putSettings(id);
        setDefaultModelState(r.defaultModel ?? id);
        toast.success("Default model saved");
      } catch {
        /* toasted */
      }
    },
    [toast],
  );

  const modelLabel = useCallback(
    (id: string | null | undefined) => {
      if (!id) return "Unknown model";
      return models.find((m) => m.id === id)?.label ?? id.split("/").pop() ?? id;
    },
    [models],
  );

  const value: AppState = {
    auth,
    checkAuth,
    onAuthenticated,
    lock,
    models,
    defaultModel,
    setDefaultModel,
    modelLabel,
    brains,
    brainsLoaded,
    brain,
    createBrain,
    updateBrain,
    deleteBrain,
    refreshBrains,
    route,
    selectBrain,
    selectConversation,
    conversations,
    conversationsLoaded,
    refreshConversations,
    upsertConversation,
    renameConversation,
    deleteConversation,
    deleteAllConversations,
    documents,
    documentsLoaded,
    refreshDocuments,
    upsertDocument,
    removeDocument,
    sidebarOpen,
    setSidebarOpen,
    docsOpen,
    setDocsOpen,
    settingsOpen,
    setSettingsOpen,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
