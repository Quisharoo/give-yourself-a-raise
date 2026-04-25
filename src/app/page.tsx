import type { ReactNode } from "react";
import { cookies, headers } from "next/headers";

import { AnalysisPanel } from "@/app/analysis-panel";
import { sampleSpendingAnalysisFixture } from "@/lib/analysis/fixtures";
import {
  ENABLE_BANKING_SESSION_COOKIE,
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
  const connected = firstValue(resolvedSearchParams.connected) === "1";
  const expectedOrigin = getExpectedOrigin();
  const callbackUrl = getCallbackUrl();
  const headerStore = await headers();
  const cookieStore = await cookies();
  const currentHost =
    headerStore.get("x-forwarded-host") ||
    headerStore.get("host") ||
    null;
  const hasSession = Boolean(cookieStore.get(ENABLE_BANKING_SESSION_COOKIE)?.value);
  const shouldUseFixtureOnFirstPaint = isLocalHost(currentHost) && !hasSession;
  const bankCountries = [
    { code: "IE", label: "Ireland" },
    { code: "ES", label: "Spain" },
  ];

  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-[1400px] flex-1 flex-col gap-5 px-4 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
      <section className="topline-bar">
        <p className="eyebrow">Give Yourself a Raise</p>
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
