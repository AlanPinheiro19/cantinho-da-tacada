-- ============================================================
--  Cantinho da Tacada — esquema do banco (Supabase / PostgreSQL)
--  Cole tudo no "SQL Editor" do Supabase e clique em "Run".
-- ============================================================

-- Torneios finalizados (histórico). Todas as estatísticas são
-- calculadas a partir daqui (ranking, hall da fama, 1x1, mês).
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

-- Segurança: qualquer um pode LER; só usuários logados podem ESCREVER.
alter table public.tournaments        enable row level security;
alter table public.current_tournament enable row level security;

drop policy if exists "leitura publica"  on public.tournaments;
drop policy if exists "escrita admin"    on public.tournaments;
drop policy if exists "leitura publica"  on public.current_tournament;
drop policy if exists "escrita admin"    on public.current_tournament;

create policy "leitura publica" on public.tournaments
  for select to anon, authenticated using (true);
create policy "escrita admin" on public.tournaments
  for all to authenticated using (true) with check (true);

create policy "leitura publica" on public.current_tournament
  for select to anon, authenticated using (true);
create policy "escrita admin" on public.current_tournament
  for all to authenticated using (true) with check (true);

-- Placar ao vivo: quem estiver com o site aberto vê o torneio atualizar sozinho.
do $$ begin
  alter publication supabase_realtime add table public.current_tournament;
exception when duplicate_object then null; end $$;
