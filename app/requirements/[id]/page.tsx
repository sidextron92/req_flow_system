"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";

// ─── Types ────────────────────────────────────────────────────────────────────

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
}

interface Attachment {
  url: string;
  file_name: string;
  storage_path: string;
}

interface Requirement {
  id: string;
  type: string;
  status: string;
  label_name: string | null;
  label_id: string | null;
  category_id: string | null;
  category_name: string | null;
  expiry_date: string | null;
  remarks: string | null;
  qty_required: string | null;
  attachments: Attachment[];
  comment_log: (CommentEntry | CommentEntry[])[];
  created_at: string;
  updated_at: string;
  created_by: number;
  assigned_to_user_id: number | null;
  assigned_date: string | null;
  requirement_products: RequirementProduct[];
}

interface AssignedUser {
  name: string;
  role: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

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
  RESTOCK:     "bg-indigo-50 text-indigo-600",
  NEW_LABEL:   "bg-teal-50 text-teal-700",
  NEW_VARIETY: "bg-violet-50 text-violet-700",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
  });
}

function formatDateTime(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function daysLeft(expiryIso: string): number {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const exp = new Date(expiryIso); exp.setHours(0, 0, 0, 0);
  return Math.round((exp.getTime() - now.getTime()) / 86_400_000);
}

/** Flatten comment_log — guards against accidentally nested arrays like [{...}] */
function flattenComments(raw: (CommentEntry | CommentEntry[])[]): CommentEntry[] {
  return raw.flatMap((item) =>
    Array.isArray(item) ? item : [item]
  ).filter(
    (c): c is CommentEntry =>
      c !== null &&
      typeof c === "object" &&
      typeof (c as CommentEntry).comment === "string" &&
      typeof (c as CommentEntry).date === "string"
  );
}

function isImageUrl(url: string) {
  return /\.(jpg|jpeg|png|gif|webp|avif|svg)(\?.*)?$/i.test(url);
}

// ─── Section wrapper ──────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-4 flex flex-col gap-3 shadow-sm">
      <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{title}</h2>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-gray-400">{label}</span>
      <span className="text-sm font-medium text-gray-800">{value ?? "—"}</span>
    </div>
  );
}

function DeadlineBadge({ expiry }: { expiry: string | null }) {
  if (!expiry) return <span className="text-gray-400 text-sm">—</span>;
  const days = daysLeft(expiry);
  let cls = "inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full ";
  let label: string;
  if (days < 0)        { cls += "bg-red-100 text-red-700";       label = `${Math.abs(days)}d overdue`; }
  else if (days === 0) { cls += "bg-red-100 text-red-700";       label = "Due today"; }
  else if (days <= 3)  { cls += "bg-orange-100 text-orange-700"; label = `${days}d left`; }
  else if (days <= 7)  { cls += "bg-yellow-100 text-yellow-700"; label = `${days}d left`; }
  else                 { cls += "bg-gray-100 text-gray-600";     label = `${days}d left`; }
  return (
    <span className={cls}>
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3M3 11h18M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
      </svg>
      {formatDate(expiry)} · {label}
    </span>
  );
}

// ─── Collapsible Overview ─────────────────────────────────────────────────────

function CollapsibleOverview({
  req,
  assignedUser,
}: {
  req: Requirement;
  assignedUser: AssignedUser | null;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Header row — always visible, clickable */}
      <button
        onClick={() => setIsOpen((v) => !v)}
        className="w-full px-4 pt-4 pb-3 flex items-center justify-between"
      >
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Overview</h2>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Always-visible summary: type badge + deadline */}
      <div className="px-4 pb-4 flex items-center gap-3 flex-wrap">
        <span className={`inline-block text-xs font-semibold px-2.5 py-1 rounded-full ${TYPE_COLORS[req.type] ?? "bg-gray-100 text-gray-600"}`}>
          {TYPE_LABELS[req.type] ?? req.type}
        </span>
        <DeadlineBadge expiry={req.expiry_date} />
      </div>

      {/* Expandable details */}
      {isOpen && (
        <div className="border-t border-gray-100 px-4 py-4 flex flex-col gap-4">
          {/* Assignment */}
          {(req.assigned_to_user_id || req.assigned_date) && (
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              {req.assigned_to_user_id && (
                <Row
                  label="Assigned to"
                  value={
                    assignedUser
                      ? `${assignedUser.name} (${assignedUser.role})`
                      : `User ${req.assigned_to_user_id}`
                  }
                />
              )}
              {req.assigned_date && (
                <Row label="Assigned on" value={formatDate(req.assigned_date)} />
              )}
            </div>
          )}

          {/* Created / Updated */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Row label="Created"      value={formatDate(req.created_at)} />
            <Row label="Last updated" value={formatDate(req.updated_at)} />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Attachment Carousel ──────────────────────────────────────────────────────

function AttachmentCarousel({ attachments, startIndex, onClose }: {
  attachments: Attachment[];
  startIndex: number;
  onClose: () => void;
}) {
  const [current, setCurrent] = useState(startIndex);
  const touchStartX = useRef<number | null>(null);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft")  setCurrent((c) => Math.max(0, c - 1));
      if (e.key === "ArrowRight") setCurrent((c) => Math.min(attachments.length - 1, c + 1));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [attachments.length, onClose]);

  const att = attachments[current];

  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 flex flex-col"
      onTouchStart={(e) => { touchStartX.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => {
        if (touchStartX.current === null) return;
        const dx = e.changedTouches[0].clientX - touchStartX.current;
        if (dx > 50)  setCurrent((c) => Math.max(0, c - 1));
        if (dx < -50) setCurrent((c) => Math.min(attachments.length - 1, c + 1));
        touchStartX.current = null;
      }}
    >
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 shrink-0">
        <span className="text-white/60 text-sm truncate max-w-[70%]">{att.file_name}</span>
        <div className="flex items-center gap-3">
          <a
            href={att.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-white/60 hover:text-white transition-colors"
            aria-label="Open original"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
          <button onClick={onClose} className="text-white/60 hover:text-white transition-colors" aria-label="Close">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Image / file area */}
      <div className="flex-1 flex items-center justify-center px-4 min-h-0 relative">
        {/* Prev */}
        {current > 0 && (
          <button
            onClick={() => setCurrent((c) => c - 1)}
            className="absolute left-2 z-10 bg-black/40 hover:bg-black/60 text-white rounded-full p-2 transition-colors"
            aria-label="Previous"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}

        {isImageUrl(att.url) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={att.url}
            alt={att.file_name}
            className="max-h-full max-w-full object-contain rounded-lg select-none"
            draggable={false}
          />
        ) : (
          <div className="flex flex-col items-center gap-4">
            <svg className="w-16 h-16 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
            <p className="text-white/60 text-sm">{att.file_name}</p>
            <a
              href={att.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 text-sm underline"
            >
              Open file
            </a>
          </div>
        )}

        {/* Next */}
        {current < attachments.length - 1 && (
          <button
            onClick={() => setCurrent((c) => c + 1)}
            className="absolute right-2 z-10 bg-black/40 hover:bg-black/60 text-white rounded-full p-2 transition-colors"
            aria-label="Next"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        )}
      </div>

      {/* Dot indicators + counter */}
      {attachments.length > 1 && (
        <div className="flex items-center justify-center gap-1.5 py-4 shrink-0">
          {attachments.map((_, i) => (
            <button
              key={i}
              onClick={() => setCurrent(i)}
              className={`rounded-full transition-all ${
                i === current ? "w-4 h-2 bg-white" : "w-2 h-2 bg-white/30"
              }`}
              aria-label={`Go to ${i + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AttachmentsSection({ attachments }: { attachments: Attachment[] }) {
  const [carouselIndex, setCarouselIndex] = useState<number | null>(null);

  return (
    <>
      <Section title={`Attachments (${attachments.length})`}>
        <div className="grid grid-cols-3 gap-2">
          {attachments.map((att, i) => (
            <button
              key={i}
              onClick={() => setCarouselIndex(i)}
              className="aspect-square rounded-xl overflow-hidden bg-gray-100 border border-gray-200 hover:opacity-90 active:opacity-75 transition-opacity relative"
              aria-label={att.file_name}
            >
              {isImageUrl(att.url) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={att.url}
                  alt={att.file_name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center gap-1 p-2">
                  <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                  </svg>
                  <span className="text-[10px] text-gray-500 text-center truncate w-full px-1">{att.file_name}</span>
                </div>
              )}
            </button>
          ))}
        </div>
      </Section>

      {carouselIndex !== null && (
        <AttachmentCarousel
          attachments={attachments}
          startIndex={carouselIndex}
          onClose={() => setCarouselIndex(null)}
        />
      )}
    </>
  );
}

// ─── Chat ─────────────────────────────────────────────────────────────────────

function ChatBubble({ entry, isMine }: { entry: CommentEntry; isMine: boolean }) {
  const timeStr = formatDateTime(entry.date);
  return (
    <div className={`flex flex-col gap-0.5 max-w-[80%] ${isMine ? "self-end items-end" : "self-start items-start"}`}>
      {!isMine && (
        <span className="text-xs text-gray-400 px-1">{entry.name}</span>
      )}
      <div
        className={`px-3.5 py-2.5 rounded-2xl text-sm leading-snug ${
          isMine
            ? "bg-blue-600 text-white rounded-br-sm"
            : "bg-gray-100 text-gray-900 rounded-bl-sm"
        }`}
      >
        {entry.comment}
      </div>
      {timeStr && (
        <span className="text-[10px] text-gray-400 px-1">{timeStr}</span>
      )}
    </div>
  );
}

function ChatBox({
  comments,
  userId,
  userName,
  requirementId,
  onNewComment,
}: {
  comments: CommentEntry[];
  userId: number;
  userName: string;
  requirementId: string;
  onNewComment: (entry: CommentEntry) => void;
}) {
  const [text, setText]       = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef             = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [comments]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || sending) return;
    setSending(true);
    try {
      const res = await fetch(`/api/requirements/${requirementId}/comment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, name: userName, comment: text.trim() }),
      });
      if (!res.ok) throw new Error("Failed to send");
      const json = await res.json();
      onNewComment(json.data);
      setText("");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 flex flex-col gap-3">
        {comments.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-8">No comments yet. Start the conversation!</p>
        ) : (
          comments.map((c, i) => (
            <ChatBubble key={i} entry={c} isMine={c.userId === userId} />
          ))
        )}
        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={submit}
        className="border-t border-gray-100 px-3 py-2.5 flex items-end gap-2 shrink-0"
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(e as unknown as React.FormEvent); }
          }}
          placeholder="Type a comment…"
          rows={1}
          className="flex-1 resize-none text-sm bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 max-h-28 overflow-y-auto"
          style={{ fieldSizing: "content" } as React.CSSProperties}
        />
        <button
          type="submit"
          disabled={!text.trim() || sending}
          className="shrink-0 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-xl px-3.5 py-2 transition-colors"
          aria-label="Send"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
          </svg>
        </button>
      </form>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

function DetailContent() {
  const { id }       = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router       = useRouter();
  const userId       = Number(searchParams.get("userId") ?? 0);

  const [req, setReq]                   = useState<Requirement | null>(null);
  const [userName, setUserName]         = useState<string>("");
  const [assignedUser, setAssignedUser] = useState<AssignedUser | null>(null);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState<string | null>(null);
  const [activeTab, setActiveTab]       = useState<"requirement" | "chat">("requirement");

  const fetchReq = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [reqRes, userRes] = await Promise.all([
        fetch(`/api/requirements/${id}`),
        userId ? fetch(`/api/user?userId=${userId}`) : Promise.resolve(null),
      ]);

      if (!reqRes.ok) { setError("Requirement not found."); return; }
      const reqJson = await reqRes.json();
      const reqData: Requirement = reqJson.data;
      setReq(reqData);

      let currentUserData: { name: string; role: string } | null = null;
      if (userRes?.ok) {
        const userJson = await userRes.json();
        currentUserData = userJson.data ?? null;
        setUserName(currentUserData?.name ?? `User ${userId}`);
      } else {
        setUserName(`User ${userId}`);
      }

      // Fetch assignee details
      if (reqData.assigned_to_user_id) {
        if (reqData.assigned_to_user_id === userId && currentUserData) {
          // Assigned to self — reuse already-fetched data
          setAssignedUser({ name: currentUserData.name, role: currentUserData.role });
        } else {
          try {
            const assigneeRes = await fetch(`/api/user?userId=${reqData.assigned_to_user_id}`);
            if (assigneeRes.ok) {
              const assigneeJson = await assigneeRes.json();
              if (assigneeJson.data) {
                setAssignedUser({ name: assigneeJson.data.name, role: assigneeJson.data.role });
              }
            }
          } catch {
            // non-fatal — falls back to "User <id>"
          }
        }
      }
    } catch {
      setError("Failed to load requirement.");
    } finally {
      setLoading(false);
    }
  }, [id, userId]);

  useEffect(() => { fetchReq(); }, [fetchReq]);

  function handleNewComment(entry: CommentEntry) {
    setReq((prev) => prev ? { ...prev, comment_log: [...prev.comment_log, entry] } : prev);
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 max-w-md mx-auto flex items-center justify-center">
        <div className="text-gray-400 text-sm">Loading…</div>
      </div>
    );
  }

  if (error || !req) {
    return (
      <div className="min-h-screen bg-gray-50 max-w-md mx-auto flex flex-col items-center justify-center gap-3 px-4">
        <p className="text-gray-500 text-sm">{error ?? "Something went wrong."}</p>
        <button onClick={() => router.back()} className="text-blue-600 text-sm font-medium">← Go back</button>
      </div>
    );
  }

  const title    = req.label_name ?? req.category_name ?? "Untitled";
  const backUrl  = `/?userId=${userId}`;
  const comments = flattenComments(req.comment_log);

  // Red dot: last comment is from someone other than the current user
  const lastComment = comments[comments.length - 1];
  const hasUnread   = !!lastComment && lastComment.userId !== userId;

  return (
    <main className="min-h-screen bg-gray-50 flex flex-col max-w-md mx-auto">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-4 sticky top-0 z-10 flex items-center gap-3">
        <button
          onClick={() => router.push(backUrl)}
          className="text-gray-500 hover:text-gray-800 transition-colors -ml-1 p-1"
          aria-label="Back"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-gray-400 leading-none mb-0.5">{TYPE_LABELS[req.type] ?? req.type}</p>
          <h1 className="text-base font-bold text-gray-900 truncate">{title}</h1>
        </div>
        <span className={`shrink-0 text-xs font-medium px-2.5 py-1 rounded-full ${STATUS_COLORS[req.status] ?? "bg-gray-100 text-gray-600"}`}>
          {req.status.replace(/_/g, " ")}
        </span>
      </header>

      {/* Tab bar */}
      <div className="bg-white border-b border-gray-200 px-4 py-2 sticky top-[73px] z-10 flex gap-1">
        <button
          onClick={() => setActiveTab("requirement")}
          className={`flex-1 py-1.5 rounded-xl text-sm font-medium transition-colors ${
            activeTab === "requirement"
              ? "bg-gray-100 text-gray-900"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          Requirement
        </button>
        <button
          onClick={() => setActiveTab("chat")}
          className={`flex-1 py-1.5 rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-1.5 ${
            activeTab === "chat"
              ? "bg-gray-100 text-gray-900"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          Chat
          {comments.length > 0 && (
            <span className="bg-gray-200 text-gray-600 text-xs font-semibold px-1.5 py-0.5 rounded-full leading-none">
              {comments.length}
            </span>
          )}
          {hasUnread && activeTab !== "chat" && (
            <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" aria-label="Unread messages" />
          )}
        </button>
      </div>

      {/* Body */}
      {activeTab === "requirement" ? (
        <div className="flex-1 px-4 py-5 flex flex-col gap-4 pb-8">

          {/* Collapsible Overview */}
          <CollapsibleOverview req={req} assignedUser={assignedUser} />

          {/* Label & Category */}
          <Section title="Label & Category">
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              {req.label_name && (
                <Row
                  label="Label name"
                  value={
                    <span>
                      {req.label_name}
                      {req.label_id && (
                        <span className="text-gray-400 font-normal ml-1">({req.label_id})</span>
                      )}
                    </span>
                  }
                />
              )}
              <Row label="Category" value={req.category_name} />
              {req.qty_required && <Row label="Qty required" value={req.qty_required} />}
            </div>
          </Section>

          {/* Remarks */}
          {req.remarks && (
            <Section title="Remarks">
              <p className="text-sm text-gray-700 leading-relaxed">{req.remarks}</p>
            </Section>
          )}

          {/* Products */}
          {req.requirement_products.length > 0 && (
            <Section title={`Products (${req.requirement_products.length})`}>
              <ul className="flex flex-col gap-2">
                {req.requirement_products.map((p, i) => (
                  <li key={p.id} className="bg-gray-50 rounded-xl px-3 py-2.5 flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-gray-800">{p.product_name}</span>
                      {req.requirement_products.length > 1 && (
                        <span className="text-xs text-gray-400">#{i + 1}</span>
                      )}
                    </div>
                    {p.product_id && <span className="text-xs text-gray-400">ID: {p.product_id}</span>}
                    {p.notes      && <span className="text-xs text-gray-600 mt-0.5">{p.notes}</span>}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {/* Attachments */}
          {req.attachments.length > 0 && (
            <AttachmentsSection attachments={req.attachments} />
          )}
        </div>
      ) : (
        <div className="flex-1 flex flex-col min-h-0 px-4 py-4">
          <ChatBox
            comments={comments}
            userId={userId}
            userName={userName}
            requirementId={req.id}
            onNewComment={handleNewComment}
          />
        </div>
      )}
    </main>
  );
}

export default function RequirementDetailPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 max-w-md mx-auto flex items-center justify-center">
        <div className="text-gray-400 text-sm">Loading…</div>
      </div>
    }>
      <DetailContent />
    </Suspense>
  );
}
