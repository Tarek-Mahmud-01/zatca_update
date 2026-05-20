import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: {
    // 127.0.0.1 (not "localhost") so the browser always uses IPv4 — uvicorn
    // binds to 127.0.0.1 only, and on Windows "localhost" can resolve to the
    // IPv6 ::1 address, which would refuse the connection ("Failed to fetch").
    BACKEND_URL: process.env.BACKEND_URL ?? "http://127.0.0.1:8001",
  },
};

export default nextConfig;
