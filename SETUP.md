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

## Campaign Management (update 13)
A new Campaign Management section sits in the left-hand menu beside Talent Index. Nothing extra to set up: the database tables are created automatically on the first deploy (migration 11), and it reuses the same ANTHROPIC_API_KEY for reading insights screenshots.
- Each campaign has its own currency (£, $ or AED). Changing it converts every amount.
- Manager details and rates entered on a campaign are saved back to the Talent Index. Talent added from a campaign is added to the Index.
- Signed client agreements: PDF or image, up to 4MB.
- Viewers (view password) can look but not edit.
- "Import from monday" lists Agency Sales Pipeline deals at 3 - Proposal Sent (where the creator list is built), with budget, currency, target margin, owner and start date. Already-imported deals are ticked and locked. Needs MONDAY_TOKEN, which the sync already uses. After import the stage is changed here by hand; it isn't written back to monday yet.

## Update 20: filming days and deliverables table
- Migration 12 (`no_post` column) runs automatically on deploy.
- Deliverables can be ticked "No posting required" (filming or attendance day): one date, no posting stage.
- The Deliverables tab is now a table: Influencer | Deliverable | Content due | To be posted by.
- The deadlines strip at the top of a campaign is a single compact row.
- Follower counts removed from influencer rows. Deliverables added on influencer lines now show in the tab.

## Update 23: rates and contacts build the Index database
- Any rate entered on a campaign (initial or negotiated) is saved to the talent's Typical Rate in the Index, in the campaign currency, even if the deal is archived or doesn't go ahead. The latest entry wins.
- Contact name, email and phone entered on a campaign show on the talent's Index profile (new Contact block) and can be edited there.
- Migration 13 fills blank Index rates from rates already entered on campaigns. Existing Index rates are not overwritten by it.

## Update 24
- Deliverables tab has a Stage column (six-step bar plus stage name); the Influencers tab lists each deliverable's stage under its summary.
- Talent Index: "Campaign rates (n)" button on a profile lists every rate entered on a campaign (date, campaign, initial, negotiated, outcome).
- Fix: saving a rate to the Index no longer errors.
