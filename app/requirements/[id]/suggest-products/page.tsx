"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TradingProduct {
  id: number;               // variantid
  productId: number;
  articleCode: string | null;
  brandId: number;
  colorDetails: Array<{
    colorName: string;
    colorQty: number;
  }>;
  mrp: number;
  margin: number | null;
  remainingLotInfo: { text: string; textColor: string } | null;
  skPrice: number;
  title: string;
  imageUrl: string;
}

interface MappedProduct {
  id: string;
  variantid: string;
  productid: string;
  brandid: string | null;
  productname: string | null;
  landingprice: number | null;
  image_url: string | null;
  article_code: string | null;
  colorname: string | null;
  availablestock: string | null;
}

interface Requirement {
  id: string;
  category_name: string | null;
  created_by: number;
  label_name: string | null;
  mapped_products: MappedProduct[];
}

const PAGE_SIZE = 20;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatPrice(n: number | null): string {
  if (n == null || isNaN(n)) return "—";
  return `₹${n.toFixed(2)}`;
}

function parseTradingProducts(raw: unknown[]): TradingProduct[] {
  return raw.map((item: unknown) => {
    const r = item as Record<string, unknown>;
    return {
      id: Number(r.id ?? 0),
      productId: Number(r.productId ?? 0),
      articleCode: (r.articleCode as string | null) ?? null,
      brandId: Number(r.brandId ?? 0),
      colorDetails: Array.isArray(r.colorDetails)
        ? (r.colorDetails as Array<Record<string, unknown>>).map((c) => ({
            colorName: String(c.colorName ?? ""),
            colorQty: Number(c.colorQty ?? 0),
          }))
        : [],
      mrp: Number(r.mrp ?? 0),
      margin: r.margin != null ? Number(r.margin) : null,
      remainingLotInfo: r.remainingLotInfo
        ? (r.remainingLotInfo as { text: string; textColor: string })
        : null,
      skPrice: Number(r.skPrice ?? 0),
      title: String(r.title ?? ""),
      imageUrl: String(r.imageUrl ?? ""),
    };
  });
}

// ─── Components ───────────────────────────────────────────────────────────────

function ProductCard({
  product,
  checked,
  onToggle,
}: {
  product: TradingProduct;
  checked: boolean;
  onToggle: () => void;
}) {
  const color = product.colorDetails[0];
  const isOutOfStock = product.remainingLotInfo?.text === "All Lots Sold";

  return (
    <div
      onClick={() => { if (!isOutOfStock) onToggle(); }}
      className={`relative bg-white rounded-2xl border p-3 flex flex-col gap-2 transition-transform ${
        isOutOfStock
          ? "border-gray-200 opacity-50 cursor-not-allowed"
          : `cursor-pointer active:scale-[0.98] ${checked ? "border-green-500 ring-1 ring-green-500" : "border-gray-200"}`
      }`}
    >
      {/* Checkbox */}
      <div
        className={`absolute top-2 left-2 z-10 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors ${
          isOutOfStock
            ? "bg-gray-200 border-gray-300 cursor-not-allowed"
            : checked
            ? "bg-green-600 border-green-600"
            : "bg-white/80 border-gray-300"
        }`}
        onClick={(e) => {
          e.stopPropagation();
          if (!isOutOfStock) onToggle();
        }}
      >
        {checked && !isOutOfStock && (
          <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        )}
      </div>

      {/* Image */}
      <div className="aspect-square rounded-xl overflow-hidden bg-gray-100">
        {product.imageUrl ? (
          <img
            src={product.imageUrl}
            alt={product.title}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-300 text-xs">No image</div>
        )}
      </div>

      {/* Info */}
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold text-gray-900 leading-snug line-clamp-2">{product.title}</p>

        {color && (
          <p className="text-xs text-gray-500">{color.colorName}</p>
        )}

        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-sm font-bold text-gray-900">{formatPrice(product.skPrice)}</span>
          {product.mrp > 0 && product.mrp !== product.skPrice && (
            <span className="text-xs text-gray-500">MRP {formatPrice(product.mrp)}</span>
          )}
        </div>

        {product.margin != null && (
          <span className="text-xs font-medium text-green-600">Margin: {product.margin}%</span>
        )}

        {product.remainingLotInfo && (
          <span className={`self-start text-xs font-semibold text-white px-2 py-0.5 rounded-full ${isOutOfStock ? 'bg-red-500' : 'bg-green-600'}`}>
            {product.remainingLotInfo.text}
          </span>
        )}
      </div>
    </div>
  );
}

function SelectedProductCard({
  product,
  onToggle,
}: {
  product: TradingProduct;
  onToggle: () => void;
}) {
  const color = product.colorDetails[0];
  return (
    <div className="relative bg-white rounded-2xl border border-gray-200 p-3 flex flex-col gap-2">
      {/* Remove button */}
      <button
        onClick={onToggle}
        className="absolute top-2 left-2 z-10 w-5 h-5 rounded-md border-2 bg-green-600 border-green-600 flex items-center justify-center"
      >
        <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </button>

      <div className="aspect-square rounded-xl overflow-hidden bg-gray-100">
        {product.imageUrl ? (
          <img src={product.imageUrl} alt={product.title} className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-300 text-xs">No image</div>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold text-gray-900 leading-snug line-clamp-2">{product.title}</p>
        {color && (
          <p className="text-xs text-gray-500">{color.colorName}</p>
        )}
        <span className="text-sm font-bold text-gray-900">{formatPrice(product.skPrice)}</span>
        {product.remainingLotInfo && (
          <span className={`self-start text-xs font-semibold text-white px-2 py-0.5 rounded-full ${product.remainingLotInfo.text === 'All Lots Sold' ? 'bg-red-500' : 'bg-green-600'}`}>
            {product.remainingLotInfo.text}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

function mappedToTrading(mp: MappedProduct): TradingProduct {
  return {
    id: Number(mp.variantid) || 0,
    productId: Number(mp.productid) || 0,
    articleCode: mp.article_code,
    brandId: Number(mp.brandid) || 0,
    colorDetails: mp.colorname
      ? [{ colorName: mp.colorname, colorQty: 0 }]
      : [],
    mrp: 0,
    margin: null,
    remainingLotInfo: mp.availablestock
      ? { text: mp.availablestock, textColor: "#2EC885" }
      : null,
    skPrice: mp.landingprice ?? 0,
    title: mp.productname ?? "Product",
    imageUrl: mp.image_url ?? "",
  };
}

function SuggestProductsContent() {
  const { id: requirementId } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();

  const userId = Number(searchParams.get("userId") ?? 0);

  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const [req, setReq] = useState<Requirement | null>(null);
  const [products, setProducts] = useState<TradingProduct[]>([]);
  const [selectedMap, setSelectedMap] = useState<Map<number, TradingProduct>>(new Map());
  const [searchQuery, setSearchQuery] = useState("");
  const [start, setStart] = useState(0);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);
  const [suggesting, setSuggesting] = useState(false);

  const sentinelRef = useRef<HTMLDivElement>(null);

  // Fetch requirement details on mount
  useEffect(() => {
    async function loadReq() {
      try {
        const res = await fetch(`/api/requirements/${requirementId}`);
        if (!res.ok) throw new Error("Failed to load requirement");
        const json = await res.json();
        const data: Requirement = json.data;
        setReq(data);
        // Pre-select existing mapped products
        const map = new Map<number, TradingProduct>();
        for (const mp of data.mapped_products ?? []) {
          const vid = Number(mp.variantid);
          if (!isNaN(vid)) map.set(vid, mappedToTrading(mp));
        }
        setSelectedMap(map);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load requirement");
      }
    }
    loadReq();
  }, [requirementId]);

  const fetchProducts = useCallback(
    async (offset: number, query: string) => {
      if (!req) return;
      setLoading(true);
      try {
        const res = await fetch("/api/trading-products", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: req.created_by,
            categoryName: req.category_name,
            query,
            start: offset,
            size: PAGE_SIZE,
          }),
        });

        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json.error ?? `Error ${res.status}`);
        }

        const json = await res.json();
        const fetched: unknown[] = Array.isArray(json.data) ? json.data : [];
        const parsed = parseTradingProducts(fetched);

        if (offset === 0) {
          setProducts(parsed);
        } else {
          setProducts((prev) => [...prev, ...parsed]);
        }

        const total = typeof json.resultCount === "number" ? json.resultCount : null;
        const loadedSoFar = offset + parsed.length;
        setHasMore(total != null ? loadedSoFar < total : parsed.length === PAGE_SIZE);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load products");
      } finally {
        setLoading(false);
      }
    },
    [req]
  );

  // Initial load when req is ready
  useEffect(() => {
    if (req) {
      setStart(0);
      setHasMore(true);
      fetchProducts(0, "");
    }
  }, [req]); // eslint-disable-line react-hooks/exhaustive-deps

  // Search debounce
  useEffect(() => {
    if (!req) return;
    const t = setTimeout(() => {
      setStart(0);
      setHasMore(true);
      setProducts([]);
      fetchProducts(0, searchQuery);
    }, 400);
    return () => clearTimeout(t);
  }, [searchQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  // Infinite scroll observer
  useEffect(() => {
    if (!sentinelRef.current || loading || !hasMore || showSelectedOnly) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loading && hasMore) {
          const nextStart = start + PAGE_SIZE;
          setStart(nextStart);
          fetchProducts(nextStart, searchQuery);
        }
      },
      { rootMargin: "200px" }
    );

    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [loading, hasMore, start, searchQuery, showSelectedOnly, fetchProducts]);

  function toggleSelection(product: TradingProduct) {
    setSelectedMap((prev) => {
      const next = new Map(prev);
      if (next.has(product.id)) next.delete(product.id);
      else next.set(product.id, product);
      return next;
    });
  }

  function clearAll() {
    setSelectedMap(new Map());
  }

  const selectedProducts = useMemo(
    () => Array.from(selectedMap.values()),
    [selectedMap]
  );

  async function handleSuggest() {
    if (!req || selectedMap.size === 0) return;
    setSuggesting(true);
    try {
      const payload = selectedProducts.map((p) => ({
        variantid: String(p.id),
        productId: String(p.productId),
        brandId: String(p.brandId),
        productName: p.title,
        landingPrice: p.skPrice,
        imageUrl: p.imageUrl,
        articleCode: p.articleCode,
        colorName: p.colorDetails[0]?.colorName ?? null,
        colorQty: p.colorDetails[0]?.colorQty ?? null,
        availableStock: p.remainingLotInfo?.text ?? null,
        mrp: p.mrp,
        margin: p.margin,
      }));

      const res = await fetch(`/api/requirements/${requirementId}/suggest-products`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, products: payload }),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? "Failed to save");
      }

      router.push(`/requirements/${requirementId}?userId=${userId}`);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSuggesting(false);
    }
  }

  if (error && !req) {
    return (
      <div className="min-h-screen bg-gray-50 max-w-md mx-auto flex flex-col items-center justify-center gap-3 px-4">
        <p className="text-gray-500 text-sm">{error}</p>
        <button onClick={() => router.back()} className="text-green-600 text-sm font-medium">← Go back</button>
      </div>
    );
  }

  if (!mounted) {
    return (
      <div className="min-h-screen bg-gray-50 max-w-md mx-auto flex items-center justify-center">
        <div className="h-8 w-8 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const displayProducts = showSelectedOnly ? selectedProducts : products;

  return (
    <main className="min-h-screen bg-gray-50 flex flex-col max-w-md mx-auto">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-4 sticky top-0 z-20 flex items-center gap-3">
        <button
          onClick={() => router.back()}
          className="text-gray-500 hover:text-gray-800 transition-colors -ml-1 p-1"
          aria-label="Back"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
        </button>
        <h1 className="text-base font-bold text-gray-900">Suggest Products</h1>
      </header>

      {/* Sticky search + selected bar */}
      <div className="sticky top-[61px] z-30">
        {/* Search bar */}
        <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-2">
          <div className="relative flex-1">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none"
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search products…"
              className="w-full pl-9 pr-8 py-2 text-sm bg-gray-100 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-green-500 placeholder:text-gray-400"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          <button
            onClick={() => {
              setStart(0);
              setHasMore(true);
              setProducts([]);
              fetchProducts(0, searchQuery);
            }}
            disabled={loading}
            className="shrink-0 bg-green-600 hover:bg-green-700 disabled:bg-green-300 text-white rounded-xl px-3 py-2 text-sm font-medium transition-colors"
          >
            Search
          </button>
        </div>

        {/* Selected count bar */}
        <div className="bg-white px-4 py-2 border-b border-gray-200 flex items-center justify-between">
          <button
            onClick={() => setShowSelectedOnly((v) => !v)}
            className="text-sm font-medium text-green-700 hover:text-green-800 transition-colors"
          >
            {showSelectedOnly
              ? "← Back to results"
              : `Show ${selectedMap.size} selected`}
          </button>

          {selectedMap.size > 0 && (
            <button
              onClick={clearAll}
              className="text-xs font-medium text-red-500 hover:text-red-600 transition-colors"
            >
              Clear all
            </button>
          )}
        </div>
      </div>

      {/* Product grid */}
      <div className="flex-1 px-4 py-4 pb-28">
        {displayProducts.length === 0 && !loading ? (
          <p className="text-sm text-gray-400 text-center py-12">
            {showSelectedOnly
              ? "No products selected yet."
              : error
                ? error
                : "No products found."}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {displayProducts.map((p, i) =>
              showSelectedOnly ? (
                <SelectedProductCard
                  key={`sel-${i}`}
                  product={p}
                  onToggle={() => toggleSelection(p)}
                />
              ) : (
                <ProductCard
                  key={`prod-${i}`}
                  product={p}
                  checked={selectedMap.has(p.id)}
                  onToggle={() => toggleSelection(p)}
                />
              )
            )}
          </div>
        )}

        {loading && (
          <div className="grid grid-cols-2 gap-3 mt-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="bg-white rounded-2xl border border-gray-200 p-3 flex flex-col gap-2 animate-pulse">
                <div className="aspect-square rounded-xl bg-gray-100" />
                <div className="h-4 w-3/4 bg-gray-100 rounded" />
                <div className="h-3 w-1/2 bg-gray-100 rounded" />
                <div className="h-4 w-1/3 bg-gray-100 rounded" />
              </div>
            ))}
          </div>
        )}

        {!showSelectedOnly && hasMore && <div ref={sentinelRef} className="h-8" />}
      </div>

      {/* Sticky bottom CTA */}
      {selectedMap.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-30 flex justify-center bg-white/90 backdrop-blur-sm border-t border-gray-200 px-4 py-3">
          <div className="w-full max-w-md">
            <button
              onClick={handleSuggest}
              disabled={suggesting}
              className="w-full bg-green-600 hover:bg-green-700 disabled:bg-green-300 text-white font-semibold text-base py-3.5 rounded-2xl transition-colors shadow-sm"
            >
              {suggesting ? "Saving…" : `Suggest ${selectedMap.size} Product${selectedMap.size > 1 ? "s" : ""}`}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

export default function SuggestProductsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-50 max-w-md mx-auto flex items-center justify-center">
          <div className="h-8 w-8 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <SuggestProductsContent />
    </Suspense>
  );
}
