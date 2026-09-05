-- ===========================================================================
-- 2PLAY — initial schema (Supabase / PostgreSQL)
-- Applied by: npm run db:migrate  (uses SUPABASE_DB_URL)
-- Safe to run more than once (idempotent: IF NOT EXISTS everywhere).
-- ===========================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  session_token text not null unique,
  nickname      text not null check (char_length(btrim(nickname)) between 3 and 20),
  avatar        text not null default '🦊',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_users_session_token on users (session_token);
create index if not exists idx_users_created_at on users (created_at desc);

-- ---------------------------------------------------------------------------
-- game_history
-- ---------------------------------------------------------------------------
create table if not exists game_history (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid references users (id) on delete cascade,
  game_id          text not null,
  room_id          text not null,
  players_json     jsonb not null default '[]'::jsonb,
  winner_id        text,
  result           text not null check (result in ('win', 'loss', 'draw')),
  score            integer not null default 0,
  duration_seconds integer not null default 0,
  played_at        timestamptz not null default now()
);

create index if not exists idx_game_history_user_id on game_history (user_id, played_at desc);
create index if not exists idx_game_history_game_id on game_history (game_id, played_at desc);
create index if not exists idx_game_history_room_id on game_history (room_id);

-- ---------------------------------------------------------------------------
-- statistics (one row per user + game)
-- ---------------------------------------------------------------------------
create table if not exists statistics (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users (id) on delete cascade,
  game_id      text not null,
  wins         integer not null default 0 check (wins >= 0),
  losses       integer not null default 0 check (losses >= 0),
  draws        integer not null default 0 check (draws >= 0),
  total_played integer not null default 0 check (total_played >= 0),
  best_score   integer not null default 0,
  updated_at   timestamptz not null default now(),
  constraint statistics_user_game_unique unique (user_id, game_id)
);

create index if not exists idx_statistics_user_id on statistics (user_id);
create index if not exists idx_statistics_game_id on statistics (game_id);

-- ---------------------------------------------------------------------------
-- favorites (one row per user + game)
-- ---------------------------------------------------------------------------
create table if not exists favorites (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users (id) on delete cascade,
  game_id    text not null,
  created_at timestamptz not null default now(),
  constraint favorites_user_game_unique unique (user_id, game_id)
);

create index if not exists idx_favorites_user_id on favorites (user_id);
create index if not exists idx_favorites_game_id on favorites (game_id);

-- ---------------------------------------------------------------------------
-- migration bookkeeping
-- ---------------------------------------------------------------------------
create table if not exists schema_migrations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  applied_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_users_updated_at on users;
create trigger trg_users_updated_at before update on users
  for each row execute function set_updated_at();

drop trigger if exists trg_statistics_updated_at on statistics;
create trigger trg_statistics_updated_at before update on statistics
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security:
-- The browser never talks to Postgres directly (all access goes through the
-- Node server using the service-role key), so no public policies are created.
-- RLS is enabled and locked down; the service role bypasses it by design.
-- ---------------------------------------------------------------------------
alter table users          enable row level security;
alter table game_history   enable row level security;
alter table statistics     enable row level security;
alter table favorites      enable row level security;
alter table schema_migrations enable row level security;
