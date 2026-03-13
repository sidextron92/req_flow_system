import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function GET() {
  const cookieStore = await cookies();
  const userId = cookieStore.get("reqflow_userId")?.value;

  const startUrl = userId ? `/?userId=${userId}` : "/";

  const manifest = {
    name: "Req Flow",
    short_name: "ReqFlow",
    description: "Capture and manage darkstore requirements",
    start_url: startUrl,
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#10B24B",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };

  return NextResponse.json(manifest, {
    headers: {
      "Content-Type": "application/manifest+json",
      // Never cache — must re-read cookie on each request so start_url is fresh
      "Cache-Control": "no-store",
    },
  });
}
