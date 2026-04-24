import type { ReactNode } from "react";
import Link from "next/link";
import { cookies, headers } from "next/headers";

import { AnalysisPanel } from "@/app/analysis-panel";
import { sampleSpendingAnalysisFixture } from "@/lib/analysis/fixtures";
import {
  ENABLE_BANKING_SESSION_COOKIE,
  hasEnableBankingConfig,
} from "@/lib/enable-banking/client";

export type VariantKey = "brief" | "diagnosis" | "explorer";

export type PageSearchParams = Promise<{
  connected?: string | string[];
  error?: string | string[];
}>;

const PAGE_META: Record<
  VariantKey,
  {
    subtitle?: string;
    title: string;
  }
> = {
  brief: {
    title: "Your raise brief",
  },
  diagnosis: {
    title: "Why these actions surfaced",
    subtitle: "The logic, filters, and confidence behind the dashboard output.",
  },
  explorer: {
    title: "Inspect the supporting detail",
    subtitle: "Recurring merchants, category context, and ambiguity that sits behind the brief.",
  },
};

export async function VariantPage({
  searchParams,
  variant,
}: {
  searchParams: PageSearchParams;
  variant: VariantKey;
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
  const meta = PAGE_META[variant];
  const hasSession = Boolean(cookieStore.get(ENABLE_BANKING_SESSION_COOKIE)?.value);
  const shouldUseFixtureOnFirstPaint = isLocalHost(currentHost) && !hasSession;
  const connectActions = [
    {
      href: appHref(
        expectedOrigin,
        "/api/enable-banking/connect?name=Revolut&country=IE&psuType=personal",
      ),
      label: "Connect Revolut IE",
      tone: "primary" as const,
    },
    {
      href: appHref(
        expectedOrigin,
        "/api/enable-banking/connect?name=Bankinter&country=ES&psuType=personal",
      ),
      label: "Connect Bankinter ES",
      tone: "secondary" as const,
    },
  ];

  return (
    <main
      className={
        variant === "brief"
          ? "mobile-app-shell mx-auto flex w-full max-w-5xl flex-1 flex-col gap-3 px-4 py-4 sm:px-6 sm:py-6 lg:px-8"
          : "mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6 lg:px-8"
      }
    >
      <section className={variant === "brief" ? "app-topbar app-topbar-brief" : "app-topbar"}>
        <div className="space-y-3">
          {variant === "brief" ? (
            <div className="mobile-brand-row">
              <p className="eyebrow">Give Yourself a Raise</p>
              <span className="mobile-brand-status">Brief</span>
            </div>
          ) : (
            <>
              <p className="eyebrow">Give Yourself a Raise</p>
              <h1 className="max-w-2xl text-2xl font-semibold tracking-[-0.05em] text-[var(--foreground)] [text-wrap:balance] sm:text-3xl">
                {meta.title}
              </h1>
              {meta.subtitle ? (
                <p className="max-w-2xl text-sm leading-6 text-[var(--muted)]">{meta.subtitle}</p>
              ) : null}
            </>
          )}

          {callbackError ? <Callout tone="danger">{callbackError}</Callout> : null}
          {connected ? <Callout tone="success">Bank connection completed.</Callout> : null}
          {!isConfigured ? (
            <Callout tone="warning">
              Missing Enable Banking env vars. Check{" "}
              <span className="font-mono text-xs">.env.local</span>.
            </Callout>
          ) : null}

          {variant !== "brief" ? (
            <div>
              <Link className="text-sm font-semibold text-[var(--muted)] underline decoration-[var(--line-strong)] underline-offset-4" href="/">
                Back to dashboard
              </Link>
            </div>
          ) : null}
        </div>
      </section>

      <AnalysisPanel
        callbackUrl={callbackUrl}
        connectActions={connectActions}
        debugHref="/debug"
        expectedOrigin={expectedOrigin}
        initialAnalysis={shouldUseFixtureOnFirstPaint ? sampleSpendingAnalysisFixture : null}
        initialSource={shouldUseFixtureOnFirstPaint ? "fixture" : null}
        showDiagnostics={false}
        variant={variant}
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

function appHref(expectedOrigin: string | null, path: string) {
  if (!expectedOrigin) {
    return path;
  }

  return new URL(path, expectedOrigin).toString();
}

function isLocalHost(host: string | null) {
  if (!host) {
    return false;
  }

  return host.startsWith("localhost:") || host.startsWith("127.0.0.1:") || host === "[::1]";
}
