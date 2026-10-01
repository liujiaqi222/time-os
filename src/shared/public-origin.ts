export function inferPublicOrigin(
  environment: Record<string, string | undefined>,
): string | undefined {
  const host =
    environment.VERCEL_ENV === "production"
      ? (environment.VERCEL_PROJECT_PRODUCTION_URL ?? environment.VERCEL_URL)
      : (environment.VERCEL_BRANCH_URL ??
        environment.VERCEL_URL ??
        environment.VERCEL_PROJECT_PRODUCTION_URL);

  return host ? `https://${host}` : undefined;
}
