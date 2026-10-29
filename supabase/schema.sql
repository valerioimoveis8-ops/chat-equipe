-- =====================================================================
-- Chat da Equipe — banco de dados no Supabase
-- Como usar: Supabase → SQL Editor → New query → cole tudo → Run.
-- Pode rodar de novo sem problema (os comandos conferem o que já existe).
-- =====================================================================

-- 1. Membros (pessoas e IAs). Quem entra pelo navegador tem user_id (login).
--    Uma IA só "automática" (API) pode não ter login: user_id fica vazio.
create table if not exists public.membros (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null,
  nome text not null unique,
  tipo text not null check (tipo in ('pessoa', 'ia')),
  cor text not null default '#F5B700',
  descricao text,
  -- true = responde sozinha pela API quando alguém escreve @Nome
  auto boolean not null default false,
  -- instruções da IA quando responde pela API (quem ela é, o que faz, como escreve)
  instrucoes text,
  criado_em timestamptz not null default now()
);

-- 2. Salas de conversa
create table if not exists public.salas (
  id bigint generated always as identity primary key,
  nome text not null unique,
  criada_por uuid references public.membros(id) on delete set null,
  criada_em timestamptz not null default now()
);

-- 3. Mensagens (texto e/ou um anexo)
create table if not exists public.mensagens (
  id bigint generated always as identity primary key,
  sala_id bigint not null references public.salas(id) on delete cascade,
  membro_id uuid not null references public.membros(id) on delete cascade,
  texto text,
  anexo_path text,
  anexo_nome text,
  anexo_tipo text,
  anexo_tamanho bigint,
  -- 'api' quando a resposta veio da IA automática
  via text,
  criada_em timestamptz not null default now(),
  constraint mensagem_nao_vazia check (texto is not null or anexo_path is not null)
);
create index if not exists mensagens_sala_data on public.mensagens (sala_id, criada_em desc);

-- 4. Funções de apoio para as regras de segurança
create or replace function public.eh_membro() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.membros where user_id = auth.uid());
$$;
create or replace function public.meu_membro_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.membros where user_id = auth.uid() limit 1;
$$;

-- 5. Segurança: só membros leem e escrevem; cada um escreve só em seu nome.
alter table public.membros enable row level security;
alter table public.salas enable row level security;
alter table public.mensagens enable row level security;

drop policy if exists "membros veem membros" on public.membros;
create policy "membros veem membros" on public.membros for select to authenticated using (public.eh_membro());

drop policy if exists "membros veem salas" on public.salas;
create policy "membros veem salas" on public.salas for select to authenticated using (public.eh_membro());
drop policy if exists "membros criam salas" on public.salas;
create policy "membros criam salas" on public.salas for insert to authenticated
  with check (public.eh_membro() and criada_por = public.meu_membro_id());

drop policy if exists "membros veem mensagens" on public.mensagens;
create policy "membros veem mensagens" on public.mensagens for select to authenticated using (public.eh_membro());
drop policy if exists "cada um escreve em seu nome" on public.mensagens;
create policy "cada um escreve em seu nome" on public.mensagens for insert to authenticated
  with check (membro_id = public.meu_membro_id() and (via is null or via <> 'api'));

-- As instruções das IAs não aparecem para quem está no chat.
revoke select on public.membros from anon, authenticated;
grant select (id, nome, tipo, cor, descricao, auto) on public.membros to authenticated;

grant execute on function public.eh_membro() to authenticated;
grant execute on function public.meu_membro_id() to authenticated;

-- 6. Tempo real: novas mensagens aparecem na hora para todos
do $$ begin
  alter publication supabase_realtime add table public.mensagens;
exception when duplicate_object then null; end $$;

-- 7. Arquivos (imagens e documentos): pasta privada "anexos", até 25 MB por arquivo
insert into storage.buckets (id, name, public, file_size_limit)
values ('anexos', 'anexos', false, 26214400)
on conflict (id) do update set file_size_limit = excluded.file_size_limit, public = false;

drop policy if exists "membros leem anexos" on storage.objects;
create policy "membros leem anexos" on storage.objects for select to authenticated
  using (bucket_id = 'anexos' and public.eh_membro());
drop policy if exists "membros enviam anexos" on storage.objects;
create policy "membros enviam anexos" on storage.objects for insert to authenticated
  with check (bucket_id = 'anexos' and public.eh_membro());

-- 8. Sala inicial
insert into public.salas (nome) values ('Geral') on conflict (nome) do nothing;
