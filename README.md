# Cantinho da Tacada 🎱

Site de placar e torneios de sinuca: sorteio de duelos, placar ao vivo, ranking, confronto 1x1, histórico, Hall da Fama e Melhores do Mês.

**100% open source e sem custo:** HTML + CSS + JavaScript puro (sem build), hospedagem grátis (GitHub Pages, Cloudflare Pages ou Vercel) e, opcionalmente, banco Supabase (open source, plano gratuito).

## Funcionalidades

| Tela | O que faz |
|---|---|
| **Início** | Destaque do torneio ao vivo, números do clube, pódio de campeões, últimos torneios |
| **Sorteio** | Cria torneio (nome, data, vidas), adiciona jogadores (autocompletar + frequentes), sorteia duelos com animação, lança vencedores com um toque, controla vidas/eliminação, bye automático, desfazer, desistência, incluir atrasado, refazer sorteio |
| **Ranking** | Tabela ordenável: títulos, vices, invictos, torneios, vitórias, derrotas, % e pontos |
| **1x1** | Placar direto entre dois jogadores + comparativo geral + lista de duelos |
| **Histórico** | Todos os torneios com as rodadas; busca por nome; exclusão (admin) |
| **Hall da Fama** | Ranking de campeões (títulos → invictos → vices) |
| **Melhores do Mês** | Power ranking mensal + destaques (rei do mês, mais vitórias, melhor %, etc.) |
| **⚙ Configurações** | Login do admin, backup/importação JSON, renomear/mesclar jogador |

### Regra do torneio (mesma lógica do Serra Pool)
Cada jogador começa com **3 vidas** (configurável). A cada rodada os vivos são sorteados em duelos; com número ímpar, quem teve menos byes descansa. O sorteio evita repetir o confronto da rodada anterior. Perdeu todas as vidas, está fora. O último vivo é o **campeão**, o último eliminado é o **vice**; campeão sem derrotas é **invicto**.

## Uso rápido (modo local)
Abra `index.html` no navegador (duplo clique) — pronto. Os dados ficam salvos **só nesse navegador**; use ⚙ → *Exportar JSON* para backup.

## Publicar grátis (GitHub Pages)
1. Crie um repositório no GitHub e envie todos os arquivos desta pasta.
2. *Settings → Pages → Source: Deploy from a branch → main / root → Save*.
3. Em ~1 min o site estará em `https://SEU-USUARIO.github.io/NOME-DO-REPO/`.

(Alternativas: Cloudflare Pages ou Vercel — basta importar o repositório, sem configuração de build.)

## Placar online compartilhado (Supabase, opcional)
Para que todos vejam o mesmo placar em qualquer celular, **ao vivo**:

1. Crie uma conta grátis em https://supabase.com e um novo projeto.
2. Abra **SQL Editor**, cole o conteúdo de `schema.sql` e clique em **Run**.
3. Em **Authentication → Users → Add user**, crie o usuário administrador (e-mail + senha, marque *Auto Confirm*).
4. Em **Project Settings → API**, copie a *Project URL* e a chave *anon public* e cole em `config.js`:
   ```js
   supabaseUrl: 'https://xxxx.supabase.co',
   supabaseAnonKey: 'eyJ...',
   ```
5. Publique de novo. Visitantes só **leem**; para criar torneios e lançar resultados, entre em ⚙ com o usuário admin.

> A chave *anon* pode ficar pública: a segurança é garantida pelas políticas RLS do `schema.sql` (leitura pública, escrita só para usuário logado).

Migrando do modo local: exporte o JSON antes, configure o Supabase, entre como admin e importe o arquivo em ⚙.

## Personalizar
Tudo em `config.js`: nome do clube, frase, vidas padrão, WhatsApp/Instagram do rodapé e a pontuação do ranking e do mês. Cores em `style.css` (variáveis no topo).

## Estrutura
```
index.html   página única (rotas por #/...)
style.css    visual (tema escuro "feltro")
config.js    configurações
engine.js    regras do torneio e estatísticas (funções puras)
store.js     armazenamento local ou Supabase
app.js       telas e navegação
schema.sql   tabelas do Supabase + segurança + realtime
```

Licença sugerida: MIT.
