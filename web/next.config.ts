import type { NextConfig } from "next";
import webpack from "webpack";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.public.blob.vercel-storage.com" },
      { protocol: "https", hostname: "**" },
    ],
  },
  serverExternalPackages: ["@vercel/blob", "@lit-protocol/lit-node-client", "@lit-protocol/constants"],
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
