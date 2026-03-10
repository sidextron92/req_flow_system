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

interface AssignedRequirement extends Requirement {
  created_by_name: string | null;
  created_by_darkstore: string | null;
}

type TabId = "byMe" | "forMe";

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

const EXCLUDED_FOR_COUNT = new Set(["DRAFT", "COMPLETED"]);

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

// ─── Assigned Requirement Card ────────────────────────────────────────────────

function AssignedRequirementCard({
  req,
  onClick,
}: {
  req: AssignedRequirement;
  onClick: () => void;
}) {
  const qtyNote = req.requirement_products
    .map((p) => p.notes)
    .filter(Boolean)
    .join(" · ");

  const title = req.label_name ?? req.category_name ?? "—";
  const creatorLine = [req.created_by_name, req.created_by_darkstore]
    .filter(Boolean)
    .join(" · ");

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

      {/* Row 4: Creator name + darkstore */}
      {creatorLine && (
        <div className="flex items-center gap-1.5 text-xs text-gray-400">
          <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24"
               stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round"
                  d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
          <span className="truncate">{creatorLine}</span>
        </div>
      )}

      {/* Row 5: Remarks / Qty (only if present) */}
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

// ─── Tab Bar ──────────────────────────────────────────────────────────────────

function TabBar({
  activeTab,
  byMeCount,
  forMeCount,
  onSwitch,
}: {
  activeTab: TabId;
  byMeCount: number;
  forMeCount: number;
  onSwitch: (tab: TabId) => void;
}) {
  const tabs: { id: TabId; label: string; count: number }[] = [
    { id: "byMe",   label: "Requirements by me", count: byMeCount },
    { id: "forMe",  label: "Req for me",          count: forMeCount },
  ];

  return (
    <div className="flex gap-1 bg-gray-100 rounded-2xl p-1">
      {tabs.map(({ id, label, count }) => {
        const isActive = activeTab === id;
        return (
          <button
            key={id}
            onClick={() => onSwitch(id)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-xs font-semibold transition-colors ${
              isActive
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {label}
            {count > 0 && (
              <span
                className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none ${
                  isActive
                    ? "bg-blue-600 text-white"
                    : "bg-gray-300 text-gray-600"
                }`}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
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

  // Defer all search-param-dependent rendering to after mount to prevent hydration mismatch.
  // The server has no access to URL params; the client does — so we show the skeleton until mounted.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const [requirements, setRequirements]             = useState<Requirement[]>([]);
  const [loading, setLoading]                       = useState(false);
  const [assignedRequirements, setAssignedReqs]     = useState<AssignedRequirement[]>([]);
  const [assignedLoading, setAssignedLoading]       = useState(false);
  const [userRole, setUserRole]                     = useState<string | null>(null);
  const [formOpen, setFormOpen]                     = useState(false);
  const [activeStatus, setActiveStatus]             = useState<string | null>(null);
  const [sort, setSort]                             = useState<SortOption>("created_desc");

  // Derive active tab from URL param + role (not a state var — avoids double-render)
  const tabParam = searchParams.get("tab") as TabId | null;
  const defaultTab: TabId = userRole === "bijnisTrader" ? "byMe" : "forMe";
  const activeTab: TabId  = (tabParam === "byMe" || tabParam === "forMe") ? tabParam : defaultTab;

  const fetchAllData = useCallback(async () => {
    if (!userId) return;

    setLoading(true);
    setAssignedLoading(true);

    const [reqResult, assignedResult, userResult] = await Promise.allSettled([
      fetch(`/api/requirements?userId=${userId}`),
      fetch(`/api/requirements/assigned?userId=${userId}`),
      fetch(`/api/user?userId=${userId}`),
    ]);

    if (reqResult.status === "fulfilled" && reqResult.value.ok) {
      const json = await reqResult.value.json();
      setRequirements(json.data ?? []);
    }
    setLoading(false);

    if (assignedResult.status === "fulfilled" && assignedResult.value.ok) {
      const json = await assignedResult.value.json();
      setAssignedReqs(json.data ?? []);
    }
    setAssignedLoading(false);

    if (userResult.status === "fulfilled" && userResult.value.ok) {
      const json = await userResult.value.json();
      setUserRole(json.data?.role ?? null);
    }
  }, [userId]);

  useEffect(() => { fetchAllData(); }, [fetchAllData]);

  function switchTab(tab: TabId) {
    setActiveStatus(null);
    setSort("created_desc");
    router.replace(`/?userId=${userId}&tab=${tab}`);
  }

  // Badge counts — exclude DRAFT and COMPLETED
  const byMeBadgeCount = useMemo(
    () => requirements.filter((r) => !EXCLUDED_FOR_COUNT.has(r.status)).length,
    [requirements]
  );
  // assignedRequirements already excludes DRAFT/COMPLETED at the API level
  const forMeBadgeCount = assignedRequirements.length;

  const displayedRequirements = useMemo(() => {
    const source: Requirement[] =
      activeTab === "byMe" ? requirements : (assignedRequirements as Requirement[]);

    let list = activeStatus
      ? source.filter((r) => r.status === activeStatus)
      : source;

    if (sort === "deadline_asc") {
      list = [...list].sort((a, b) => {
        if (!a.expiry_date && !b.expiry_date) return 0;
        if (!a.expiry_date) return 1;
        if (!b.expiry_date) return -1;
        return new Date(a.expiry_date).getTime() - new Date(b.expiry_date).getTime();
      });
    } else {
      list = [...list].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    }

    return list;
  }, [requirements, assignedRequirements, activeTab, activeStatus, sort]);

  const isActiveTabLoading = activeTab === "byMe" ? loading : assignedLoading;

  if (!mounted) return <HomeSkeleton />;

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

            <TabBar
              activeTab={activeTab}
              byMeCount={byMeBadgeCount}
              forMeCount={forMeBadgeCount}
              onSwitch={switchTab}
            />

            <FilterBar
              activeStatus={activeStatus}
              sort={sort}
              onStatusChange={setActiveStatus}
              onSortChange={setSort}
            />

            {isActiveTabLoading ? (
              <div className="flex flex-col gap-3 mt-1">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="bg-white rounded-2xl border border-gray-200 p-4 h-24 animate-pulse" />
                ))}
              </div>
            ) : displayedRequirements.length === 0 ? (
              <div className="text-center text-gray-400 py-16 text-sm">
                {activeTab === "byMe"
                  ? (requirements.length === 0
                      ? "No requirements yet. Create your first one!"
                      : "No requirements match this filter.")
                  : (assignedRequirements.length === 0
                      ? "No requirements assigned to you."
                      : "No requirements match this filter.")}
              </div>
            ) : (
              <ul className="flex flex-col gap-3">
                {displayedRequirements.map((req) =>
                  activeTab === "byMe" ? (
                    <RequirementCard
                      key={req.id}
                      req={req}
                      onClick={() =>
                        router.push(`/requirements/${req.id}?userId=${userId}&tab=${activeTab}`)
                      }
                    />
                  ) : (
                    <AssignedRequirementCard
                      key={req.id}
                      req={req as AssignedRequirement}
                      onClick={() =>
                        router.push(`/requirements/${req.id}?userId=${userId}&tab=${activeTab}`)
                      }
                    />
                  )
                )}
              </ul>
            )}
          </section>
        </div>
      </main>

      <RequirementForm
        isOpen={formOpen}
        userId={userId}
        onClose={() => setFormOpen(false)}
        onSubmitSuccess={fetchAllData}
      />
    </>
  );
}

function HomeSkeleton() {
  return (
    <main className="min-h-screen bg-gray-50 flex flex-col max-w-md mx-auto">
      <header className="bg-white border-b border-gray-200 px-4 py-5 sticky top-0 z-10">
        <div className="h-7 w-28 bg-gray-200 rounded-lg animate-pulse" />
      </header>
      <div className="flex-1 px-4 py-6 flex flex-col gap-5">
        <div className="h-14 w-full bg-blue-200 rounded-2xl animate-pulse" />
        <div className="flex flex-col gap-3">
          <div className="h-4 w-36 bg-gray-200 rounded animate-pulse" />
          {/* Tab bar skeleton */}
          <div className="flex gap-1 bg-gray-100 rounded-2xl p-1">
            <div className="flex-1 h-9 rounded-xl bg-gray-200 animate-pulse" />
            <div className="flex-1 h-9 rounded-xl bg-gray-200 animate-pulse" />
          </div>
          {/* Filter chips */}
          <div className="flex gap-2 overflow-hidden">
            {[80, 60, 100, 72].map((w, i) => (
              <div key={i} className={`h-7 rounded-full bg-gray-200 animate-pulse shrink-0`} style={{ width: w }} />
            ))}
          </div>
          {/* Cards */}
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-2xl border border-gray-200 p-4 flex flex-col gap-2.5 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="h-3.5 w-16 bg-gray-200 rounded animate-pulse" />
                <div className="h-3.5 w-20 bg-gray-100 rounded animate-pulse" />
              </div>
              <div className="h-5 w-48 bg-gray-200 rounded animate-pulse" />
              <div className="flex gap-2">
                <div className="h-5 w-16 rounded-full bg-gray-200 animate-pulse" />
                <div className="h-5 w-14 rounded-full bg-gray-100 animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<HomeSkeleton />}>
      <HomeContent />
    </Suspense>
  );
}
