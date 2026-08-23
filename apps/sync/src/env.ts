export interface Env {
  jtGrantKey: string;
  appToken: string;
  port: number;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const jtGrantKey = source.JT_GRANT_KEY ?? "";
  const appToken = source.APP_TOKEN ?? "";
  if (!jtGrantKey) {
    throw new Error("JT_GRANT_KEY is not set. Create a grant key in JobTread and put it in apps/sync/.env");
  }
  if (!appToken) {
    throw new Error("APP_TOKEN is not set. Generate a shared secret for the mobile app (openssl rand -hex 24)");
  }
  return {
    jtGrantKey,
    appToken,
    port: Number(source.PORT ?? 8787),
  };
}
