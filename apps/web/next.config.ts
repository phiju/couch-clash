import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript sources.
  transpilePackages: ["@couch-clash/shared", "@couch-clash/games"],
};

export default nextConfig;
