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
-- ============================================================
--  Marcadores: qualquer pessoa pode criar conta e LANÇAR PLACAR
--  do torneio em andamento. Criar/cancelar/excluir torneios,
--  importar e gerenciar usuários continua só com o administrador.
-- ============================================================

-- Perfis (um por conta). Criado automaticamente no cadastro.
create table if not exists public.profiles (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  name       text,
  email      text,
  blocked    boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id, name, email)
  values (new.id, coalesce(nullif(trim(new.raw_user_meta_data->>'name'), ''), split_part(new.email, '@', 1)), new.email)
  on conflict (user_id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- perfis para contas que já existiam
insert into public.profiles (user_id, name, email)
  select id, coalesce(nullif(trim(raw_user_meta_data->>'name'), ''), split_part(email, '@', 1)), email from auth.users
  on conflict (user_id) do nothing;

create or replace function public.is_scorer() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or exists (select 1 from public.profiles where user_id = auth.uid() and not blocked);
$$;

drop policy if exists "perfil proprio ou admin" on public.profiles;
drop policy if exists "admin bloqueia" on public.profiles;
create policy "perfil proprio ou admin" on public.profiles
  for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy "admin bloqueia" on public.profiles
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- Marcador pode ATUALIZAR o torneio em andamento (não criar nem apagar)
drop policy if exists "marcador lanca placar" on public.current_tournament;
create policy "marcador lanca placar" on public.current_tournament
  for update to authenticated using (public.is_scorer()) with check (public.is_scorer());

-- Marcador pode registrar no histórico SOMENTE o torneio atual já finalizado
drop policy if exists "marcador registra final" on public.tournaments;
create policy "marcador registra final" on public.tournaments
  for insert to authenticated with check (
    public.is_scorer()
    and exists (select 1 from public.current_tournament c
                where c.id = 1 and c.data->>'id' = tournaments.id::text and c.data->>'status' = 'finished'));

-- Auditoria + trava: marcador só mexe nos resultados
alter table public.current_tournament add column if not exists updated_by uuid;

create or replace function public.guard_score() returns trigger
language plpgsql security definer set search_path = public as $$
declare o jsonb := old.data; n jsonb := new.data; i int;
begin
  new.updated_by := auth.uid();
  new.updated_at := now();
  if auth.uid() is null or public.is_admin() then return new; end if;
  if o is null or n is null then
    raise exception 'Só o administrador pode criar ou encerrar torneios';
  end if;
  if (o->>'id') is distinct from (n->>'id') or (o->>'name') is distinct from (n->>'name')
     or (o->>'date') is distinct from (n->>'date') or (o->'lives') is distinct from (n->'lives')
     or (o->'ranked') is distinct from (n->'ranked') then
    raise exception 'Marcadores não podem alterar os dados do torneio';
  end if;
  if (select array_agg(x->>'name' order by x->>'name') from jsonb_array_elements(o->'participants') x)
     is distinct from
     (select array_agg(x->>'name' order by x->>'name') from jsonb_array_elements(n->'participants') x) then
    raise exception 'Marcadores não podem incluir ou remover jogadores';
  end if;
  -- rodadas anteriores à última ficam travadas
  for i in 0 .. jsonb_array_length(coalesce(o->'rounds', '[]')) - 2 loop
    if (o->'rounds'->i) is distinct from (n->'rounds'->i) then
      raise exception 'Rodadas anteriores não podem ser alteradas por marcadores';
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists guard_score on public.current_tournament;
create trigger guard_score before update on public.current_tournament
  for each row execute function public.guard_score();
