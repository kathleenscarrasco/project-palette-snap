import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/trust")({
  head: () => ({
    meta: [
      { title: "Trust & Privacy — FotoFairy" },
      {
        name: "description",
        content:
          "How FotoFairy handles security, privacy, and your data. Maintained by the FotoFairy team.",
      },
      { property: "og:title", content: "Trust & Privacy — FotoFairy" },
      {
        property: "og:description",
        content:
          "How FotoFairy handles security, privacy, and your data. Maintained by the FotoFairy team.",
      },
    ],
  }),
  component: TrustPage,
});

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-xl font-semibold text-foreground">{title}</h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}

function TrustPage() {
  return (
    <div className="min-h-screen bg-background px-6 py-16">
      <div className="mx-auto max-w-2xl">
        <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
          ← Back home
        </Link>
        <h1 className="mt-6 text-4xl font-semibold tracking-tight text-foreground">
          Trust & Privacy
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          This page is maintained by the FotoFairy team to answer common security and privacy
          questions about the app. It describes our current practices — not an independent
          certification or audit result.
        </p>

        <Section title="What FotoFairy does">
          <p>
            FotoFairy helps you curate camera-roll batches into a cleaner final collection. The app
            runs fast local checks in your browser, then may use server-side AI analysis to improve
            scene understanding, duplicate handling, ranking, captions, and final order.
          </p>
        </Section>

        <Section title="Access & authentication">
          <p>
            FotoFairy currently requires a Supabase Auth account for private collections. Email
            confirmation, magic links, and password reset links are handled through Supabase Auth.
            Auth emails should point back to FotoFairy&apos;s <code>/auth/callback</code> route, not
            to localhost in production.
          </p>
        </Section>

        <Section title="Data we store">
          <p>
            For saved collections, FotoFairy stores project metadata, uploaded photo records,
            analysis metadata, duplicate/group decisions, removed/restored states, final ordering,
            pinned cover photo, captions, and selected preferences. This lets you leave and come
            back without losing a completed draft.
          </p>
          <p>
            Photo files are stored in a private Supabase Storage bucket. Database rows store storage
            paths and metadata; display URLs are generated as fresh signed URLs when you reopen a
            collection.
          </p>
        </Section>

        <Section title="AI processing">
          <p>
            FotoFairy uses local/browser analysis first where possible. When deeper analysis is
            needed, images or optimized previews may be sent to the server-side Gemini pipeline. API
            keys stay on the server and should never be exposed to the browser.
          </p>
        </Section>

        <Section title="Cookies & analytics">
          <p>
            FotoFairy uses essential browser storage for sign-in state and short-lived workflow
            handoff state. Local browser storage is not treated as the permanent source of truth for
            saved collections.
          </p>
        </Section>

        <Section title="Retention & deletion">
          <p>
            Saved collection rows remain until you delete them. Deleting a collection should remove
            the associated database records and request cleanup of associated private Storage
            objects. Older drafts with missing photo files may show a specific fallback message
            rather than silently restarting the flow.
          </p>
        </Section>

        <Section title="Security contact">
          <p>
            To report a security or privacy concern, contact the FotoFairy maintainer through the
            project repository or support channel. We will respond as soon as we are able.
          </p>
        </Section>
      </div>
    </div>
  );
}
