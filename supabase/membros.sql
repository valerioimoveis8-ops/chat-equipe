-- =====================================================================
-- Cadastro dos membros do chat
-- ANTES: crie um login para cada um em Supabase → Authentication → Users →
-- "Add user" → "Create new user" (e-mail + senha, marque "Auto Confirm User").
-- DEPOIS: troque os e-mails abaixo pelos verdadeiros e rode no SQL Editor.
-- Quem não tiver login (só resposta automática) pode ficar com o e-mail como está:
-- o membro é criado do mesmo jeito, sem login.
-- =====================================================================

with lista (email, nome, tipo, cor, descricao, auto, instrucoes) as (values
  ('EMAIL_DO_DONO@exemplo.com',   'SEU NOME',     'pessoa', '#F5B700', 'Dono do Sistema Abelha', false, null),
  ('EMAIL_ROBERTINHA_1@exemplo.com', 'Robertinha 1', 'ia', '#FB923C', 'Cadastro de tabelas', true,
    'Você é a Robertinha 1, uma das IAs que cadastram tabelas de imóveis no Sistema Abelha. Responda curto, em português, e só afirme o que viu nas mensagens ou nos anexos.'),
  ('EMAIL_ROBERTINHA_2@exemplo.com', 'Robertinha 2', 'ia', '#F472B6', 'Cadastro de tabelas', true,
    'Você é a Robertinha 2, uma das IAs que cadastram tabelas de imóveis no Sistema Abelha. Responda curto, em português, e só afirme o que viu nas mensagens ou nos anexos.'),
  ('EMAIL_ZE_1@exemplo.com',      'Zé 1',         'ia', '#60A5FA', 'Cadastro de tabelas', true,
    'Você é o Zé 1, uma das IAs que cadastram tabelas de imóveis no Sistema Abelha. Responda curto, em português, e só afirme o que viu nas mensagens ou nos anexos.'),
  ('EMAIL_ZE_2@exemplo.com',      'Zé 2',         'ia', '#34D399', 'Cadastro de tabelas', true,
    'Você é o Zé 2, uma das IAs que cadastram tabelas de imóveis no Sistema Abelha. Responda curto, em português, e só afirme o que viu nas mensagens ou nos anexos.'),
  ('EMAIL_CLAUDIO_1@exemplo.com', 'Cláudio 1',    'ia', '#A78BFA', 'Cadastro de tabelas', true,
    'Você é o Cláudio 1 (a Cláudia), uma das IAs que cadastram tabelas de imóveis no Sistema Abelha. Responda curto, em português, e só afirme o que viu nas mensagens ou nos anexos.'),
  ('EMAIL_CLAUDIO_2@exemplo.com', 'Cláudio 2',    'ia', '#FBBF24', 'Cadastro de tabelas', true,
    'Você é o Cláudio 2, uma das IAs que cadastram tabelas de imóveis no Sistema Abelha. Responda curto, em português, e só afirme o que viu nas mensagens ou nos anexos.')
)
insert into public.membros (user_id, nome, tipo, cor, descricao, auto, instrucoes)
select u.id, l.nome, l.tipo, l.cor, l.descricao, l.auto, l.instrucoes
from lista l left join auth.users u on lower(u.email) = lower(l.email)
on conflict (nome) do update set
  user_id = coalesce(excluded.user_id, public.membros.user_id),
  tipo = excluded.tipo, cor = excluded.cor, descricao = excluded.descricao,
  auto = excluded.auto, instrucoes = excluded.instrucoes;

-- Para conferir: select nome, tipo, auto, user_id is not null as tem_login from public.membros order by nome;
-- Para desligar a resposta automática de alguém: update public.membros set auto = false where nome = 'Cláudio 2';
