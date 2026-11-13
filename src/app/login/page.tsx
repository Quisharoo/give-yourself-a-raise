import { hasAuthConfig } from "@/lib/auth/session";
import { getSafeNextPath } from "@/lib/auth/paths";
import { hasClerkConfig } from "@/lib/auth/clerk";

type LoginSearchParams = Promise<{
  error?: string | string[];
  next?: string | string[];
}>;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: LoginSearchParams;
}) {
  const resolvedSearchParams = await searchParams;
  const error = firstValue(resolvedSearchParams.error);
  const next = getSafeNextPath(firstValue(resolvedSearchParams.next));
  const isConfigured = hasAuthConfig();
  const clerkConfigured = hasClerkConfig();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-1 flex-col justify-center px-4 py-8 sm:px-6 lg:px-8">
      <section className="shell-panel hero-panel variant-brief space-y-6">
        <div className="space-y-3">
          <p className="eyebrow">Private Access</p>
          <h1 className="max-w-xl text-3xl font-semibold tracking-[-0.05em] text-[var(--foreground)] sm:text-4xl">
            Sign in before running the bank connection flow
          </h1>
          <p className="max-w-2xl text-sm leading-6 text-[var(--muted)]">
            Sign in to access your private bank connection. For Revolut credit-card access, start
            here on your phone and complete approval in the Revolut app.
          </p>
        </div>

        {clerkConfigured ? (
          <a className="button button-primary w-full sm:w-fit" href={`/auth/sign-in?next=${encodeURIComponent(next)}`}>
              Continue securely
          </a>
        ) : null}

        {!clerkConfigured && !isConfigured ? (
          <div className="callout callout-warning">
            Set <span className="font-mono text-xs">APP_LOGIN_PASSWORD</span> and{" "}
            <span className="font-mono text-xs">APP_LOGIN_SECRET</span> to enable the deploy gate.
          </div>
        ) : null}

        {error === "invalid" ? (
          <div className="callout callout-danger">Password not recognised.</div>
        ) : null}

        {error === "config" ? (
          <div className="callout callout-warning">Login is not configured on this deployment.</div>
        ) : null}

        {!clerkConfigured ? <form action="/api/auth/login" className="grid gap-4" method="post">
          <input name="next" type="hidden" value={next} />

          <label className="grid gap-2 text-sm font-semibold text-[var(--foreground)]">
            Access password
            <input
              autoComplete="current-password"
              className="target-input"
              name="password"
              required
              type="password"
            />
          </label>

          <button className="button button-primary w-full sm:w-fit" disabled={!isConfigured} type="submit">
            Enter app
          </button>
        </form> : null}
      </section>
    </main>
  );
}

function firstValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}
