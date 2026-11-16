-- Public development points used by the map.
-- gen_random_uuid() is built into Supabase Postgres; no extension is needed.
create table if not exists public.development (
  id uuid primary key default gen_random_uuid(),
  title text,
  allocated numeric,
  lat double precision,
  lng double precision,
  source_link text,
  photo_url text,
  date date,
  year text,
  district text,
  created_at timestamp default now()
);

alter table public.development add column if not exists scheme text;
alter table public.development add column if not exists state text;
alter table public.development add column if not exists photo_url_2 text;
alter table public.development add column if not exists photo_status text default 'missing';
alter table public.development add column if not exists problem_since date;
alter table public.development add column if not exists reported_year text;
alter table public.development add column if not exists party text default 'Not known';
alter table public.development add column if not exists mla text default 'Not known';
alter table public.development add column if not exists votes_true integer default 0;
alter table public.development add column if not exists votes_false integer default 0;
alter table public.development add column if not exists flagged_yellow boolean default true;
alter table public.development add column if not exists credits text;
alter table public.development add column if not exists dedupe_key text;
alter table public.development add column if not exists extra jsonb;

create index if not exists development_lat_lng_idx on public.development (lat, lng);
create index if not exists development_year_idx on public.development (year);
create index if not exists development_scheme_idx on public.development (scheme);
create unique index if not exists development_dedupe_key_idx on public.development (dedupe_key);

alter table public.development enable row level security;

drop policy if exists "read all" on public.development;
create policy "read all" on public.development
  for select
  using (true);

grant select on public.development to anon, authenticated;

-- One vote per browser token per development point. Tokens are hashed by the API.
create table if not exists public.development_vote_tokens (
  id bigserial primary key,
  development_id uuid not null references public.development (id) on delete cascade,
  voter_token text not null,
  vote boolean not null,
  created_at timestamptz default now(),
  unique (development_id, voter_token)
);

alter table public.development_vote_tokens enable row level security;

create or replace function public.increment_development_vote(
  p_id uuid,
  p_vote boolean,
  p_token text
)
returns table (true_votes integer, false_votes integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_token is null or length(p_token) < 8 then
    raise exception 'invalid voter token';
  end if;

  insert into public.development_vote_tokens (development_id, voter_token, vote)
  values (p_id, p_token, p_vote)
  on conflict (development_id, voter_token) do nothing;

  if found then
    update public.development as d
    set votes_true = coalesce(d.votes_true, 0) + case when p_vote then 1 else 0 end,
        votes_false = coalesce(d.votes_false, 0) + case when p_vote then 0 else 1 end
    where d.id = p_id;
  end if;

  return query
    select coalesce(d.votes_true, 0), coalesce(d.votes_false, 0)
    from public.development as d
    where d.id = p_id;
end;
$$;

grant execute on function public.increment_development_vote(uuid, boolean, text) to anon, authenticated;
