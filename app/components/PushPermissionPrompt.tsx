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

function isRunningAsStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari
    ("standalone" in window.navigator && (window.navigator as { standalone?: boolean }).standalone === true)
  );
}

// beforeinstallprompt fires before React mounts — capture it on window
declare global {
  interface Window {
    __installPrompt?: BeforeInstallPromptEvent;
  }
}
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// type for the step we show
type Step = "install" | "notifications" | "done";

export default function PushPermissionPrompt({ userId }: { userId: number }) {
  const [step, setStep] = useState<Step>("done");
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    if (sessionStorage.getItem("push_prompt_dismissed")) return;

    // Capture beforeinstallprompt if not already caught
    const handleInstallPrompt = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handleInstallPrompt);

    // Also pick it up if it already fired before mount
    if (window.__installPrompt) {
      setInstallPrompt(window.__installPrompt);
    }

    const standalone = isRunningAsStandalone();
    const notifAlreadyHandled = Notification.permission !== "default";

    fetch(`/api/push/subscribe?userId=${userId}`)
      .then((r) => r.json())
      .then((data) => {
        const alreadySubscribed = !!data.subscribed;

        let nextStep: Step = "done";

        if (!standalone && !sessionStorage.getItem("install_nudge_dismissed")) {
          // Not installed — show install nudge first (regardless of notification state)
          nextStep = "install";
        } else if (!alreadySubscribed && !notifAlreadyHandled) {
          // Installed (or nudge dismissed) but no notification subscription yet
          nextStep = "notifications";
        }

        if (nextStep !== "done") {
          setTimeout(() => setStep(nextStep), 2000);
        }
      })
      .catch(() => {});

    return () => window.removeEventListener("beforeinstallprompt", handleInstallPrompt);
  }, [userId]);

  // ── Install step ──────────────────────────────────────────────────────────

  async function handleInstall() {
    if (installPrompt) {
      await installPrompt.prompt();
      const { outcome } = await installPrompt.userChoice;
      setInstallPrompt(null);
      window.__installPrompt = undefined;
      if (outcome === "accepted") {
        // After install, skip notification prompt — they'll get it next launch as standalone
        setStep("done");
        return;
      }
    }
    // Prompt not available or dismissed — move to notification step
    sessionStorage.setItem("install_nudge_dismissed", "1");
    if (Notification.permission === "default") {
      setStep("notifications");
    } else {
      setStep("done");
    }
  }

  function handleSkipInstall() {
    sessionStorage.setItem("install_nudge_dismissed", "1");
    if (Notification.permission === "default") {
      setStep("notifications");
    } else {
      setStep("done");
    }
  }

  // ── Notification step ─────────────────────────────────────────────────────

  async function handleAllow() {
    setStep("done");
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

  function handleDismissNotif() {
    setStep("done");
    sessionStorage.setItem("push_prompt_dismissed", "1");
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (step === "done") return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-md z-50 animate-in slide-in-from-bottom-4 duration-300">
      <div className="bg-white rounded-2xl shadow-xl border border-gray-200 p-4 flex items-start gap-3">

        {step === "install" ? (
          <>
            <div className="shrink-0 w-9 h-9 bg-blue-100 rounded-full flex items-center justify-center mt-0.5">
              {/* Home screen icon */}
              <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900">Add Req Flow to home screen</p>
              <p className="text-xs text-gray-500 mt-0.5">
                Install the app for faster access and reliable notifications — even when the browser is closed.
              </p>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={handleInstall}
                  className="flex-1 bg-blue-600 text-white text-sm font-medium py-1.5 rounded-lg"
                >
                  Add to home screen
                </button>
                <button
                  onClick={handleSkipInstall}
                  className="flex-1 bg-gray-100 text-gray-600 text-sm font-medium py-1.5 rounded-lg"
                >
                  Not now
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="shrink-0 w-9 h-9 bg-green-100 rounded-full flex items-center justify-center mt-0.5">
              <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6 6 0 10-12 0v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900">Enable notifications</p>
              <p className="text-xs text-gray-500 mt-0.5">Get updates when requirements are assigned or their status changes.</p>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={handleAllow}
                  className="flex-1 bg-green-600 text-white text-sm font-medium py-1.5 rounded-lg"
                >
                  Allow
                </button>
                <button
                  onClick={handleDismissNotif}
                  className="flex-1 bg-gray-100 text-gray-600 text-sm font-medium py-1.5 rounded-lg"
                >
                  Not now
                </button>
              </div>
            </div>
          </>
        )}

      </div>
    </div>
  );
}
