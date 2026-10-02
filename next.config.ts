import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  ...(process.env.TIMEOS_TEST_SCHEMA &&
  /^timeos_test_[a-f0-9]{32}$/.test(process.env.TIMEOS_TEST_SCHEMA)
    ? { distDir: `.next-tests/${process.env.TIMEOS_TEST_SCHEMA}` }
    : {}),
  allowedDevOrigins: ["127.0.0.1"],
  reactCompiler: true,
};

export default nextConfig;
