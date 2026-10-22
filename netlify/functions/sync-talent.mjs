import { syncTalent } from '../lib/sync.mjs';

// Runs every 5 minutes on the published site
export const config = { schedule: '*/5 * * * *' };

export default async () => {
  try {
    const r = await syncTalent();
    console.log('talent sync', JSON.stringify(r));
  } catch (e) {
    console.error('talent sync failed', e.message);
  }
};
