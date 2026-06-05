import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The SDK ships TypeScript source (exports "./src/index.ts"); transpile it.
  transpilePackages: ["@clearinghouse/sdk"],
  // The SDK uses NodeNext-style ".js" import specifiers that resolve to ".ts"
  // sources; teach the bundler that mapping.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },
  turbopack: {
    resolveExtensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".json"],
  },
};

export default nextConfig;
