import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_APP_CONFIG } from "@/config/defaults";
import { getPortfolioByUserIdWithLocalFallback, savePortfolioByUserId } from "@/lib/sqlite/db";
import type { AppConfig, Stock } from "@/types";

export const runtime = "nodejs";

type Body = {
  userId?: string;
  stocks?: Stock[];
  config?: AppConfig;
};

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get("userId");
  if (!userId) {
    return NextResponse.json({ error: "Missing userId" }, { status: 400 });
  }

  const payload = getPortfolioByUserIdWithLocalFallback(userId);
  return NextResponse.json(payload);
}

export async function PUT(request: NextRequest) {
  const body = (await request.json()) as Body;
  if (!body.userId) {
    return NextResponse.json({ error: "Missing userId" }, { status: 400 });
  }

  savePortfolioByUserId(body.userId, {
    stocks: body.stocks ?? [],
    config: body.config ?? DEFAULT_APP_CONFIG,
  });

  return NextResponse.json({ ok: true });
}
