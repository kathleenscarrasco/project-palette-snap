import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Loader2, Plus, Pencil, Trash2, LogOut, X } from "lucide-react";
import { toast } from "sonner";

import { supabase, type SavedProject } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { BrandMark, BrandWordmark } from "@/components/dumpdeck/brand";

export const Route = createFileRoute("/projects")({
  head: () => ({ meta: [{ title: "Your saved projects · dumpify" }] }),
  component: ProjectsPage,
});

function ProjectsPage() {
  const navigate = useNavigate();
  const { user, isAuthed, loading: authLoading, signOut } = useAuth();
  const [projects, setProjects] = useState<SavedProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<SavedProject | null>(null);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    if (!authLoading && !isAuthed) navigate({ to: "/auth" });
  }, [authLoading, isAuthed, navigate]);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("saved_projects")
      .select("id, user_id, title, description, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (error) {
      console.error("[saved_projects] load error:", error);
      setError(error.message);
    } else {
      console.log("[saved_projects] loaded", data?.length ?? 0);
      setProjects((data ?? []) as SavedProject[]);
      setError(null);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => { if (user) void load(); }, [user, load]);

  async function remove(id: string) {
    if (!confirm("Delete this project?")) return;
    const { error } = await supabase.from("saved_projects").delete().eq("id", id);
    if (error) { toast.error(error.message); console.error(error); return; }
    toast.success("Deleted");
    await load();
  }

  if (authLoading || !isAuthed) {
    return <main className="grid min-h-screen place-items-center text-sm text-muted-foreground">Loading…</main>;
  }

  return (
    <main className="relative min-h-screen overflow-hidden px-5 pb-16 pt-8">
      <div className="pointer-events-none absolute -left-20 top-20 h-72 w-72 rounded-full bg-coral/30 blur-3xl animate-blob" />
      <div className="pointer-events-none absolute -right-16 top-60 h-80 w-80 rounded-full bg-lavender/40 blur-3xl animate-blob" style={{ animationDelay: "-5s" }} />

      <div className="mx-auto w-full max-w-2xl">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <Link to="/" className="flex items-center gap-2">
            <BrandMark className="h-9 w-9" />
            <BrandWordmark size="text-xl" />
          </Link>
          <div className="flex items-center gap-2">
            <span className="chip max-w-[180px] truncate" title={user?.email ?? ""}>{user?.email}</span>
            <button
              onClick={async () => { await signOut(); navigate({ to: "/auth" }); }}
              className="chip hover:bg-coral hover:text-white"
            >
              <LogOut className="h-3 w-3" /> Sign out
            </button>
          </div>
        </header>

        <section className="mt-10 flex items-center justify-between">
          <div>
            <h1 className="font-display text-4xl tracking-tight">Saved projects</h1>
            <p className="mt-1 text-sm text-muted-foreground">Your curated decks, anytime.</p>
          </div>
          <button
            onClick={() => { setEditing(null); setShowForm(true); }}
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-ink px-4 font-semibold text-cream transition hover:bg-coral"
          >
            <Plus className="h-4 w-4" /> New
          </button>
        </section>

        {error && (
          <div className="mt-4 rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>
        )}

        <section className="mt-6 space-y-3">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          )}

          {!loading && projects.length === 0 && (
            <div className="glass-card rounded-2xl p-8 text-center">
              <div className="font-display text-2xl">No saved projects yet</div>
              <p className="mt-2 text-sm text-muted-foreground">Create one to save your work.</p>
              <button
                onClick={() => { setEditing(null); setShowForm(true); }}
                className="mt-5 inline-flex h-11 items-center gap-2 rounded-xl bg-ink px-4 font-semibold text-cream hover:bg-coral"
              >
                <Plus className="h-4 w-4" /> Create your first project
              </button>
            </div>
          )}

          {!loading && projects.map((p) => (
            <article key={p.id} className="glass-card flex items-start gap-3 rounded-2xl p-4">
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{p.title}</div>
                {p.description && (
                  <div className="mt-1 line-clamp-2 text-sm text-muted-foreground">{p.description}</div>
                )}
                <div className="mt-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                  {new Date(p.created_at).toLocaleString()}
                </div>
              </div>
              <button
                onClick={() => { setEditing(p); setShowForm(true); }}
                className="grid h-9 w-9 place-items-center rounded-lg hover:bg-ink/5"
                aria-label="Edit"
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button
                onClick={() => remove(p.id)}
                className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                aria-label="Delete"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </article>
          ))}
        </section>
      </div>

      {showForm && user && (
        <ProjectForm
          userId={user.id}
          initial={editing}
          onClose={() => setShowForm(false)}
          onSaved={async () => { setShowForm(false); await load(); }}
        />
      )}
    </main>
  );
}

function ProjectForm({
  userId,
  initial,
  onClose,
  onSaved,
}: {
  userId: string;
  initial: SavedProject | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      if (initial) {
        const { error } = await supabase
          .from("saved_projects")
          .update({ title: title.trim(), description: description.trim() || null })
          .eq("id", initial.id);
        if (error) throw error;
        toast.success("Saved");
      } else {
        const { error } = await supabase
          .from("saved_projects")
          .insert({ user_id: userId, title: title.trim(), description: description.trim() || null });
        if (error) throw error;
        toast.success("Created");
      }
      await onSaved();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Save failed";
      console.error("[saved_projects] save error:", err);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4" onClick={onClose}>
      <form
        onSubmit={onSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-2xl">{initial ? "Edit project" : "New project"}</h2>
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-ink/5">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-4 space-y-3">
          <input
            required
            placeholder="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={busy}
            className="h-12 w-full rounded-xl border border-ink/10 bg-white px-4 text-base outline-none focus:border-coral disabled:opacity-60"
          />
          <textarea
            placeholder="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={busy}
            rows={4}
            className="w-full rounded-xl border border-ink/10 bg-white px-4 py-3 text-base outline-none focus:border-coral disabled:opacity-60"
          />
        </div>
        <div className="mt-5 flex gap-2">
          <button type="button" onClick={onClose} className="h-11 flex-1 rounded-xl border border-ink/10 font-semibold hover:bg-ink/5">
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !title.trim()}
            className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-ink font-semibold text-cream hover:bg-coral disabled:opacity-60"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {initial ? "Save" : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}
