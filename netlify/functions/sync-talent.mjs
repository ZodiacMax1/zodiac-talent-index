import { syncTalent } from '../lib/sync.mjs';

// Every 30 minutes, 7am–9pm Dubai (03:00–17:30 UTC). Overnight runs kept the database awake 24/7.
// The monday Sync button still pulls changes on demand.
export const config = { schedule: '*/30 3-17 * * *' };

export default async () => {
  try {
    const r = await syncTalent();
    console.log('talent sync', JSON.stringify(r));
  } catch (e) {
    console.error('talent sync failed', e.message);
  }
};
