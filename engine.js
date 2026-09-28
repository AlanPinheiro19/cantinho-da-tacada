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

  // mode: 'single' (individual) | 'duplas'. Em duplas, players = nomes das duplas
  // ("Ana & Beto") e teams = { "Ana & Beto": ["Ana", "Beto"] }.
  function newTournament({ name, date, lives, players, ranked = true, scheduledId = null, mode = 'single', teams = null }) {
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
      scheduledId: scheduledId || undefined, // torneio agendado de origem
      mode: mode === 'duplas' ? 'duplas' : 'single',
      teams: mode === 'duplas' ? teams || {} : undefined,
      participants,
      rounds: [],
      status: 'running', // running | finished
      winner: null,
      runnerUp: null,
      undefeated: false,
    };
  }

  const teamName = (a, b) => `${norm(a)} & ${norm(b)}`;
  // Forma duplas a partir de uma lista (em ordem) de jogadores
  function buildTeams(players) {
    const ps = players.map(norm).filter(Boolean);
    if (ps.length < 4 || ps.length % 2) throw new Error('Para duplas, informe um número PAR de jogadores (mínimo 4).');
    const teams = {};
    for (let i = 0; i < ps.length; i += 2) teams[teamName(ps[i], ps[i + 1])] = [ps[i], ps[i + 1]];
    return teams;
  }
  const isDoubles = (r) => !!r && r.mode === 'duplas';

  const alive = (t) => t.participants.filter((p) => !p.eliminated);
  const findP = (t, name) => t.participants.find((p) => p.name === name);
  const currentRound = (t) => t.rounds[t.rounds.length - 1] || null;
  const roundOpen = (r) => !!r && !r.closed;

  // ---------------- Sorteio sem repetir adversário ----------------
  // Regra: enquanto houver adversários inéditos, ninguém repete confronto.
  // Só quando TODOS os vivos já se enfrentaram os confrontos podem se repetir
  // (e aí o sorteio espalha as repetições). Com número ímpar, o "bye" entra
  // como um adversário fictício: descansa quem teve menos folgas.
  const BYE = '\u0000BYE';
  const pk = (a, b) => (a < b ? a + '\u0001' + b : b + '\u0001' + a);

  function meetCounts(t) {
    const m = new Map();
    for (const r of t.rounds) for (const [a, b] of r.duels) m.set(pk(a, b), (m.get(pk(a, b)) || 0) + 1);
    return m;
  }

  // Todas as combinações de pares (emparelhamentos perfeitos) de uma lista
  function* allMatchings(list) {
    if (!list.length) { yield []; return; }
    const [a, ...rest] = list;
    for (let i = 0; i < rest.length; i++) {
      const b = rest[i];
      const others = rest.slice(0, i).concat(rest.slice(i + 1));
      for (const m of allMatchings(others)) yield [[a, b], ...m];
    }
  }

  // Existe emparelhamento só com pares inéditos (grafo "ainda não jogaram")?
  function hasFreshMatching(list, fresh) {
    if (!list.length) return true;
    const [a, ...rest] = list;
    for (let i = 0; i < rest.length; i++) {
      if (!fresh(a, rest[i])) continue;
      if (hasFreshMatching(rest.slice(0, i).concat(rest.slice(i + 1)), fresh)) return true;
    }
    return false;
  }

  // Dá para completar o "todos contra todos" dos pares inéditos restantes? (busca limitada)
  function canFinishRoundRobin(list, played, budget) {
    const unplayed = [];
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) if (!played.has(pk(list[i], list[j]))) unplayed.push(pk(list[i], list[j]));
    if (!unplayed.length) return true;
    const rec = (pl) => {
      if (budget.n-- <= 0) return true; // sem certeza: não penaliza
      const fresh = (a, b) => !pl.has(pk(a, b));
      if ([...Array(list.length).keys()].every((i) => list.every((b, j) => j === i || pl.has(pk(list[i], b))))) return true;
      for (const m of allMatchings(list)) {
        if (!m.every(([a, b]) => fresh(a, b))) continue;
        const np = new Set(pl); m.forEach(([a, b]) => np.add(pk(a, b)));
        if (rec(np)) return true;
        if (budget.n <= 0) return true;
      }
      return false;
    };
    return rec(new Set(played));
  }

  function matchCost(m, count, lastPair) {
    let c = 0;
    for (const [a, b] of m) {
      const n = count(a, b);
      c += n * n * 1000;              // repetir confronto pesa muito (e cada vez mais)
      if (lastPair.has(pk(a, b))) c += 1; // desempate: evita repetir a rodada anterior
    }
    return c;
  }

  function drawRound(t, rnd = Math.random) {
    if (t.status !== 'running') throw new Error('Torneio já finalizado.');
    if (roundOpen(currentRound(t))) throw new Error('Finalize a rodada atual antes de sortear outra.');
    const pool = alive(t).map((p) => p.name);
    if (pool.length < 2) throw new Error('É preciso ao menos 2 jogadores vivos.');

    const meets = meetCounts(t);
    const byesOf = new Map(t.participants.map((p) => [p.name, p.byes || 0]));
    const list = shuffle(pool, rnd);
    if (list.length % 2 === 1) list.push(BYE);
    const count = (a, b) => (a === BYE ? byesOf.get(b) : b === BYE ? byesOf.get(a) : meets.get(pk(a, b)) || 0);
    const last = t.rounds.filter((x) => x.closed).slice(-1)[0];
    const lastPair = new Set(last ? last.duels.map(([a, b]) => pk(a, b)) : []);
    // grafo de "já jogaram" incluindo o bye como adversário fictício (número ímpar)
    const played = new Set([...meets.keys()]);
    if (list.includes(BYE)) for (const [n, c] of byesOf) if (c > 0 && pool.includes(n)) played.add(pk(BYE, n));
    const realAll = list.slice();

    let best = null, bestCost = Infinity;
    // Grupos grandes (>12): rodízio clássico ("método do círculo") enquanto todos estão vivos
    let circle = null;
    if (list.length > 12) {
      if (!t.rrOrder || t.rrOrder.length !== list.length) t.rrOrder = shuffle(list, rnd);
      const n = t.rrOrder.length, k = t.rounds.length;
      if (k < n - 1 && t.rrOrder.every((x) => x === BYE || pool.includes(x)) && list.every((x) => t.rrOrder.includes(x))) {
        const fixed = t.rrOrder[0], rot = t.rrOrder.slice(1);
        const r = rot.slice(k % (n - 1)).concat(rot.slice(0, k % (n - 1)));
        const m = [[fixed, r[0]]];
        for (let i = 1; i < n / 2; i++) m.push([r[i], r[n - 1 - i]]);
        if (m.every(([a, b]) => !count(a, b) || a === BYE || b === BYE)) circle = m;
      }
    }
    if (list.length <= 12) {
      // busca completa (até 10.395 combinações) com olhar à frente
      const cands = [];
      for (const m of allMatchings(list)) {
        const c = matchCost(m, count, lastPair);
        if (c < bestCost + 1000) cands.push({ m, c });
        if (c < bestCost) bestCost = c;
      }
      const min = cands.filter((x) => x.c < bestCost + 1000).sort((a, b) => a.c - b.c);
      // entre as de menor custo, prefere a que mantém o "todos contra todos" possível
      const minTier = min.filter((x) => Math.floor(x.c / 1000) === Math.floor(bestCost / 1000));
      if (Math.floor(bestCost / 1000) === 0 && realAll.length >= 4) {
        const budget = { n: 4000 };
        for (const x of shuffle(minTier, rnd).sort((a, b) => a.c - b.c)) {
          const np = new Set(played); x.m.forEach(([a, b]) => np.add(pk(a, b)));
          if (canFinishRoundRobin(realAll, np, budget)) { best = x.m; break; }
        }
      }
      if (!best) best = shuffle(minTier, rnd).sort((a, b) => a.c - b.c)[0].m;
    } else if (circle) {
      best = circle;
    } else {
      // muitos jogadores: tentativas aleatórias gulosas, fica com a melhor
      for (let tries = 0; tries < 400 && bestCost > 0; tries++) {
        const rest = shuffle(list, rnd), m = [];
        while (rest.length) {
          const a = rest.shift();
          let bi = 0, bc = Infinity;
          rest.forEach((b, i) => { const c = count(a, b) * 1000 + (lastPair.has(pk(a, b)) ? 1 : 0) + rnd() * 0.1; if (c < bc) { bc = c; bi = i; } });
          m.push([a, rest.splice(bi, 1)[0]]);
        }
        const c = matchCost(m, count, lastPair);
        if (c < bestCost) { bestCost = c; best = m; }
      }
    }

    const byes = [], duels = [];
    for (const [a, b] of best) {
      if (a === BYE) byes.push(b); else if (b === BYE) byes.push(a);
      else duels.push(rnd() < 0.5 ? [a, b] : [b, a]);
    }
    const round = { duels, winners: duels.map(() => null), flags: duels.map(() => ({})), byes, closed: false };
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

  // Marcações do duelo: gato (vitória aplicada pelo vencedor) e suicídio (cometido pelo perdedor).
  // Vale para a rodada atual (aberta ou recém-fechada).
  const FLAGS = ['gato', 'suicidio'];
  function toggleFlag(t, duelIdx, flag) {
    if (!FLAGS.includes(flag)) throw new Error('Marcação inválida.');
    const r = currentRound(t);
    if (!r || !r.duels[duelIdx]) throw new Error('Duelo não encontrado.');
    if (!r.flags) r.flags = r.duels.map(() => ({}));
    const f = r.flags[duelIdx] || (r.flags[duelIdx] = {});
    if (f[flag]) delete f[flag]; else f[flag] = true;
  }
  const flagOf = (r, i) => (r.flags && r.flags[i]) || {};

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
      mode: t.mode || 'single',
      teams: t.mode === 'duplas' ? t.teams : undefined,
      winner: t.winner,
      runnerUp: t.runnerUp,
      undefeated: !!t.undefeated,
      players: t.participants.length,
      participants: t.participants.map((p) => p.name),
      rounds: t.rounds.filter((r) => r.closed).map((r) => ({ duels: r.duels, winners: r.winners.slice(), flags: (r.flags || r.duels.map(() => ({}))).map((f) => ({ ...(f || {}) })), byes: r.byes.slice() })),
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
      const flags = duels.map((_, i) => ({ ...((x.flags && x.flags[i]) || {}) }));
      return { duels, winners, flags, byes: (x.byes || []).map(norm) };
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
      mode: r.mode === 'duplas' ? 'duplas' : 'single',
      teams: r.mode === 'duplas' ? r.teams || {} : undefined,
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
    return { name, titles: 0, vices: 0, undefeated: 0, participations: 0, wins: 0, losses: 0, gatos: 0, gatosSofridos: 0, suicidios: 0, lastDate: '' };
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
          const l = w === a ? b : a, f = flagOf(r, i);
          get(w).wins++; get(l).losses++;
          if (f.gato) { get(w).gatos++; get(l).gatosSofridos++; }
          if (f.suicidio) get(l).suicidios++;
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
            duels.push({ tournament: t.name, date: t.date, round: ri + 1, winner: r.winners[i], ...flagOf(r, i), final: t.winner && d.includes(t.winner) && d.includes(t.runnerUp) && ri === t.rounds.length - 1 });
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
    const tot = new Map(names.map((n) => [n, { name: n, wins: 0, losses: 0, gatos: 0, suicidios: 0 }]));
    const pair = new Map(); // "a\u0000b" -> vitórias de a sobre b
    const duels = [];
    for (const t of records) {
      (t.rounds || []).forEach((r, ri) => r.duels.forEach(([a, b], i) => {
        const w = r.winners[i];
        if (!w || !set.has(a) || !set.has(b)) return;
        const l = w === a ? b : a;
        tot.get(w).wins++; tot.get(l).losses++;
        const f = flagOf(r, i); if (f.gato) tot.get(w).gatos++; if (f.suicidio) tot.get(l).suicidios++;
        const k = w + '\u0000' + l; pair.set(k, (pair.get(k) || 0) + 1);
        duels.push({ tournament: t.name, date: t.date, round: ri + 1, winner: w, loser: l, ranked: t.ranked !== false, ...flagOf(r, i) });
      }));
    }
    const rows = [...tot.values()].map((x) => ({ ...x, games: x.wins + x.losses, winPct: x.wins + x.losses ? (x.wins / (x.wins + x.losses)) * 100 : 0 }))
      .sort((x, y) => y.wins - x.wins || y.winPct - x.winPct || x.name.localeCompare(y.name));
    duels.sort((x, y) => (y.date || '').localeCompare(x.date || '') || y.round - x.round);
    return { rows, duels, vs: (a, b) => pair.get(a + '\u0000' + b) || 0 };
  }

  // Jogadores individuais (integrantes das duplas entram pelo próprio nome)
  function allPlayers(records, current) {
    const s = new Set();
    const addT = (t, names) => {
      if (isDoubles(t)) Object.values(t.teams || {}).forEach((m) => m.forEach((n) => s.add(n)));
      else names.forEach((n) => s.add(n));
    };
    records.forEach((t) => addT(t, t.participants || []));
    if (current) addT(current, current.participants.map((p) => p.name));
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
  function filterRecords(records, { type = 'all', season = 'all', mode = 'all' } = {}) {
    return records.filter((r) =>
      (type === 'all' || (type === 'ranked' ? isRanked(r) : !isRanked(r))) &&
      (season === 'all' || seasonOf(r) === season) &&
      (mode === 'all' || (mode === 'duplas' ? isDoubles(r) : !isDoubles(r))));
  }

  const api = {
    isRanked, seasonOf, seasons, filterRecords, buildTeams, teamName, isDoubles, meetCounts,
    uid, norm, key, shuffle,
    newTournament, alive, currentRound, roundOpen, drawRound, setWinner, toggleFlag, flagOf, canCloseRound, closeRound,
    withdraw, addLatePlayer, toRecord, normalizeRecord,
    playerStats, ranking, hallOfFame, months, monthly, headToHead, groupH2H, allPlayers, renamePlayer,
  };
  root.CTD_ENGINE = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
