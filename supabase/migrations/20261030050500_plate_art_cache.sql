-- rendered stack artwork, cached so a seed is drawn once and then just downloaded
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('plate-art', 'plate-art', true, 2097152, array['image/webp']);

-- one row per complete set of plates, written after all its images are up.
-- The public only reads: writes go through the plate-art Edge Function.
create table public.plate_art_sets (
  key text primary key check (char_length(key) <= 200),
  engine_rev text not null,
  engine text not null,
  seed integer not null,
  layers integer not null,
  plates integer not null check (plates between 1 and 64),
  width integer not null,
  height integer not null,
  created_at timestamptz not null default now()
);
alter table public.plate_art_sets enable row level security;

create policy "plate art sets: anyone can read"
  on public.plate_art_sets for select to anon, authenticated using (true);
