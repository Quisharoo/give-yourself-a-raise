import { hasEnableBankingConfig } from "@/lib/enable-banking/client";
import { AnalysisPanel } from "@/app/analysis-panel";

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
  const expectedOrigin = getExpectedOrigin();
  const callbackUrl = getCallbackUrl();

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6">
      <section className="card space-y-4">
        <div className="space-y-1">
          <p className="label">Give Yourself A Raise</p>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950">
            Find the top levers in your discretionary spend
          </h1>
          <p className="text-sm text-slate-600">
            Cut the noise first: ignore wealth movement, keep fixed costs as context,
            and rank the few categories that could actually move the needle.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatusItem label="Config" value={isConfigured ? "loaded" : "missing"} />
          <AnalysisPanel expectedOrigin={expectedOrigin} callbackUrl={callbackUrl} />
        </div>

        {callbackError ? <Callout tone="danger">{callbackError}</Callout> : null}
        {connected ? <Callout tone="success">Consent completed.</Callout> : null}
        {!isConfigured ? (
          <Callout tone="warning">
            Missing Enable Banking env vars. Check `.env.local`.
          </Callout>
        ) : null}
        {isConfigured && (expectedOrigin || callbackUrl) ? (
          <Callout tone="neutral">
            <span className="font-medium text-slate-950">Expected origin:</span>{" "}
            <span className="font-mono text-xs break-all">{expectedOrigin ?? "unset"}</span>
            <br />
            <span className="font-medium text-slate-950">Callback URL:</span>{" "}
            <span className="font-mono text-xs break-all">{callbackUrl ?? "unset"}</span>
          </Callout>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <a
            className="button button-primary"
            href={appHref(
              expectedOrigin,
              "/api/enable-banking/connect?name=Revolut&country=IE&psuType=personal",
            )}
          >
            Connect Revolut IE
          </a>
          <a
            className="button button-secondary"
            href={appHref(
              expectedOrigin,
              "/api/enable-banking/connect?name=Bankinter&country=ES&psuType=personal",
            )}
          >
            Connect Bankinter ES
          </a>
          <a className="button button-secondary" href={appHref(expectedOrigin, "/api/enable-banking/session")}>
            Open session JSON
          </a>
          <a className="button button-secondary" href={appHref(expectedOrigin, "/api/enable-banking/disconnect")}>
            Disconnect
          </a>
        </div>
      </section>

      <section className="card space-y-4">
        <div className="space-y-1">
          <p className="label">How It Works</p>
          <h2 className="text-xl font-semibold text-slate-950">The brief only uses trusted signal</h2>
        </div>

        <ul className="grid gap-2 text-sm text-slate-700">
          <li>Transfers, exchanges, savings moves, and FX are treated as wealth flow, not spending.</li>
          <li>Recurring baseline costs stay visible but never get ranked as cut candidates.</li>
          <li>Only confident merchant and category patterns feed the main raise brief.</li>
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
  tone: "danger" | "neutral" | "success" | "warning";
}) {
  const toneClass =
    tone === "danger"
      ? "border-red-200 bg-red-50 text-red-800"
      : tone === "success"
        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
        : tone === "neutral"
          ? "border-slate-200 bg-slate-50 text-slate-700"
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

function getExpectedOrigin() {
  const appBaseUrl = process.env.APP_BASE_URL?.trim();

  if (!appBaseUrl) {
    return null;
  }

  try {
    return new URL(appBaseUrl).origin;
  } catch {
    return appBaseUrl;
  }
}

function getCallbackUrl() {
  const explicitCallbackUrl = process.env.ENABLE_BANKING_CALLBACK_URL?.trim();

  if (explicitCallbackUrl) {
    return explicitCallbackUrl;
  }

  const appBaseUrl = process.env.APP_BASE_URL?.trim();

  if (!appBaseUrl) {
    return null;
  }

  try {
    return new URL("/api/enable-banking/callback", appBaseUrl).toString();
  } catch {
    return null;
  }
}

function appHref(expectedOrigin: string | null, path: string) {
  if (!expectedOrigin) {
    return path;
  }

  return new URL(path, expectedOrigin).toString();
}
