/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  allowedDevOrigins: [
    '127.0.0.1',
    '127.0.0.1:3000',
    'http://127.0.0.1:3000',
  ],
};

export default nextConfig;
