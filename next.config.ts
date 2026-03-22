import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverActions: {
    allowedOrigins: ["skillbenchmark.vercel.app", "localhost:3000"],
  },
};

export default nextConfig;
