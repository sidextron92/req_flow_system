"use client";

import { useEffect, useState } from "react";

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const arr = Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
  return arr.buffer as ArrayBuffer;
}

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

export default function PushPermissionPrompt({ userId }: { userId: number }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Don't show if push isn't supported
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    // Don't show if already granted/denied
    if (Notification.permission !== "default") return;
    // Don't show if dismissed this session
    if (sessionStorage.getItem("push_prompt_dismissed")) return;

    // Check if already subscribed in DB
    fetch(`/api/push/subscribe?userId=${userId}`)
      .then((r) => r.json())
      .then((data) => {
        if (!data.subscribed) {
          // Show banner after 2s delay
          const timer = setTimeout(() => setVisible(true), 2000);
          return () => clearTimeout(timer);
        }
      })
      .catch(() => {});
  }, [userId]);

  async function handleAllow() {
    setVisible(false);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return;

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

      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          subscription: subJson,
          device_info: getDeviceInfo(),
        }),
      });
    } catch {
      // Silently fail — user can enable from Settings
    }
  }

  function handleDismiss() {
    setVisible(false);
    sessionStorage.setItem("push_prompt_dismissed", "1");
  }

  if (!visible) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-md z-50 animate-in slide-in-from-bottom-4 duration-300">
      <div className="bg-white rounded-2xl shadow-xl border border-gray-200 p-4 flex items-start gap-3">
        <div className="shrink-0 w-9 h-9 bg-blue-100 rounded-full flex items-center justify-center mt-0.5">
          <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6 6 0 10-12 0v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900">Enable notifications</p>
          <p className="text-xs text-gray-500 mt-0.5">Get updates when requirements are assigned or their status changes.</p>
          <div className="flex gap-2 mt-3">
            <button
              onClick={handleAllow}
              className="flex-1 bg-blue-600 text-white text-sm font-medium py-1.5 rounded-lg"
            >
              Allow
            </button>
            <button
              onClick={handleDismiss}
              className="flex-1 bg-gray-100 text-gray-600 text-sm font-medium py-1.5 rounded-lg"
            >
              Not now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
