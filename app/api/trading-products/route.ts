// POST /api/trading-products
// Proxies to Bijnis trading session variant list API.
// Body: { userId: number, categoryName: string, query?: string, start?: number, size?: number }

import { NextRequest, NextResponse } from "next/server";

const TRADING_API_URL =
  "https://api.bijnis.com/g/ss/retool/trading/trading-session-rm-variant-list";

export async function POST(req: NextRequest) {
  let body: {
    userId: number;
    categoryName: string;
    query?: string;
    start?: number;
    size?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { userId, categoryName, query = "", start = 0, size = 20 } = body;

  if (!userId || !categoryName) {
    return NextResponse.json(
      { error: "userId and categoryName are required" },
      { status: 400 }
    );
  }

  const token = process.env.BIJNIS_TRADING_API_TOKEN;
  if (!token) {
    console.error("[trading-products] BIJNIS_TRADING_API_TOKEN not set");
    return NextResponse.json(
      { error: "Server misconfiguration: missing trading API token" },
      { status: 500 }
    );
  }

  const payload = {
    filters: [
      {
        name: "groups",
        tags: [{ v: categoryName }],
      },
    ],
    start,
    query,
    title: "",
    size,
    userId,
  };

  try {
    const res = await fetch(TRADING_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Token-X": token,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "Unknown error");
      console.error("[trading-products] external API error:", res.status, text);
      return NextResponse.json(
        { error: `External API returned ${res.status}` },
        { status: 502 }
      );
    }

    const raw = await res.json();
    const products = Array.isArray(raw?.payload) ? raw.payload : [];
    const resultCount = typeof raw?.resultCount === "number" ? raw.resultCount : null;

    return NextResponse.json({ data: products, resultCount });
  } catch (err) {
    console.error("[trading-products] fetch error:", err);
    return NextResponse.json(
      { error: "Failed to reach trading API" },
      { status: 502 }
    );
  }
}
