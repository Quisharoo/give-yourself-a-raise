import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const target = new URL("/api/enable-banking/callback", request.url);

  request.nextUrl.searchParams.forEach((value, key) => {
    target.searchParams.set(key, value);
  });

  return NextResponse.redirect(target);
}
