import { getPrivateOwnerSubject } from "@/lib/auth/owner";
import { hasAuthConfig } from "@/lib/auth/session";

export function hasClerkConfig() {
  return Boolean(
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() &&
      process.env.CLERK_SECRET_KEY?.trim(),
  );
}

export function getWebAuthMode(): "clerk" | "password" | "unavailable" {
  if (!getPrivateOwnerSubject()) return "unavailable";
  if (hasClerkConfig()) return "clerk";
  if (process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() || process.env.CLERK_SECRET_KEY?.trim()) {
    return "unavailable";
  }
  return hasAuthConfig() ? "password" : "unavailable";
}
