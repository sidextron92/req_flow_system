// POST /api/brand-product/fuzzy-search
// Uses pg_trgm RPC functions in Supabase to run server-side fuzzy search.
// No full-table fetch — Postgres GiST indexes handle the similarity scoring.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

interface FuzzySearchBody {
  label_name?: string;
  product_names?: string[];
}

interface BrandRow   { brand_name: string;   brand_id: string;   score: number }
interface ProductRow { product_name: string; product_id: string; score: number }

interface LabelResult {
  exact: { brand_name: string; brand_id: string } | null;
  suggestions: Array<{ brand_name: string; brand_id: string }>;
}

interface ProductResult {
  original: string;
  exact: { product_name: string; product_id: string } | null;
  suggestions: Array<{ product_name: string; product_id: string }>;
}

const SUGGESTION_LIMIT = 5; // fetch 5, first may be exact → leaves 4 suggestions

export async function POST(req: NextRequest) {
  let body: FuzzySearchBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { label_name, product_names } = body;

  if (!label_name && (!product_names || product_names.length === 0)) {
    return NextResponse.json({ error: "Provide label_name and/or product_names" }, { status: 400 });
  }

  // ── Label search ──────────────────────────────────────────────────────────

  let labelResult: LabelResult | null = null;

  if (label_name) {
    const query = label_name.trim();

    const { data, error } = await supabaseAdmin.rpc("fuzzy_search_brands", {
      query,
      result_limit: SUGGESTION_LIMIT,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rows: BrandRow[] = data ?? [];

    // Exact match = case-insensitive string equality
    const exactIdx = rows.findIndex(
      (r) => r.brand_name.toLowerCase() === query.toLowerCase()
    );

    if (exactIdx !== -1) {
      const exact = rows[exactIdx];
      labelResult = { exact: { brand_name: exact.brand_name, brand_id: exact.brand_id }, suggestions: [] };
    } else {
      // No exact match — return top 4 as suggestions (already deduplicated by SQL DISTINCT ON)
      const suggestions = rows.slice(0, 4).map((r) => ({
        brand_name: r.brand_name,
        brand_id:   r.brand_id,
      }));
      labelResult = { exact: null, suggestions };
    }
  }

  // ── Product search ────────────────────────────────────────────────────────

  const productResults: ProductResult[] = [];

  if (product_names && product_names.length > 0) {
    // Run all product searches in parallel
    const searches = await Promise.all(
      product_names.map(async (name) => {
        const query = name.trim();
        const { data, error } = await supabaseAdmin.rpc("fuzzy_search_products", {
          query,
          result_limit: SUGGESTION_LIMIT,
        });
        return { query, rows: (data ?? []) as ProductRow[], error };
      })
    );

    for (const { query, rows, error } of searches) {
      if (error) {
        // Non-fatal — include this product with no suggestions
        productResults.push({ original: query, exact: null, suggestions: [] });
        continue;
      }

      const exactIdx = rows.findIndex(
        (r) => r.product_name.toLowerCase() === query.toLowerCase()
      );

      if (exactIdx !== -1) {
        const exact = rows[exactIdx];
        productResults.push({
          original: query,
          exact: { product_name: exact.product_name, product_id: exact.product_id },
          suggestions: [],
        });
      } else {
        const suggestions = rows.slice(0, 4).map((r) => ({
          product_name: r.product_name,
          product_id:   r.product_id,
        }));
        productResults.push({ original: query, exact: null, suggestions });
      }
    }
  }

  return NextResponse.json({
    label:    labelResult,
    products: productResults,
  });
}
