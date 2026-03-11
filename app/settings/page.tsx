"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";

type SubStatus =
  | { loading: true }
  | { loading: false; subscribed: false }
  | { loading: false; subscribed: true; device_info: string | null; created_at: string };

function getDeviceInfo(): string {
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) {
    if (/chrome/i.test(ua)) return "Chrome on Android";
    if (/firefox/i.test(ua)) return "Firefox on Android";
    return "Android browser";
  }
  if (/iphone|ipad/i.test(ua)) return "Safari on iOS";
  if (/macintosh/i.test(ua)) return "Safari on Mac";
  if (/chrome/i.test(ua)) return "Chrome on Desktop";
  if (/firefox/i.test(ua)) return "Firefox on Desktop";
  return "Unknown browser";
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function SettingsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const userId = searchParams.get("userId");

  const [status, setStatus] = useState<SubStatus>({ loading: true });
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    fetch(`/api/push/subscribe?userId=${userId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.subscribed) {
          setStatus({ loading: false, subscribed: true, device_info: data.device_info, created_at: data.created_at });
        } else {
          setStatus({ loading: false, subscribed: false });
        }
      })
      .catch(() => setStatus({ loading: false, subscribed: false }));
  }, [userId]);

  async function subscribe() {
    setError(null);
    setWorking(true);
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        setError("Push notifications are not supported in this browser.");
        return;
      }

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setError("Notification permission was denied.");
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });

      const subJson = sub.toJSON() as {
        endpoint: string;
        keys: { p256dh: string; auth: string };
      };

      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: Number(userId),
          subscription: subJson,
          device_info: getDeviceInfo(),
        }),
      });

      if (!res.ok) throw new Error("Failed to save subscription");

      setStatus({
        loading: false,
        subscribed: true,
        device_info: getDeviceInfo(),
        created_at: new Date().toISOString(),
      });
      showToast("Notifications enabled for this device");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setWorking(false);
    }
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  if (!userId) {
    return (
      <div className="max-w-md mx-auto px-4 py-8 text-center text-gray-500">
        No userId provided.
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto px-4 pb-8">
      {/* Header */}
      <div className="flex items-center gap-3 py-4 mb-2">
        <button
          onClick={() => router.back()}
          className="p-2 rounded-full hover:bg-gray-100 text-gray-600"
          aria-label="Back"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="text-lg font-semibold text-gray-900">Settings</h1>
      </div>

      {/* Notifications section */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Notifications</h2>
        </div>

        <div className="px-4 py-4">
          {status.loading ? (
            <div className="animate-pulse space-y-2">
              <div className="h-4 bg-gray-100 rounded w-1/2" />
              <div className="h-3 bg-gray-100 rounded w-2/3" />
            </div>
          ) : status.subscribed ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 bg-green-50 text-green-700 text-xs font-medium px-2.5 py-1 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                  Notifications enabled
                </span>
              </div>
              <p className="text-sm text-gray-600">
                {status.device_info ?? "Unknown device"}
                {status.created_at && (
                  <span className="text-gray-400"> · subscribed {formatDate(status.created_at)}</span>
                )}
              </p>
              <p className="text-xs text-gray-400">
                Only this device receives notifications. Subscribing from another device will replace this one.
              </p>
              <button
                onClick={subscribe}
                disabled={working}
                className="mt-1 text-sm text-blue-600 font-medium disabled:opacity-50"
              >
                {working ? "Subscribing…" : "Resubscribe this device"}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 bg-gray-100 text-gray-500 text-xs font-medium px-2.5 py-1 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-400 inline-block" />
                  Notifications off
                </span>
              </div>
              <p className="text-sm text-gray-600">
                Enable push notifications to get updates when requirements are assigned or their status changes.
              </p>
              <button
                onClick={subscribe}
                disabled={working}
                className="w-full mt-1 bg-blue-600 text-white text-sm font-medium py-2.5 rounded-xl disabled:opacity-50"
              >
                {working ? "Enabling…" : "Enable for this device"}
              </button>
            </div>
          )}

          {error && (
            <p className="mt-3 text-sm text-red-600">{error}</p>
          )}
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-sm px-4 py-2.5 rounded-xl shadow-lg z-50">
          {toast}
        </div>
      )}
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="max-w-md mx-auto px-4 py-8 text-gray-400 text-sm">Loading…</div>}>
      <SettingsContent />
    </Suspense>
  );
}

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const arr = Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
  return arr.buffer as ArrayBuffer;
}
