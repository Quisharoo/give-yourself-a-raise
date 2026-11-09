import Link from "next/link";

export default function TermsPage() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-4 py-12 sm:px-6">
      <article className="shell-panel space-y-5 leading-7 text-[var(--muted)] [&_h2]:pt-3 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-[var(--foreground)]">
        <p className="eyebrow">Give Yourself a Raise</p>
        <h1 className="text-4xl font-semibold tracking-[-0.04em] text-[var(--foreground)]">Terms of Service</h1>
        <p className="text-sm">Last updated: August 9, 2026</p>
        <p>
          Use the service only with accounts and financial data you are authorised to access. The
          service provides read-only analysis and budgeting support; it is not financial, legal, tax,
          or accounting advice.
        </p>
        <h2>Availability</h2>
        <p>
          This is an early-stage service provided on a best-effort basis. It may change or be
          unavailable during maintenance or provider outages.
        </p>
        <h2>Your decisions</h2>
        <p>
          You remain responsible for decisions made using the information shown by the service. The
          service is provided as-is without warranties to the extent permitted by law.
        </p>
        <h2>Contact</h2>
        <p>For questions, email colmquish@gmail.com.</p>
        <p><Link className="underline" href="/">Return to the app</Link></p>
      </article>
    </main>
  );
}
