# Cantinho da Tacada 🎱

Site de placar e torneios de sinuca do **Cantinho da Tacada**: sorteio de duelos, placar ao vivo, ranking da temporada, confrontos 1x1, agenda, histórico, Hall da Fama e Melhores do Mês.

🌐 **Site:** https://cantinho-da-tacada.vercel.app

**100% open source e sem custo:** HTML + CSS + JavaScript puro (sem build), hospedagem grátis na Vercel (ou GitHub Pages / Cloudflare Pages) e banco **Supabase** (open source, plano gratuito).

---

## Funcionalidades

### Torneios
| Recurso | Descrição |
|---|---|
| **Sistema de vidas** | Cada jogador (ou dupla) começa com 3 vidas (configurável). Perdeu todas, está fora. O último vivo é o **campeão**; o último eliminado, o **vice**. Campeão sem derrotas = **invicto**. |
| **Sorteio sem repetir adversário** | Ninguém repete confronto enquanto houver adversário inédito entre os vivos. Só depois que **todos se enfrentaram** os duelos podem se repetir (e as repetições são espalhadas). Com número ímpar, a folga (*bye*) também roda: ninguém folga duas vezes antes de todos folgarem uma. Testado de 4 a 16 jogadores. |
| **Individual ou Duplas** | Na criação do torneio, escolha a modalidade. Em **duplas**, as duplas são formadas pela ordem dos jogadores, por sorteio (🎲) ou trocando nomes com um toque. Cada dupla joga como um participante. |
| **Vale para o Ranking** | Cada torneio pode ser marcado como **válido para o ranking da temporada** ou **amistoso** (fica no histórico, mas não soma pontos). Pode ser alterado depois, no histórico. |
| **Gato 🐱 e Suicídio 💀** | Marcações em cada duelo. Gato conta para quem venceu (e como "sofrido" para quem perdeu); suicídio conta para quem perdeu. Aparecem nas estatísticas. |
| **Placar ao vivo** | Quem estiver com o site aberto vê os resultados atualizarem sozinhos. |
| **Controles do torneio** | Desfazer, refazer sorteio da rodada, incluir jogador atrasado, desistência, cancelar. |

### Agenda
- O administrador **agenda torneios** (data, hora, local, vidas, modalidade, ranking e jogadores confirmados).
- Um torneio agendado **só pode começar na data e hora marcadas**. O botão ▶ Iniciar fica bloqueado com contagem regressiva, e a regra também é conferida pelo servidor.
- Torneios com data futura não começam "ao vivo": vão para a agenda.
- Página **Agenda** no menu e destaque **"Próximo torneio"** na página inicial.

### Estatísticas e relatórios
| Página | O que mostra |
|---|---|
| **Ranking** | Títulos, vices, invictos, torneios, vitórias, derrotas, % de vitória, 🐱 gatos, 💀 suicídios e pontos. Por padrão: **Ranking da Temporada** (ano atual, só torneios válidos). |
| **1x1** | Placar direto entre dois jogadores, comparativo geral (inclui gatos e suicídios) e lista de duelos. |
| **Confrontos do grupo** | Selecione vários jogadores e veja o **consolidado só das partidas entre eles** e uma tabela de cruzamento jogador × jogador. |
| **Histórico** | Todos os torneios com as rodadas, busca por nome e etiquetas (🏆 Ranking, 🤝 Amistoso, 👥 Duplas, Invicto). |
| **Hall da Fama** | Ranking de campeões. |
| **Melhores do Mês** | Power ranking mensal e destaques: rei do mês, mais títulos, mais vitórias, melhor aproveitamento, mais presente, mais vices, rei do gato e mais suicídios. |

**Filtros** em todas as páginas de estatística: 🏆 válidos para o ranking / 🤝 amistosos / todos, **temporada** (ano) e **modalidade** (individual ou duplas; as duplas não se misturam ao ranking individual).

### Acesso e segurança
| Perfil | Pode fazer |
|---|---|
| **Visitante** (sem login) | Ver tudo: placar ao vivo, agenda, ranking, histórico e estatísticas. |
| **Marcador** (qualquer pessoa que criar conta em *Entrar → Criar conta*) | Lançar o placar do torneio em andamento: marcar vencedores, gato/suicídio, confirmar rodada e sortear a próxima. |
| **Administrador** | Tudo: criar/agendar/cancelar/excluir torneios, incluir jogadores, marcar ranking, importar/exportar, renomear jogadores e **bloquear marcadores**. |

As regras são aplicadas **no banco de dados** (Row Level Security + gatilhos do Supabase), e não só na tela: marcadores não conseguem renomear torneios, incluir jogadores, alterar rodadas anteriores, apagar o histórico nem virar administrador.

### Visual
Tema "salão de sinuca" (verde garrafa, feltro, madeira e latão), fotos de mesa e bolas, posições como bolas numeradas, cada jogador com sua "bola" de iniciais, duelos exibidos sobre uma mesa com caçapas. Responsivo para celular.

---

## Configuração (Supabase)

1. Crie uma conta grátis em https://supabase.com e um novo projeto.
2. **SQL Editor** → cole todo o `schema.sql` → **Run**. Ele cria as tabelas (`tournaments`, `current_tournament`, `scheduled_tournaments`, `admins`, `profiles`), as regras de acesso e o placar ao vivo.
3. **Authentication → Users → Add user → Create new user**: e-mail + senha forte do administrador, marque *Auto Confirm User*.
4. No **SQL Editor**, cadastre o administrador (com o seu e-mail):
   ```sql
   insert into public.admins (user_id)
     select id from auth.users where email = 'seu-email@exemplo.com'
     on conflict do nothing;
   ```
5. **Authentication → Sign In / Providers**:
   - **Allow new users to sign up**: ligado, para que marcadores possam criar conta (ou desligado, se só o administrador deve lançar placar).
   - **Confirm email**: desligado, para liberar o marcador na hora (o envio de e-mails do plano gratuito é limitado).
6. **Project Settings → API Keys**: copie a *Project URL* e a chave **publishable** (ou *anon*) para o `config.js`:
   ```js
   supabaseUrl: 'https://xxxx.supabase.co',
   supabaseAnonKey: 'sb_publishable_...',
   ```
7. Envie o `config.js` ao GitHub. No site, entre em **Entrar** com o e-mail e a senha do administrador.

> A chave *publishable/anon* pode ficar pública: sozinha, ela só permite **ler**. Lançar placar exige conta de marcador não bloqueada; o resto exige estar na tabela `admins`.

⚠️ Se você apagar e recriar o usuário administrador no Supabase, rode o passo 4 de novo (o cadastro de admin é removido junto com o usuário).

**Sem Supabase** (campos vazios no `config.js`), o site funciona em **modo local**: tudo fica salvo só no navegador. Use ⚙ → Exportar JSON para backup.

## Publicação (Vercel, grátis)
1. Em https://vercel.com, entre com o GitHub e clique em **Add New → Project → Import** neste repositório.
2. **Framework Preset: Other**, sem comando de build → **Deploy**.
3. A cada envio ao GitHub, a Vercel publica sozinha em ~1 minuto. Depois de publicar, recarregue o site com **Ctrl+Shift+R**.

(Com o repositório **privado**, a Vercel continua funcionando; o GitHub Pages gratuito exige repositório público.)

## Personalizar
Tudo em `config.js`:
- nome do clube, frase e vidas padrão;
- fotos das páginas (`images`) e créditos;
- WhatsApp/Instagram e dados do desenvolvedor no rodapé;
- pontuação do ranking e do Melhores do Mês.

Cores e visual em `style.css` (variáveis no topo).

## Estrutura
```
index.html   página única (rotas por #/...)
style.css    visual (tema salão de sinuca)
config.js    configurações do clube, Supabase, fotos, pontuação, rodapé
engine.js    regras do torneio, sorteio sem repetição, duplas e estatísticas (funções puras)
store.js     armazenamento: local (navegador) ou Supabase; login e perfis
app.js       telas, navegação, agenda, filtros e permissões
schema.sql   banco do Supabase: tabelas, regras de acesso (RLS), travas e realtime
```

## Créditos
- **Desenvolvido por:** Alan Pinheiro · **Contato:** alanpinhe@gmail.com
- Fotos: [Unsplash](https://unsplash.com) (Joey Genovese, Dmytro Bayer, Matthew Ball, tanner moran, Denise Jans)
- Bibliotecas: [Supabase JS](https://github.com/supabase/supabase-js) (MIT) · Fontes Oswald e Barlow (Google Fonts, OFL)

Licença sugerida: MIT.
