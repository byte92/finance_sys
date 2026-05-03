/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  logging: {
    fetches: {
      fullUrl: true,
    },
  },
  allowedDevOrigins: [
    '127.0.0.1',
    '127.0.0.1:3218',
    'http://127.0.0.1:3218',
  ],
};

export default nextConfig;
