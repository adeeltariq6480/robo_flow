import type { NextConfig } from "next";
import path from "path";

const projectRoot = path.resolve(__dirname);

const nextConfig: NextConfig = {
  // Keep module tracing inside this project (avoids parent lockfile confusion)
  outputFileTracingRoot: projectRoot,
  experimental: {
    optimizePackageImports: ["lucide-react"],
    // Middleware buffers POST bodies; default 10MB breaks model uploads
    middlewareClientMaxBodySize: "500mb",
    serverActions: {
      bodySizeLimit: "500mb",
    },
  },
};

export default nextConfig;
