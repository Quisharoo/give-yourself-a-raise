import type { ReactNode } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getWebUserSubject } from "@/lib/auth/web-user";
import { getBankConnection } from "@/lib/connections/store";

import { AnalysisPanel } from "@/app/analysis-panel";
import { sampleSpendingAnalysisFixture } from "@/lib/analysis/fixtures";
import {
  hasEnableBankingConfig,
} from "@/lib/enable-banking/client";

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
  const subject = await getWebUserSubject();
  if (!subject) redirect("/login");
  const connection = isConfigured ? await getBankConnection(subject) : null;
  const connected = Boolean(connection) && firstValue(resolvedSearchParams.connected) === "1";
  const expectedOrigin = getExpectedOrigin();
  const callbackUrl = getCallbackUrl();
  const headerStore = await headers();
  const currentHost =
    headerStore.get("x-forwarded-host") ||
    headerStore.get("host") ||
    null;
  const hasSession = Boolean(connection);
  const shouldUseFixtureOnFirstPaint = isLocalHost(currentHost) && !hasSession;
  const bankCountries = [
    { code: "IE", label: "Ireland" },
    { code: "ES", label: "Spain" },
  ];

  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-[1400px] flex-1 flex-col gap-5 px-4 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
      <section className="topline-bar">
        <p className="eyebrow">Give Yourself a Raise</p>
        {hasSession ? (
          <form action="/api/enable-banking/disconnect" method="post">
            <button className="button button-secondary" type="submit">Disconnect bank</button>
          </form>
        ) : null}
      </section>

      {callbackError ? <Callout tone="danger">{callbackError}</Callout> : null}
      {connected ? <Callout tone="success">Bank connection completed.</Callout> : null}
      {!isConfigured ? (
        <Callout tone="warning">
          Missing Enable Banking env vars. Check{" "}
          <span className="font-mono text-xs">.env.local</span>.
        </Callout>
      ) : null}

      <AnalysisPanel
        bankCountries={bankCountries}
        callbackUrl={callbackUrl}
        expectedOrigin={expectedOrigin}
        initialAnalysis={shouldUseFixtureOnFirstPaint ? sampleSpendingAnalysisFixture : null}
        initialSource={shouldUseFixtureOnFirstPaint ? "fixture" : null}
      />
    </main>
  );
}

function Callout({
  children,
  tone,
}: {
  children: ReactNode;
  tone: "danger" | "neutral" | "success" | "warning";
}) {
  const toneClass =
    tone === "danger"
      ? "callout-danger"
      : tone === "success"
        ? "callout-success"
        : tone === "warning"
          ? "callout-warning"
          : "callout-neutral";

  return <div className={`callout ${toneClass}`}>{children}</div>;
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

function isLocalHost(host: string | null) {
  if (!host) {
    return false;
  }

  return host.startsWith("localhost:") || host.startsWith("127.0.0.1:") || host === "[::1]";
}
