export const MIN_CHAT_QUERY_LENGTH = 3;
export const MAX_CHAT_QUERY_LENGTH = 2000;

export function normalizeChatQuery(value: string): string | null {
  const normalized = value.trim();

  if (normalized.length < MIN_CHAT_QUERY_LENGTH || normalized.length > MAX_CHAT_QUERY_LENGTH) {
    return null;
  }

  return normalized;
}
