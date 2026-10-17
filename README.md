# Outbound Email Engine (Demo)

A multi-campaign outbound email tool. It finds leads that match each campaign's ideal customer, drafts personalized emails with Claude, and sends them only after a person reviews and approves each one.

This repository is a sanitized demo of an internal tool I built with Claude and Claude Code during a consulting internship. The brands, organizations, people, and email addresses in it are all fictional. Real client data, history, and credentials are not included.

## What it does

- **Campaigns:** each campaign has its own branding, lead criteria, pitch copy, and prompt templates, stored in the database so a campaign can be edited without a deploy. A switcher moves between them.
- **Discover:** Claude suggests organizations that fit a campaign's customer profile. Results already in the leads table or on the campaign's past-customer list are filtered out.
- **Contact lookup:** an optional Hunter.io lookup finds a contact email and first name for each suggested organization, with a check that rejects a domain that resolves to the wrong organization.
- **Draft:** Claude writes a personalized email from an approved template, with a first-name greeting and clickable links.
- **Review queue:** drafts wait for a person to edit, approve, or skip them. Nothing is sent unattended.
- **Send:** approved emails go out through Resend from a campaign's configured sender. Campaigns without a sender open a Gmail compose window instead.
- **Pipeline:** leads move through New, Emailed, Replied, and Meeting.

## Stack

Next.js 14 (App Router), Supabase (Postgres), Anthropic API, Hunter.io, Resend, deployed on Vercel.

## Run it locally

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in your values. Only the Supabase values and `ANTHROPIC_API_KEY` are needed to explore the app.
3. In the Supabase SQL editor, run `schema.sql`. It creates the tables and seeds three fictional campaigns, sample leads, and two drafts in the review queue.
4. `npm run dev` and open http://localhost:3000.

## Demo mode

With `DEMO_MODE=true`, the send route never calls Resend and returns a fake id, so the approve flow can be shown without sending anything. Sample addresses use the reserved `example.org` domain.

## Known limitations

- **No user authentication.** The database policies in `schema.sql` give the anonymous role full access, and the API routes have no login check. This is acceptable for a local demo with fictional data and not acceptable for real data. Do not deploy it publicly with real keys or real leads.
- Several routes call paid APIs, so protect any deployed copy.
- The client logic in `lib/appLogic.js` is one large file that would be better split into modules.

## What I would do next

- Add authentication and per-user database policies.
- Add send-rate and spend limits per campaign.
- Track replies and measure results per campaign, such as drafts approved, emails sent, and meetings booked.
- Add automated tests for the draft and duplicate-filtering logic.
