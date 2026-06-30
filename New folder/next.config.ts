import type { NextConfig } from "next";
import path from "path";

const projectRoot = path.resolve(__dirname);

const nextConfig: NextConfig = {
  // Keep module tracing inside this project (avoids parent lockfile confusion)
  outputFileTracingRoot: projectRoot,
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
};

export default nextConfig;
