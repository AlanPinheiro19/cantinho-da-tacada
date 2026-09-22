// ============================================================
//  Cantinho da Tacada — configuração
//  Edite este arquivo para personalizar o site.
// ============================================================
window.CTD_CONFIG = {
  clubName: 'Cantinho da Tacada',
  tagline: 'Sinuca, amigos e resenha',

  // Vidas por jogador em cada torneio (eliminado ao perder todas)
  defaultLives: 3,

  // ---- Supabase (opcional) ----
  // Deixe em branco para salvar tudo só neste navegador (modo local).
  // Preencha para ter placar online compartilhado (veja README.md).
  supabaseUrl: '',
  supabaseAnonKey: '',

  // ---- Contato (opcional, aparece no rodapé) ----
  contact: {
    whatsapp: '',   // ex.: '5511999999999'
    instagram: '',  // ex.: 'cantinhodatacada'
  },

  // ---- Pontuação ----
  scoring: {
    // Ranking geral
    ranking: {
      title: 1000,        // por título
      undefeated: 500,    // bônus por título invicto
      vice: 300,          // por vice-campeonato
      win: 10,            // por duelo vencido
      winPct: 1,          // pontos por ponto percentual de aproveitamento
      participation: 5,   // × log2(participações + 1)
    },
    // Melhores do mês (power ranking)
    monthly: {
      title: 1000,
      undefeated: 500,
      vice: 200,
      win: 15,
      participation: 5,   // por torneio disputado
    },
  },
};
