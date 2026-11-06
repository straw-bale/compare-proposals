-- Run once in Supabase → SQL Editor → New query → paste → Run.
-- Each row stores what the app saved as JSON in `data`; `project` is pulled out so projects can be listed later.
-- RLS is on with no policies: only the server (secret key) can read or write. The public key gets nothing.

create table if not exists rfp_reviews (
  id uuid primary key,
  project text,
  data jsonb not null,
  saved_at timestamptz not null default now()
);

create table if not exists comparisons (
  id uuid primary key,
  project text,
  data jsonb not null,
  saved_at timestamptz not null default now()
);

-- A PDF's reading, keyed by a hash of the file, so the same PDF is never paid for twice.
create table if not exists readings (
  hash text primary key,
  data jsonb not null,
  saved_at timestamptz not null default now()
);

alter table rfp_reviews enable row level security;
alter table comparisons enable row level security;
alter table readings enable row level security;

-- Newer Supabase projects don't grant table access automatically; let the server's secret key (service_role) in.
grant select, insert, update, delete on rfp_reviews, comparisons, readings to service_role;

-- Messages from the Feedback button.
create table if not exists feedback (
  id uuid primary key default gen_random_uuid(),
  message text not null,
  tab text,
  created_at timestamptz not null default now()
);
alter table feedback enable row level security;
grant select, insert, update, delete on feedback to service_role;

-- Projects: an RFP review and its comparisons link to one by id (stored in their data as projectId).
create table if not exists projects (
  id uuid primary key,
  name text,
  data jsonb not null,
  saved_at timestamptz not null default now()
);
alter table projects enable row level security;
grant select, insert, update, delete on projects to service_role;
