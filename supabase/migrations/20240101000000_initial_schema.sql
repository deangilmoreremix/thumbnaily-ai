create table if not exists thumbnails (
  id uuid primary key default gen_random_uuid(),
  prompt text not null,
  image_url text not null,
  is_public boolean default true,
  created_at timestamp with time zone default now()
);

create index if not exists idx_thumbnails_is_public on thumbnails(is_public);
create index if not exists idx_thumbnails_created_at on thumbnails(created_at desc);