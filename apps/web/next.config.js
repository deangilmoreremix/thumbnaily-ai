const r2PublicHostname = (() => {
  const publicUrl = process.env.R2_PUBLIC_BASE_URL;
  if (!publicUrl) return null;
  try {
    return new URL(publicUrl).hostname;
  } catch {
    return null;
  }
})();

const nextConfig = {
  output: "standalone",
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'thumbnaily-storage.s3.ap-south-1.amazonaws.com',
        pathname: '**',
      },
      ...(r2PublicHostname
        ? [
            {
              protocol: 'https',
              hostname: r2PublicHostname,
              pathname: '**',
            },
          ]
        : []),
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
        pathname: '**'
      },
      {
        protocol: 'https',
        hostname: 'cdn.iconscout.com',
        pathname: '**'
      },
      {
        protocol: 'https',
        hostname: 'i.ytimg.com',
        pathname: '**'
      },
      {
        protocol: 'https',
        hostname: '**.r2.dev',
        pathname: '**'
      }
    ],
  },
};

export default nextConfig;