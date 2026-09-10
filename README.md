# Prato Cheio

Sistema de gestão para a **Associação Prato Cheio** — cadastro de famílias,
controle de estoque (com alerta de validade/FEFO), registro de entregas de
cestas por ciclo (com trava de duplicidade) e relatórios consolidados para
prestação de contas.

Construído como **PWA offline-first**, sem etapa de build, seguindo os
princípios do projeto: **simples, leve e seguro**. Funciona 100% sem
internet e sincroniza sozinho com o [Supabase](https://supabase.com) quando
há sinal — a rede nunca é pré-requisito para operar.

> Documentos de referência do projeto: `prato-cheio-spec.md` (requisitos) e
> `prato-cheio-guia-tecnico.md` (arquitetura), usados como especificação
> para esta implementação.

## Como os dados são protegidos (LGPD)

- **Administrador**: acesso completo (CPF, renda, dependentes, foto).
  Esses campos ficam **criptografados no dispositivo** (Web Crypto API,
  AES-GCM-256 derivado por PBKDF2 de um **PIN de dispositivo** que só existe
  na memória durante a sessão).
- **Estoquista** e **Voluntário**: só recebem `nome` + `status no ciclo`.
  O filtro acontece **no servidor** (Row Level Security + uma *view*
  mascarada, `familias_operacional`) — o campo sensível nunca trafega para
  o dispositivo desses papéis, nem mesmo em cache. Ver `supabase/schema.sql`.
- **Exclusão de dados** (direito do titular): função
  `excluir_dados_familia` no banco, acionada pela tela de Famílias.
- **Relatórios de prestação de contas**: exportação em CSV **agregada**
  (só contagens), sem CPF/renda individuais.

## Stack

Vanilla JS + HTML + CSS (sem framework, sem build). Duas dependências,
vendorizadas em `vendor/` (sem precisar de internet para funcionar):

- [Dexie.js](https://dexie.org/) — camada sobre IndexedDB (banco local).
- [`@supabase/supabase-js`](https://supabase.com/docs/reference/javascript) —
  cliente do backend (Postgres + Auth + RLS), plano gratuito.

## Estrutura

```
index.html            Shell do app (login + navegação + telas)
manifest.json          Configuração do PWA
service-worker.js       Cache offline do "app shell"
css/estilo.css          Fontes/botões grandes, alto contraste, responsivo
js/
  util.js               Helpers (escape HTML, datas, CSV, uuid)
  config.js             URL/chave do Supabase (preencher antes de usar)
  db-local.js            Camada IndexedDB (Dexie) + fila de sincronização
  cripto.js              Criptografia local (PIN do dispositivo, admin)
  auth.js                Login (online e offline) e papéis
  sync.js                 Sincronização filtrada por papel
  familias.js            Cadastro de famílias (admin)
  estoque.js             Estoque + alerta FEFO
  entregas.js            Ciclos + registro de entrega + trava de duplicidade
  relatorios.js          Consolidado por período + exportação CSV
  app.js                  Roteamento e orquestração
vendor/                 Dexie e supabase-js (arquivos estáticos, sem CDN)
icons/                  Ícones do PWA
supabase/schema.sql     Tabelas, views restritas, políticas RLS
```

## Configuração (Supabase — plano gratuito)

1. Crie um projeto em [supabase.com](https://supabase.com).
2. No **SQL Editor**, execute o conteúdo de `supabase/schema.sql` (cria
   tabelas, a view mascarada `familias_operacional`, e ativa RLS com uma
   política por papel).
3. Em **Authentication → Users**, crie o primeiro usuário (e-mail/senha) —
   esse será o Administrador.
4. No **SQL Editor**, associe o papel a esse usuário:
   ```sql
   insert into public.usuarios (id, nome, papel)
   values ('<uuid-do-usuario-criado>', 'Nome do Admin', 'admin');
   ```
   Repita para Estoquista (`papel = 'estoquista'`) e Voluntários
   (`papel = 'voluntario'`), sempre a partir de um usuário criado em
   Authentication → Users.
5. Em **Project Settings → API**, copie a **Project URL** e a chave
   **anon/public**, e preencha `js/config.js`:
   ```js
   window.PRATO_CHEIO_CONFIG = {
     SUPABASE_URL: "https://SEU-PROJETO.supabase.co",
     SUPABASE_ANON_KEY: "SUA-CHAVE-ANON",
   };
   ```
   A chave anon é pública por natureza — quem protege os dados é a RLS no
   banco, não o sigilo dessa chave.

Sem essa configuração, o app funciona normalmente de forma **100% local**
(cadastro, estoque, entregas) — só a sincronização entre dispositivos fica
desativada.

## Rodando localmente

Não há build. Sirva a pasta com qualquer servidor estático (é preciso um
servidor — `file://` direto não permite Service Worker/IndexedDB em alguns
navegadores):

```bash
python3 -m http.server 8080
# ou: npx serve .
```

Abra `http://localhost:8080`. Para instalar como PWA, use a opção
"Instalar app" do navegador (Chrome/Edge no PC, "Adicionar à tela inicial"
no Android).

## Publicando (grátis)

Qualquer hospedagem de arquivos estáticos com HTTPS funciona: GitHub Pages,
Netlify ou Cloudflare Pages. Basta publicar a raiz deste repositório —
não há passo de build.

## Simplificações conscientes do MVP (ver spec, seção 3.2)

- Foto de família: campo opcional (link), sem upload de arquivo.
- Exportação: CSV (Excel abre normalmente); PDF fica para a Fase 2.
- Sem gráficos no MVP — números-chave e tabelas.
- **Login offline**: após o primeiro login online bem-sucedido, o app
  guarda um hash da senha neste dispositivo (nunca a senha em texto puro)
  para permitir novo login sem rede depois. É uma simplificação deliberada
  para atender à sede sem Wi-Fi — trocar a senha exige um login online para
  atualizar esse hash local.

## Checklist de segurança / LGPD

- [x] RLS ativada em todas as tabelas (`supabase/schema.sql`).
- [x] Voluntário/Estoquista só leem a view restrita (nome + status).
- [x] Dispositivo de voluntário/estoquista nunca recebe CPF/renda/foto/dependentes.
- [x] Dado sensível cacheado pelo Administrador fica criptografado (AES-GCM).
- [x] Função de exclusão de dados da família (direito do titular).
- [x] Consentimento registrado no cadastro, com data e finalidade.
- [x] Relatório de prestação de contas em versão agregada/anonimizada.
- [x] App abre e opera sem internet; sincroniza sozinho ao voltar o sinal.
- [ ] HTTPS — garantido pela hospedagem escolhida (GitHub Pages/Netlify/Cloudflare Pages) e pelo Supabase; não há nada a configurar no código.
