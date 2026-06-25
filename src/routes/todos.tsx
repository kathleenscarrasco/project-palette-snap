import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { Trash2, Plus, Loader2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/todos")({
  head: () => ({ meta: [{ title: "Todos" }] }),
  component: TodosPage,
});

type Todo = {
  id: string;
  task: string;
  done: boolean;
  created_at: string;
};

function TodosPage() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("todos")
      .select("id, task, done, created_at")
      .order("created_at", { ascending: false });
    if (error) {
      setError(error.message);
      setTodos([]);
    } else {
      setTodos((data ?? []) as Todo[]);
      setError(null);
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  async function addTodo(e: FormEvent) {
    e.preventDefault();
    const value = text.trim();
    if (!value) return;
    setAdding(true);
    const { error } = await supabase.from("todos").insert({ task: value });
    if (error) setError(error.message);
    else setText("");
    setAdding(false);
    await load();
  }

  async function toggle(todo: Todo) {
    const { error } = await supabase
      .from("todos")
      .update({ done: !todo.done })
      .eq("id", todo.id);
    if (error) setError(error.message);
    await load();
  }

  async function remove(id: string) {
    const { error } = await supabase.from("todos").delete().eq("id", id);
    if (error) setError(error.message);
    await load();
  }

  return (
    <main className="mx-auto min-h-screen max-w-md px-5 py-10">
      <h1 className="font-display text-4xl tracking-tight">Todos</h1>
      <p className="mt-1 text-sm text-muted-foreground">Shared list — anyone can edit.</p>

      <form onSubmit={addTodo} className="mt-6 flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add a todo…"
          className="h-12 flex-1 rounded-xl border border-border bg-card px-4 text-base outline-none focus:border-coral"
        />
        <button
          type="submit"
          disabled={adding || !text.trim()}
          className="grid h-12 w-12 place-items-center rounded-xl bg-ink text-cream disabled:opacity-50"
          aria-label="Add todo"
        >
          {adding ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
        </button>
      </form>

      {error && (
        <div className="mt-4 rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <ul className="mt-6 space-y-2">
        {loading && (
          <li className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </li>
        )}
        {!loading && todos.length === 0 && (
          <li className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No todos yet. Add your first one above.
          </li>
        )}
        {todos.map((t) => (
          <li key={t.id} className="glass-card flex items-center gap-3 rounded-xl p-3">
            <input
              type="checkbox"
              checked={t.done}
              onChange={() => toggle(t)}
              className="h-5 w-5 accent-coral"
            />
            <span className={`flex-1 ${t.done ? "text-muted-foreground line-through" : ""}`}>
              {t.task}
            </span>
            <button
              onClick={() => remove(t.id)}
              className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              aria-label="Delete"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
