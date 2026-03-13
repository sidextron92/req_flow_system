import withPWA from "@ducanh2912/next-pwa";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {},
};

export default withPWA({
  dest: "public",
  cacheOnFrontEndNav: true,
  aggressiveFrontEndNavCaching: true,
  reloadOnOnline: true,
  disable: process.env.NODE_ENV === "development",
  // Exclude the dynamic manifest from precaching so the SW always fetches it
  // fresh from the server (which reads the userId cookie for the correct start_url)
  exclude: [/\/api\/manifest/],
})(nextConfig);
