const PUBLIC_PATHS = new Set([
  "/login",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/enable-banking/callback",
  "/favicon.ico",
  "/robots.txt",
  "/sitemap.xml",
]);

export function isPublicPath(pathname: string) {
  if (PUBLIC_PATHS.has(pathname)) {
    return true;
  }

  if (pathname.startsWith("/_next/")) {
    return true;
  }

  return /\.[a-z0-9]+$/i.test(pathname);
}

export function getSafeNextPath(value: string | null | undefined) {
  if (!value) {
    return "/";
  }

  if (!value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }

  return value;
}
