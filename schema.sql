-- ============================================================
--  Cantinho da Tacada — esquema do banco (Supabase / PostgreSQL)
--  Cole tudo no "SQL Editor" do Supabase e clique em "Run".
--
--  Regras de acesso:
--    • QUALQUER visitante pode LER (ranking, histórico, placar ao vivo).
--    • SOMENTE quem estiver na tabela "admins" pode CRIAR/ALTERAR/APAGAR.
--  Essas regras rodam no servidor (RLS): não dá para burlar pelo navegador.
-- ============================================================

-- Torneios finalizados (histórico)
create table if not exists public.tournaments (
  id         uuid primary key,
  name       text not null,
  date       date,
  data       jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists tournaments_date_idx on public.tournaments (date desc);

-- Torneio em andamento (uma única linha, id = 1)
create table if not exists public.current_tournament (
  id         int primary key default 1 check (id = 1),
  data       jsonb,
  updated_at timestamptz not null default now()
);

-- Administradores (quem pode alterar dados)
create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

alter table public.tournaments        enable row level security;
alter table public.current_tournament enable row level security;
alter table public.admins             enable row level security;

-- remove políticas antigas (versões anteriores deste arquivo)
drop policy if exists "leitura publica" on public.tournaments;
drop policy if exists "escrita admin"   on public.tournaments;
drop policy if exists "leitura publica" on public.current_tournament;
drop policy if exists "escrita admin"   on public.current_tournament;
drop policy if exists "admin ve a si mesmo" on public.admins;

-- Leitura pública
create policy "leitura publica" on public.tournaments
  for select to anon, authenticated using (true);
create policy "leitura publica" on public.current_tournament
  for select to anon, authenticated using (true);

-- Escrita somente do administrador
create policy "escrita admin" on public.tournaments
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "escrita admin" on public.current_tournament
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- A tabela de admins só pode ser lida pelo próprio admin (e não pode ser
-- alterada pelo site — só aqui no painel do Supabase).
create policy "admin ve a si mesmo" on public.admins
  for select to authenticated using (user_id = auth.uid());

-- Placar ao vivo
do $$ begin
  alter publication supabase_realtime add table public.current_tournament;
exception when duplicate_object then null; end $$;

-- ============================================================
--  CADASTRAR O ADMINISTRADOR
--  1) Crie o usuário em Authentication → Users → Add user (Auto Confirm).
--  2) Troque o e-mail abaixo pelo seu e rode só esta linha:
-- ============================================================
-- insert into public.admins (user_id)
--   select id from auth.users where email = 'SEU-EMAIL@exemplo.com'
--   on conflict do nothing;
