import { createHmac, timingSafeEqual } from "node:crypto";

export const AUTH_COOKIE_NAME = "gyr-auth";
export const AUTH_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 12;

type AuthConfig = {
  password: string;
  secret: string;
};

const AUTH_TOKEN_PAYLOAD = "v1";

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

export function createAuthSessionToken() {
  const { secret } = readAuthConfig();
  const signature = createHmac("sha256", secret).update(AUTH_TOKEN_PAYLOAD).digest("hex");

  return `${AUTH_TOKEN_PAYLOAD}.${signature}`;
}

export function verifyAuthSessionToken(token: string | undefined | null) {
  if (!token || !hasAuthConfig()) {
    return false;
  }

  const [payload, signature] = token.split(".");

  if (!payload || !signature) {
    return false;
  }

  const expectedToken = createAuthSessionToken();
  const expectedBuffer = Buffer.from(expectedToken);
  const tokenBuffer = Buffer.from(token);

  if (expectedBuffer.length !== tokenBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, tokenBuffer);
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
