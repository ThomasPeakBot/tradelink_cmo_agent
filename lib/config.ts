/** The prefixed alias works in cloud settings that reserve OPENAI_* names. */
export function openAIKey(): string | undefined {
  return process.env.TRADELINK_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
}
