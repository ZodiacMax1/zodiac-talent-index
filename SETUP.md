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

## Update 40
Header stat band is now Budget, Creator costs, Margin, Margin % (Client price box removed).

## Update 41
Deliverables tab, deliverable tracking in each creator's panel, and the deadline pills now work at any monday stage, not just 7 - Won. Creators count once their Approved is "Yes".

## Update 42: Sales dashboard
No new migration. New "Sales dashboard" item under Campaign Management in the sidebar.
- Filters: period (this year, month, quarter, last 12 months, each year, all time), owner, £ / AED display, CSV download.
- Headline numbers: won revenue, margin, average deal, win rate, open pipeline.
- Charts: won revenue by month (margin vs creator costs), won vs lost deals by month, pipeline by stage, closest to signing, by salesperson, top clients, by market, and a deals table. Everything opens through to the campaign, with a "← Sales" link back.
- Built from the campaigns already in the system (monday imports plus anything added here). Dates use each deal's start or expected close date. Margin only counts won deals that have creators added.

## Update 43 – Weekly sales report
- New migration `15_won_invoiced_dates.sql` (runs automatically on deploy). It adds a "won on" date to campaigns and an "invoiced on" date to each influencer, and backfills existing ones from the campaign start date (approximate for older deals).
- Moving a campaign to 7 - Won stamps today's date. Setting an influencer to Invoiced / Part paid / Paid stamps today's date. Moving back to Not invoiced clears it.
- Sales dashboard → **Weekly report**: pick any of the last 12 weeks, preview it, **Download HTML**. Same layout as the usual weekly update. Built only from campaigns in this app, in £.

## Update 43b – Forecast report by deal
- New migration `16_forecast_note.sql` (one-line note per deal).
- Sales dashboard → **Reports**. "Forecast, by deal" follows the Influencer Marketing Forecast layout: closed won and pipeline totals, Key Updates, Active Conversations, and every deal listed with its value and margin. Pick the owner (defaults to Jonny). "Weekly update, by TM" is the earlier team version.
- Key Updates = won deals still delivering, or won this month. Active Conversations = deals at Discovery / Scoping. Pipeline = Proposal Sent, Negotiation, Verbal Agreement and Contract Sent. Add a note per deal under "Deal notes" and it appears on the report.
- Pipeline margin uses creator costs where creators are added, otherwise the campaign's target margin (30% by default).

## Update 43c – Deliverables from scope
- Opening the Deliverables tab now creates a deliverable for each scope line (e.g. "2 × IG Reel") for any selected influencer who has a scope but no deliverables yet. Set the dates afterwards. An "Add from scope" button appears if any are still missing.

## Update 44 – Content calendar
No new migration. New "Content calendar" tab on every campaign, built from the existing deliverable dates.
- Month view (Mon–Sun), only showing months that have content. Month chips jump between them; ‹ › step through them. Opens on the current month, or the next month with content.
- Colour coded: Content due (gold), Goes live (burgundy), Filming (black). Done items fade with ✓, overdue items get a red outline and "!". A month chip with anything overdue has a red outline.
- Filter by creator, or toggle each type on/off in the legend. Click a day number or "n more" for that day's full list. Click any item to open the creator's deliverable.
- Editors can drag an item to another day to move its date. Content due can't move past go-live, and go-live can't move before content due.
- Download .ics adds the dates (as filtered) to Outlook or Google Calendar.

## Update 45 – Calendar views
Month / Year / Agenda switcher at the top of the Content calendar.
- **Month**: as before.
- **Year**: creator per row, month per column (first to last month with content, empty months shaded), one item per deliverable in the month it goes live with the day number, totals per creator and "Posts this month". Hover for the content due date.
- **Agenda**: chronological list grouped by week – Overdue first, then This week, Next week and on. Earlier items hidden behind "Show earlier".
- Creator filter, type toggles and Download .ics work in every view. Fix: Download .ics now downloads.

## Update 46 – Year view matches the posting plan sheet
- New migration `17_calendar_note.sql` (runs automatically on deploy): one note per campaign under the Year view.
- Year view is now a fixed Jan–Dec grid for one year (‹ › to change year, only years with content). Creator rows, pink "Post 1, Post 2…" cells numbered in go-live order per creator, months with no posting shaded grey, Total column and "Posts this month" row.
- Toggle "Post numbers / Deliverable names". Click any cell to open the deliverable; hover for dates. ✓ = done, ! = overdue.
- Note line under the table (editors type straight into it, e.g. "No posting in Feb (Ramadan, c. 8 Feb to 9 Mar, provisional), Jul or Aug (summer pause).").

## Update 47 – Schedule deliverables from the calendar
No new migration.
- "To schedule" tray above the Month and Year views (editors only), grouped by creator. It lists every deliverable of approved creators with no date yet, plus quoted scope lines that haven't been turned into deliverables. Anything that already has a date isn't listed.
- Year view: drag an item onto a month on that creator's row and it goes live on the last day of that month. Month view: drag onto a day for the exact date. Or click an item, then click the month/day.
- Filming days set the filming date; everything else sets the go-live date.
- Placing a scope line creates that deliverable (and the creator's other scope lines, undated, so they stay in the tray).
- Month view has an "Any month" picker so you can go to a month that has nothing in it yet.

## Update 48 – Add creators and deliverables from the calendar
No new migration. Adding from the Influencers tab works exactly as before; this is a second way in (editors only).
- "+ Add" on the calendar toolbar, "+ Add … on this day" in a day's pop-up (Month view), clicking an empty month cell in the Year view (pre-fills that creator and the last day of the month), or "+" next to a creator in To schedule.
- Pick a selected creator, one already on the campaign but not selected (they become Approved: Yes), or anyone else from the Talent Index (added to Influencers as selected, linked to their Index profile). "Not in the Index? Add new talent" opens the usual Talent Index Add Talent form and drops them straight back in.
- Optional creator rate for anyone new to the selection. Blank uses their Index typical rate, as when added from Influencers; entering one saves it to the Index like any campaign rate.
- Deliverable: quick picks (IG Reel, IG Story, IG Post, TikTok, YouTube video, UGC video) or type one, platform, filming day, content due and go-live. Dates can be blank and it goes to To schedule. "Add & another" keeps the creator and date.
- Rows in the Year view now show every selected creator for editors, so new ones can be scheduled straight away.

## Update 49 – Calendar fixes
No new migration.
- Year view: no dragging. Click a deliverable in To schedule, then click the month (any row works; it always goes to that deliverable's creator, whose row is highlighted). It goes live on the last day of the month.
- Month view: editors' ‹ › now step one month at a time, including empty months, so you can drag or click-place into any month. A clicked deliverable stays selected while you change month.
- Add to calendar pop-up: creator rate removed (rates are added on Influencers as usual). Deliverables use the same editor as Influencers (+ Add a deliverable…, quantity steppers, Other…). They are saved to the creator's quoted deliverables and created as "2 × IG Reel" etc. with the dates given. Filming day / Event take the date as the filming date; Usage rights is saved to the quote only.

## Update 50 – Social media links on the creator panel
No new migration. Creator panel in a campaign has a third tab, "Social media links": Instagram, TikTok and YouTube from their Talent Index profile, with handle, follower count, open link, Copy link and Copy all links. Edit them in the Talent Index ("Edit in Talent Index ↗").

## Update 51 – Tabs, currency, tidy-up
No new migration.
- Campaign tabs are now Influencers, Campaign Overview, Deliverables, Content Calendar (Financials comes with the payments build). Campaign Overview = Brief & setup with Decks & links underneath. Archived creators sit at the bottom of the Influencers tab (collapsible) instead of their own tab.
- Every amount shows its currency: £1,000 / $1,000 / AED 1,000 (AED now in front, matching the sales dashboard). Negatives read -£1,000 (was £-1,000). Quote history amounts and the monday import list show the currency too.
- Fixes: "Open in monday ↗" now opens the deal (it did nothing); Sync only says imported when there is a monday deal; client agreement's first step reads "Drafted" once past it; campaigns spanning two years show both years; empty client-links box no longer duplicated; negative margins on the campaign list in red.

## Update 52 – Rates, payments and Financials
New migration `18_payments.sql` (runs automatically on deploy).

The rule throughout: a creator is only paid for a deliverable once it's live **and** the client has paid for it.

- **Creator panel → Rates & payments** (panel is wider on this tab)
  - Rate card: each quoted deliverable with quantity, creator rate and total. Saving rates sets the negotiated rate to the card total. "Split X across the N" fills the rates when only the total is known.
  - Payments by deliverable: Deliverable (opens it) · Content · Live (green ✓ once posted, red if the date has passed unposted) · Creator rate (from the rate card, or typed per deliverable) · Client payment (from Financials, with the invoice that covers it) · Creator payment (click: Not due → Invoiced → Paid; Paid is refused until posted and client-paid).
  - Drop a creator invoice on a row (that deliverable) or on the box (pick which deliverables it covers). Checks the amount against the ticked deliverables, warns if the client hasn't paid yet, and shows the PDF and "On hold · waits for client" / "Ready to pay" against each deliverable.
- **Header on won campaigns**: Client · money in (paid / invoiced unpaid / left to invoice) and Creators · money out (paid out / left to spend / cash position). The per-creator Invoiced/Paid bars are replaced by these.
- **Financials tab** (won campaigns)
  - Billing: On completion (one Final invoice for the budget, the default), Quarterly upfront or Monthly upfront (rows generated from the campaign dates, budget split evenly, amounts editable), or Custom (add your own). Can't be switched once an invoice is issued.
  - Each invoice: amount, Mark invoiced / Mark paid (dates editable), drop the PDF. A paid invoice marks every deliverable going live in its period as client-paid; On completion covers everything.
  - Creator payments per creator (total, paid, ready to pay, left, invoices) and every creator invoice received, filterable On hold / Ready to pay / Paid, with Mark paid.
- The influencer Invoicing field is now set from the client invoices (read-only), so the sales dashboard and weekly reports keep working. Older won campaigns keep their hand-set statuses until an invoice is issued here; if every creator was already invoiced or paid, the Final invoice starts that way.
- Changing the campaign currency converts invoice amounts and rates too.

## Update 53 – One deliverable per piece, clearer headings
New migration `19_deliverable_item_qty.sql` (runs automatically on deploy).
- Quoted deliverables now become one deliverable per piece: 4 × IG Reel → IG Reel 1, IG Reel 2, IG Reel 3, IG Reel 4. Stories stay together (3 × IG Story is one deliverable). Applies everywhere deliverables are made from a quote: Deliverables tab, Content Calendar tray and Add.
- Deliverables tab: tick deliverables from one creator and "Group into one" (e.g. 3 stories posted together), or "Split into N" on any grouped one (also fixes older "4 × IG Reel" deliverables). Grouping/splitting is blocked once a creator invoice or payment is against them.
- Each deliverable stores what it is and how many pieces, so its creator rate comes from the rate card (qty × rate).
- Stat boxes at the top show the figure only (the ≈ £ line and descriptions are gone; use the currency switch).
- All table headings are bold and black.
- Fix: adding deliverables from the calendar no longer clears the rate card.

## Update 54 – Story sets and bulk creator actions
No new migration.
- Stories in sets: "Split into N" now asks how many per deliverable (1 each, or sets, e.g. 12 × IG Story → 4 × "3 × IG Story · Set 1–4"). Dates carry over. Set numbers continue after existing sets.
- Influencers tab: tick creators (or tick-all in the header). A bar appears:
  - + Add deliverables: the same deliverable editor, applied to every ticked creator (e.g. 1 × IG Reel, 6 × IG Story in sets of 3). Added to each creator's quote and Index rate quote; for selected (Approved: Yes) creators the deliverables are created too, with optional content due / go-live dates.
  - Approved… and Stage… set the value for every ticked creator in one go (Approved only shows before the campaign is won).

## Update 55 – One place for each input, and everything reversible
No new migration.
- **Creator panel → Rates** (was Rates & payments): Rates card (Initial, Agreed, Client rate, Margin, Profit), the rate card, a one-line payment summary linking to Financials, **Rates on file** (every rate on other campaigns here plus their managed deals from monday, filled automatically; replaces Quote history), Contact and Contract & invoicing cards, then Archive / Remove. No strike-throughs anywhere.
- **Financials is the only place money is entered**: Creator payments is one table grouped by creator. Drop a creator invoice on a creator (or a deliverable row), click a creator payment to move it on, change a deliverable's rate, delete a creator invoice (×). The separate "invoices received" list is merged into it; filters: Not invoiced / On hold / Ready to pay / Paid.
- **Undo**: client invoice Invoiced / Paid dates have × to undo; creator invoices can be deleted; Deliverables tab has Delete for ticked deliverables.
- Deleting a deliverable takes it off the creator's quote too, and the Deliverables tab no longer re-creates deliverables from the quote by itself (use "Add N from scope"). This was why a deleted dummy came back.
- Influencers table only shows "x of y posted" for selected creators, matching the Deliverables tab and calendar.

## Update 56 – Cleaner headers
No new migration. Campaign header shows client and dates only (no contact or owner). Money cards drop the "of …" captions. Rates on file shows 5, then "Show all". Every box and section heading uses one style: bold, black, small caps.

## Update 57 – Next up
No new migration. A slim "Next up" line under the campaign title lists what needs doing, worked out from what's already entered (hidden when there's nothing): overdue content, due in the next 2 days, client invoices to raise (final invoice once all content is live; quarterly/monthly a week before the period starts) or chase (invoiced 30+ days, unpaid), creators ready to pay, unsigned creator contracts, deliverables with no dates, and posts going live this week. Show ▾ opens the full list with one-click actions (Open, Mark invoiced, Mark paid, Schedule, Calendar).

## Update 58 · Content Calendar toolbar, To schedule list and Auto-plan
- One toolbar: view, ‹ › month, legend, creator filter, "To schedule" toggle, ⋯ (Download .ics, go to any month, months with content), + Add.
- To schedule now sits beside the calendar (Month and Year), one line per creator with a count; click to open their chips, search box at the top. Drag or pick-and-click to place as before.
- Auto-plan (button in the To schedule list): pick a go-live date range (defaults to the campaign dates), posting days, posts per creator per week, content-due lead time, max posts per day, spread evenly or as soon as possible, and which creators. Preview shows posts per week/month and anything that won't fit. Schedule writes the dates in one go. Nothing already dated is moved. It is plain arithmetic in the browser, so it uses no AI or console credits.
- No database changes.

## Update 59 · Talent filter, creator contracts, shift dates, tidier uploads, assigned spend, banner
- Deliverables: Talent filter next to Stage (counts follow it).
- Shift dates… (Deliverables bar, the selection bar, and Calendar ⋯ menu): move content due and go-live together by ±N days for all creators, one creator, the selected deliverables, or only dates from a given day. Posted content stays put by default. An Undo bar puts every date back.
- Campaign Overview: Creator contracts card under Client agreement. Lists every Approved: Yes creator automatically, with status (same field as Influencers), date signed, and a slot for the signed contract. Uploading a contract marks that creator Signed with today's date (editable).
- Upload areas are now slim one-line rows. Linked deck, Documents and Client links sit in one Decks & links card. Creator contracts don't appear in Documents.
- Creators · money out: Paid out · Assigned, not paid · Unassigned (client budget less target margin, minus creator costs; red if over) · Cash position.
- Campaign list has the black Zodiac banner.
- Migration 20 (runs on deploy): campaign_talents.contract_signed, campaign_docs.ct_id.

## Update 60 · Overview layout, money out reverted
- Campaign Overview: Brief (long briefs clamp with "Read the full brief") beside Client contact + monday deal; Client agreement full width (terms left, usage + file right); Creator contracts full width, two columns on wide screens.
- Creators · money out back to Paid out · Left to spend · Cash position (Unassigned removed).

## Update 61 · Zodiac OS home page
- The app is now Zodiac OS (browser tab, sign-in card, sidebar wordmark "zodiac os." in Aileron per the brand kit).
- New Home page (opens first after sign-in): live date/time (Dubai), greeting, cards into Talent Index (talent on file, deck links live, opened this week) and Campaign Management (live campaigns, need attention, deliverables overdue), and a Next up strip that opens the campaign it refers to.
- Sidebar: Home, Talent Index, Campaign Management, Sales dashboard. The logo also goes Home.
- Search on the home page opens the ⌘K search.
- New files: public/fonts/aileron-*.woff2, public/zodiac-mark.png. No database changes.

## Update 62 · Home clock and sign-in
- Home has a live clock (ticks every second): Dubai time with date, plus London time.
- Tagline is larger with a burgundy rule.
- Signing in (or reopening the site) always lands on Home.

## Update 63 · Home page redesign (ChatGPT concept)
- Home rebuilt to the new concept: top bar (date · Dubai time ticking · live Dubai weather from Open-Meteo, no key needed), search, notifications bell (red dot when something needs attention; opens a list that jumps to the campaign), settings (opens your account menu).
- Hero "zodiac os." with the night-time Earth and Z artwork (public/home-earth.jpg, cropped from the concept; swap for a high-res export when available).
- Cards: Talent Index (total talent, added this month) and Campaign Management (active campaigns, need attention, to invoice).
- Needs Attention bar: deliverables overdue, deliverables due this week, campaigns ready to invoice; each opens the campaign.
- Sidebar: count badges on Talent Index and Campaign Management; Home highlighted in burgundy.
- API: campaign list now returns dueWeek, readyInv and toInvoice; talents return their added date. No database changes.

## Update 64 · Opening screen
- New opening screen using the Earth + Z artwork (public/zodiac-splash.jpg): "zodiac os." with the tagline and a loading line, then fades into Home.
- Plays when the site opens with a saved sign-in (no more flash of the sign-in card), straight after signing in, and when you come back to the tab after 30+ minutes away (it then returns you to Home).
- If the saved sign-in has expired, the sign-in card appears as before.
- The Home hero now uses the same high-res artwork.

## Update 65 · Netlify credits: let the database sleep
- Netlify DB charges for every hour it is awake and it only sleeps after ~5 idle minutes. The 5-minute talent sync and the 20-second page check kept it awake 24/7 (most of the credit usage).
- Talent sync now every 30 min, 7am–9pm Dubai (was every 5 min, all night). monday deals sync hourly in the same hours (was every 30 min). The monday Sync button still works any time.
- Open pages check for changes once a minute, and only while someone has used the page in the last 5 minutes and the tab is visible.

## Update 66 · Spreadsheet import fixes (UK food creators)
- Cause: Jonny's sheet used "Followers" and "Content Type" headings, which the import didn't recognise, so follower counts and niches were silently dropped; "~99.7K" counts couldn't be read; UK towns were kept as the location so they didn't count as UK.
- Import now recognises Followers / Follower count, Content Type / Category / Type; reads "~99.7K", "12K+", and treats "Count not confirmed" as blank; prefers the column with full links over @handles.
- Free-text niches are mapped onto the Index's own niches (F&B, Travel & Tourism, Lifestyle, Health & Wellness, Parenting, UGC, Events, Fashion, Beauty…); extra descriptors ("reviews", "South Asian") are dropped; anything that still doesn't match is shown as a warning in the preview before importing.
- The preview shows which column is being read for each field, and warns if there's no niche or follower column.
- UK towns, cities and counties (and the other emirates) are saved as UK / UAE.
- Migration 21 (runs on deploy): talent whose location is a single UK town/city/county is changed to UK (other emirates to UAE).

## Update 67 · Closed Won campaigns checked against monday (read only)
- For every 7 - Won campaign imported from monday, Zodiac OS reads the Agency Sales Pipeline deal and flags anything that doesn't match. Nothing is ever written to monday.
- Compared: stage (monday "Invoiced"/"Invoice Paid" count as won), currency, budget, target margin, real margin on the creators booked vs monday's target, start date, owner, client, and invoicing status vs the Financials client invoices.
- Campaign header: "N differences with monday" (or "Matches monday"). Click for the side-by-side, with "Use monday's" per row (budget, target margin, start date, owner, client, stage) and "Use monday's for all". Margin and invoicing rows link to Rates / Financials.
- Runs with the hourly deals sync (7am–9pm Dubai) and when you open a won campaign (if the last check is over 10 minutes old). Campaign list shows a "≠ monday" flag; Home's bell lists them and they count towards "Need attention".
- Migration 22 (runs on deploy): campaigns.monday_check.
- Update 67b: the monday check now also covers campaigns still in the pipeline (3 - Proposal Sent through 6 - Contract Sent): stage, currency, budget, target margin, real margin, start date, owner and client. Invoicing is only checked once Won. If a deal is marked Won on monday while the campaign is still at Proposal Sent, it's flagged with "Use monday's" to move it to 7 - Won. Closed Lost campaigns aren't checked.

## Update 68 · Sales dashboard and Reports from monday; monthly Forecast report
- Sales dashboard and Reports now read every deal on the monday Agency Sales Pipeline (read only, cached 5 minutes, "Refresh" to re-read). Deals with a campaign here use its real creator costs; others use monday's Target Margin. Monday "Invoiced" / "Invoice Paid" count as won; "1- Prospect" isn't in the revenue figures. Campaigns made by hand here (no monday deal) still count. Deals without a campaign open on monday when clicked.
- Currency to £ uses the same rates as monday's GBP formulas (USD 0.75, AED 0.2, EUR 0.85, SAR 0.2).
- Reports → Forecast now matches the monthly meeting PDF: headline cards; Closed Won with By Status (Invoice Paid / Agreed) and Agreed Deals; Key Updates (deals agreed this month and last, grouped by client); Active Conversations (prospect and discovery deals); Proposal Sent pipeline with likelihood (monday Close Probability) and next steps (monday Next Steps).
- "Edit the wording": per deal, choose where it shows (Auto / Key Updates / Conversations / Hide), a tag and a line; saved for the whole team and kept month to month.
- Save as PDF (prints one section per A4 page), Excel (Summary, Closed Won, Pipeline, Key Updates, Active Conversations), and Download HTML. Sales has Download Excel.
- Migration 23 (runs on deploy): report_notes.

## Update 69 — Customisable Forecast report
Reports → Forecast now has a "Customise the report" panel. One layout is saved for the whole team (app_settings key `forecast_cfg`, PUT /api/campaigns/report-config). You can set the title, the report month (blank means the current month), the start of the financial year, what Key Updates covers, which stages count as pipeline and conversations, show or hide headline cards, by-status, agreed list, margins, likelihood and top lines, rename and reorder sections or hide them, and add an intro note. "Reset to the standard layout" puts everything back. Viewers can see the settings but can't change them.

## Update 70 — Connect Claude (Zodiac OS connector)
Anyone with their own login can go to Account → Connect Claude, make a personal link (`/mcp/zos_…`) and add it to their Claude as a custom connector. Their Claude can then read the Talent Index, campaigns, deliverables, invoices and the live monday pipeline, and shortlist an existing creator on a campaign (Claude shows a preview and must be told yes first). It cannot change fees, stages, contracts or invoices, delete anything or write to monday. It works through the normal API as that person, so their role applies and everything is in the activity log.
Links are stored hashed (table `claude_keys`, migration 24). Making a new link switches off the old one. Admins see everyone's connections there and can switch any of them off. Deactivating a user also stops their link.
Tools: search_talent, get_talent, list_campaigns, get_campaign, sales_pipeline, needs_attention, add_creator_to_campaign.
Update 70b: add_creator_to_campaign can also set the creator fee, client rate or margin, and their deliverables (item, qty, optional per-item rate, content-due and go-live dates). Deliverables are split the same way the app does it (stories as one set, others one each, usage rights scope-only). The creator stays shortlisted; approving is still done in Zodiac OS.

## Update 71 — Claude can edit (per person)
Admins see a **Can edit** tick next to each connection in Account → Connect Claude (`users.claude_edit`, migration 25, off by default). With it on, that person's Claude can also:
- update_campaign_creator: fees (initial/negotiated), client rate or margin, scope, approval, stage, next action, creator contract and signed date, archive/un-archive, remove (only with no deliverables or invoices)
- edit_deliverables: add/update/remove up to 40 in one go: stage, content due/received, live due/went live, platform, links (no removing anything live or invoiced)
- log_creator_invoice (marks Invoiced, never Paid), update_client_invoice (invoiced date, amount, period, new line; never Paid)
- update_campaign (details, contact, client agreement, billing, document links; not currency), create_campaign_from_monday, resolve_monday_mismatch (Zodiac OS takes the monday value)
- add_talent / update_talent (Index niches only; duplicate check by name and handle) and notes
Every change returns a preview plus a confirm_token tied to the exact arguments; changing anything needs a new preview. Nothing writes to monday, nothing marks payments, everything is logged under the person's name.
Also: get_campaign now runs a fresh monday check if the last one is over 10 minutes old, and entering a client agreement signed date now sets the status to Signed (migration 25 fixes existing ones).

## Update 72 — One look across Zodiac OS
Every main page now opens with the same burgundy header with big figure tiles, and cream with white cards below:
- Campaign page: name, client, dates, owner, stage, currency, billing and monday check in the header, then Budget (still editable), Creator costs, Margin, Margin % and a campaign timeline. Tabs are now Overview · Creators · Deliverables · Calendar · Financials and live in the header. Campaigns open on Overview.
- Overview: delivery rings, money in/out, brief, client agreement and creator contracts on the left; Next up, monday check and client contact on the right; documents and links underneath. Money in/out also shows on Financials. The other tabs keep the compact Next up bar.
- Campaign list: Live campaigns, Won this year, In the pipeline, To invoice and Needs attention, with the action buttons in the header.
- Sales: the five headline figures and the period/owner/currency controls are in the header.
- Talent Index: the header, toolbar and Talent/Followers/Instagram/TikTok/YouTube tiles sit in the burgundy band.
Update 72b: toned down for consistency. One flat burgundy (#2A0009) for the sidebar and every page header, so they read as one frame. Figure tiles show just the label and number (no extra lines underneath); Margin % is simply green or red. Billing pill removed from the campaign header. Budget uses the same currency symbol as the other figures. Home blends from the sidebar burgundy into its starfield. Tiles stay five across down to 980px wide.
Update 72c: back to the black rounded banner with the Zodiac Global logo, now used the same way on every page (Talent Index, campaign list, each campaign, Sales). Logo, divider, title in the same font, actions on the right, and the figure tiles inside the banner with just a label and number. Sidebar and Home back to black.
Update 73: every campaign tab redesigned to match the Overview, and one style across the platform.
- Tabs: Creators is first and campaigns open on it.
- Financials: Money in / Money out cards (big total, one bar, three figures), a Cash position line in plain English, client invoices as rows with an Invoiced → Paid tracker, creator payments grouped by creator with a paid-so-far bar.
- Creators: title, deadline chips and Add button inside the table card.
- Deliverables: a stage strip (Brief sent → Live) with counts; click a stage to filter. Filter chips match everywhere.
- Overview: one compact Money card.
- Everywhere: sentence-case section titles, one number font, same chips, same cards. Client pages and Reports use the same black banner (no logo on detail pages). Talent Index section heading matches.

## Update 74 — New look: black floating sidebar, burgundy banners, Home
- Sidebar: a floating black card with rounded corners; the page you're on is a burgundy pill. Sales dashboard is always in the sidebar.
- Banners on every page (Talent Index, campaign list, each campaign, Sales, Reports, client pages) are burgundy with rounded corners; all text on them is white.
- Home: "Here's where everything stands" removed. Needs attention pills now take you to the work: one campaign → straight to it on the right tab (overdue → Deliverables filtered to overdue; invoices → Financials; contracts → Creators); several → the campaign list with Next up open. New Recently viewed row: the last 3 campaigns you opened (kept in your browser), click to open.

## Update 75 — Content Calendar (sidebar)
New "Content Calendar" under Sales dashboard: every deliverable from selected creators on all live (not lost or archived) campaigns in one Google-style month view, plus a List view. Each campaign has its own colour; solid = goes live, outline = content due, dark = filming, red = overdue, faded ✓ = done. Filters: campaign, creator, owner, and Live / Content due / Filming. Header tiles: going live this week, content due this week, overdue, posts this month. Click any post to open that campaign's calendar (with "← Content Calendar" to come back). Download .ics exports what's on screen. API: GET /api/campaigns/calendar.
