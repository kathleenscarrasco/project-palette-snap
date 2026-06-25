import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/trust")({
  head: () => ({
    meta: [
      { title: "Trust & Privacy — dumpify" },
      {
        name: "description",
        content:
          "How dumpify handles security, privacy, and your data. Maintained by the dumpify team.",
      },
      { property: "og:title", content: "Trust & Privacy — dumpify" },
      {
        property: "og:description",
        content:
          "How dumpify handles security, privacy, and your data. Maintained by the dumpify team.",
      },
    ],
  }),
  component: TrustPage,
});

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-xl font-semibold text-foreground">{title}</h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted-foreground">
        {children}
      </div>
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
          This page is maintained by the dumpify team to answer common security and
          privacy questions about the app. It describes our current practices and is
          editable project content — not an independent certification or audit result.
        </p>

        <Section title="What dumpify does">
          <p>
            dumpify is a photo curation tool that helps you select and order images for
            a photo dump. Photos you upload are processed in your browser for the
            curation flow.
          </p>
        </Section>

        <Section title="Access & authentication">
          <p>
            The core curation flow does not require an account. The shared todos demo
            page is intentionally public — anyone with the link can read and edit it.
            We will note clearly on any future feature whether sign-in is required.
          </p>
        </Section>

        <Section title="Data we store">
          <p>
            Items you add to the public shared list (task text and completion state)
            are stored in our database. We do not collect names, emails, or payment
            information for the current features.
          </p>
        </Section>

        <Section title="Cookies & analytics">
          <p>
            dumpify does not set marketing cookies. Essential storage may be used to
            keep the app working in your browser.
          </p>
        </Section>

        <Section title="Retention & deletion">
          <p>
            Public shared list items remain until someone deletes them from the app.
            For deletion requests related to anything else, contact us using the
            address below.
          </p>
        </Section>

        <Section title="Security contact">
          <p>
            To report a security or privacy concern, please open an issue from the
            project page or contact the maintainer listed there. We will respond as
            soon as we are able.
          </p>
        </Section>
      </div>
    </div>
  );
}
