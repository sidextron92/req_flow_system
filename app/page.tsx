"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import RequirementForm from "./components/RequirementForm";
import PushPermissionPrompt from "./components/PushPermissionPrompt";

interface RequirementProduct {
  id: string;
  product_id: string | null;
  product_name: string;
  notes: string | null;
}

interface CommentEntry {
  userId: number;
  name: string;
  date: string;
  comment: string;
  isSystemUpdate?: boolean;
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
  comment_log: CommentEntry[] | null;
  assigned_to_user_id: number | null;
  assignee: { name: string } | null;
  requirement_products: RequirementProduct[];
}

interface AssignedRequirement extends Requirement {
  created_by_name: string | null;
  created_by_darkstore: string | null;
}

type TabId = "byMe" | "forMe";

const STATUS_COLORS: Record<string, string> = {
  DRAFT:                 "bg-gray-100 text-gray-600",
  OPEN:                  "bg-green-100 text-green-700",
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

const EXCLUDED_FOR_COUNT = new Set(["DRAFT", "COMPLETED"]);

// ─── Filter definitions ────────────────────────────────────────────────────────

type FilterKey = string;

interface FilterDef {
  key: FilterKey;
  label: string;
}

const BY_ME_FILTERS: FilterDef[] = [
  { key: "all_open",       label: "All Open" },
  { key: "action_pending", label: "Action Pending" },
  { key: "closed",         label: "Closed" },
];

const FOR_ME_FILTERS: FilterDef[] = [
  { key: "all_open",  label: "All Open" },
  { key: "follow_up", label: "Follow Up" },
  { key: "closed",    label: "Closed" },
];

const BY_ME_STATUS_SETS: Record<FilterKey, Set<string>> = {
  all_open: new Set(["DRAFT", "OPEN", "IN_PROCESS", "REVIEW_FOR_COMPLETION"]),
  closed:   new Set(["COMPLETED", "INCOMPLETE", "PARTIALLY_COMPLETE", "CANNOT_BE_DONE"]),
};

const FOR_ME_STATUS_SETS: Record<FilterKey, Set<string>> = {
  all_open:  new Set(["OPEN", "IN_PROCESS"]),
  follow_up: new Set(["REVIEW_FOR_COMPLETION"]),
  closed:    new Set(["COMPLETED", "INCOMPLETE", "PARTIALLY_COMPLETE", "CANNOT_BE_DONE"]),
};

type SortOption = "deadline_asc" | "created_desc";

// ─── Fuzzy search helper ───────────────────────────────────────────────────────

/** Very lightweight fuzzy match: every char in `query` must appear in order in `str`. */
function fuzzyMatch(str: string, query: string): boolean {
  if (!query) return true;
  const s = str.toLowerCase();
  const q = query.toLowerCase();
  let si = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const idx = s.indexOf(q[qi], si);
    if (idx === -1) return false;
    si = idx + 1;
  }
  return true;
}

function requirementMatchesSearch(
  req: Requirement,
  query: string,
  tab: TabId,
): boolean {
  if (!query.trim()) return true;
  const candidates: (string | null | undefined)[] = [
    req.label_name,
    req.category_name,
    req.assignee?.name,
    ...(req.requirement_products.map((p) => p.product_name)),
  ];
  if (tab === "forMe") {
    const ar = req as AssignedRequirement;
    candidates.push(ar.created_by_name);
  }
  return candidates.some((c) => c && fuzzyMatch(c, query));
}

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
      <div className="flex items-center justify-between">
        <span className={`text-xs font-semibold ${TYPE_COLORS[req.type] ?? "text-green-500"}`}>
          {TYPE_LABELS[req.type] ?? req.type}
        </span>
        <span className="text-xs text-gray-400">{formatDate(req.created_at)}</span>
      </div>

      <p className="text-base font-semibold text-gray-900 leading-snug">{title}</p>

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

      {req.status !== "DRAFT" && (req.assignee?.name || req.status === "OPEN") && (
        <div className="flex items-center gap-1.5 text-xs text-gray-400">
          <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24"
               stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round"
                  d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
          <span className="truncate">{req.assignee?.name ?? "DS Lead"}</span>
        </div>
      )}

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
      <div className="flex items-center justify-between">
        <span className={`text-xs font-semibold ${TYPE_COLORS[req.type] ?? "text-green-500"}`}>
          {TYPE_LABELS[req.type] ?? req.type}
        </span>
        <span className="text-xs text-gray-400">{formatDate(req.created_at)}</span>
      </div>

      <p className="text-base font-semibold text-gray-900 leading-snug">{title}</p>

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
    { id: "byMe",  label: "Requirements by me", count: byMeCount },
    { id: "forMe", label: "Req for me",          count: forMeCount },
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
                    ? "bg-green-600 text-white"
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

// ─── Label Filter Bottom Sheet ────────────────────────────────────────────────

function LabelFilterSheet({
  labels,
  activeLabel,
  onSelect,
  onClose,
}: {
  labels: string[];
  activeLabel: string | null;
  onSelect: (label: string | null) => void;
  onClose: () => void;
}) {
  const [localSearch, setLocalSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Focus search on open
    const t = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, []);

  const filtered = useMemo(() => {
    if (!localSearch.trim()) return labels;
    return labels.filter((l) => fuzzyMatch(l, localSearch));
  }, [labels, localSearch]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Sheet */}
      <div className="relative bg-white rounded-t-2xl max-w-md mx-auto w-full max-h-[70vh] flex flex-col animate-slide-up">
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-10 h-1 rounded-full bg-gray-300" />
        </div>

        {/* Title row */}
        <div className="flex items-center justify-between px-4 pt-1 pb-3 shrink-0">
          <h3 className="text-base font-semibold text-gray-900">Filter by Label</h3>
          {activeLabel && (
            <button
              onClick={() => { onSelect(null); onClose(); }}
              className="text-xs text-green-600 font-medium"
            >
              Clear
            </button>
          )}
        </div>

        {/* Search inside sheet */}
        <div className="px-4 pb-3 shrink-0">
          <div className="relative">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round"
                    d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
            </svg>
            <input
              ref={inputRef}
              type="text"
              value={localSearch}
              onChange={(e) => setLocalSearch(e.target.value)}
              placeholder="Search labels…"
              className="w-full pl-9 pr-8 py-2 text-sm bg-gray-100 rounded-xl border-none outline-none focus:ring-2 focus:ring-green-500"
            />
            {localSearch && (
              <button
                onClick={() => setLocalSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Label list */}
        <ul className="overflow-y-auto flex-1 px-4 pb-6">
          {filtered.length === 0 ? (
            <li className="text-sm text-gray-400 text-center py-8">No labels found</li>
          ) : (
            filtered.map((label) => (
              <li key={label}>
                <button
                  onClick={() => { onSelect(label === activeLabel ? null : label); onClose(); }}
                  className={`w-full text-left px-3 py-3 rounded-xl text-sm flex items-center justify-between transition-colors ${
                    activeLabel === label
                      ? "bg-green-50 text-green-700 font-medium"
                      : "text-gray-800 hover:bg-gray-50"
                  }`}
                >
                  <span>{label}</span>
                  {activeLabel === label && (
                    <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24"
                         stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}

// ─── Sort Bottom Sheet ────────────────────────────────────────────────────────

function SortSheet({
  sort,
  onSelect,
  onClose,
}: {
  sort: SortOption;
  onSelect: (s: SortOption) => void;
  onClose: () => void;
}) {
  const options: { value: SortOption; label: string; desc: string }[] = [
    { value: "created_desc", label: "Latest created",       desc: "Newest requirements first" },
    { value: "deadline_asc", label: "Deadline approaching", desc: "Soonest expiry first" },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <div className="relative bg-white rounded-t-2xl max-w-md mx-auto w-full animate-slide-up">
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-gray-300" />
        </div>

        <div className="px-4 pt-1 pb-2">
          <h3 className="text-base font-semibold text-gray-900">Sort by</h3>
        </div>

        <ul className="px-4 pb-6 flex flex-col gap-1">
          {options.map((opt) => (
            <li key={opt.value}>
              <button
                onClick={() => { onSelect(opt.value); onClose(); }}
                className={`w-full text-left px-3 py-3.5 rounded-xl flex items-center justify-between transition-colors ${
                  sort === opt.value
                    ? "bg-green-50 text-green-700"
                    : "text-gray-800 hover:bg-gray-50"
                }`}
              >
                <div>
                  <p className={`text-sm font-medium ${sort === opt.value ? "text-green-700" : "text-gray-900"}`}>
                    {opt.label}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">{opt.desc}</p>
                </div>
                {sort === opt.value && (
                  <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24"
                       stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ─── Search + Filter Bar ──────────────────────────────────────────────────────

function SearchFilterBar({
  searchQuery,
  onSearchChange,
  activeLabel,
  labelCount,
  sort,
  onLabelClick,
  onSortClick,
}: {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  activeLabel: string | null;
  labelCount: number;
  sort: SortOption;
  onLabelClick: () => void;
  onSortClick: () => void;
}) {
  const sortLabels: Record<SortOption, string> = {
    created_desc: "Latest",
    deadline_asc: "Deadline",
  };

  return (
    <div className="flex items-center gap-2">
      {/* Search input — grows */}
      <div className="relative flex-1 min-w-0">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none"
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round"
                d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
        </svg>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search requirements…"
          className="w-full pl-9 pr-8 py-2 text-sm bg-white border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 placeholder:text-gray-400"
        />
        {searchQuery && (
          <button
            onClick={() => onSearchChange("")}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Label filter CTA */}
      <button
        onClick={onLabelClick}
        className={`shrink-0 flex items-center gap-1 px-3 py-2 rounded-xl border text-xs font-medium transition-colors ${
          activeLabel
            ? "bg-green-600 text-white border-green-600"
            : "bg-white text-gray-600 border-gray-200"
        }`}
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round"
                d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
        </svg>
        <span className="max-w-[64px] truncate">{activeLabel ?? "Label"}</span>
        {labelCount > 0 && !activeLabel && (
          <span className="text-[10px] text-gray-400">{labelCount}</span>
        )}
      </button>

      {/* Sort CTA */}
      <button
        onClick={onSortClick}
        className="shrink-0 flex items-center gap-1 px-3 py-2 rounded-xl border border-gray-200 bg-white text-xs font-medium text-gray-600 transition-colors hover:border-gray-300"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" />
        </svg>
        <span>{sortLabels[sort]}</span>
      </button>
    </div>
  );
}

// ─── Filter Pills ─────────────────────────────────────────────────────────────

function FilterPills({
  activeTab,
  activeFilter,
  onFilterChange,
}: {
  activeTab: TabId;
  activeFilter: FilterKey;
  onFilterChange: (f: FilterKey) => void;
}) {
  const filters = activeTab === "byMe" ? BY_ME_FILTERS : FOR_ME_FILTERS;

  return (
    <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide">
      {filters.map(({ key, label }) => (
        <button
          key={key}
          onClick={() => onFilterChange(key)}
          className={`shrink-0 text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
            activeFilter === key
              ? "bg-gray-900 text-white border-gray-900"
              : "bg-white text-gray-600 border-gray-200"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function HomeContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  // Persist userId in localStorage so PWA home screen shortcut works without URL params
  const userIdParam = searchParams.get("userId");
  const userId = useMemo(() => {
    if (typeof window === "undefined") return 0;
    if (userIdParam) {
      const n = Number(userIdParam);
      if (n) {
        localStorage.setItem("reqflow_userId", String(n));
        // Also set a cookie so the server-side /api/manifest route can read it
        // and bake the userId into start_url — fixes iOS PWA home screen launch
        document.cookie = `reqflow_userId=${n}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
      }
      return n;
    }
    return Number(localStorage.getItem("reqflow_userId") ?? 0);
  }, [userIdParam]);

  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const [requirements, setRequirements]         = useState<Requirement[]>([]);
  const [loading, setLoading]                   = useState(false);
  const [assignedRequirements, setAssignedReqs] = useState<AssignedRequirement[]>([]);
  const [assignedLoading, setAssignedLoading]   = useState(false);
  const [userRole, setUserRole]                 = useState<string | null>(null);
  const [userName, setUserName]                 = useState<string | null>(null);
  const [formOpen, setFormOpen]                 = useState(false);
  const [activeFilter, setActiveFilter]         = useState<FilterKey>("all_open");
  const [sort, setSort]                         = useState<SortOption>("created_desc");
  const [searchQuery, setSearchQuery]           = useState("");
  const [activeLabel, setActiveLabel]           = useState<string | null>(null);
  const [labelSheetOpen, setLabelSheetOpen]     = useState(false);
  const [sortSheetOpen, setSortSheetOpen]       = useState(false);

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
      setUserName(json.data?.name ?? null);
    }
  }, [userId]);

  useEffect(() => { fetchAllData(); }, [fetchAllData]);

  function switchTab(tab: TabId) {
    setActiveFilter("all_open");
    setSort("created_desc");
    setSearchQuery("");
    setActiveLabel(null);
    router.replace(`/?userId=${userId}&tab=${tab}`);
  }

  // Raw badge counts — always unfiltered
  const byMeBadgeCount = useMemo(
    () => requirements.filter((r) => !EXCLUDED_FOR_COUNT.has(r.status)).length,
    [requirements]
  );
  const forMeBadgeCount = useMemo(
    () => assignedRequirements.filter((r) => !EXCLUDED_FOR_COUNT.has(r.status)).length,
    [assignedRequirements]
  );

  // All unique labels for the active tab (sourced from full tab data, not filtered)
  const allLabels = useMemo(() => {
    const source: Requirement[] =
      activeTab === "byMe" ? requirements : (assignedRequirements as Requirement[]);
    const set = new Set<string>();
    for (const r of source) {
      if (r.label_name) set.add(r.label_name);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [requirements, assignedRequirements, activeTab]);

  const displayedRequirements = useMemo(() => {
    const source: Requirement[] =
      activeTab === "byMe" ? requirements : (assignedRequirements as Requirement[]);

    // 1. Status pill filter
    let list: Requirement[];
    if (activeTab === "byMe") {
      if (activeFilter === "action_pending") {
        list = source.filter((r) => {
          if (r.status === "REVIEW_FOR_COMPLETION") return true;
          if (r.status === "OPEN" || r.status === "IN_PROCESS") {
            const log = r.comment_log;
            if (!log || log.length === 0) return false;
            return log[log.length - 1].userId !== userId;
          }
          return false;
        });
      } else {
        const statusSet = BY_ME_STATUS_SETS[activeFilter];
        list = statusSet ? source.filter((r) => statusSet.has(r.status)) : source;
      }
    } else {
      const statusSet = FOR_ME_STATUS_SETS[activeFilter];
      list = statusSet ? source.filter((r) => statusSet.has(r.status)) : source;
    }

    // 2. Label filter (AND)
    if (activeLabel) {
      list = list.filter((r) => r.label_name === activeLabel);
    }

    // 3. Search query (AND)
    if (searchQuery.trim()) {
      list = list.filter((r) => requirementMatchesSearch(r, searchQuery, activeTab));
    }

    // 4. Sort
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
  }, [requirements, assignedRequirements, activeTab, activeFilter, sort, userId, searchQuery, activeLabel]);

  const isActiveTabLoading = activeTab === "byMe" ? loading : assignedLoading;

  if (!mounted) return <HomeSkeleton />;

  const hasActiveSecondaryFilter = searchQuery.trim() || activeLabel;

  return (
    <>
      <main className="min-h-screen bg-gray-50 flex flex-col max-w-md mx-auto">
        {/* Header */}
        <header className="bg-white border-b border-gray-200 px-4 py-5 sticky top-0 z-10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <img src="/apple-touch-icon.png" alt="ReqFlow logo" className="w-8 h-8 rounded-lg" />
              <div>
                <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Req Flow</h1>
                {userName && <p className="text-xs text-gray-400">Welcome {userName}</p>}
              </div>
            </div>
            {userId ? (
              <a
                href={`/settings?userId=${userId}`}
                className="p-2 rounded-full hover:bg-gray-100 text-gray-500"
                aria-label="Settings"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </a>
            ) : null}
          </div>
          {!userId && (
            <p className="text-xs text-red-500 mt-0.5">No userId in URL — add ?userId=123</p>
          )}
        </header>

        {/* Content */}
        <div className="flex-1 px-4 py-6 flex flex-col gap-5">
          {/* CTA */}
          {userRole !== "bijnisBuyer" && (
            <button
              onClick={() => setFormOpen(true)}
              disabled={!userId}
              className="w-full bg-green-600 hover:bg-green-700 active:bg-green-800 disabled:bg-green-300 text-white font-semibold text-base py-4 rounded-2xl transition-colors shadow-sm"
            >
              + Create a New Requirement
            </button>
          )}

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

            {/* Search + Label + Sort row */}
            <SearchFilterBar
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              activeLabel={activeLabel}
              labelCount={allLabels.length}
              sort={sort}
              onLabelClick={() => setLabelSheetOpen(true)}
              onSortClick={() => setSortSheetOpen(true)}
            />

            {/* Status filter pills */}
            <FilterPills
              activeTab={activeTab}
              activeFilter={activeFilter}
              onFilterChange={setActiveFilter}
            />

            {isActiveTabLoading ? (
              <div className="flex flex-col gap-3 mt-1">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="bg-white rounded-2xl border border-gray-200 p-4 h-24 animate-pulse" />
                ))}
              </div>
            ) : displayedRequirements.length === 0 ? (
              <div className="text-center text-gray-400 py-16 text-sm">
                {hasActiveSecondaryFilter
                  ? "No requirements match your search."
                  : activeTab === "byMe"
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

      {/* Label filter bottom sheet */}
      {labelSheetOpen && (
        <LabelFilterSheet
          labels={allLabels}
          activeLabel={activeLabel}
          onSelect={setActiveLabel}
          onClose={() => setLabelSheetOpen(false)}
        />
      )}

      {/* Sort bottom sheet */}
      {sortSheetOpen && (
        <SortSheet
          sort={sort}
          onSelect={setSort}
          onClose={() => setSortSheetOpen(false)}
        />
      )}

      {/* Push notification permission prompt */}
      {userId ? <PushPermissionPrompt userId={userId} /> : null}
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
        <div className="h-14 w-full bg-green-200 rounded-2xl animate-pulse" />
        <div className="flex flex-col gap-3">
          <div className="h-4 w-36 bg-gray-200 rounded animate-pulse" />
          {/* Tab bar skeleton */}
          <div className="flex gap-1 bg-gray-100 rounded-2xl p-1">
            <div className="flex-1 h-9 rounded-xl bg-gray-200 animate-pulse" />
            <div className="flex-1 h-9 rounded-xl bg-gray-200 animate-pulse" />
          </div>
          {/* Search + CTA row skeleton */}
          <div className="flex gap-2">
            <div className="flex-1 h-9 rounded-xl bg-gray-200 animate-pulse" />
            <div className="w-20 h-9 rounded-xl bg-gray-200 animate-pulse" />
            <div className="w-16 h-9 rounded-xl bg-gray-200 animate-pulse" />
          </div>
          {/* Filter chips */}
          <div className="flex gap-2 overflow-hidden">
            {[80, 60, 100].map((w, i) => (
              <div key={i} className="h-7 rounded-full bg-gray-200 animate-pulse shrink-0" style={{ width: w }} />
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
