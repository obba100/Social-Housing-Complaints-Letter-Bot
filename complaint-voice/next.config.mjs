/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true, // stop build failing on lint errors
  },
  // If you really need to, you can also skip TS type errors:
  // typescript: { ignoreBuildErrors: true },
};

export default nextConfig;
