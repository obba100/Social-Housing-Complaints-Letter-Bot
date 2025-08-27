import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: {
    ignoreDuringBuilds: true, // stop Vercel failing on lint errors
  },
  // If you absolutely must ship with TS errors, uncomment below.
  // typescript: {
  //   ignoreBuildErrors: true,
  // },
};

export default nextConfig;
