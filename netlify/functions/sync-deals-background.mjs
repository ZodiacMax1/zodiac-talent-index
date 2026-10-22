import { syncDeals } from '../lib/sync.mjs';

// Background function (name ends in -background): may run for several minutes.
export default async (req) => {
  if (!process.env.AUTH_SECRET || req.headers.get('x-sync-key') !== process.env.AUTH_SECRET) return;
  try {
    const r = await syncDeals();
    console.log('deals sync', JSON.stringify(r));
  } catch (e) {
    console.error('deals sync failed', e.message);
  }
};
