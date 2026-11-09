import Link from "next/link";

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="August 9, 2026">
      <p>
        Give Yourself a Raise lets you connect a bank account through Enable Banking and ask for
        read-only spending analysis in the web app or ChatGPT.
      </p>
      <h2>Data we use</h2>
      <p>
        We retrieve balances and transactions you explicitly authorise. Clerk supplies your account
        identity. Enable Banking supplies regulated bank connectivity. ChatGPT receives only the
        result of the tool you choose to run.
      </p>
      <h2>Storage and security</h2>
      <p>
        The Enable Banking session identifier is encrypted with AES-256-GCM before it is stored and
        is bound to your Clerk user ID. Raw bank transactions are fetched on demand; this service does
        not persist them in its application database.
      </p>
      <h2>Sharing</h2>
      <p>
        Bank data is not sold or used for advertising. It is processed by Enable Banking, this
        service, and ChatGPT only when needed to answer an authorised request.
      </p>
      <h2>Deletion and revocation</h2>
      <p>
        Disconnecting revokes the Enable Banking session and deletes the stored encrypted connection.
        You can also revoke ChatGPT access from your Clerk account or ChatGPT settings.
      </p>
      <h2>Contact</h2>
      <p>For privacy or deletion requests, email colmquish@gmail.com.</p>
    </LegalPage>
  );
}

function LegalPage({
  children,
  title,
  updated,
}: {
  children: React.ReactNode;
  title: string;
  updated: string;
}) {
  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-4 py-12 sm:px-6">
      <article className="shell-panel space-y-5 leading-7 text-[var(--muted)] [&_h2]:pt-3 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-[var(--foreground)]">
        <p className="eyebrow">Give Yourself a Raise</p>
        <h1 className="text-4xl font-semibold tracking-[-0.04em] text-[var(--foreground)]">{title}</h1>
        <p className="text-sm">Last updated: {updated}</p>
        {children}
        <p><Link className="underline" href="/">Return to the app</Link></p>
      </article>
    </main>
  );
}
