import { runMatch } from '../lib/matcher.mjs';

// Background function (name ends in -background): can run well past the normal timeout.
export default async (req) => {
  if (!process.env.AUTH_SECRET || req.headers.get('x-sync-key') !== process.env.AUTH_SECRET) return;
  try {
    const { id } = await req.json();
    if (id) await runMatch(String(id));
  } catch (e) {
    console.error('match-brief-background', e.message);
  }
};
