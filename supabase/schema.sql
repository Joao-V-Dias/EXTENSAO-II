-- ============================================================================
-- Prato Cheio — schema Supabase (PostgreSQL)
-- ============================================================================
-- Este script cria as tabelas, views restritas e políticas de Row Level
-- Security (RLS) que implementam o controle de acesso por papel exigido
-- pela LGPD (ver prato-cheio-spec.md, seção 6).
--
-- Princípio central: a filtragem de dados sensíveis acontece AQUI, no banco,
-- nunca só na interface. Um voluntário jamais recebe CPF, renda, foto ou
-- número de dependentes — nem em resposta de API, nem em cache local.
--
-- Execute este script inteiro no SQL Editor do Supabase (ou via CLI/MCP).
-- Idempotente: pode ser rodado novamente sem duplicar objetos.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tabela de usuários (perfis) — espelha auth.users com o papel de cada um
-- ----------------------------------------------------------------------------
create table if not exists public.usuarios (
  id uuid primary key references auth.users (id) on delete cascade,
  nome text not null,
  papel text not null check (papel in ('admin', 'estoquista', 'voluntario')),
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

comment on table public.usuarios is 'Perfil e papel de cada usuário autenticado (admin | estoquista | voluntario).';

-- Função auxiliar (security definer) para ler o papel do usuário logado sem
-- disparar recursão de RLS na própria tabela usuarios.
create or replace function public.papel_atual()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select papel from public.usuarios where id = auth.uid() and ativo = true;
$$;

comment on function public.papel_atual() is 'Retorna o papel (admin/estoquista/voluntario) do usuário autenticado. security definer evita recursão de RLS.';

-- ----------------------------------------------------------------------------
-- 2. Famílias — tabela completa (dado sensível). Só o Administrador acessa.
-- ----------------------------------------------------------------------------
create table if not exists public.familias (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  cpf text,
  renda numeric(12,2),
  numero_dependentes integer default 0,
  foto_url text,
  consentimento boolean not null default false,
  consentimento_data timestamptz,
  consentimento_finalidade text,
  ativa boolean not null default true,
  data_cadastro timestamptz not null default now()
);

comment on table public.familias is 'Cadastro completo de famílias. Contém dados pessoais sensíveis (CPF, renda, foto, dependentes) — acesso restrito ao Administrador via RLS.';

-- View operacional: apenas o mínimo necessário para operar entregas
-- (nome + id). NÃO expõe CPF, renda, foto ou dependentes.
--
-- IMPORTANTE: esta view é criada SEM `security_invoker`, ou seja, roda com
-- os privilégios do dono da view (o papel que executa esta migração,
-- normalmente bypassa RLS). Isso é proposital: é o mecanismo de MASCARAMENTO
-- DE COLUNAS. A tabela public.familias só tem política de RLS para 'admin'
-- (seção 8), então um voluntário jamais lê a tabela base diretamente — mas
-- pode ler esta view, que fisicamente não contém as colunas sensíveis. Não
-- há forma de "escapar" para ver CPF/renda através dela, porque a coluna
-- não existe no resultado.
create or replace view public.familias_operacional as
select id, nome, ativa
from public.familias
where ativa = true;

comment on view public.familias_operacional is 'View sem dados sensíveis (id, nome, ativa), para Voluntário/Estoquista. Roda com privilégio do dono para aplicar o mascaramento de colunas mesmo com RLS restrita a admin na tabela base.';

-- ----------------------------------------------------------------------------
-- 3. Ciclos de distribuição
-- ----------------------------------------------------------------------------
create table if not exists public.ciclos_distribuicao (
  id uuid primary key default gen_random_uuid(),
  descricao text not null,
  data_inicio date not null,
  data_fim date,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

comment on table public.ciclos_distribuicao is 'Períodos de distribuição de cestas (semanal/quinzenal/mensal, a definir com a ONG).';

-- ----------------------------------------------------------------------------
-- 4. Estoque
-- ----------------------------------------------------------------------------
create table if not exists public.itens_estoque (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  categoria text,
  quantidade numeric(12,2) not null default 0,
  unidade text not null default 'un',
  data_entrada date not null default current_date,
  data_validade date,
  atualizado_em timestamptz not null default now()
);

comment on table public.itens_estoque is 'Itens de estoque com data de validade, usados para alerta FEFO. Dado operacional, sem informação sensível de famílias.';

-- ----------------------------------------------------------------------------
-- 5. Entregas — vincula família + ciclo, sem duplicidade
-- ----------------------------------------------------------------------------
create table if not exists public.entregas (
  id uuid primary key default gen_random_uuid(),
  familia_id uuid not null references public.familias (id) on delete restrict,
  ciclo_id uuid not null references public.ciclos_distribuicao (id) on delete restrict,
  data_entrega timestamptz not null default now(),
  voluntario_id uuid references public.usuarios (id),
  itens jsonb not null default '[]'::jsonb,
  confirmado_duplicidade boolean not null default false,
  criado_em timestamptz not null default now()
);

comment on table public.entregas is 'Registro de entrega de cesta por família/ciclo.';

-- Trava de duplicidade no servidor: só pode existir UMA entrega
-- não-confirmada por família/ciclo. O app avisa e exige confirmação
-- explícita (confirmado_duplicidade = true) antes de tentar uma segunda
-- entrega para a mesma família no mesmo ciclo — essa segunda linha não
-- colide com o índice porque fica fora do filtro `where`.
create unique index if not exists entregas_uma_por_ciclo_sem_confirmacao
  on public.entregas (familia_id, ciclo_id)
  where confirmado_duplicidade = false;

-- View operacional de entregas (não expõe nada sensível — já são só ids/datas)
create or replace view public.entregas_operacional
with (security_invoker = true) as
select id, familia_id, ciclo_id, data_entrega, voluntario_id
from public.entregas;

-- ----------------------------------------------------------------------------
-- 6. Habilitar Row Level Security em TODAS as tabelas
-- ----------------------------------------------------------------------------
alter table public.usuarios enable row level security;
alter table public.familias enable row level security;
alter table public.ciclos_distribuicao enable row level security;
alter table public.itens_estoque enable row level security;
alter table public.entregas enable row level security;

-- ----------------------------------------------------------------------------
-- 7. Políticas — usuarios
-- ----------------------------------------------------------------------------
drop policy if exists usuarios_select_proprio_ou_admin on public.usuarios;
create policy usuarios_select_proprio_ou_admin on public.usuarios
  for select using (id = auth.uid() or public.papel_atual() = 'admin');

drop policy if exists usuarios_admin_all on public.usuarios;
create policy usuarios_admin_all on public.usuarios
  for all using (public.papel_atual() = 'admin')
  with check (public.papel_atual() = 'admin');

-- ----------------------------------------------------------------------------
-- 8. Políticas — familias (tabela completa: só Administrador)
-- ----------------------------------------------------------------------------
drop policy if exists familias_admin_all on public.familias;
create policy familias_admin_all on public.familias
  for all using (public.papel_atual() = 'admin')
  with check (public.papel_atual() = 'admin');

-- Nenhuma outra política é criada para familias: sem política de select
-- para estoquista/voluntario, o RLS nega (retorna zero linhas) qualquer
-- tentativa desses papéis de ler a tabela base diretamente — mesmo que o
-- client tente. O único caminho de leitura para eles é a view
-- familias_operacional (seção 2), que fisicamente não tem as colunas
-- sensíveis. Isso é reforçado por dois GRANTs distintos: acesso amplo à
-- tabela base (filtrado por RLS a admin-only) e acesso à view mascarada.
grant select, insert, update, delete on public.familias to authenticated;
grant select on public.familias_operacional to authenticated;
grant select on public.entregas_operacional to authenticated;

-- ----------------------------------------------------------------------------
-- 9. Políticas — ciclos_distribuicao (leitura geral, escrita só admin)
-- ----------------------------------------------------------------------------
drop policy if exists ciclos_select_todos on public.ciclos_distribuicao;
create policy ciclos_select_todos on public.ciclos_distribuicao
  for select using (public.papel_atual() in ('admin', 'estoquista', 'voluntario'));

drop policy if exists ciclos_admin_escreve on public.ciclos_distribuicao;
create policy ciclos_admin_escreve on public.ciclos_distribuicao
  for insert with check (public.papel_atual() = 'admin');

drop policy if exists ciclos_admin_atualiza on public.ciclos_distribuicao;
create policy ciclos_admin_atualiza on public.ciclos_distribuicao
  for update using (public.papel_atual() = 'admin');

drop policy if exists ciclos_admin_deleta on public.ciclos_distribuicao;
create policy ciclos_admin_deleta on public.ciclos_distribuicao
  for delete using (public.papel_atual() = 'admin');

-- ----------------------------------------------------------------------------
-- 10. Políticas — itens_estoque (admin + estoquista)
-- ----------------------------------------------------------------------------
drop policy if exists estoque_admin_estoquista_all on public.itens_estoque;
create policy estoque_admin_estoquista_all on public.itens_estoque
  for all using (public.papel_atual() in ('admin', 'estoquista'))
  with check (public.papel_atual() in ('admin', 'estoquista'));

-- ----------------------------------------------------------------------------
-- 11. Políticas — entregas
-- ----------------------------------------------------------------------------
-- Todos os papéis autenticados podem ler entregas (só ids/datas, sem dado
-- sensível de família) para saber quem já foi atendido no ciclo.
drop policy if exists entregas_select_todos on public.entregas;
create policy entregas_select_todos on public.entregas
  for select using (public.papel_atual() in ('admin', 'estoquista', 'voluntario'));

-- Voluntário, estoquista e admin podem registrar entregas.
drop policy if exists entregas_insert_todos on public.entregas;
create policy entregas_insert_todos on public.entregas
  for insert with check (public.papel_atual() in ('admin', 'estoquista', 'voluntario'));

-- Só admin/estoquista podem corrigir ou remover um registro de entrega.
drop policy if exists entregas_update_admin_estoquista on public.entregas;
create policy entregas_update_admin_estoquista on public.entregas
  for update using (public.papel_atual() in ('admin', 'estoquista'));

drop policy if exists entregas_delete_admin on public.entregas;
create policy entregas_delete_admin on public.entregas
  for delete using (public.papel_atual() = 'admin');

-- ----------------------------------------------------------------------------
-- 12. Direito do titular (LGPD) — função para excluir todos os dados de uma
--     família (cadastro + histórico de entregas), disponível só ao admin
--     (a própria chamada RPC roda como o usuário autenticado; a RLS acima
--     garante que só admin efetivamente apaga linhas de public.familias).
-- ----------------------------------------------------------------------------
create or replace function public.excluir_dados_familia(p_familia_id uuid)
returns void
language plpgsql
security invoker
as $$
begin
  if public.papel_atual() <> 'admin' then
    raise exception 'apenas administrador pode excluir dados de família';
  end if;
  delete from public.entregas where familia_id = p_familia_id;
  delete from public.familias where id = p_familia_id;
end;
$$;

comment on function public.excluir_dados_familia(uuid) is 'Atende ao direito de exclusão do titular (LGPD art. 18). Remove cadastro e histórico de entregas da família.';

-- ----------------------------------------------------------------------------
-- 13. Relatório agregado/anonimizado para prestação de contas
--     (usa apenas contagens — nunca CPF/renda individuais).
-- ----------------------------------------------------------------------------
create or replace view public.relatorio_periodo_agregado
with (security_invoker = true) as
select
  c.id as ciclo_id,
  c.descricao as ciclo_descricao,
  c.data_inicio,
  c.data_fim,
  count(e.id) as total_entregas,
  count(distinct e.familia_id) as total_familias_atendidas
from public.ciclos_distribuicao c
left join public.entregas e on e.ciclo_id = c.id
group by c.id, c.descricao, c.data_inicio, c.data_fim;

grant select on public.relatorio_periodo_agregado to authenticated;

comment on view public.relatorio_periodo_agregado is 'Relatório agregado por ciclo, sem CPF/renda individuais — para prestação de contas e editais.';

-- ============================================================================
-- Fim do schema. Após rodar, cadastre o primeiro usuário admin:
--   1. Crie o usuário em Authentication > Users (ou supabase.auth.signUp).
--   2. Insira a linha correspondente em public.usuarios com papel = 'admin':
--      insert into public.usuarios (id, nome, papel)
--      values ('<uuid-do-auth-user>', 'Nome do Admin', 'admin');
-- ============================================================================
