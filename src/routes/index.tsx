import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "FotoFairy" },
      {
        name: "description",
        content: "AI-powered photo dump curator.",
      },
    ],
  }),
  component: HomeRedirect,
});

function HomeRedirect() {
  const navigate = useNavigate();
  const { isAuthed, loading } = useAuth();

  useEffect(() => {
    if (!loading) void navigate({ to: isAuthed ? "/projects" : "/auth", replace: true });
  }, [loading, isAuthed, navigate]);

  return (
    <main className="grid min-h-screen place-items-center text-sm text-muted-foreground">
      Loading…
    </main>
  );
}
