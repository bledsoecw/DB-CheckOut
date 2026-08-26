export interface Env {
  jtGrantKey: string;
  /** Signs the app's session tokens. Sign-in is disabled until this is set. */
  sessionSecret: string;
  /** Google OAuth web client id (public). Sign-in is disabled until set. */
  googleClientId: string;
  /** Workspace domain whose accounts may sign in. */
  workspaceDomain: string;
  /** Extra allowed accounts outside the domain (comma-separated env var). */
  allowedEmails: string[];
  /** Validates the JobTread webhook URL path. Webhook is disabled until set. */
  webhookSecret: string;
  /** Public base URL of this deployment, used to self-register the webhook. */
  publicUrl: string;
  /** Gemini API key for ES translation of JT text. Disabled until set. */
  geminiApiKey: string;
  geminiModel: string;
  port: number;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const jtGrantKey = source.JT_GRANT_KEY ?? "";
  if (!jtGrantKey) {
    throw new Error("JT_GRANT_KEY is not set. Create a grant key in JobTread and put it in apps/sync/.env");
  }
  return {
    jtGrantKey,
    sessionSecret: source.SESSION_SECRET ?? "",
    googleClientId: source.GOOGLE_CLIENT_ID ?? "",
    workspaceDomain: (source.GOOGLE_WORKSPACE_DOMAIN ?? "deitemeyerbrothers.com").toLowerCase(),
    allowedEmails: (source.GOOGLE_ALLOWED_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
    webhookSecret: source.WEBHOOK_SECRET ?? "",
    publicUrl: source.PUBLIC_URL ?? "https://closeout.deitemeyerbrothers.com",
    geminiApiKey: source.GEMINI_API_KEY ?? "",
    geminiModel: source.GEMINI_MODEL ?? "gemini-flash-lite-latest",
    port: Number(source.PORT ?? 8787),
  };
}
