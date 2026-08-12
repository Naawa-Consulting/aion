/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Type-checking is back on as of Fase 7.0 (the `ignoreBuildErrors` stopgap from Fase 1 is
  // gone). The remaining errors were all one root cause — an untyped Supabase browser client,
  // fixed in lib/supabase/client.ts. Keep it on: Fase 7 rewrites every module page, and the
  // type-checker is the cheapest regression net we have for a refactor that size.
};

export default nextConfig;
