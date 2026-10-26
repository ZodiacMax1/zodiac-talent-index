// If a separate brand-facing domain is set (DECKS_HOST, e.g. decks.zodiacglobal.com), that domain only serves shared deck
// pages and their photos. Anything else (including the bare domain) is sent to the public website, never to the Index.
export default async (req: Request, context: { next: () => Promise<Response> }) => {
  const host = (Deno.env.get('DECKS_HOST') || '').toLowerCase();
  const url = new URL(req.url);
  if (!host || url.host.toLowerCase() !== host) return context.next();
  const p = url.pathname;
  if (p.startsWith('/d/') || p.startsWith('/api/public/') || p.startsWith('/api/img/') || p === '/deck.html') return context.next();
  return Response.redirect('https://zodiacglobal.com/', 302);
};

export const config = { path: '/*', onError: 'bypass' };
