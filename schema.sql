-- Outbound Email Engine: demo schema with fictional data.
-- Run this once in the Supabase SQL editor (Project -> SQL Editor -> New query).
-- All organizations, people, and email addresses below are made up. Addresses
-- use the reserved example.org domain, so nothing can reach a real inbox.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  is_active boolean default true,

  primary_color text not null,
  secondary_color text,
  logo_url text,

  sender_name text,
  sender_title text,
  sender_email text,

  -- Pitch copy, prompt templates, filters and known customers live here so a
  -- campaign can be edited with an UPDATE instead of a deploy.
  config jsonb not null default '{}'::jsonb,

  sending_enabled boolean default false,
  daily_send_limit int default 20,
  approval_required boolean default true,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.leads (
  id bigint generated always as identity primary key,
  campaign_id uuid references public.campaigns(id),
  org text not null,
  contact text not null default '',
  first_name text,
  email text not null default '',
  title text not null default '',
  location text not null default '',
  type text not null default 'School District',
  status text not null default 'New'
    check (status in ('New', 'Emailed', 'Replied', 'Meeting')),
  source text not null default 'manual'
    check (source in ('existing', 'discovered', 'imported', 'manual')),
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_leads_campaign_id on public.leads(campaign_id);

create table if not exists public.email_queue (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id),
  lead_id bigint not null references public.leads(id) on delete cascade,
  subject text not null,
  body text not null,
  status text not null default 'pending_review',  -- pending_review | sent | skipped
  batch_date date not null default current_date,
  generated_at timestamptz default now(),
  sent_at timestamptz,
  unique (lead_id, batch_date)
);

create index if not exists idx_email_queue_campaign_status on public.email_queue(campaign_id, status);
create index if not exists idx_email_queue_batch_date on public.email_queue(batch_date);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
-- DEMO ONLY. This app has no per-user login, so the anon role gets full access.
-- Before using real data, add authentication and replace these policies.

alter table public.campaigns enable row level security;
alter table public.leads enable row level security;
alter table public.email_queue enable row level security;

create policy "demo: anon full access on campaigns" on public.campaigns
  for all to anon using (true) with check (true);
create policy "demo: anon full access on leads" on public.leads
  for all to anon using (true) with check (true);
create policy "demo: anon full access on email_queue" on public.email_queue
  for all to anon using (true) with check (true);

-- ---------------------------------------------------------------------------
-- Campaigns (three fictional companies)
-- ---------------------------------------------------------------------------

insert into public.campaigns
  (slug, name, primary_color, secondary_color, logo_url, sender_name, sender_title, sender_email, config, is_active, sending_enabled, daily_send_limit)
values

('acme-crosswalk', 'Acme Crosswalk Safety',
 '#FF6B00', '#1E3A5F', null,
 null, null, null,
 $cfg$
 {
   "discover_subtitle": "AI searches for school districts and transportation buyers matching your existing customer profile.",
   "compose_subtitle": "Select leads and let Claude write personalized cold outreach emails based on your campaign context.",
   "campaign_types": [
     {"value":"cold","label":"Cold outreach, first touch"},
     {"value":"followup","label":"Follow-up, warm lead"},
     {"value":"pilot","label":"Pilot program invitation"}
   ],
   "campaign_labels": {
     "cold":"cold first-touch outreach",
     "followup":"follow-up to a warm lead",
     "pilot":"pilot program invitation"
   },
   "default_contact_role": "Transportation or Safety Director",
   "discover_filters": {
     "region": {"label":"Region","options":{
       "west":{"label":"Western US","prompt_text":"the western United States"},
       "midwest":{"label":"Midwest","prompt_text":"the US Midwest"},
       "northeast":{"label":"Northeast","prompt_text":"the US Northeast"},
       "national":{"label":"National","prompt_text":"the US nationally"}
     }},
     "org_type": {"label":"Organization type","options":{
       "district":{"label":"School districts","prompt_text":"K-12 school districts"},
       "dot":{"label":"City / DOT transportation","prompt_text":"city and county transportation departments"},
       "both":{"label":"Both","prompt_text":"school districts and city or county transportation departments"}
     }},
     "size": {"label":"District size","options":{
       "any":{"label":"Any size","prompt_text":""},
       "small":{"label":"Under 5,000 students","prompt_text":"with under 5,000 students"},
       "mid":{"label":"5,000 to 25,000 students","prompt_text":"with 5,000 to 25,000 students"},
       "large":{"label":"25,000+ students","prompt_text":"with over 25,000 students"}
     }}
   },
   "known_customers": [
     {"org":"Maple Grove Township (Demo)","contact":"Transportation Director","email":"transportation@example.org","title":"Director of Transportation","location":"Maple Grove, OH","type":"City/DOT"},
     {"org":"Cedar Valley Elementary (Demo)","contact":"Principal","email":"principal@example.org","title":"Principal","location":"Cedar Valley, CO","type":"School District"},
     {"org":"Harborview School District (Demo)","contact":"Student Safety Coordinator","email":"safety@example.org","title":"Student Safety Coordinator","location":"Harborview, WA","type":"School District"}
   ],
   "previous_customer_orgs": ["Maple Grove Township (Demo)", "Cedar Valley Elementary (Demo)", "Harborview School District (Demo)"],
   "discover_prompt_template": "You are a B2B lead researcher for Acme Crosswalk Safety, a fictional student pedestrian safety app at $3/student/month. Existing customers include Maple Grove Township OH (city/DOT), Cedar Valley Elementary CO (school), and Harborview School District WA (school district).\n\nFind 8 specific, real named leads: {{org_type_desc}} {{size_desc}} in {{region_desc}} that are likely to purchase a student pedestrian safety tracking app. Prioritize those with known pedestrian safety initiatives, urban or suburban settings, active crosswalk programs, or prior safety spending. Keywords: {{keywords}}.\n\nReturn ONLY a valid JSON array. No preamble, no markdown fences. Each object must have exactly these keys:\norg (string), contact_title (string), location (string, \"City, ST\"), reason (string, max 12 words, why they are a good fit), type (string, either \"School District\" or \"City/DOT\"), estimated_students (string, e.g. \"8,200\" or \"Unknown\"), domain (string, the organization's actual website domain if you are reasonably confident of it, e.g. \"cityofexample.us\"; leave as an empty string if not confident, do not guess randomly)",
   "email_prompt_template": "You are a sales rep for Acme Crosswalk Safety, a fictional student pedestrian safety mobile app that:\n- Uses GPS route tracking for students walking to and from school\n- Sends real-time deviation alerts to parents\n- Lets families report crosswalk hazards to city and DOT contacts\n- Costs $3/student/month\n\nWrite a {{tone}} {{campaign_label}} email to:\n- Organization: {{lead_org}}\n- Contact role: {{lead_title}}\n- Location: {{lead_location}}\n- Type: {{lead_type}}\n{{extra_context_line}}\n\nRequirements:\n- First line: \"Subject: [subject line]\" on its own line\n- Then begin the body with this greeting on its own line: {{greeting}}\n- 3 to 4 short paragraphs max\n- No opener like \"I hope this email finds you well\"\n- Reference something specific to their district, city, or region\n- Clear CTA: request a 15-minute call or pilot interest\n- End with the line: Explore Acme Crosswalk Safety: https://example.com/acme-crosswalk\n- Do not include any sign-off or signature, a signature block will be appended automatically"
 }
 $cfg$::jsonb,
 true, true, 3),

('northwind-secure', 'Northwind Secure',
 '#2B2D42', '#8D99AE', null,
 null, null, null,
 $cfg$
 {
   "discover_subtitle": "AI searches for school districts and municipalities that are strong targets for a cybersecurity platform.",
   "compose_subtitle": "Select leads and let Claude write personalized outreach for your cybersecurity campaign.",
   "campaign_types": [
     {"value":"cold","label":"Cold outreach, first touch"},
     {"value":"followup","label":"Follow-up, warm lead"},
     {"value":"audit","label":"Free security audit offer"}
   ],
   "campaign_labels": {
     "cold":"cold first-touch outreach",
     "followup":"follow-up to a warm lead",
     "audit":"free security audit offer"
   },
   "default_contact_role": "IT Director or Superintendent",
   "discover_filters": {
     "region": {"label":"Region","options":{
       "west":{"label":"Western US","prompt_text":"the western United States"},
       "midwest":{"label":"Midwest","prompt_text":"the US Midwest"},
       "national":{"label":"National","prompt_text":"the US nationally"}
     }},
     "org_type": {"label":"Organization type","options":{
       "district":{"label":"School districts","prompt_text":"K-12 school districts"},
       "city":{"label":"Municipalities","prompt_text":"city and county governments"},
       "both":{"label":"Both","prompt_text":"school districts and city or county governments"}
     }},
     "size": {"label":"Size","options":{
       "any":{"label":"Any size","prompt_text":""},
       "small":{"label":"Small","prompt_text":"with a small IT team"},
       "large":{"label":"Large","prompt_text":"with a large student or resident data footprint"}
     }}
   },
   "known_customers": [],
   "previous_customer_orgs": [],
   "discover_prompt_template": "You are a B2B lead researcher for Northwind Secure, a fictional cybersecurity platform for K-12 districts and local governments. Target buyers: IT directors, superintendents, and technology coordinators.\n\nFind 8 specific, real named leads: {{org_type_desc}} {{size_desc}} in {{region_desc}} that are likely buyers of a cybersecurity and data-protection platform. Prioritize organizations with large data footprints or known technology upgrades. Keywords: {{keywords}}.\n\nReturn ONLY a valid JSON array. No preamble, no markdown fences. Each object must have exactly these keys:\norg (string), contact_title (string), location (string, \"City, ST\"), reason (string, max 12 words, why they are a good fit), type (string, either \"School District\" or \"City/DOT\"), estimated_students (string, e.g. \"8,200\" or \"Unknown\"), domain (string, the organization's actual website domain if you are reasonably confident of it; otherwise an empty string)",
   "email_prompt_template": "You are a sales rep for Northwind Secure, a fictional cybersecurity platform that:\n- Provides real-time threat detection and incident response for school and municipal networks\n- Helps protect sensitive student and resident data\n- Offers managed monitoring for under-resourced IT teams\n\nWrite a {{tone}} {{campaign_label}} email to:\n- Organization: {{lead_org}}\n- Contact role: {{lead_title}}\n- Location: {{lead_location}}\n- Type: {{lead_type}}\n{{extra_context_line}}\n\nRequirements:\n- First line: \"Subject: [subject line]\" on its own line\n- Then begin the body with this greeting on its own line: {{greeting}}\n- 3 to 4 short paragraphs max\n- No opener like \"I hope this email finds you well\"\n- Clear CTA: request a 15-minute call or a free security assessment\n- Do not include any sign-off or signature, a signature block will be appended automatically"
 }
 $cfg$::jsonb,
 true, false, 20),

('lumen-talent', 'Lumen Talent Partners',
 '#6A4C93', '#FFCA3A', null,
 null, null, null,
 $cfg$
 {
   "discover_subtitle": "AI searches for growing organizations that need help filling open roles.",
   "compose_subtitle": "Select leads and let Claude write personalized outreach for your recruiting campaign.",
   "campaign_types": [
     {"value":"cold","label":"Cold outreach, first touch"},
     {"value":"followup","label":"Follow-up, warm lead"},
     {"value":"referral","label":"Referral or warm introduction"}
   ],
   "campaign_labels": {
     "cold":"cold first-touch outreach",
     "followup":"follow-up to a warm lead",
     "referral":"warm introduction outreach"
   },
   "default_contact_role": "Hiring Manager or People Ops Lead",
   "discover_filters": {
     "industry": {"label":"Industry","options":{
       "nonprofit":{"label":"Nonprofits","prompt_text":"nonprofits and associations"},
       "tech":{"label":"Technology","prompt_text":"technology"},
       "construction":{"label":"Engineering and construction","prompt_text":"engineering and construction"},
       "any":{"label":"Any industry","prompt_text":"any industry"}
     }},
     "hiring_need": {"label":"Hiring need","options":{
       "single":{"label":"Single hard-to-fill role","prompt_text":"a single hard-to-fill open role"},
       "growth":{"label":"High-growth, multiple roles","prompt_text":"a high-growth hiring push with multiple open roles"},
       "any":{"label":"Any","prompt_text":"active hiring needs"}
     }}
   },
   "known_customers": [
     {"org":"Lakeside Community Trust (Demo)","contact":"","email":"","title":"","location":"Springfield, IL","type":"Nonprofit"},
     {"org":"Brightpath Software (Demo)","contact":"","email":"","title":"","location":"","type":"Technology"}
   ],
   "previous_customer_orgs": ["Lakeside Community Trust (Demo)", "Brightpath Software (Demo)"],
   "discover_prompt_template": "You are a B2B lead researcher for Lumen Talent Partners, a fictional recruiting firm. Existing customers include Lakeside Community Trust and Brightpath Software.\n\nFind 8 specific, real named leads: organizations in {{industry_desc}} that appear to be experiencing {{hiring_need_desc}}. Prioritize organizations showing signs of active hiring. Keywords: {{keywords}}.\n\nReturn ONLY a valid JSON array. No preamble, no markdown fences. Each object must have exactly these keys:\norg (string), contact_title (string), location (string, \"City, ST\"), reason (string, max 12 words, why they are a good fit), type (string, industry category), estimated_students (string, always \"Unknown\" for this campaign), domain (string, the organization's actual website domain if you are reasonably confident of it; otherwise an empty string)",
   "email_prompt_template": "You are a recruiter at Lumen Talent Partners, a fictional talent acquisition firm that partners closely with hiring teams to find candidates who fit both the role and the culture.\n\nWrite a {{tone}} {{campaign_label}} email to:\n- Organization: {{lead_org}}\n- Contact role: {{lead_title}}\n- Location: {{lead_location}}\n- Type: {{lead_type}}\n{{extra_context_line}}\n\nRequirements:\n- First line: \"Subject: [subject line]\" on its own line\n- Then begin the body with this greeting on its own line: {{greeting}}\n- 3 to 4 short paragraphs max\n- No opener like \"I hope this email finds you well\"\n- Clear CTA: request a 15-minute call to discuss their hiring needs\n- Do not include any sign-off or signature, a signature block will be appended automatically"
 }
 $cfg$::jsonb,
 true, false, 20)

on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- Seed leads for the Acme Crosswalk Safety campaign (all fictional)
-- ---------------------------------------------------------------------------
-- Re-running this block inserts duplicate rows, so run it once.

insert into public.leads (campaign_id, org, contact, first_name, email, title, location, type, status, source)
select c.id, v.org, v.contact, v.first_name, v.email, v.title, v.location, v.type, v.status, v.source
from public.campaigns c
cross join (values
  ('Maple Grove Township (Demo)', 'Transportation Director', null, 'transportation@example.org', 'Director of Transportation', 'Maple Grove, OH', 'City/DOT', 'Meeting', 'existing'),
  ('Cedar Valley Elementary (Demo)', 'Principal', null, 'principal@example.org', 'Principal', 'Cedar Valley, CO', 'School District', 'Replied', 'existing'),
  ('Harborview School District (Demo)', 'Student Safety Coordinator', null, 'safety@example.org', 'Student Safety Coordinator', 'Harborview, WA', 'School District', 'Emailed', 'existing'),
  ('Riverbend School District (Demo)', 'Jordan Ellis', 'Jordan', 'jordan.ellis@riverbend.example.org', 'Transportation Safety Officer', 'Riverbend, OR', 'School District', 'New', 'discovered'),
  ('Pinecrest Unified (Demo)', 'Priya Nair', 'Priya', 'priya.nair@pinecrest.example.org', 'Director of Operations', 'Pinecrest, CA', 'School District', 'New', 'discovered'),
  ('Lakeshore City Transportation Dept (Demo)', '', null, '', '', 'Lakeshore, MI', 'City/DOT', 'New', 'discovered'),
  ('Oak Hollow School District (Demo)', '', null, '', '', 'Oak Hollow, TX', 'School District', 'New', 'discovered'),
  ('Summit Ridge County Schools (Demo)', '', null, '', '', 'Summit Ridge, CO', 'School District', 'New', 'discovered')
) as v(org, contact, first_name, email, title, location, type, status, source)
where c.slug = 'acme-crosswalk';

-- ---------------------------------------------------------------------------
-- Two drafted emails in the review queue, so the Review panel is not empty
-- ---------------------------------------------------------------------------

insert into public.email_queue (campaign_id, lead_id, subject, body)
select c.id, l.id,
  'Safer walks to Riverbend schools',
  $b$Hi Jordan,

Riverbend families walk to school across a few busy crossings, and it can be hard for parents to know whether their child made it along the planned route. Acme Crosswalk Safety gives families GPS route tracking and real-time alerts if a student leaves the expected path.

It also lets families report crosswalk hazards straight to the right city contact, so problem spots get fixed faster. We price it at $3 per student per month, and we are inviting a small number of districts to a pilot.

Would you be open to a 15-minute call to see if a pilot fits Riverbend?

Explore Acme Crosswalk Safety: https://example.com/acme-crosswalk$b$
from public.campaigns c
join public.leads l on l.campaign_id = c.id and l.org = 'Riverbend School District (Demo)'
where c.slug = 'acme-crosswalk'
on conflict do nothing;

insert into public.email_queue (campaign_id, lead_id, subject, body)
select c.id, l.id,
  'Walking routes in Pinecrest, a quick idea',
  $b$Hi Priya,

Operations teams in growing districts often hear about unsafe crossings only after a close call. Acme Crosswalk Safety gives parents live route alerts and gives your team a simple way to collect crosswalk hazard reports from families.

Districts like Harborview use it to spot problem areas early and share clear reports with city traffic staff. It is $3 per student per month.

Could we set up a 15-minute call to walk through how it might work for Pinecrest?

Explore Acme Crosswalk Safety: https://example.com/acme-crosswalk$b$
from public.campaigns c
join public.leads l on l.campaign_id = c.id and l.org = 'Pinecrest Unified (Demo)'
where c.slug = 'acme-crosswalk'
on conflict do nothing;
