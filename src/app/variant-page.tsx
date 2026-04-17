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
  eyebrow: string;
  heroClassName: string;
  href: string;
  principleCards: Array<{
    body: string;
    title: string;
  }>;
  spotlight: string;
  subtitle: string;
  title: string;
};

const VARIANT_META: Record<VariantKey, VariantMeta> = {
  brief: {
    eyebrow: "Brief-first",
    heroClassName: "variant-brief",
    href: "/",
    principleCards: [
      {
        body: "Put the monthly opportunity on the page immediately, then justify it with just enough detail.",
        title: "Lead with the answer",
      },
      {
        body: "Reduce the bank feed to three or four decisions the user could actually make this month.",
        title: "Keep the aperture tight",
      },
      {
        body: "Treat fixed costs and wealth movement as guardrails, not headline advice.",
        title: "Cut noise first",
      },
    ],
    spotlight:
      "This variant should feel like a sharp spending memo: decisive, compressed, and useful in under a minute.",
    subtitle:
      "One baseline, three levers, and a clean answer to where the spending power is hiding.",
    title: "Action brief",
  },
  diagnosis: {
    eyebrow: "Diagnosis-first",
    heroClassName: "variant-diagnosis",
    href: "/diagnosis",
    principleCards: [
      {
        body: "Show what counted, what was excluded, and why the model trusts these recommendations.",
        title: "Lead with trust",
      },
      {
        body: "Keep uncertainty visible so the product never pretends ambiguous merchants are certain.",
        title: "Surface ambiguity",
      },
      {
        body: "Frame the result as evidence-backed reasoning rather than a budgeting lecture.",
        title: "Explain the model",
      },
    ],
    spotlight:
      "This variant should feel like a credible analyst walking through the bank feed, not a dashboard begging for clicks.",
    subtitle:
      "Explain why the levers appeared, what was filtered out, and where confidence is still low.",
    title: "Explain the model",
  },
  explorer: {
    eyebrow: "Explorer-lite",
    heroClassName: "variant-explorer",
    href: "/explorer",
    principleCards: [
      {
        body: "Expose the category stack, recurring merchants, and unresolved spend without tipping into spreadsheet mode.",
        title: "Lead with inspectability",
      },
      {
        body: "Let the user move from category-level signal to merchant-level texture in one screen.",
        title: "Keep depth nearby",
      },
      {
        body: "Preserve the same backend contract while letting curiosity travel further.",
        title: "Stay on the same model",
      },
    ],
    spotlight:
      "This variant should feel like a lean investigation surface for power users who want to inspect the machine without fighting it.",
    subtitle:
      "Inspect the category stack, recurring merchants, and ambiguous spend without falling into dashboard soup.",
    title: "Inspect the stack",
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
  const meta = VARIANT_META[variant];

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-5 px-4 py-5 sm:px-6 sm:py-6 lg:px-8">
      <section className={`shell-panel hero-panel ${meta.heroClassName}`}>
        <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl space-y-4">
            <div className="space-y-2">
              <p className="eyebrow">Give Yourself a Raise</p>
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-[var(--accent-deep)]">
                {meta.eyebrow}
              </p>
            </div>
            <div className="space-y-3">
              <h1 className="font-display text-4xl tracking-[-0.04em] text-[var(--foreground)] sm:text-5xl">
                {meta.title}
              </h1>
              <p className="max-w-2xl text-base leading-7 text-[var(--muted)] sm:text-lg">
                {meta.subtitle}
              </p>
            </div>
          </div>

          <nav aria-label="Variant switcher" className="flex flex-wrap gap-2">
            {(Object.entries(VARIANT_META) as Array<[VariantKey, VariantMeta]>).map(([key, item]) => (
              <Link
                key={key}
                className="variant-link"
                data-active={key === variant}
                href={item.href}
              >
                {item.eyebrow}
              </Link>
            ))}
          </nav>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.35fr_0.65fr]">
          <div className="grid gap-3 md:grid-cols-3">
            {meta.principleCards.map((card) => (
              <article key={card.title} className="hero-card">
                <p className="eyebrow">{card.title}</p>
                <p className="mt-3 text-sm leading-6 text-[var(--muted)]">{card.body}</p>
              </article>
            ))}
          </div>

          <aside className="hero-spotlight">
            <p className="eyebrow">Product thesis</p>
            <p className="mt-3 text-xl font-semibold tracking-[-0.03em] text-[var(--foreground)]">
              Same analysis core. Different front door.
            </p>
            <p className="mt-3 text-sm leading-6 text-[var(--muted)]">{meta.spotlight}</p>
          </aside>
        </div>
      </section>

      <section className="shell-panel space-y-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="grid flex-1 gap-3 md:grid-cols-2">
            {callbackError ? <Callout tone="danger">{callbackError}</Callout> : null}
            {connected ? <Callout tone="success">Consent completed.</Callout> : null}
            {!isConfigured ? (
              <Callout tone="warning">
                Missing Enable Banking env vars. Check{" "}
                <span className="font-mono text-xs">.env.local</span>.
              </Callout>
            ) : null}
            {isConfigured && (expectedOrigin || callbackUrl) ? (
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
            ) : null}
          </div>

          <div className="flex flex-wrap gap-3 xl:max-w-xl xl:justify-end">
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
        </div>
      </section>

      <AnalysisPanel callbackUrl={callbackUrl} expectedOrigin={expectedOrigin} variant={variant} />
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
