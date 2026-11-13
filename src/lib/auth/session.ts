import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import { getPrivateOwnerSubject } from "@/lib/auth/owner";

export const AUTH_COOKIE_NAME = "gyr-auth";
export const AUTH_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 12;

type AuthConfig = {
  password: string;
  secret: string;
};

const sessionClaims = z.object({
  sub: z.string().min(1),
  iat: z.number().int().nonnegative(),
  exp: z.number().int().nonnegative(),
}).strict();

export function hasAuthConfig() {
  return Boolean(process.env.APP_LOGIN_PASSWORD?.trim() && process.env.APP_LOGIN_SECRET?.trim());
}

export function readAuthConfig(): AuthConfig {
  const password = process.env.APP_LOGIN_PASSWORD?.trim();
  const secret = process.env.APP_LOGIN_SECRET?.trim();

  if (!password) {
    throw new Error("APP_LOGIN_PASSWORD is required to enable app login.");
  }

  if (!secret) {
    throw new Error("APP_LOGIN_SECRET is required to enable app login.");
  }

  return { password, secret };
}

export function createAuthSessionToken(nowSeconds = Math.floor(Date.now() / 1000)) {
  const { secret } = readAuthConfig();
  const subject = getPrivateOwnerSubject();
  if (!subject) throw new Error("PRIVATE_PLUGIN_SUBJECT is required for app login.");
  const claims = sessionClaims.parse({
    sub: subject,
    iat: nowSeconds,
    exp: nowSeconds + AUTH_COOKIE_MAX_AGE_SECONDS,
  });
  const payload = `v2.${Buffer.from(JSON.stringify(claims)).toString("base64url")}`;
  const signature = createHmac("sha256", secret).update(payload).digest("hex");

  return `${payload}.${signature}`;
}

export function verifyAuthSessionToken(
  token: string | undefined | null,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  const subject = getPrivateOwnerSubject();
  if (!token || token.length > 2048 || !hasAuthConfig() || !subject || !Number.isSafeInteger(nowSeconds)) {
    return false;
  }

  const parts = token.split(".");
  const [version, encoded, signature] = parts;
  if (parts.length !== 3 || version !== "v2" || !encoded || !/^[A-Za-z0-9_-]+$/.test(encoded) || !signature || !/^[a-f0-9]{64}$/.test(signature)) {
    return false;
  }
  const { secret } = readAuthConfig();
  const expected = createHmac("sha256", secret).update(`${version}.${encoded}`).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, "hex"))) {
    return false;
  }

  try {
    const result = sessionClaims.safeParse(JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")));
    if (!result.success) return false;
    const { sub, iat, exp } = result.data;
    return sub === subject && exp - iat === AUTH_COOKIE_MAX_AGE_SECONDS && iat <= nowSeconds && nowSeconds < exp;
  } catch {
    return false;
  }
}

export function passwordMatches(candidate: string) {
  const { password } = readAuthConfig();
  const candidateBuffer = Buffer.from(candidate);
  const passwordBuffer = Buffer.from(password);

  if (candidateBuffer.length !== passwordBuffer.length) {
    return false;
  }

  return timingSafeEqual(candidateBuffer, passwordBuffer);
}

export function getAuthCookieOptions() {
  return {
    httpOnly: true,
    maxAge: AUTH_COOKIE_MAX_AGE_SECONDS,
    path: "/",
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
  };
}
