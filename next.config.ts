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
  customWorkerSrc: "sw-custom.js",
})(nextConfig);
