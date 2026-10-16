import { z } from 'zod';
/** Read only on an uninitialized database. Never supply a production default password. */
export function bootstrapConfig(env: Record<string, string | undefined>) {
  const parsed = z
    .object({
      ADMIN_EMAIL: z.string().email().default('admin@tradelink.local'),
      ADMIN_PASSWORD: z
        .string()
        .min(16)
        .max(256)
        .refine(
          (value) => value !== 'TradeLink-Demo-2026!',
          'The public demo password cannot be used for production.',
        ),
      BOOTSTRAP_MODE: z.enum(['empty', 'demo']).default('empty'),
    })
    .safeParse(env);
  if (!parsed.success)
    throw new Error(
      'Fresh database: set ADMIN_PASSWORD to a unique 16–256 character password in Railway service variables. ADMIN_EMAIL must be valid; BOOTSTRAP_MODE is empty or demo.',
    );
  return {
    email: parsed.data.ADMIN_EMAIL.toLowerCase(),
    password: parsed.data.ADMIN_PASSWORD,
    mode: parsed.data.BOOTSTRAP_MODE,
  };
}
