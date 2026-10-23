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
  /**
   * Lets DB Crew's Apps Script act for a signed-in person: a bearer token
   * equal to this, plus X-Acting-Email / X-Acting-Name. Off until set.
   */
  crewAppSecret: string;
  /**
   * The Production Board's origin and the shared secret on its close-out
   * hook (`CLOSEOUT_HOOK_SECRET`, the same value on both projects). With
   * both, every close tells the board, which moves the job's Status and
   * names each work area's reviewer; without them Close Out tags its
   * fallback reviewers and the board's hourly sweep moves the Status.
   */
  boardUrl: string;
  closeoutHookSecret: string;
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
    crewAppSecret: source.CREW_APP_SECRET ?? "",
    boardUrl: source.BOARD_URL ?? "",
    closeoutHookSecret: source.CLOSEOUT_HOOK_SECRET ?? "",
    publicUrl: source.PUBLIC_URL ?? "https://closeout.deitemeyerbrothers.com",
    geminiApiKey: source.GEMINI_API_KEY ?? "",
    geminiModel: source.GEMINI_MODEL ?? "gemini-flash-lite-latest",
    port: Number(source.PORT ?? 8787),
  };
}
