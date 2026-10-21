/** Extra process boundary for the standalone QA runner, independent of web configuration. */
export function assertQaRunnerConfig(env: Record<string, string | undefined>) {
  const forbidden = /^(?:GMAIL_TOKEN.*|GOOGLE.*|SUPABASE.*|EMAILCREATOR_SUPABASE.*|SHEET_ID|SERVICE_ACCOUNT_JSON|ANTHROPIC_API_KEY|OPENAI_API_KEY|SLACK_BOT_TOKEN|STRIPE_SECRET_KEY|SMTP_.*|HUBSPOT_.*|GHL_.*)$/;
  if (Object.entries(env).some(([key, value]) => value && forbidden.test(key))) {
    throw new Error('Remove production provider bindings from the dedicated QA runner');
  }
  const db = new URL(env.DATABASE_URL || '');
  if (!['postgres:', 'postgresql:'].includes(db.protocol) || !db.pathname.endsWith('_qa')) {
    throw new Error('Standalone QA runner requires a dedicated PostgreSQL database ending _qa');
  }
  if (new URL(env.CMO_HUB_ORIGIN || '').hostname === 'web-production-44a4c.up.railway.app') {
    throw new Error('Standalone QA runner cannot use the existing production Hub');
  }
}
