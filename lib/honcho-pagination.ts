export type HonchoMessageLike = {
  id: string;
  content: string;
  createdAt: string;
  metadata: Record<string, unknown>;
};

type SessionLike = {
  messages: (args: Record<string, unknown>) => Promise<{ items: HonchoMessageLike[] }>;
};

export async function listHonchoMessages(
  session: unknown,
  options: { pageSize?: number; maxPages?: number; reverse?: boolean } = {},
) {
  const pageSize = Math.max(10, Math.min(100, options.pageSize ?? 100));
  const maxPages = Math.max(1, Math.min(100, options.maxPages ?? 20));
  const reverse = options.reverse !== false;
  const client = session as SessionLike;
  const items: HonchoMessageLike[] = [];
  const seen = new Set<string>();

  for (let page = 1; page <= maxPages; page += 1) {
    const result = await client.messages({ size: pageSize, page, reverse });
    for (const item of result.items || []) {
      if (!item?.id || seen.has(item.id)) continue;
      seen.add(item.id);
      items.push(item);
    }
    if (!result.items || result.items.length < pageSize) break;
  }
  return items;
}
