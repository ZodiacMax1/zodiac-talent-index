# Zodiac Talent Index – live version: setup

What this is: the Talent Index with a real shared database behind it. Anyone who edits a niche, number, link, adds or deletes talent, or saves a list/deck changes it for everyone. Open pages refresh themselves about every 20 seconds.

Two passwords:
- VIEW_PASSWORD – everyone on the team. Can search, build lists and decks.
- EDIT_PASSWORD – the people allowed to edit/add/delete talent. They sign in with the view password, then click "Unlock Editing" (or just sign in with the edit password).

## One-off setup (about 15 minutes)

1. Netlify > Billing: check the team is on a credit-based plan (Netlify Database needs it).
2. Put this folder on GitHub (new private repo, upload everything in this folder – keep the `netlify` and `public` folders as they are).
3. Netlify > Add new project > Import from Git > pick that repo. Give it a NEW project name (e.g. zodiac-talent-index-live). Leave build settings as they are (netlify.toml covers it).
4. Before the first deploy finishes: Project configuration > Environment variables, add three:
   - VIEW_PASSWORD  – the team password
   - EDIT_PASSWORD  – the edit password (different from the view one)
   - AUTH_SECRET    – any long random string (30+ characters, never shared)
5. Deploy (or Trigger deploy if it already ran). The database tables are created and the current 335 talent are loaded automatically on that first deploy.
6. Open the site, sign in, check the talent count, edit something in a second browser and watch it appear.

## Going live
Once happy, either point the old site's domain at this project or just share the new link. Keep the old site for a few days as a fallback. After cutover monday.com is no longer the source for the Talent Index.

## Notes
- Data is not in the page any more: it is fetched after login, so the view password genuinely protects it.
- If two people edit the same field at the same moment, the last save wins. Different fields on the same talent don't clash.
- Two people editing the same brand list at the same moment: last save wins.
- Deleting talent is permanent for everyone (a confirm box appears first).


## monday.com sync (added)
Set one more environment variable in Netlify (mark it secret): MONDAY_TOKEN – a monday API token (monday: your avatar > Developers > My access tokens). Then redeploy.

- Talent is pulled every 5 minutes from three boards: Talent Index (new intake board), Talent Roster and Talent Outreach.
- Roster talent: Exclusive Talent group = Exclusive, Non-Exclusive Talent group = Non-Exclusive. Moving someone between groups updates the Index.
- New talent only come through when complete: name, region, niche and at least one platform with link + following. Incomplete rows are listed under "monday Sync" in the header and come through on their own once filled in.
- No duplicates: every synced talent remembers its monday item; otherwise it is matched on Instagram handle, TikTok handle, then name.
- Where monday has a value it overwrites the Index. Blank monday cells never wipe anything.
- Previous deals (Deal Agreed / In Progress / Completed) for Roster talent are copied every 30 minutes and appear behind a "Previous deals" button.

## Brief Matcher (update 10)
Add one environment variable in Netlify: ANTHROPIC_API_KEY (from console.anthropic.com). Optional: ANTHROPIC_MODEL to choose the model.
Optional: ANTHROPIC_WORKSPACE_ID if your key is not scoped to a workspace.
