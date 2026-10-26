import { syncWebsite } from '../lib/website.mjs';

export default async (req) => {
  if (!process.env.AUTH_SECRET || req.headers.get('x-sync-key') !== process.env.AUTH_SECRET) return;
  try { console.log('website sync', JSON.stringify(await syncWebsite())); }
  catch (e) { console.error('website sync failed', e.message); }
};
