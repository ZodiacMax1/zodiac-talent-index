import { syncDeals } from '../lib/sync.mjs';

// Previous deals refresh every 30 minutes
export const config = { schedule: '*/30 * * * *' };

export default async () => {
  try {
    const r = await syncDeals();
    console.log('deals sync', JSON.stringify(r));
  } catch (e) {
    console.error('deals sync failed', e.message);
  }
};
