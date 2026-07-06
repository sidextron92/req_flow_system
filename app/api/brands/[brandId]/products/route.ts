// GET /api/brands/:brandId/products
// Returns all distinct products for a given brand_id from brand_product_data.
// Deduplicates by product_name (case-insensitive) and returns image, article_code, category_name.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

interface ProductRow {
  product_id: string;
  product_name: string;
  category_name: string | null;
  image: string | null;
  article_code: string | null;
  bijnis_buyer_id: string | null;
  bijnis_buyer_name: string | null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ brandId: string }> }
) {
  const { brandId } = await params;

  if (!brandId) {
    return NextResponse.json({ error: "brandId is required" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("brand_product_data")
    .select("product_id, product_name, category_name, image, article_code, bijnis_buyer_id, bijnis_buyer_name")
    .eq("brand_id", brandId)
    .order("product_name", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows: ProductRow[] = data ?? [];

  // Deduplicate by product_name (case-insensitive), keeping the first occurrence
  const seen = new Set<string>();
  const deduped: ProductRow[] = [];
  for (const row of rows) {
    const key = row.product_name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }

  return NextResponse.json({ data: deduped });
}
