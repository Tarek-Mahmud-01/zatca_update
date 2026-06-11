import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: false,
  env: {
    // 127.0.0.1 (not "localhost") — uvicorn binds IPv4 only; Windows resolves
    // "localhost" to IPv6 ::1 first which refuses. Override via BACKEND_URL in
    // frontend/.env.local (gitignored). Default matches run.py default port.
    BACKEND_URL: process.env.BACKEND_URL ?? "http://127.0.0.1:8011",
  },
};

export default nextConfig;
