import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const baseUrl = process.env.APP_BASE_URL?.trim() || request.nextUrl.origin;
  const target = new URL("/api/enable-banking/callback", baseUrl);

  request.nextUrl.searchParams.forEach((value, key) => {
    target.searchParams.set(key, value);
  });

  return NextResponse.redirect(target);
}
