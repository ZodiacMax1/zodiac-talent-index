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

## Update 25
- Migration 14: quote scope on influencers, whole-campaign archive, campaign documents.
- Quote covers: pick deliverables and quantities on each influencer line (e.g. 2× IG Reel, 5× IG Story). It also shows in the Talent Index typical rate and the Campaign rates list.
- The Index tag on an influencer opens their profile in the Talent Index.
- Totals row under the influencers table.
- Decks and links: Documents (drop files up to 4MB, or add a link for larger decks).
- Archive campaign (with a group), Active/Archived tabs, filters (client, stage, owner, search) and group by client or stage.
- monday import now pulls the client (Accounts) and first linked contact (Contacts board). "Refresh client and contact" updates campaigns already imported.

## Update 26
- "Quote covers" is now the Deliverables column on every campaign: one compact line per influencer, click it to open an editor with quantity steppers.
- Company (monday Accounts) is shown instead of the contact in the campaign list and import panel. "Update company from monday" refreshes campaigns already imported.

## Update 27
- Import from monday now lists Proposal Sent, Verbal Agreement and Closed Won deals. Each comes in at its own monday stage.

## Update 28
- Campaign list is grouped by monday stage by default (collapsible, stage-coloured headings), with an Archived section at the bottom (collapsed, grouped by archive group). Group by client or no grouping are still available.

## Update 29
- Stages now match monday: 2 Discovery / Scoping, 3 Proposal Sent, 4 Negotiation, 5 Verbal Agreement, 6 Contract Sent, 7 Won, 8 Closed Lost. Import lists all seven, grouped like monday (Closed Lost collapsed, "Tick all" per group).
- Deliverables on the summary: hover for the full list, "+" to add or edit.
- Client name is bold and clickable: pop-up with every campaign for that client at any stage.
- Remove button on every influencer row.
- "New talent" in the picker opens the full Talent Index Add Talent form, then adds them to the campaign.

## Update 30
No new migration (still up to 14). Upload the contents as before.
- Explanatory copy removed across the campaign screens.
- Compact campaign header: slimmer stat band, thin progress row, deadlines moved onto the tab row.
- Initial / Negotiated / Client rate / Margin kept, restyled (muted initial, bold negotiated, margin chip green/red vs target).
- "Needs attention" card on the campaign list (overdue, margin below target, unsigned, not invoiced). List endpoint now returns overdue, unsigned, uninvoiced per campaign.

## Update 31
No new migration. Layout and clarity pass on Campaign Management:

- Influencer table fits a laptop screen: amounts show as plain numbers (currency shown above the table), Initial and Client rate are lighter, Remove is a small ✕.
- Deadline pills moved next to "selected creators" (Influencers tab only).
- Header: Stage / Currency / Archive in one row; stat band is now Budget, Client price, Creator costs, Margin (amount, % and target together). "left" became "unallocated" or "over by".
- Brief & setup: banner replaced by one slim line.
- "+ Add deliverables" is clearer; campaign list columns no longer wrap or gap.

## Update 32
No new migration.
- Client page: clicking a client name now opens a full page (won, in progress, margin earned, contacts, every campaign at any stage). Opening a campaign from it gives a "← Client" back link.
- ⌘K / Ctrl+K search from anywhere: campaigns, clients, talent (opens the Talent Index profile) and quick actions. There is also a Search button on the campaign list.
- The Influencers tab now shows its count, e.g. "Influencers (5)".

## Update 34
Needs attention now only flags late deliverables (content or posting overdue). Margin below target is no longer flagged.

## Update 35
Amounts in the influencer table and totals row show currency signs again (£ / $ / AED). Archive is now a small icon button so the table still fits a laptop screen. Quoted deliverables show wider on campaigns not yet won.

## Update 36
On won campaigns the per-creator Archive button is gone. "Archived" is now the last option in each creator's Stage dropdown (Shortlisted, Outreach, Negotiating, Confirmed, Archived). Choosing it asks for the reason, then moves them to the Archive tab.

## Update 37
Target margin is no longer shown or flagged anywhere: no "target 30%", no red margin box, chips or "below target" on the list. The target field is still in Brief & setup and is used for the default margin on new creators.

## Update 38
Budget box now says what margin you would make if the whole budget is used (e.g. "Budget fully used = 65.0% margin") instead of "unallocated". "Apply" sets every selected creator to that margin (with a Yes/No check), so client price matches the budget. Nothing changes unless you press it. Rounds down so the price never goes over budget.

## Update 39
Margin = budget minus creator costs (everything left over from the client budget), shown in the header box, on the campaign list and with the percentage of budget. The budget box just says "client budget"; the Apply button from update 38 is gone. Only applies once creators are selected. Per-creator rates, margin chips and the table totals still work from each creator's own margin.
