import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  async redirects() {
    return [
      {
        source: '/en/app/subscrab/privacy',
        destination: '/en/app/octosubs/privacy',
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
