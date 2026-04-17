import { hasEnableBankingConfig } from "@/lib/enable-banking/client";
import { SessionPanel } from "@/app/session-panel";

type PageSearchParams = Promise<{
  connected?: string | string[];
  error?: string | string[];
}>;

export default async function Home({
  searchParams,
}: {
  searchParams: PageSearchParams;
}) {
  const resolvedSearchParams = await searchParams;
  const isConfigured = hasEnableBankingConfig();
  const callbackError = firstValue(resolvedSearchParams.error);
  const connected = firstValue(resolvedSearchParams.connected) === "1";

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6">
      <section className="card space-y-4">
        <div className="space-y-1">
          <p className="label">Enable Banking</p>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950">
            Live account access check
          </h1>
          <p className="text-sm text-slate-600">
            Goal: confirm consent, session creation, balances, and transactions.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatusItem label="Config" value={isConfigured ? "loaded" : "missing"} />
          <SessionPanel />
          <StatusItem
            label="Last callback"
            value={callbackError ? "error" : connected ? "connected" : "idle"}
          />
        </div>

        {callbackError ? <Callout tone="danger">{callbackError}</Callout> : null}
        {connected ? <Callout tone="success">Consent completed.</Callout> : null}
        {!isConfigured ? (
          <Callout tone="warning">
            Missing Enable Banking env vars. Check `.env.local`.
          </Callout>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <a
            className="button button-primary"
            href="/api/enable-banking/connect?name=Revolut&country=IE&psuType=personal"
          >
            Connect Revolut IE
          </a>
          <a
            className="button button-secondary"
            href="/api/enable-banking/connect?name=Bankinter&country=ES&psuType=personal"
          >
            Connect Bankinter ES
          </a>
          <a className="button button-secondary" href="/api/enable-banking/session">
            Open session JSON
          </a>
          <a className="button button-secondary" href="/api/enable-banking/disconnect">
            Disconnect
          </a>
        </div>
      </section>

      <section className="card space-y-4">
        <div className="space-y-1">
          <p className="label">What matters</p>
          <h2 className="text-xl font-semibold text-slate-950">Proof points</h2>
        </div>

        <ul className="grid gap-2 text-sm text-slate-700">
          <li>JWT auth and consent redirect work if the connect button reaches your bank.</li>
          <li>Session creation works if `/api/enable-banking/session` returns accounts.</li>
          <li>Live data works if balances and transactions render below.</li>
        </ul>
      </section>
    </main>
  );
}

function Callout({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "danger" | "success" | "warning";
}) {
  const toneClass =
    tone === "danger"
      ? "border-red-200 bg-red-50 text-red-800"
      : tone === "success"
        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
        : "border-amber-200 bg-amber-50 text-amber-800";

  return <div className={`rounded-xl border px-4 py-3 text-sm ${toneClass}`}>{children}</div>;
}

function StatusItem({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
      <p className="label">{label}</p>
      <p className="mt-1 text-sm font-medium text-slate-950">{value}</p>
    </div>
  );
}

function firstValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}
