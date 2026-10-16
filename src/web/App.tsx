import { Menu } from "lucide-react";
import { AppProvider, useApp } from "./state/AppState";
import { ToastProvider } from "./components/Toasts";
import { ConfirmProvider } from "./components/Dialog";
import { LockScreen } from "./components/LockScreen";
import { NewBrainForm, Sidebar } from "./components/Sidebar";
import { ChatView } from "./components/ChatView";
import { DocumentsPanel } from "./components/DocumentsPanel";
import { SettingsModal } from "./components/SettingsModal";
import { Spinner } from "./components/ui";
import { Logo } from "./components/Logo";

export function App() {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <AppProvider>
          <Shell />
        </AppProvider>
      </ConfirmProvider>
    </ToastProvider>
  );
}

function Shell() {
  const app = useApp();
  if (app.auth !== "ready") return <LockScreen />;

  return (
    <div className="flex h-full overflow-hidden">
      <a
        href="#composer"
        className="sr-only z-50 rounded-lg bg-surface px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to message box
      </a>
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col">
        {app.brain ? <ChatView key={app.brain.id} /> : <NoBrain />}
      </main>
      <DocumentsPanel />
      <SettingsModal />
    </div>
  );
}

function NoBrain() {
  const app = useApp();
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 items-center border-b border-line px-3 lg:hidden">
        <button className="icon-btn" onClick={() => app.setSidebarOpen(true)} aria-label="Open sidebar">
          <Menu className="size-5" />
        </button>
      </header>
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        {!app.brainsLoaded ? (
          <Spinner className="size-6 text-muted" label="Loading" />
        ) : (
          <>
            <Logo className="size-12" />
            <h1 className="mt-4 text-2xl font-semibold tracking-tight">Create your first brain</h1>
            <p className="mt-2 max-w-sm text-sm text-muted">
              A brain is a collection of documents, like one creator's video transcripts, that you can chat with.
            </p>
            <div className="mt-6 w-full max-w-sm text-left">
              <NewBrainForm onDone={() => {}} cancellable={false} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
