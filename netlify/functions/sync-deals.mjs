// Scheduled every 30 minutes: just kicks off the background function that does the work.
export const config = { schedule: '*/30 * * * *' };

export default async () => {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL;
  try {
    const res = await fetch(`${base}/.netlify/functions/sync-deals-background`, {
      method: 'POST',
      headers: { 'x-sync-key': process.env.AUTH_SECRET || '' },
    });
    console.log('deals sync started', res.status);
  } catch (e) {
    console.error('could not start deals sync', e.message);
  }
};
