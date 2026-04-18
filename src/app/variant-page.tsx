import type { ReactNode } from "react";
import Link from "next/link";

import { AnalysisPanel } from "@/app/analysis-panel";
import { hasEnableBankingConfig } from "@/lib/enable-banking/client";

export type VariantKey = "brief" | "diagnosis" | "explorer";

export type PageSearchParams = Promise<{
  connected?: string | string[];
  error?: string | string[];
}>;

type VariantMeta = {
  href: string;
  navigationLabel: string;
};

const VARIANT_META: Record<VariantKey, VariantMeta> = {
  brief: {
    href: "/",
    navigationLabel: "Brief",
  },
  diagnosis: {
    href: "/diagnosis",
    navigationLabel: "Diagnosis",
  },
  explorer: {
    href: "/explorer",
    navigationLabel: "Explorer",
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
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
      <section className="app-topbar">
        <div className="space-y-3">
          <p className="eyebrow">Give Yourself a Raise</p>
          <h1 className="max-w-3xl text-2xl font-semibold tracking-[-0.04em] text-[var(--foreground)] sm:text-3xl">
            Find a 10% raise in monthly spending power by cutting a few discretionary habits, not the whole budget.
          </h1>

          {callbackError ? <Callout tone="danger">{callbackError}</Callout> : null}
          {connected ? <Callout tone="success">Bank connection completed.</Callout> : null}
          {!isConfigured ? (
            <Callout tone="warning">
              Missing Enable Banking env vars. Check{" "}
              <span className="font-mono text-xs">.env.local</span>.
            </Callout>
          ) : null}

          <nav aria-label="Analysis views" className="app-tab-strip">
            {(Object.entries(VARIANT_META) as Array<[VariantKey, VariantMeta]>).map(([key, item]) => (
              <Link
                key={key}
                aria-current={key === variant ? "page" : undefined}
                className="variant-link"
                data-active={key === variant}
                href={item.href}
              >
                {item.navigationLabel}
              </Link>
            ))}
          </nav>

          <div className="flex flex-wrap gap-2 text-sm text-[var(--muted)]">
            <span className="chip chip-quiet">Action-focused</span>
            <span className="chip chip-quiet">Conservative ranking</span>
            <span className="chip chip-quiet">Inspectability preserved</span>
          </div>
        </div>
      </section>

      <AnalysisPanel
        callbackUrl={callbackUrl}
        connectActions={connectActions}
        debugHref="/debug"
        expectedOrigin={expectedOrigin}
        showDiagnostics={false}
        variant={variant}
      />

      <div className="flex justify-end">
        <Link className="text-sm font-semibold text-[var(--muted)] underline decoration-[var(--line-strong)] underline-offset-4" href="/debug">
          Open debug tools
        </Link>
      </div>
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
