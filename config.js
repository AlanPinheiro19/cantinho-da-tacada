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

  // ---- Fotos (troque por fotos do seu clube quando quiser) ----
  // Pode ser um link da internet ou um arquivo enviado ao repositório (ex.: 'fotos/mesa.jpg').
  images: {
    hero:    'https://images.unsplash.com/photo-1599685315659-bc876da49fe5?auto=format&fit=crop&w=2000&q=70',
    sorteio: 'https://images.unsplash.com/photo-1737223450924-5e1a0d5ab85f?auto=format&fit=crop&w=2000&q=70',
    ranking: 'https://images.unsplash.com/photo-1597514427650-0199c57eec1a?auto=format&fit=crop&w=2000&q=70',
    duel:    'https://images.unsplash.com/photo-1624827637654-84cd4877717e?auto=format&fit=crop&w=2000&q=70',
    history: 'https://images.unsplash.com/photo-1597514427650-0199c57eec1a?auto=format&fit=crop&w=2000&q=70',
    hall:    'https://images.unsplash.com/photo-1593024360360-f1eec76b9379?auto=format&fit=crop&w=2000&q=70',
    month:   'https://images.unsplash.com/photo-1737223450924-5e1a0d5ab85f?auto=format&fit=crop&w=2000&q=70',
    config:  'https://images.unsplash.com/photo-1624827637654-84cd4877717e?auto=format&fit=crop&w=2000&q=70',
  },
  photoCredits: [
    ['Joey Genovese', 'https://unsplash.com/@joeyguns'],
    ['Dmytro Bayer', 'https://unsplash.com/@dmytrobayer'],
    ['Matthew Ball', 'https://unsplash.com/@tex450'],
    ['tanner moran', 'https://unsplash.com/@tannerrmorann__'],
    ['Denise Jans', 'https://unsplash.com/@dmjdenise'],
  ],

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
