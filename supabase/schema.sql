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
