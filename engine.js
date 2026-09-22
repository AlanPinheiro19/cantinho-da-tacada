// ============================================================
//  Motor do torneio (sorteio, vidas, eliminação) e estatísticas.
//  Funções puras: não acessam DOM nem armazenamento.
// ============================================================
(function (root) {
  'use strict';

  const uid = () =>
    (root.crypto && root.crypto.randomUUID)
      ? root.crypto.randomUUID()
      : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2);

  const norm = (s) => String(s || '').trim().replace(/\s+/g, ' ');
  const key = (s) => norm(s).toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[̀-ͯ]/g, '');

  function shuffle(arr, rnd = Math.random) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ---------------- Torneio em andamento ----------------

  function newTournament({ name, date, lives, players, ranked = true }) {
    const seen = new Set();
    const participants = [];
    for (const p of players || []) {
      const n = norm(p);
      if (!n || seen.has(key(n))) continue;
      seen.add(key(n));
      participants.push({ name: n, losses: 0, byes: 0, eliminated: false, eliminatedRound: null, withdrew: false });
    }
    return {
      id: uid(),
      name: norm(name) || 'Torneio',
      date: date || new Date().toISOString().slice(0, 10),
      lives: Math.max(1, parseInt(lives, 10) || 3),
      ranked: ranked !== false, // vale para o ranking da temporada?
      participants,
      rounds: [],
      status: 'running', // running | finished
      winner: null,
      runnerUp: null,
      undefeated: false,
    };
  }

  const alive = (t) => t.participants.filter((p) => !p.eliminated);
  const findP = (t, name) => t.participants.find((p) => p.name === name);
  const currentRound = (t) => t.rounds[t.rounds.length - 1] || null;
  const roundOpen = (r) => !!r && !r.closed;

  function lastOpponents(t) {
    const r = t.rounds.filter((x) => x.closed).slice(-1)[0];
    const m = new Map();
    if (r) for (const [a, b] of r.duels) { m.set(a, b); m.set(b, a); }
    return m;
  }

  // Sorteia a próxima rodada entre os vivos.
  // - número ímpar: "bye" para quem teve menos byes (sorteado entre empatados)
  // - evita repetir o confronto da rodada anterior quando possível
  function drawRound(t, rnd = Math.random) {
    if (t.status !== 'running') throw new Error('Torneio já finalizado.');
    if (roundOpen(currentRound(t))) throw new Error('Finalize a rodada atual antes de sortear outra.');
    let pool = alive(t);
    if (pool.length < 2) throw new Error('É preciso ao menos 2 jogadores vivos.');

    const byes = [];
    if (pool.length % 2 === 1) {
      const minByes = Math.min(...pool.map((p) => p.byes));
      const cands = pool.filter((p) => p.byes === minByes);
      const b = cands[Math.floor(rnd() * cands.length)];
      byes.push(b.name);
      pool = pool.filter((p) => p !== b);
    }

    const prev = lastOpponents(t);
    let best = null, bestScore = Infinity;
    for (let tries = 0; tries < 60 && bestScore > 0; tries++) {
      const s = shuffle(pool.map((p) => p.name), rnd);
      const duels = [];
      let score = 0;
      for (let i = 0; i < s.length; i += 2) {
        duels.push([s[i], s[i + 1]]);
        if (prev.get(s[i]) === s[i + 1]) score++;
      }
      if (score < bestScore) { best = duels; bestScore = score; }
    }

    const round = { duels: best, winners: best.map(() => null), byes, closed: false };
    t.rounds.push(round);
    return round;
  }

  function setWinner(t, duelIdx, name) {
    const r = currentRound(t);
    if (!roundOpen(r)) throw new Error('Nenhuma rodada aberta.');
    const d = r.duels[duelIdx];
    if (!d || !d.includes(name)) throw new Error('Jogador não está neste duelo.');
    r.winners[duelIdx] = r.winners[duelIdx] === name ? null : name; // clicar de novo desmarca
  }

  function canCloseRound(t) {
    const r = currentRound(t);
    return roundOpen(r) && r.winners.every(Boolean);
  }

  // Aplica derrotas, elimina quem zerou as vidas, verifica campeão.
  function closeRound(t) {
    const r = currentRound(t);
    if (!canCloseRound(t)) throw new Error('Defina o vencedor de todos os duelos.');
    const n = t.rounds.length;
    r.duels.forEach(([a, b], i) => {
      const loser = findP(t, r.winners[i] === a ? b : a);
      loser.losses++;
      if (loser.losses >= t.lives) { loser.eliminated = true; loser.eliminatedRound = n; }
    });
    for (const b of r.byes) findP(t, b).byes++;
    r.closed = true;
    checkFinish(t);
  }

  // Desistência: jogador sai do torneio (entre rodadas).
  function withdraw(t, name) {
    if (roundOpen(currentRound(t))) throw new Error('Remova jogadores apenas entre rodadas.');
    const p = findP(t, name);
    if (!p || p.eliminated) return;
    p.eliminated = true; p.withdrew = true; p.eliminatedRound = t.rounds.length;
    checkFinish(t);
  }

  // Inclui jogador atrasado (entre rodadas), começando com N derrotas.
  function addLatePlayer(t, name, losses = 0) {
    if (roundOpen(currentRound(t))) throw new Error('Adicione jogadores apenas entre rodadas.');
    const n = norm(name);
    if (!n) return;
    if (t.participants.some((p) => key(p.name) === key(n))) throw new Error('Jogador já está no torneio.');
    t.participants.push({ name: n, losses: Math.min(losses, t.lives - 1), byes: 0, eliminated: false, eliminatedRound: null, withdrew: false });
  }

  function checkFinish(t) {
    const a = alive(t);
    if (a.length > 1) return false;
    t.status = 'finished';
    const champ = a[0] || null;
    t.winner = champ ? champ.name : null;
    // Vice = último eliminado (desempate: menos derrotas); desistentes contam por último
    const out = t.participants
      .filter((p) => p.eliminated && p !== champ)
      .sort((x, y) => (y.eliminatedRound - x.eliminatedRound) || (x.withdrew - y.withdrew) || (x.losses - y.losses));
    t.runnerUp = out[0] ? out[0].name : null;
    t.undefeated = !!champ && champ.losses === 0;
    return true;
  }

  // Converte o torneio em andamento para o formato do histórico.
  // (Compatível com o formato do Serra Pool: rounds[{duels, winners, byes}])
  function toRecord(t) {
    return {
      id: t.id || uid(),
      name: t.name,
      date: t.date,
      lives: t.lives,
      ranked: t.ranked !== false,
      winner: t.winner,
      runnerUp: t.runnerUp,
      undefeated: !!t.undefeated,
      players: t.participants.length,
      participants: t.participants.map((p) => p.name),
      rounds: t.rounds.filter((r) => r.closed).map((r) => ({ duels: r.duels, winners: r.winners.slice(), byes: r.byes.slice() })),
    };
  }

  // Normaliza registros importados (inclusive do Serra Pool)
  function normalizeRecord(r) {
    const rounds = (r.rounds || []).map((x) => {
      const duels = (x.duels || []).map((d) => [norm(d[0]), norm(d[1])]);
      let winners = (x.winners || []).map(norm);
      // formato antigo: lista de vencedores sem alinhamento → alinhar por duelo
      if (winners.length !== duels.length || duels.some((d, i) => winners[i] && !d.includes(winners[i]))) {
        const ws = new Set(winners);
        winners = duels.map((d) => (ws.has(d[0]) ? d[0] : ws.has(d[1]) ? d[1] : null));
      }
      return { duels, winners, byes: (x.byes || []).map(norm) };
    });
    const names = new Set();
    rounds.forEach((x) => { x.duels.flat().forEach((n) => names.add(n)); x.byes.forEach((n) => names.add(n)); });
    (r.participants || []).forEach((n) => names.add(norm(n)));
    return {
      id: r.id || uid(),
      name: norm(r.name) || 'Torneio',
      date: r.date || '',
      lives: r.lives || null,
      ranked: r.ranked !== false,
      winner: r.winner ? norm(r.winner) : null,
      runnerUp: r.runnerUp ? norm(r.runnerUp) : null,
      undefeated: !!r.undefeated,
      players: r.players || names.size,
      participants: [...names],
      rounds,
    };
  }

  // ---------------- Estatísticas ----------------

  function emptyStats(name) {
    return { name, titles: 0, vices: 0, undefeated: 0, participations: 0, wins: 0, losses: 0, lastDate: '' };
  }

  function playerStats(records) {
    const m = new Map();
    const get = (n) => { if (!m.has(n)) m.set(n, emptyStats(n)); return m.get(n); };
    for (const t of records) {
      for (const n of t.participants || []) {
        const s = get(n); s.participations++; if ((t.date || '') > s.lastDate) s.lastDate = t.date || '';
      }
      if (t.winner) { const s = get(t.winner); s.titles++; if (t.undefeated) s.undefeated++; }
      if (t.runnerUp) get(t.runnerUp).vices++;
      for (const r of t.rounds || []) {
        r.duels.forEach(([a, b], i) => {
          const w = r.winners[i]; if (!w) return;
          get(w).wins++; get(w === a ? b : a).losses++;
        });
      }
    }
    return [...m.values()].map((s) => {
      const games = s.wins + s.losses;
      s.games = games;
      s.winPct = games ? (s.wins / games) * 100 : 0;
      return s;
    });
  }

  function rankingPoints(s, sc) {
    return Math.round(
      s.titles * sc.title + s.undefeated * sc.undefeated + s.vices * sc.vice +
      s.wins * sc.win + s.winPct * sc.winPct + Math.log2(s.participations + 1) * sc.participation
    );
  }

  function ranking(records, sc) {
    return playerStats(records)
      .map((s) => ({ ...s, points: rankingPoints(s, sc) }))
      .sort((a, b) => b.points - a.points || b.titles - a.titles || b.winPct - a.winPct || a.name.localeCompare(b.name));
  }

  function hallOfFame(records) {
    return playerStats(records)
      .filter((s) => s.titles || s.vices)
      .sort((a, b) => b.titles - a.titles || b.undefeated - a.undefeated || b.vices - a.vices || a.name.localeCompare(b.name));
  }

  function months(records) {
    return [...new Set(records.map((t) => (t.date || '').slice(0, 7)).filter(Boolean))].sort().reverse();
  }

  function monthly(records, ym, sc) {
    const recs = records.filter((t) => (t.date || '').startsWith(ym));
    const rows = playerStats(recs).map((s) => ({
      ...s,
      points: s.titles * sc.title + s.undefeated * sc.undefeated + s.vices * sc.vice + s.wins * sc.win + s.participations * sc.participation,
    })).sort((a, b) => b.points - a.points || b.winPct - a.winPct || a.name.localeCompare(b.name));
    return { tournaments: recs.length, rows };
  }

  function headToHead(records, a, b) {
    const duels = [];
    for (const t of records) {
      (t.rounds || []).forEach((r, ri) => {
        r.duels.forEach((d, i) => {
          if (d.includes(a) && d.includes(b) && r.winners[i]) {
            duels.push({ tournament: t.name, date: t.date, round: ri + 1, winner: r.winners[i], final: t.winner && d.includes(t.winner) && d.includes(t.runnerUp) && ri === t.rounds.length - 1 });
          }
        });
      });
    }
    duels.sort((x, y) => (y.date || '').localeCompare(x.date || '') || y.round - x.round);
    return { duels, a: duels.filter((d) => d.winner === a).length, b: duels.filter((d) => d.winner === b).length };
  }

  // Confrontos diretos entre um grupo de jogadores (só duelos entre eles)
  function groupH2H(records, names) {
    const set = new Set(names);
    const tot = new Map(names.map((n) => [n, { name: n, wins: 0, losses: 0 }]));
    const pair = new Map(); // "a\u0000b" -> vitórias de a sobre b
    const duels = [];
    for (const t of records) {
      (t.rounds || []).forEach((r, ri) => r.duels.forEach(([a, b], i) => {
        const w = r.winners[i];
        if (!w || !set.has(a) || !set.has(b)) return;
        const l = w === a ? b : a;
        tot.get(w).wins++; tot.get(l).losses++;
        const k = w + '\u0000' + l; pair.set(k, (pair.get(k) || 0) + 1);
        duels.push({ tournament: t.name, date: t.date, round: ri + 1, winner: w, loser: l, ranked: t.ranked !== false });
      }));
    }
    const rows = [...tot.values()].map((x) => ({ ...x, games: x.wins + x.losses, winPct: x.wins + x.losses ? (x.wins / (x.wins + x.losses)) * 100 : 0 }))
      .sort((x, y) => y.wins - x.wins || y.winPct - x.winPct || x.name.localeCompare(y.name));
    duels.sort((x, y) => (y.date || '').localeCompare(x.date || '') || y.round - x.round);
    return { rows, duels, vs: (a, b) => pair.get(a + '\u0000' + b) || 0 };
  }

  function allPlayers(records, current) {
    const s = new Set();
    records.forEach((t) => (t.participants || []).forEach((n) => s.add(n)));
    if (current) current.participants.forEach((p) => s.add(p.name));
    return [...s].sort((x, y) => x.localeCompare(y, 'pt-BR'));
  }

  // Renomear/mesclar jogador em todos os registros
  function renamePlayer(records, from, to) {
    const f = (n) => (n === from ? to : n);
    for (const t of records) {
      t.winner = t.winner && f(t.winner);
      t.runnerUp = t.runnerUp && f(t.runnerUp);
      t.participants = [...new Set((t.participants || []).map(f))];
      for (const r of t.rounds || []) {
        r.duels = r.duels.map((d) => d.map(f));
        r.winners = r.winners.map((w) => w && f(w));
        r.byes = r.byes.map(f);
      }
    }
    return records;
  }

  // Torneios antigos (sem o campo) contam como válidos para o ranking
  const isRanked = (r) => !!r && r.ranked !== false;
  const seasonOf = (r) => (r.date || '').slice(0, 4);
  function seasons(records) {
    return [...new Set(records.map(seasonOf).filter(Boolean))].sort().reverse();
  }
  function filterRecords(records, { type = 'all', season = 'all' } = {}) {
    return records.filter((r) =>
      (type === 'all' || (type === 'ranked' ? isRanked(r) : !isRanked(r))) &&
      (season === 'all' || seasonOf(r) === season));
  }

  const api = {
    isRanked, seasonOf, seasons, filterRecords,
    uid, norm, key, shuffle,
    newTournament, alive, currentRound, roundOpen, drawRound, setWinner, canCloseRound, closeRound,
    withdraw, addLatePlayer, toRecord, normalizeRecord,
    playerStats, ranking, hallOfFame, months, monthly, headToHead, groupH2H, allPlayers, renamePlayer,
  };
  root.CTD_ENGINE = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
