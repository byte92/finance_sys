import { type NextRequest, NextResponse } from "next/server";
import { DEFAULT_APP_CONFIG } from "@/config/defaults";
import { safeReadJsonBody } from "@/lib/api/request";
import type { AppConfig, Stock } from "@/types";

export const runtime = "nodejs";

const STORAGE_ERROR_MESSAGE = "本地数据服务暂时不可用，请稍后重试。";

type Body = {
  userId?: string;
  stocks?: Stock[];
  config?: AppConfig;
};

function storageErrorResponse(error: unknown) {
  console.error("Storage API failed:", error);
  return NextResponse.json({ error: STORAGE_ERROR_MESSAGE }, { status: 500 });
}

export async function GET(request: NextRequest) {
  try {
    const userId = request.nextUrl.searchParams.get("userId");
    if (!userId) {
      return NextResponse.json({ error: "缺少用户 ID" }, { status: 400 });
    }

    const { getPortfolioByUserIdWithLocalFallback } = await import("@/lib/sqlite/db");
    const payload = getPortfolioByUserIdWithLocalFallback(userId);
    return NextResponse.json(payload);
  } catch (error) {
    return storageErrorResponse(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const payload = await safeReadJsonBody<Body>(request);
    if (!payload.ok) {
      return NextResponse.json({ error: payload.error }, { status: payload.status });
    }

    const body = payload.body;
    if (!body.userId) {
      return NextResponse.json({ error: "缺少用户 ID" }, { status: 400 });
    }

    const { savePortfolioByUserId } = await import("@/lib/sqlite/db");
    savePortfolioByUserId(body.userId, {
      stocks: body.stocks ?? [],
      config: body.config ?? DEFAULT_APP_CONFIG,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return storageErrorResponse(error);
  }
}
