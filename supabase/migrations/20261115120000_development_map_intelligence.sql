-- Development map intelligence: transparent work categories, amount state and
-- viewport clustering for a large public layer (102k+ sourced points).
-- Categories are text classifications of official work titles; they are not
-- independent physical verification and no missing amount is treated as zero.

alter table public.development add column if not exists category text;
alter table public.development add column if not exists issue_group text;
alter table public.development add column if not exists amount_status text default 'unknown';
alter table public.development add column if not exists block text;
alter table public.development add column if not exists gram_panchayat text;
alter table public.development add column if not exists work_type text;
alter table public.development add column if not exists source_dataset text;

create index if not exists development_category_idx on public.development (category);
create index if not exists development_year_category_idx on public.development (year, category);
create index if not exists development_issue_idx on public.development (issue_group) where issue_group is not null;
create index if not exists development_geo_idx on public.development (lat, lng) where lat is not null and lng is not null;

alter table public.development enable row level security;

drop policy if exists "read all" on public.development;
create policy "read all" on public.development
  for select
  using (true);

grant select on public.development to anon, authenticated;

-- Zoom-adaptive count clusters. Returns one row per grid cell in the viewport.
create or replace function public.development_map_clusters(
  p_west double precision,
  p_south double precision,
  p_east double precision,
  p_north double precision,
  p_year text default null,
  p_category text default null,
  p_cells integer default 512,
  p_limit integer default 4000
)
returns table (
  lng double precision,
  lat double precision,
  total integer,
  amount_total numeric,
  issue_total integer,
  category text
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with params as (
    select greatest(16, least(8192, coalesce(p_cells, 512)))::int as cells
  ),
  filtered as (
    select d.lat, d.lng, d.category, d.issue_group, coalesce(d.allocated, 0) as amount
    from public.development d
    where d.lat is not null
      and d.lng is not null
      and d.lat between p_south and p_north
      and d.lng between p_west and p_east
      and (p_year is null or p_year = '' or p_year = 'all' or d.year = p_year)
      and (p_category is null or p_category = '' or p_category = 'all' or d.category = p_category)
  ),
  grouped as (
    select
      floor((f.lng + 180) / 360 * p.cells)::int as cx,
      floor((1 - asinh(tan(radians(f.lat))) / pi()) / 2 * p.cells)::int as cy,
      count(*)::int as total,
      avg(f.lng)::double precision as lng,
      avg(f.lat)::double precision as lat,
      sum(f.amount) as amount_total,
      count(*) filter (where f.issue_group is not null)::int as issue_total,
      mode() within group (order by f.category) as category
    from filtered f
    cross join params p
    group by 1, 2
  )
  select g.lng, g.lat, g.total, g.amount_total, g.issue_total, g.category
  from grouped g
  order by g.total desc
  limit greatest(1, least(6000, coalesce(p_limit, 4000)));
$$;

grant execute on function public.development_map_clusters(double precision, double precision, double precision, double precision, text, text, integer, integer) to anon, authenticated;

-- Individual points in the viewport; used only at close zoom so the map stays light.
create or replace function public.development_map_points(
  p_west double precision,
  p_south double precision,
  p_east double precision,
  p_north double precision,
  p_year text default null,
  p_category text default null,
  p_limit integer default 3000
)
returns table (
  id uuid,
  title text,
  allocated numeric,
  amount_status text,
  lat double precision,
  lng double precision,
  category text,
  issue_group text,
  photo_url text,
  photo_url_2 text,
  photo_status text,
  source_link text,
  date date,
  problem_since date,
  year text,
  reported_year text,
  district text,
  state text,
  scheme text,
  party text,
  mla text,
  votes_true integer,
  votes_false integer,
  flagged_yellow boolean,
  credits text,
  block text,
  gram_panchayat text,
  work_type text
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    d.id,
    d.title,
    d.allocated,
    coalesce(d.amount_status, case when d.allocated is not null and d.allocated > 0 then 'reported' else 'not_published' end),
    d.lat,
    d.lng,
    coalesce(d.category, 'other'),
    d.issue_group,
    d.photo_url,
    d.photo_url_2,
    d.photo_status,
    d.source_link,
    d.date,
    d.problem_since,
    d.year,
    d.reported_year,
    d.district,
    d.state,
    d.scheme,
    d.party,
    d.mla,
    coalesce(d.votes_true, 0),
    coalesce(d.votes_false, 0),
    coalesce(d.flagged_yellow, false),
    d.credits,
    d.block,
    d.gram_panchayat,
    d.work_type
  from public.development d
  where d.lat is not null
    and d.lng is not null
    and d.lat between p_south and p_north
    and d.lng between p_west and p_east
    and (p_year is null or p_year = '' or p_year = 'all' or d.year = p_year)
    and (p_category is null or p_category = '' or p_category = 'all' or d.category = p_category)
  order by d.created_at desc nulls last, d.id
  limit greatest(1, least(6000, coalesce(p_limit, 3000)));
$$;

grant execute on function public.development_map_points(double precision, double precision, double precision, double precision, text, text, integer) to anon, authenticated;

comment on column public.development.category is 'Text classification of the official work title; not independent physical verification.';
comment on column public.development.issue_group is 'Road-condition flag derived from the official work title (for example road_repair); null when not stated.';
comment on column public.development.amount_status is 'reported when a positive published amount exists; not_published keeps unknown amounts unknown.';
