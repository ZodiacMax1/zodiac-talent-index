import { syncDeals } from '../lib/sync.mjs';
import { mondayCheck } from '../lib/campaigns.mjs';

// Background function (name ends in -background): may run for several minutes.
export default async (req) => {
  if (!process.env.AUTH_SECRET || req.headers.get('x-sync-key') !== process.env.AUTH_SECRET) return;
  try {
    const r = await syncDeals();
    console.log('deals sync', JSON.stringify(r));
    try { console.log('closed won check', JSON.stringify(await mondayCheck())); } catch (e) { console.error('closed won check failed', e.message); }
  } catch (e) {
    console.error('deals sync failed', e.message);
  }
};
