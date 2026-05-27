// POST /api/requirements/[id]/suggest-products
// Upserts selected trading products into mapped_products.
// Body: { userId: number, products: Array<{ variantid, productId, brandId, productName, landingPrice, imageUrl, articleCode, colorName, colorQty, availableStock, mrp, margin }> }

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { sendPushNotification } from "@/lib/push.service";

interface TradingProduct {
  variantid: string;
  productId: string;
  brandId: string;
  productName: string;
  landingPrice: number;
  imageUrl: string;
  articleCode: string | null;
  colorName: string | null;
  colorQty: number | null;
  availableStock: string | null;
  mrp: number | null;
  margin: number | null;
}

interface PostBody {
  userId: number;
  products: TradingProduct[];
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: requirementId } = await params;

  let body: PostBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { userId, products } = body;

  if (!userId || !Array.isArray(products)) {
    return NextResponse.json(
      { error: "userId and products array are required" },
      { status: 400 }
    );
  }

  // Fetch requirement details for the notification + count update
  const { data: reqData, error: reqErr } = await supabaseAdmin
    .from("requirements")
    .select("created_by, label_name, category_name")
    .eq("id", requirementId)
    .single();

  if (reqErr || !reqData) {
    return NextResponse.json(
      { error: reqErr?.message ?? "Requirement not found" },
      { status: 404 }
    );
  }

  // Upsert each product
  const now = new Date().toISOString();
  for (const p of products) {
    const { error: upsertErr } = await supabaseAdmin
      .from("mapped_products")
      .upsert(
        {
          productid: p.productId,
          requirementid: requirementId,
          brandid: p.brandId ?? null,
          productname: p.productName ?? null,
          variantid: p.variantid,
          landingprice: p.landingPrice ?? null,
          image_url: p.imageUrl ?? null,
          article_code: p.articleCode ?? null,
          availablestock: p.availableStock ?? null,
          colorname: p.colorName
            ? `${p.colorName}${p.colorQty != null ? ` (${p.colorQty})` : ""}`
            : null,
          createdby: userId,
          updatedat: now,
        },
        { onConflict: "requirementid,variantid" }
      );

    if (upsertErr) {
      console.error("[suggest-products] upsert error:", upsertErr.message);
      return NextResponse.json(
        { error: `Failed to save product ${p.variantid}: ${upsertErr.message}` },
        { status: 500 }
      );
    }
  }

  // Recalculate productsSuggestedCount for this requirement
  const { count, error: countErr } = await supabaseAdmin
    .from("mapped_products")
    .select("id", { count: "exact", head: true })
    .eq("requirementid", requirementId);

  const newCount = count ?? 0;

  if (countErr) {
    console.error("[suggest-products] count error:", countErr.message);
  } else {
    const { error: updateErr } = await supabaseAdmin
      .from("requirements")
      .update({ products_suggested_count: newCount })
      .eq("id", requirementId);

    if (updateErr) {
      console.error("[suggest-products] update count error:", updateErr.message);
    }
  }

  // Notify creator
  (async () => {
    try {
      const creatorId = reqData.created_by;
      if (!creatorId || creatorId === userId) return;

      const label = reqData.label_name || reqData.category_name || "your requirement";
      await sendPushNotification(creatorId, {
        title: "Products Suggested",
        body: `${products.length} product${products.length > 1 ? "s" : ""} mapped for your requirement of ${label}`,
        url: `/requirements/${requirementId}?userId=${creatorId}`,
      });
    } catch {
      // Notification failure must not affect the API response
    }
  })();

  return NextResponse.json({ data: { success: true, mappedCount: newCount } });
}
