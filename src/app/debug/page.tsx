import type { ReactNode } from "react";
import Link from "next/link";

import { hasEnableBankingConfig } from "@/lib/enable-banking/client";

export default function DebugPage() {
  const isConfigured = hasEnableBankingConfig();
  const expectedOrigin = getExpectedOrigin();
  const callbackUrl = getCallbackUrl();

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
      <section className="app-topbar">
        <div className="space-y-1">
          <p className="eyebrow">Debug Surface</p>
          <h1 className="font-display text-3xl tracking-[-0.04em] text-[var(--foreground)] sm:text-4xl">
            Connection and session tools
          </h1>
        </div>
        <Link className="button button-secondary button-compact" href="/">
          Back to app
        </Link>
      </section>

      <section className="shell-panel hero-panel variant-diagnosis">
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="eyebrow">Enable Banking</p>
            <p className="max-w-3xl text-sm leading-6 text-[var(--muted)]">
              Keep origin checks, callback URLs, connect actions, and raw session access here so the
              main product flow stays focused on the financial answer.
            </p>
          </div>

          {!isConfigured ? (
            <Callout tone="warning">
              Missing Enable Banking env vars. Check{" "}
              <span className="font-mono text-xs">.env.local</span>.
            </Callout>
          ) : null}

          <div className="grid gap-3 md:grid-cols-2">
            <Callout tone="neutral">
              <div className="grid gap-1">
                <div>
                  <span className="font-semibold text-[var(--foreground)]">Expected origin:</span>{" "}
                  <span className="font-mono text-xs break-all">{expectedOrigin ?? "unset"}</span>
                </div>
                <div>
                  <span className="font-semibold text-[var(--foreground)]">Callback URL:</span>{" "}
                  <span className="font-mono text-xs break-all">{callbackUrl ?? "unset"}</span>
                </div>
              </div>
            </Callout>
            <Callout tone="neutral">
              <div className="grid gap-1">
                <span className="font-semibold text-[var(--foreground)]">Notes</span>
                <span>
                  Use this page for bank linking, session inspection, and local capture checks.
                </span>
              </div>
            </Callout>
          </div>

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
            <a
              className="button button-secondary"
              href={appHref(expectedOrigin, "/api/enable-banking/session?summary=1")}
            >
              Open summary JSON
            </a>
            <a className="button button-secondary" href={appHref(expectedOrigin, "/api/enable-banking/disconnect")}>
              Disconnect
            </a>
          </div>
        </div>
      </section>
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
