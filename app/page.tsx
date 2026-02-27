"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import RequirementForm from "./components/RequirementForm";

interface RequirementProduct {
  id: string;
  product_id: string | null;
  product_name: string;
  notes: string | null;
}

interface Requirement {
  id: string;
  type: string;
  status: string;
  label_name: string | null;
  category_name: string | null;
  expiry_date: string | null;
  remarks: string | null;
  created_at: string;
  requirement_products: RequirementProduct[];
}

const STATUS_COLORS: Record<string, string> = {
  DRAFT:                 "bg-gray-100 text-gray-600",
  OPEN:                  "bg-blue-100 text-blue-700",
  IN_PROCESS:            "bg-yellow-100 text-yellow-700",
  REVIEW_FOR_COMPLETION: "bg-purple-100 text-purple-700",
  COMPLETED:             "bg-green-100 text-green-700",
  INCOMPLETE:            "bg-red-100 text-red-700",
  PARTIALLY_COMPLETE:    "bg-orange-100 text-orange-700",
};

const TYPE_LABELS: Record<string, string> = {
  RESTOCK:     "Restock",
  NEW_LABEL:   "New Label",
  NEW_VARIETY: "New Variety",
};

const TYPE_COLORS: Record<string, string> = {
  RESTOCK:     "text-indigo-500",
  NEW_LABEL:   "text-teal-600",
  NEW_VARIETY: "text-violet-600",
};

const ALL_STATUSES = [
  "DRAFT", "OPEN", "IN_PROCESS",
  "REVIEW_FOR_COMPLETION", "COMPLETED", "INCOMPLETE", "PARTIALLY_COMPLETE",
];

type SortOption = "deadline_asc" | "created_desc";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
  });
}

function daysLeft(expiryIso: string): number {
  const now   = new Date();
  now.setHours(0, 0, 0, 0);
  const expiry = new Date(expiryIso);
  expiry.setHours(0, 0, 0, 0);
  return Math.round((expiry.getTime() - now.getTime()) / 86_400_000);
}

function DaysLeftBadge({ expiry }: { expiry: string | null }) {
  if (!expiry) return null;
  const days = daysLeft(expiry);

  let cls = "text-xs font-semibold px-2 py-0.5 rounded-full ";
  let label: string;

  if (days < 0) {
    cls += "bg-red-100 text-red-700";
    label = `${Math.abs(days)}d overdue`;
  } else if (days === 0) {
    cls += "bg-red-100 text-red-700";
    label = "Due today";
  } else if (days <= 3) {
    cls += "bg-orange-100 text-orange-700";
    label = `${days}d left`;
  } else if (days <= 7) {
    cls += "bg-yellow-100 text-yellow-700";
    label = `${days}d left`;
  } else {
    cls += "bg-gray-100 text-gray-500";
    label = `${days}d left`;
  }

  return <span className={cls}>{label}</span>;
}

// ─── Requirement Card ─────────────────────────────────────────────────────────

function RequirementCard({ req, onClick }: { req: Requirement; onClick: () => void }) {
  // Qty hint — look for a "qty" or numeric pattern in notes of any product
  const qtyNote = req.requirement_products
    .map((p) => p.notes)
    .filter(Boolean)
    .join(" · ");

  const title = req.label_name ?? req.category_name ?? "—";

  return (
    <li
      onClick={onClick}
      className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm flex flex-col gap-2.5 cursor-pointer active:scale-[0.98] transition-transform"
    >
      {/* Row 1: Type + Created date */}
      <div className="flex items-center justify-between">
        <span className={`text-xs font-semibold ${TYPE_COLORS[req.type] ?? "text-blue-500"}`}>
          {TYPE_LABELS[req.type] ?? req.type}
        </span>
        <span className="text-xs text-gray-400">{formatDate(req.created_at)}</span>
      </div>

      {/* Row 2: Title */}
      <p className="text-base font-semibold text-gray-900 leading-snug">{title}</p>

      {/* Row 3: Status + Days left */}
      <div className="flex items-center gap-2 flex-wrap">
        <span
          className={`text-xs font-medium px-2 py-0.5 rounded-full ${
            STATUS_COLORS[req.status] ?? "bg-gray-100 text-gray-600"
          }`}
        >
          {req.status.replace(/_/g, " ")}
        </span>
        <DaysLeftBadge expiry={req.expiry_date} />
      </div>

      {/* Row 4: Remarks / Qty (only if present) */}
      {(req.remarks || qtyNote) && (
        <p className="text-xs text-gray-500 leading-snug line-clamp-2">
          {[req.remarks, qtyNote ? `Qty: ${qtyNote}` : null]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
    </li>
  );
}

// ─── Filter / Sort Bar ────────────────────────────────────────────────────────

function FilterBar({
  activeStatus,
  sort,
  onStatusChange,
  onSortChange,
}: {
  activeStatus: string | null;
  sort: SortOption;
  onStatusChange: (s: string | null) => void;
  onSortChange: (s: SortOption) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {/* Status chips */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide">
        <button
          onClick={() => onStatusChange(null)}
          className={`shrink-0 text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
            activeStatus === null
              ? "bg-gray-900 text-white border-gray-900"
              : "bg-white text-gray-600 border-gray-200"
          }`}
        >
          All
        </button>
        {ALL_STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => onStatusChange(s === activeStatus ? null : s)}
            className={`shrink-0 text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
              activeStatus === s
                ? "bg-gray-900 text-white border-gray-900"
                : "bg-white text-gray-600 border-gray-200"
            }`}
          >
            {s.replace(/_/g, " ")}
          </button>
        ))}
      </div>

      {/* Sort select */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-400 shrink-0">Sort by</span>
        <select
          value={sort}
          onChange={(e) => onSortChange(e.target.value as SortOption)}
          className="flex-1 text-xs bg-white border border-gray-200 rounded-xl px-3 py-1.5 text-gray-700 appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="deadline_asc">Deadline approaching</option>
          <option value="created_desc">Latest created</option>
        </select>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function HomeContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const userId = Number(searchParams.get("userId") ?? 0);

  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [loading, setLoading]           = useState(false);
  const [formOpen, setFormOpen]         = useState(false);
  const [activeStatus, setActiveStatus] = useState<string | null>(null);
  const [sort, setSort]                 = useState<SortOption>("created_desc");

  const fetchRequirements = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/requirements?userId=${userId}`);
      const json = await res.json();
      setRequirements(json.data ?? []);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { fetchRequirements(); }, [fetchRequirements]);

  const displayedRequirements = useMemo(() => {
    let list = activeStatus
      ? requirements.filter((r) => r.status === activeStatus)
      : requirements;

    if (sort === "deadline_asc") {
      list = [...list].sort((a, b) => {
        // No expiry → sort to end
        if (!a.expiry_date && !b.expiry_date) return 0;
        if (!a.expiry_date) return 1;
        if (!b.expiry_date) return -1;
        return new Date(a.expiry_date).getTime() - new Date(b.expiry_date).getTime();
      });
    } else {
      // "created_desc" — already returned newest first from API, just preserve
      list = [...list].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    }

    return list;
  }, [requirements, activeStatus, sort]);

  return (
    <>
      <main className="min-h-screen bg-gray-50 flex flex-col max-w-md mx-auto">
        {/* Header */}
        <header className="bg-white border-b border-gray-200 px-4 py-5 sticky top-0 z-10">
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Req Flow</h1>
          {!userId && (
            <p className="text-xs text-red-500 mt-0.5">No userId in URL — add ?userId=123</p>
          )}
        </header>

        {/* Content */}
        <div className="flex-1 px-4 py-6 flex flex-col gap-5">
          {/* CTA */}
          <button
            onClick={() => setFormOpen(true)}
            disabled={!userId}
            className="w-full bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:bg-blue-300 text-white font-semibold text-base py-4 rounded-2xl transition-colors shadow-sm"
          >
            + Create a New Requirement
          </button>

          {/* Requirements List */}
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
              My Requirements
            </h2>

            <FilterBar
              activeStatus={activeStatus}
              sort={sort}
              onStatusChange={setActiveStatus}
              onSortChange={setSort}
            />

            {loading ? (
              <div className="flex flex-col gap-3 mt-1">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="bg-white rounded-2xl border border-gray-200 p-4 h-24 animate-pulse" />
                ))}
              </div>
            ) : displayedRequirements.length === 0 ? (
              <div className="text-center text-gray-400 py-16 text-sm">
                {requirements.length === 0
                  ? "No requirements yet. Create your first one!"
                  : "No requirements match this filter."}
              </div>
            ) : (
              <ul className="flex flex-col gap-3">
                {displayedRequirements.map((req) => (
                  <RequirementCard
                    key={req.id}
                    req={req}
                    onClick={() => router.push(`/requirements/${req.id}?userId=${userId}`)}
                  />
                ))}
              </ul>
            )}
          </section>
        </div>
      </main>

      <RequirementForm
        isOpen={formOpen}
        userId={userId}
        onClose={() => setFormOpen(false)}
        onSubmitSuccess={fetchRequirements}
      />
    </>
  );
}

export default function Home() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 max-w-md mx-auto flex items-center justify-center">
        <div className="text-gray-400 text-sm">Loading...</div>
      </div>
    }>
      <HomeContent />
    </Suspense>
  );
}
