// Scheduled daily: kicks off the background function that copies photos and bios from the website.
export const config = { schedule: '0 3 * * *' };

export default async () => {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL;
  try {
    const res = await fetch(`${base}/.netlify/functions/sync-website-background`, { method: 'POST', headers: { 'x-sync-key': process.env.AUTH_SECRET || '' } });
    console.log('website sync started', res.status);
  } catch (e) { console.error('could not start website sync', e.message); }
};
