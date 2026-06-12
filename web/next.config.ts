import type { NextConfig } from "next";
import webpack from "webpack";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.public.blob.vercel-storage.com" },
      { protocol: "https", hostname: "**" },
    ],
  },
  serverExternalPackages: ["@vercel/blob", "@lit-protocol/lit-node-client", "@lit-protocol/constants", "sharp"],
  // sharp's native addon (@img/sharp-linux-x64) dlopens libvips from
  // @img/sharp-libvips-linux-x64 — Vercel's file tracer can't see dlopen
  // deps, so the .so was missing in prod (ERR_DLOPEN_FAILED). Force both
  // packages into the function bundle.
  outputFileTracingIncludes: {
    "/api/lit/encrypt": ["./node_modules/@img/**/*", "./node_modules/sharp/**/*"],
  },
  webpack(config, { isServer }) {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false, path: false, os: false,
        crypto: false, net: false, tls: false,
        stream: require.resolve("stream-browserify"),
        buffer: require.resolve("buffer/"),
      };
      config.plugins.push(
        new webpack.ProvidePlugin({ Buffer: ["buffer", "Buffer"] })
      );
    }
    return config;
  },
};

export default nextConfig;
