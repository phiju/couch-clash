import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The shared package ships TypeScript sources.
  transpilePackages: ["@couch-clash/shared"],
};

export default nextConfig;
