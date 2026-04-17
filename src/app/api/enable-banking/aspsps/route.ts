import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  EnableBankingError,
  findAspsps,
  hasEnableBankingConfig,
} from "@/lib/enable-banking/client";

export async function GET(request: NextRequest) {
  if (!hasEnableBankingConfig()) {
    return NextResponse.json(
      {
        error: "Enable Banking is not configured.",
      },
      { status: 503 },
    );
  }

  const country = request.nextUrl.searchParams.get("country")?.trim().toUpperCase();
  const query = request.nextUrl.searchParams.get("query")?.trim();

  if (!country) {
    return NextResponse.json(
      {
        error: "Missing required query parameter: country",
      },
      { status: 400 },
    );
  }

  try {
    const aspsps = await findAspsps(country, query ?? undefined);

    return NextResponse.json({
      aspsps,
      country,
      query: query ?? null,
    });
  } catch (error) {
    if (error instanceof EnableBankingError) {
      return NextResponse.json(
        {
          details: error.details,
          error: error.message,
        },
        { status: error.status ?? 500 },
      );
    }

    return NextResponse.json(
      {
        error: "Unexpected error while searching ASPSPs.",
      },
      { status: 500 },
    );
  }
}
