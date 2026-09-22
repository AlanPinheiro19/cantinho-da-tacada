// ============================================================
//  Cantinho da Tacada — interface (roteador + telas)
// ============================================================
(function () {
  'use strict';
  const C = window.CTD_CONFIG;
  const E = window.CTD_ENGINE;
  const S = window.CTD_STORE;
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const view = $('#view');

  // ---------- estado em memória ----------
  const state = { records: [], current: null, undo: [], loaded: false };

  // ---------- utilidades ----------
  const h = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtDate = (d) => (d ? d.split('-').reverse().join('/') : '—');
  const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const fmtMonth = (ym) => { const [y, m] = ym.split('-'); return `${MONTHS[+m - 1]} de ${y}`; };
  const pct = (x) => `${Math.round(x)}%`;
  const plural = (n, s, p) => `${n} ${n === 1 ? s : p}`;
  const sortedRecords = () => state.records.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '') || 0);

  let toastTimer;
  function toast(msg, err = false) {
    const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 3200);
  }
  function overlay(html) { const o = $('#overlay'); o.innerHTML = html; o.hidden = false; return o; }
  function closeOverlay() { const o = $('#overlay'); o.hidden = true; o.innerHTML = ''; }
  $('#overlay').addEventListener('click', (e) => { if (e.target.id === 'overlay' && !e.target.dataset.lock) closeOverlay(); });

  // Confirmação dentro da página (não depende de confirm() do navegador)
  function ask(msg, okLabel = 'Confirmar') {
    return new Promise((resolve) => {
      const o = overlay(`<div class="card modal"><h2 style="font-size:18px">Tem certeza?</h2><p class="muted">${h(msg)}</p>
        <div class="btn-row" style="margin-top:14px"><button class="btn btn-danger" id="askOk">${h(okLabel)}</button><button class="btn" id="askNo">Voltar</button></div></div>`);
      o.dataset.lock = '1';
      const done = (v) => { delete o.dataset.lock; closeOverlay(); resolve(v); };
      $('#askOk', o).onclick = () => done(true);
      $('#askNo', o).onclick = () => done(false);
    });
  }

  async function guard(fn) {
    try { await fn(); } catch (e) { console.error(e); toast(e.message || String(e), true); }
  }

  function head(eyebrow, title, sub) {
    return `<div class="eyebrow">${h(eyebrow)}</div><h1 class="page-title">${h(title)}</h1>${sub ? `<p class="page-sub">${h(sub)}</p>` : ''}`;
  }

  function livesHtml(p, lives) {
    const left = Math.max(0, lives - p.losses);
    return `<span class="lives" title="${left} de ${lives} vidas">${'●'.repeat(left)}<span class="lost">${'●'.repeat(lives - left)}</span></span>`;
  }

  function duelMini(d, w) {
    const cls = (n) => (w ? (n === w ? 'w' : 'l') : '');
    return `<span class="duel-mini"><span class="${cls(d[0])}">${w === d[0] ? '✓ ' : ''}${h(d[0])}</span><span class="vs">vs</span><span class="${cls(d[1])}">${w === d[1] ? '✓ ' : ''}${h(d[1])}</span></span>`;
  }

  function roundsHtml(rounds) {
    return rounds.map((r, i) => `
      <div class="round-label">RODADA ${i + 1}</div>
      <div>${r.duels.map((d, j) => duelMini(d, r.winners[j])).join('')}
      ${r.byes.map((b) => `<span class="duel-mini"><span class="vs">bye ·</span> <b>${h(b)}</b> <span class="vs">avança</span></span>`).join('')}</div>`).join('');
  }

  // ---------- persistência ----------
  async function loadAll() {
    const [records, current] = await Promise.all([S.listTournaments(), S.getCurrent()]);
    state.records = records || [];
    state.current = current || null;
    state.loaded = true;
  }

  async function saveCurrent() { await S.setCurrent(state.current); }

  function snapshot() {
    state.undo.push(JSON.stringify(state.current));
    if (state.undo.length > 40) state.undo.shift();
  }

  // Muta o torneio atual com desfazer + persistência + histórico ao terminar
  async function mutate(fn) {
    if (!S.canWrite()) throw new Error('Entre como administrador para alterar o torneio.');
    const wasFinished = state.current && state.current.status === 'finished';
    snapshot();
    try { fn(state.current); } catch (e) { state.undo.pop(); throw e; }
    await saveCurrent();
    if (!wasFinished && state.current.status === 'finished') {
      const rec = E.toRecord(state.current);
      await S.saveTournament(rec);
      state.records = state.records.filter((r) => r.id !== rec.id).concat(rec);
      celebrate(state.current);
    }
  }

  async function undo() {
    if (!state.undo.length) return;
    const prev = JSON.parse(state.undo.pop());
    if (state.current && state.current.status === 'finished' && (!prev || prev.status !== 'finished')) {
      await S.deleteTournament(state.current.id);
      state.records = state.records.filter((r) => r.id !== state.current.id);
    }
    state.current = prev;
    await saveCurrent();
    render();
  }

  // ============================================================
  //  TELAS
  // ============================================================

  function champCard(s, i) {
    const cls = i < 3 ? `p${i + 1}` : '';
    return `<article class="card champ ${cls}">
      ${i === 0 ? '<span class="crown">👑</span>' : ''}
      <span class="pos">#${i + 1}</span>
      <h3>${h(s.name)}</h3>
      <div class="titles">${plural(s.titles, 'título', 'títulos')}</div>
      <div class="meta"><span class="tag gold">★ ${plural(s.undefeated, 'invicto', 'invictos')}</span><span class="tag">🥈 ${plural(s.vices, 'vice', 'vices')}</span></div>
    </article>`;
  }

  function tournamentCard(t, { admin = false, open = false } = {}) {
    return `<article class="card tourn" data-id="${h(t.id)}">
      <div class="tourn__head">
        <div><h3>${h(t.name)}</h3><div class="muted mono" style="font-size:12px">${fmtDate(t.date)} · ${plural(t.players, 'jogador', 'jogadores')}${t.lives ? ` · ${t.lives} vidas` : ''}</div></div>
        <div class="tourn__win">🏆 <b>${h(t.winner || '—')}</b><small>vice ${h(t.runnerUp || '—')}</small></div>
        <div class="btn-row">${t.undefeated ? '<span class="tag gold">CAMPEÃO INVICTO</span>' : '<span class="tag green">Finalizado</span>'}
          ${admin ? `<button class="btn btn-sm btn-danger" data-del="${h(t.id)}" title="Excluir torneio">✕</button>` : ''}</div>
      </div>
      ${t.rounds && t.rounds.length ? `<details class="rounds" ${open ? 'open' : ''}><summary>Ver duelos sorteados (${t.rounds.length} rodadas)</summary>${roundsHtml(t.rounds)}</details>` : ''}
    </article>`;
  }

  // ---------- Início ----------
  function viewHome() {
    const recs = sortedRecords();
    const hall = E.hallOfFame(recs);
    const players = E.playerStats(recs);
    const duels = players.reduce((a, s) => a + s.wins, 0);
    const cur = state.current;

    return `
      <section class="hero">
        <div class="eyebrow">Clube de sinuca</div>
        <h1>${h(C.clubName).replace(/(\S+)$/, '<span>$1</span>')}</h1>
        <p>${h(C.tagline)} — sorteio de duelos, placar ao vivo, ranking e histórico de todos os torneios.</p>
        <div class="btn-row" style="justify-content:center"><a class="btn btn-primary" href="#/sorteio">🎱 ${cur && cur.status === 'running' ? 'Ver torneio ao vivo' : 'Novo torneio'}</a><a class="btn" href="#/ranking">Ver ranking</a></div>
      </section>

      ${cur && cur.status === 'running' ? `
      <section class="section"><div class="card live-banner">
        <div><div class="mono" style="font-size:12px"><span class="pulse"></span>AO VIVO · RODADA ${cur.rounds.length || 1}</div>
        <h2 style="margin:6px 0 2px">${h(cur.name)}</h2><div class="muted">${plural(E.alive(cur).length, 'jogador ainda na disputa', 'jogadores ainda na disputa')}</div></div>
        <a class="btn btn-primary" href="#/sorteio">Acompanhar ▸</a></div></section>` : ''}

      <section class="section grid grid-3">
        <div class="card stat"><b>${recs.length}</b><span>torneios</span></div>
        <div class="card stat"><b>${players.length}</b><span>jogadores</span></div>
        <div class="card stat"><b>${duels}</b><span>duelos disputados</span></div>
      </section>

      <section class="section">
        <div class="eyebrow">Hall da Fama</div><h2 class="page-title" style="font-size:28px">Maiores Campeões</h2><p class="page-sub">Quem mais levantou a taça</p>
        ${hall.length ? `<div class="podium">${hall.slice(0, 3).map(champCard).join('')}</div>
          ${hall.length > 3 ? `<div class="carousel" style="margin-top:14px">${hall.slice(3, 10).map((s, i) => champCard(s, i + 3)).join('')}</div>` : ''}
          <p style="text-align:center;margin-top:14px"><a href="#/hall">Ver Hall da Fama completo (${hall.length}) ▸</a></p>`
          : '<div class="empty">Nenhum campeão ainda. Comece o primeiro torneio em <a href="#/sorteio">Sorteio</a>!</div>'}
      </section>

      <section class="section">
        <h2 class="section-title">Últimos torneios ${recs.length ? `<a href="#/historico">Histórico completo (${recs.length}) ▸</a>` : ''}</h2>
        ${recs.length ? recs.slice(0, 4).map((t) => tournamentCard(t)).join('') : '<div class="empty">Nenhum torneio finalizado ainda.</div>'}
      </section>`;
  }

  // ---------- Sorteio / torneio ----------
  const draft = { name: '', date: '', lives: C.defaultLives, players: [] };

  function viewSorteio() {
    const cur = state.current;
    if (!cur) return viewSetup();
    return viewRunning(cur);
  }

  function viewSetup() {
    const can = S.canWrite();
    const known = E.allPlayers(state.records).filter((n) => !draft.players.some((p) => E.key(p) === E.key(n)));
    const freq = E.playerStats(state.records).sort((a, b) => b.participations - a.participations).map((s) => s.name)
      .filter((n) => known.includes(n)).slice(0, 24);
    if (!draft.date) draft.date = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

    return `${head('Sorteio', 'Novo Torneio', 'Cadastre os participantes e deixe o sorteio montar os duelos')}
      ${!can ? loginHint() : ''}
      <div class="card" style="max-width:760px;margin:0 auto">
        <div class="form-row">
          <div class="field"><label for="tName">Nome do torneio</label><input class="input" id="tName" placeholder="Ex.: Terça Maluca" value="${h(draft.name)}" maxlength="60"></div>
          <div class="field"><label for="tDate">Data</label><input class="input" id="tDate" type="date" value="${h(draft.date)}"></div>
          <div class="field"><label for="tLives">Vidas</label><input class="input" id="tLives" type="number" min="1" max="9" value="${h(draft.lives)}"></div>
        </div>
        <div class="field" style="margin-top:14px"><label for="pName">Participantes (${draft.players.length})</label>
          <form class="add-row" id="addForm" autocomplete="off">
            <input class="input" id="pName" list="knownPlayers" placeholder="Digite um nome e aperte Enter (ou cole vários separados por vírgula)" maxlength="600">
            <datalist id="knownPlayers">${known.map((n) => `<option value="${h(n)}">`).join('')}</datalist>
            <button class="btn btn-primary" type="submit" aria-label="Adicionar">＋</button>
          </form>
        </div>
        <div style="margin-top:14px">${draft.players.length
          ? `<div class="chips">${draft.players.map((p, i) => `<span class="chip">${h(p)}<button data-rm="${i}" aria-label="Remover ${h(p)}">×</button></span>`).join('')}</div>`
          : '<div class="empty">Nenhum participante adicionado ainda.</div>'}</div>
        ${freq.length ? `<div style="margin-top:16px"><div class="muted" style="font-size:12px;margin-bottom:8px">Jogadores frequentes — toque para adicionar</div>
          <div class="chips">${freq.map((n) => `<button class="chip chip-add" data-add="${h(n)}">＋ ${h(n)}</button>`).join('')}</div></div>` : ''}
        <div style="margin-top:20px;display:grid;gap:10px">
          <button class="btn btn-primary btn-block" id="startBtn" ${draft.players.length < 2 || !can ? 'disabled' : ''}>🎱 Sortear duelos</button>
          ${draft.players.length ? '<button class="btn btn-block btn-danger" id="clearDraft">Limpar participantes</button>' : ''}
        </div>
        <p class="legend">Regra: cada jogador tem <b>${h(draft.lives)} vidas</b>. A cada rodada os vivos são sorteados em duelos (com número ímpar, um jogador descansa — “bye”). Quem perde todas as vidas está fora. O último que sobrar é o campeão; o último eliminado é o vice. Campeão sem nenhuma derrota = <b>invicto</b>.</p>
      </div>`;
  }

  function bindSetup() {
    const sync = () => { draft.name = $('#tName').value; draft.date = $('#tDate').value; draft.lives = $('#tLives').value; };
    ['#tName', '#tDate', '#tLives'].forEach((s) => $(s).addEventListener('input', sync));
    $('#tLives').addEventListener('change', () => render());
    const add = (name) => {
      const n = E.norm(name).slice(0, 40); if (!n) return;
      // reaproveita a grafia de um jogador já conhecido
      const known = E.allPlayers(state.records).find((k) => E.key(k) === E.key(n));
      const final = known || n;
      if (draft.players.some((p) => E.key(p) === E.key(final))) return toast(`${final} já está na lista`, true);
      draft.players.push(final);
    };
    $('#addForm').addEventListener('submit', (e) => {
      e.preventDefault(); sync();
      $('#pName').value.split(/[,;\n]/).forEach(add);
      render(); $('#pName').focus();
    });
    $$('[data-rm]').forEach((b) => b.addEventListener('click', () => { sync(); draft.players.splice(+b.dataset.rm, 1); render(); }));
    $$('[data-add]').forEach((b) => b.addEventListener('click', () => { sync(); add(b.dataset.add); render(); }));
    const cl = $('#clearDraft'); if (cl) cl.addEventListener('click', () => { draft.players = []; render(); });
    $('#startBtn').addEventListener('click', () => guard(async () => {
      sync();
      if (!S.canWrite()) throw new Error('Entre como administrador.');
      if (!draft.name.trim()) { $('#tName').focus(); throw new Error('Dê um nome ao torneio.'); }
      const t = E.newTournament({ name: draft.name, date: draft.date, lives: draft.lives, players: draft.players });
      if (t.participants.length < 2) throw new Error('Adicione ao menos 2 jogadores.');
      E.drawRound(t);
      state.current = t; state.undo = [];
      await saveCurrent();
      Object.assign(draft, { name: '', date: '', lives: C.defaultLives, players: [] });
      await drawAnimation(t);
      render();
    }));
  }

  function viewRunning(t) {
    const can = S.canWrite();
    const r = E.currentRound(t);
    const open = E.roundOpen(r);
    const finished = t.status === 'finished';
    const alive = E.alive(t).sort((a, b) => a.losses - b.losses || a.name.localeCompare(b.name));
    const out = t.participants.filter((p) => p.eliminated).sort((a, b) => b.eliminatedRound - a.eliminatedRound);
    const closed = t.rounds.filter((x) => x.closed);

    let main = '';
    if (finished) {
      main = `<div class="card celebrate"><div class="trophy">🏆</div><div class="muted">Campeão${t.undefeated ? ' INVICTO' : ''}</div><h2>${h(t.winner)}</h2>
        <div class="muted">Vice: <b style="color:var(--text)">${h(t.runnerUp || '—')}</b> · ${plural(closed.length, 'rodada', 'rodadas')}</div>
        <div class="btn-row" style="justify-content:center;margin-top:18px">${can ? '<button class="btn btn-primary" id="newT">Novo torneio</button>' : ''}<a class="btn" href="#/historico">Ver no histórico</a></div>
        <p class="muted" style="font-size:12px;margin-top:10px">Torneio salvo no histórico automaticamente.</p></div>`;
    } else if (open) {
      const done = r.winners.filter(Boolean).length;
      main = `<div class="card"><h2 class="section-title">Rodada ${t.rounds.length} <span class="muted mono" style="font-size:13px">${done}/${r.duels.length} definidos</span></h2>
        ${can ? '<p class="muted" style="margin-top:-6px;font-size:13px">Toque no nome de quem venceu cada duelo.</p>' : ''}
        ${r.duels.map((d, i) => {
          const w = r.winners[i];
          const btn = (n) => `<button class="pick ${w ? (w === n ? 'win' : 'lose') : ''}" data-duel="${i}" data-name="${h(n)}" ${can ? '' : 'disabled'}>${h(n)}</button>`;
          return `<div class="duel ${state.justDrawn ? 'anim' : ''}" style="animation-delay:${i * 60}ms"><span class="n">DUELO ${i + 1}</span>${btn(d[0])}<span class="vs">vs</span>${btn(d[1])}</div>`;
        }).join('')}
        ${r.byes.map((b) => `<div class="bye">😴 <b>${h(b)}</b> descansa nesta rodada (bye)</div>`).join('')}
        ${can ? `<button class="btn btn-primary btn-block" id="closeRound" style="margin-top:14px" ${E.canCloseRound(t) ? '' : 'disabled'}>Confirmar resultados da rodada ${t.rounds.length}</button>` : ''}
      </div>`;
    } else {
      main = `<div class="card" style="text-align:center"><h2 style="margin-top:0">Rodada ${t.rounds.length} encerrada</h2>
        <p class="muted">${plural(alive.length, 'jogador vivo', 'jogadores vivos')}. ${can ? 'Ajuste participantes se precisar e sorteie a próxima.' : 'Aguardando o próximo sorteio…'}</p>
        ${can ? `<button class="btn btn-primary" id="drawNext">🎱 Sortear rodada ${t.rounds.length + 1}</button>` : ''}</div>`;
    }

    return `${head(finished ? 'Torneio finalizado' : 'Torneio em andamento', t.name, `${fmtDate(t.date)} · ${plural(t.participants.length, 'jogador', 'jogadores')} · ${t.lives} vidas`)}
      ${!can ? loginHint(true) : ''}
      <div class="t-layout">
        <div>${main}
          ${closed.length ? `<div class="card" style="margin-top:14px"><details class="rounds" style="border:0;margin:0;padding:0" ${finished ? 'open' : ''}><summary>Rodadas anteriores (${closed.length})</summary>${roundsHtml(closed)}</details></div>` : ''}
        </div>
        <aside>
          <div class="card"><h3 style="margin:0 0 8px;font-size:15px">Na disputa (${alive.length})</h3>
            <ul class="plist">${alive.map((p) => `<li><span>${h(p.name)}</span>${livesHtml(p, t.lives)}</li>`).join('')}</ul>
            ${out.length ? `<h3 style="margin:16px 0 8px;font-size:15px">Eliminados (${out.length})</h3>
              <ul class="plist">${out.map((p) => `<li class="out"><span>${h(p.name)}</span><span class="mono" style="font-size:11px">${p.withdrew ? 'saiu' : 'R' + p.eliminatedRound}</span></li>`).join('')}</ul>` : ''}
          </div>
          ${can ? `<div class="card" style="margin-top:14px;display:grid;gap:8px">
            <button class="btn btn-sm" id="undoBtn" ${state.undo.length ? '' : 'disabled'}>↶ Desfazer última ação</button>
            ${!finished ? `<button class="btn btn-sm" id="lateBtn" ${open ? 'disabled title="Disponível entre rodadas"' : ''}>＋ Incluir jogador</button>
            <button class="btn btn-sm" id="wdBtn" ${open ? 'disabled title="Disponível entre rodadas"' : ''}>⇥ Desistência</button>
            ${open && !r.winners.some(Boolean) ? '<button class="btn btn-sm" id="redrawBtn">⟳ Refazer sorteio da rodada</button>' : ''}` : ''}
            <button class="btn btn-sm btn-danger" id="cancelT">${finished ? 'Fechar torneio' : 'Cancelar torneio'}</button>
          </div>` : ''}
        </aside>
      </div>`;
  }

  function bindRunning() {
    const t = state.current;
    $$('.pick[data-duel]').forEach((b) => b.addEventListener('click', () => guard(async () => {
      await mutate((x) => E.setWinner(x, +b.dataset.duel, b.dataset.name)); render();
    })));
    const on = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', () => guard(fn)); };
    on('#closeRound', async () => { await mutate((x) => E.closeRound(x)); render(); });
    on('#drawNext', async () => { await mutate((x) => E.drawRound(x)); await drawAnimation(state.current); render(); });
    on('#redrawBtn', async () => { await mutate((x) => { x.rounds.pop(); E.drawRound(x); }); await drawAnimation(state.current); render(); });
    on('#undoBtn', undo);
    on('#newT', async () => { state.current = null; state.undo = []; await saveCurrent(); render(); });
    on('#cancelT', async () => {
      if (t.status !== 'finished' && !(await ask('Cancelar este torneio? Ele NÃO será salvo no histórico.', 'Cancelar torneio'))) return;
      state.current = null; state.undo = []; await saveCurrent(); render();
    });
    on('#wdBtn', async () => {
      const o = overlay(`<div class="card modal"><h2>Desistência</h2><p class="muted">O jogador sai do torneio sem somar derrota.</p>
        <select class="input" id="wdSel">${E.alive(t).map((p) => `<option>${h(p.name)}</option>`).join('')}</select>
        <div class="btn-row" style="margin-top:14px"><button class="btn btn-primary" id="wdOk">Confirmar</button><button class="btn" id="wdX">Voltar</button></div></div>`);
      $('#wdX', o).onclick = closeOverlay;
      $('#wdOk', o).onclick = () => guard(async () => { const n = $('#wdSel', o).value; closeOverlay(); await mutate((x) => E.withdraw(x, n)); render(); });
    });
    on('#lateBtn', async () => {
      const known = E.allPlayers(state.records).filter((n) => !t.participants.some((p) => E.key(p.name) === E.key(n)));
      const o = overlay(`<div class="card modal"><h2>Incluir jogador</h2>
        <div class="field"><label>Nome</label><input class="input" id="lateName" list="lateList"><datalist id="lateList">${known.map((n) => `<option value="${h(n)}">`).join('')}</datalist></div>
        <div class="field" style="margin-top:10px"><label>Começa com quantas derrotas?</label><input class="input" id="lateLoss" type="number" min="0" max="${t.lives - 1}" value="${Math.min(t.lives - 1, Math.max(...t.participants.map((p) => p.losses)))}"></div>
        <div class="btn-row" style="margin-top:14px"><button class="btn btn-primary" id="lateOk">Incluir</button><button class="btn" id="lateX">Voltar</button></div></div>`);
      $('#lateX', o).onclick = closeOverlay;
      $('#lateOk', o).onclick = () => guard(async () => {
        const n = $('#lateName', o).value, l = +$('#lateLoss', o).value || 0;
        await mutate((x) => E.addLatePlayer(x, n, l)); closeOverlay(); render();
      });
    });
  }

  function drawAnimation(t) {
    state.justDrawn = true; setTimeout(() => (state.justDrawn = false), 2500);
    return new Promise((resolve) => {
      const names = t.participants.filter((p) => !p.eliminated).map((p) => p.name);
      const o = overlay(`<div class="draw-anim"><div class="ball8"></div><div class="muted mono">SORTEANDO DUELOS · RODADA ${t.rounds.length}</div>
        <div class="spin" id="spin"></div><button class="btn btn-sm" id="skip" style="margin-top:16px">Pular</button></div>`);
      o.dataset.lock = '1';
      let i = 0;
      const iv = setInterval(() => { $('#spin', o).textContent = names[i++ % names.length]; }, 90);
      const done = () => { clearInterval(iv); clearTimeout(to); delete o.dataset.lock; closeOverlay(); resolve(); };
      const to = setTimeout(done, 1600);
      $('#skip', o).onclick = done;
    });
  }

  function celebrate(t) {
    overlay(`<div class="card modal celebrate"><div class="trophy">🏆</div><div class="muted">${h(t.name)}</div>
      <h2>${h(t.winner)}</h2><div>${t.undefeated ? '<span class="tag gold">CAMPEÃO INVICTO</span>' : 'é o campeão!'}</div>
      <p class="muted">Vice: ${h(t.runnerUp || '—')}</p><button class="btn btn-primary" onclick="document.getElementById('overlay').click()">Fechar</button></div>`);
  }

  // ---------- Ranking ----------
  const rankSort = { key: 'points', dir: -1 };
  function viewRanking() {
    const sc = C.scoring.ranking;
    let rows = E.ranking(state.records, sc);
    const pos = new Map(rows.map((r, i) => [r.name, i + 1]));
    const k = rankSort.key;
    if (k !== 'points') rows = rows.slice().sort((a, b) => (typeof a[k] === 'string' ? a[k].localeCompare(b[k]) : a[k] - b[k]) * rankSort.dir || a.name.localeCompare(b.name));
    else if (rankSort.dir === 1) rows = rows.slice().reverse();
    const cols = [['pos', '#'], ['name', 'Nome'], ['titles', '🏆 Títulos'], ['vices', '🥈 Vices'], ['undefeated', '⭐ Invictos'], ['participations', '🎱 Torneios'], ['wins', '✅ Vitórias'], ['losses', '❌ Derrotas'], ['winPct', '📊 % Vitória'], ['points', '🏅 Pontos']];

    return `${head('Ranking', 'Estatísticas dos Jogadores', 'Desempenho completo em duelos e torneios')}
      ${rows.length ? `<div class="table-wrap"><table><thead><tr>${cols.map(([c, l]) => `<th data-sort="${c}" class="${c === 'name' ? 'name' : ''} ${rankSort.key === c ? 'sorted' : ''}">${l}${rankSort.key === c ? (rankSort.dir < 0 ? ' ▾' : ' ▴') : ''}</th>`).join('')}</tr></thead>
        <tbody>${rows.map((s) => { const p = pos.get(s.name); return `<tr class="rank-${p}"><td>${p}</td><td class="name"><a href="#/1x1?a=${encodeURIComponent(s.name)}">${h(s.name)}</a></td><td>${s.titles}</td><td>${s.vices}</td><td>${s.undefeated}</td><td>${s.participations}</td><td>${s.wins}</td><td>${s.losses}</td>
          <td><div style="display:flex;align-items:center;gap:8px;justify-content:center">${pct(s.winPct)}<div class="bar"><i style="width:${s.winPct}%"></i></div></div></td><td class="pts">${s.points.toLocaleString('pt-BR')}</td></tr>`; }).join('')}</tbody></table></div>`
        : '<div class="empty">Nenhum jogador registrado ainda. Finalize um torneio para aparecer aqui.</div>'}
      <section class="section card"><h2 class="section-title">Como os pontos são calculados</h2>
        <div class="legend">🏆 Título = <b>${sc.title}</b> pts · ⭐ Título invicto = <b>+${sc.undefeated}</b> · 🥈 Vice = <b>${sc.vice}</b> · ✅ Vitória em duelo = <b>${sc.win}</b> ·
        📊 Aproveitamento = <b>${sc.winPct}</b> pt por % · 🎱 Frequência = log₂(torneios + 1) × <b>${sc.participation}</b><br>
        <span class="muted">Clique no cabeçalho para ordenar. Valores ajustáveis em <code>config.js</code>.</span></div></section>`;
  }
  function bindRanking() {
    $$('th[data-sort]').forEach((th) => th.addEventListener('click', () => {
      let k = th.dataset.sort; if (k === 'pos') k = 'points';
      rankSort.dir = rankSort.key === k ? -rankSort.dir : (k === 'name' || k === 'losses' ? 1 : -1);
      rankSort.key = k; render();
    }));
  }

  // ---------- 1x1 ----------
  function viewH2H(params) {
    const players = E.allPlayers(state.records);
    const a = params.get('a') || '', b = params.get('b') || '';
    const opt = (sel) => `<option value="">— escolher —</option>${players.map((n) => `<option ${n === sel ? 'selected' : ''}>${h(n)}</option>`).join('')}`;
    let body = '';
    if (a && b && a !== b) {
      const r = E.headToHead(state.records, a, b);
      const st = new Map(E.playerStats(state.records).map((s) => [s.name, s]));
      const sa = st.get(a) || {}, sb = st.get(b) || {};
      const row = (label, k, fmt = (x) => x ?? 0, higher = true) => {
        const x = sa[k] ?? 0, y = sb[k] ?? 0;
        const ca = x === y ? '' : (x > y) === higher ? 'better' : '', cb = x === y ? '' : (y > x) === higher ? 'better' : '';
        return `<tr><td class="${ca}">${fmt(x)}</td><td>${label}</td><td class="${cb}">${fmt(y)}</td></tr>`;
      };
      body = `
        <div class="card" style="margin-top:18px"><div class="score">
          <div><div class="num ${r.a > r.b ? 'lead' : ''}">${r.a}</div><div class="who">${h(a)}</div></div>
          <div class="muted mono">${plural(r.duels.length, 'duelo', 'duelos')}</div>
          <div><div class="num ${r.b > r.a ? 'lead' : ''}">${r.b}</div><div class="who">${h(b)}</div></div></div>
          ${r.duels.length ? `<div class="bar" style="height:10px;margin-top:16px"><i style="width:${(r.a / r.duels.length) * 100}%"></i></div>` : ''}
        </div>
        <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(280px,1fr));margin-top:14px">
          <div class="card"><h3 style="margin-top:0;font-size:15px">Comparativo geral</h3><table class="cmp"><tbody>
            ${row('Títulos', 'titles')}${row('Invictos', 'undefeated')}${row('Vices', 'vices')}${row('Torneios', 'participations')}${row('Vitórias', 'wins')}${row('Derrotas', 'losses', undefined, false)}${row('% Vitória', 'winPct', pct)}
          </tbody></table></div>
          <div class="card"><h3 style="margin-top:0;font-size:15px">Histórico de duelos diretos</h3>
            ${r.duels.length ? `<ul class="plist">${r.duels.map((d) => `<li><span><b style="color:var(--felt-2)">✓ ${h(d.winner)}</b>${d.final ? ' <span class="tag gold">final</span>' : ''}<br><small class="muted">${h(d.tournament)} · R${d.round}</small></span><span class="muted mono" style="font-size:12px">${fmtDate(d.date)}</span></li>`).join('')}</ul>`
              : '<div class="empty">Esses dois ainda não se enfrentaram.</div>'}</div>
        </div>`;
    } else if (a && a === b) body = '<div class="empty" style="margin-top:18px">Escolha dois jogadores diferentes.</div>';
    return `${head('Estatísticas', 'Confronto 1×1', 'Compare dois jogadores e veja o histórico de duelos diretos')}
      <div class="card"><div class="vs-pick">
        <div class="field"><label>Jogador A</label><select class="input" id="pa">${opt(a)}</select></div>
        <div class="big">VS</div>
        <div class="field"><label>Jogador B</label><select class="input" id="pb">${opt(b)}</select></div></div></div>${body}`;
  }
  function bindH2H() {
    const go = () => { const q = new URLSearchParams(); if ($('#pa').value) q.set('a', $('#pa').value); if ($('#pb').value) q.set('b', $('#pb').value); location.hash = '#/1x1?' + q; };
    $('#pa').addEventListener('change', go); $('#pb').addEventListener('change', go);
  }

  // ---------- Histórico ----------
  let histFilter = '';
  function viewHistory() {
    const admin = S.canWrite();
    const recs = sortedRecords().filter((t) => !histFilter || E.key(JSON.stringify([t.name, t.participants])).includes(E.key(histFilter)));
    return `${head('Histórico', 'Torneios Anteriores', `${plural(state.records.length, 'torneio disputado', 'torneios disputados')}`)}
      <input class="input" id="hf" placeholder="Filtrar por nome do torneio ou jogador…" value="${h(histFilter)}" style="margin-bottom:14px">
      <div id="hl">${recs.length ? recs.map((t) => tournamentCard(t, { admin })).join('') : '<div class="empty">Nenhum torneio encontrado.</div>'}</div>`;
  }
  function bindHistory() {
    const f = $('#hf');
    f.addEventListener('input', () => { histFilter = f.value; const pos = f.selectionStart; render(); const g = $('#hf'); g.focus(); g.setSelectionRange(pos, pos); });
    $$('[data-del]').forEach((b) => b.addEventListener('click', () => guard(async () => {
      const t = state.records.find((r) => r.id === b.dataset.del);
      if (!(await ask(`Excluir o torneio "${t.name}" (${fmtDate(t.date)})? Isso altera ranking e estatísticas.`, 'Excluir'))) return;
      await S.deleteTournament(t.id); state.records = state.records.filter((r) => r.id !== t.id); toast('Torneio excluído'); render();
    })));
  }

  // ---------- Hall da Fama ----------
  function viewHall() {
    const hall = E.hallOfFame(state.records);
    return `${head('Hall da Fama', 'Ranking de Campeões', 'Todos que já levantaram a taça ou bateram na trave')}
      ${hall.length ? `<div class="podium">${hall.slice(0, 3).map(champCard).join('')}</div>
        ${hall.length > 3 ? `<div class="grid grid-auto" style="margin-top:14px">${hall.slice(3).map((s, i) => champCard(s, i + 3)).join('')}</div>` : ''}`
        : '<div class="empty">Nenhum campeão ainda.</div>'}`;
  }

  // ---------- Melhores do mês ----------
  let monthSel = '';
  function viewMonth() {
    const ms = E.months(state.records);
    if (!ms.includes(monthSel)) monthSel = ms[0] || '';
    const sc = C.scoring.monthly;
    const { tournaments, rows } = monthSel ? E.monthly(state.records, monthSel, sc) : { tournaments: 0, rows: [] };
    const top = (k, min = 0) => rows.filter((r) => r[k] > min).slice().sort((a, b) => b[k] - a[k] || b.points - a.points)[0];
    const eligible = rows.filter((r) => r.games >= 5);
    const best = eligible.slice().sort((a, b) => b.winPct - a.winPct || b.games - a.games)[0];
    const hl = [
      ['👑', 'Rei do mês', rows[0], (r) => `${r.points.toLocaleString('pt-BR')} pts`],
      ['🏆', 'Mais títulos', top('titles'), (r) => plural(r.titles, 'título', 'títulos')],
      ['✅', 'Mais vitórias', top('wins'), (r) => plural(r.wins, 'vitória', 'vitórias')],
      ['📊', 'Melhor aproveitamento', best, (r) => `${pct(r.winPct)} em ${r.games} duelos`],
      ['🎱', 'Mais presente', top('participations'), (r) => plural(r.participations, 'torneio', 'torneios')],
      ['🥈', 'Mais vices', top('vices'), (r) => plural(r.vices, 'vice', 'vices')],
    ];
    return `${head('Power Ranking', 'Melhores do Mês', 'Destaques e estatísticas por período')}
      ${ms.length ? `<div style="display:flex;gap:10px;align-items:center;justify-content:center;margin-bottom:22px;flex-wrap:wrap">
          <select class="input" id="ms" style="max-width:240px">${ms.map((m) => `<option value="${m}" ${m === monthSel ? 'selected' : ''}>${fmtMonth(m)}</option>`).join('')}</select>
          <span class="muted">${plural(tournaments, 'torneio', 'torneios')}</span></div>
        <div class="grid grid-3 highlights">${hl.map(([ico, label, r, fmt]) => `<div class="card"><div class="ico">${ico}</div><small>${label}</small><b>${r ? h(r.name) : '—'}</b><small>${r ? fmt(r) : ''}</small></div>`).join('')}</div>
        <section class="section"><h2 class="section-title">Power Ranking de ${fmtMonth(monthSel)}</h2>
          <div class="table-wrap"><table><thead><tr><th>#</th><th class="name">Nome</th><th>🏆</th><th>⭐</th><th>🥈</th><th>✅ V</th><th>❌ D</th><th>📊 %</th><th>🎱</th><th>Pts</th></tr></thead>
          <tbody>${rows.map((s, i) => `<tr class="rank-${i + 1}"><td>${i + 1}</td><td class="name">${h(s.name)}</td><td>${s.titles}</td><td>${s.undefeated}</td><td>${s.vices}</td><td>${s.wins}</td><td>${s.losses}</td><td>${pct(s.winPct)}</td><td>${s.participations}</td><td class="pts">${s.points.toLocaleString('pt-BR')}</td></tr>`).join('')}</tbody></table></div>
          <p class="legend">Pontuação: 🏆 Título = ${sc.title} · ⭐ Invicto = +${sc.undefeated} · 🥈 Vice = ${sc.vice} · ✅ Vitória em duelo = ${sc.win} · 🎱 Participação = ${sc.participation}. “Melhor aproveitamento” exige ao menos 5 duelos no mês.</p></section>`
        : '<div class="empty">Nenhum dado disponível ainda.</div>'}`;
  }
  function bindMonth() { const s = $('#ms'); if (s) s.addEventListener('change', () => { monthSel = s.value; render(); }); }

  // ---------- Configurações / backup ----------
  function loginHint(live) {
    if (S.mode !== 'supabase') return '';
    return `<div class="card" style="margin:0 auto 16px;max-width:760px;text-align:center;font-size:14px">${live ? '👀 Você está vendo o placar ao vivo. ' : ''}Para ${live ? 'lançar resultados' : 'criar torneios'}, <a href="#/config">entre como administrador</a>.</div>`;
  }

  function viewConfig() {
    const sb = S.mode === 'supabase';
    const players = E.allPlayers(state.records);
    return `${head('Configurações', 'Dados e Backup', sb ? 'Modo online (Supabase)' : 'Modo local — dados salvos neste navegador')}
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr))">
        ${sb ? `<div class="card"><h3 style="margin-top:0">Administrador</h3>
          ${S.user() ? `<p>Conectado como <b>${h(S.user().email)}</b>.</p><button class="btn" id="logout">Sair</button>`
            : `<form id="loginForm" style="display:grid;gap:10px"><input class="input" id="lEmail" type="email" placeholder="E-mail" required autocomplete="username">
              <input class="input" id="lPass" type="password" placeholder="Senha" required autocomplete="current-password"><button class="btn btn-primary">Entrar</button></form>
              <p class="muted" style="font-size:12px">Usuários são criados no painel do Supabase (Authentication → Users).</p>`}</div>`
          : `<div class="card"><h3 style="margin-top:0">Modo local</h3><p class="muted" style="font-size:14px">Tudo fica salvo só neste navegador. Faça backups com frequência. Para placar online compartilhado, configure o Supabase em <code>config.js</code> (veja o README).</p></div>`}
        <div class="card"><h3 style="margin-top:0">Backup</h3>
          <p class="muted" style="font-size:14px">${plural(state.records.length, 'torneio', 'torneios')} · ${plural(players.length, 'jogador', 'jogadores')}</p>
          <div class="btn-row"><button class="btn" id="exp">⬇ Exportar JSON</button>
          <label class="btn ${S.canWrite() ? '' : 'hide'}">⬆ Importar JSON<input type="file" id="imp" accept=".json,application/json" hidden></label></div>
          <label style="display:flex;gap:8px;align-items:center;margin-top:10px;font-size:13px" class="muted ${S.canWrite() ? '' : 'hide'}"><input type="checkbox" id="impReplace"> Substituir tudo ao importar (senão, mescla)</label>
          <p class="muted" style="font-size:12px">A importação aceita o formato de histórico do Serra Pool (lista de torneios com <code>rounds/duels/winners/byes</code>).</p></div>
        ${S.canWrite() && players.length ? `<div class="card"><h3 style="margin-top:0">Renomear / mesclar jogador</h3>
          <div style="display:grid;gap:10px"><select class="input" id="rnFrom">${players.map((n) => `<option>${h(n)}</option>`).join('')}</select>
          <input class="input" id="rnTo" placeholder="Novo nome (ou nome existente para mesclar)" list="rnList"><datalist id="rnList">${players.map((n) => `<option value="${h(n)}">`).join('')}</datalist>
          <button class="btn" id="rnOk">Aplicar</button></div></div>` : ''}
        ${!sb ? `<div class="card"><h3 style="margin-top:0">Zona de perigo</h3><button class="btn btn-danger" id="wipe">Apagar todos os dados</button></div>` : ''}
      </div>`;
  }
  function bindConfig() {
    const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, (e) => guard(() => fn(e))); };
    on('#loginForm', 'submit', async (e) => { e.preventDefault(); await S.signIn($('#lEmail').value, $('#lPass').value); toast('Bem-vindo!'); render(); });
    on('#logout', 'click', async () => { await S.signOut(); render(); });
    on('#exp', 'click', async () => {
      const blob = new Blob([JSON.stringify(await S.exportAll(), null, 2)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = `cantinho-da-tacada-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(a.href);
    });
    on('#imp', 'change', async (e) => {
      const f = e.target.files[0]; if (!f) return;
      const json = JSON.parse(await f.text());
      const replace = $('#impReplace').checked;
      if (replace && !(await ask('Substituir TODO o histórico pelo arquivo importado?', 'Substituir'))) return;
      const n = await S.importAll(json, { merge: !replace });
      if (json.current && !state.current && replace) { state.current = json.current; await saveCurrent(); }
      await loadAll(); toast(`${plural(n, 'torneio importado', 'torneios importados')}`); render();
    });
    on('#rnOk', 'click', async () => {
      const from = $('#rnFrom').value, to = E.norm($('#rnTo').value);
      if (!to || to === from) throw new Error('Informe um novo nome.');
      if (!(await ask(`Renomear "${from}" para "${to}" em todo o histórico?`, 'Renomear'))) return;
      await S.replaceAll(E.renamePlayer(state.records, from, to)); await loadAll(); toast('Jogador atualizado'); render();
    });
    on('#wipe', 'click', async () => {
      if (!(await ask('Apagar TODOS os torneios deste navegador? Exporte um backup antes.', 'Apagar tudo'))) return;
      await S.replaceAll([]); await S.setCurrent(null); state.undo = []; await loadAll(); render();
    });
  }

  // ============================================================
  //  Roteador
  // ============================================================
  const routes = {
    '': [viewHome],
    sorteio: [viewSorteio, () => (state.current ? bindRunning() : bindSetup())],
    ranking: [viewRanking, bindRanking],
    '1x1': [viewH2H, bindH2H],
    historico: [viewHistory, bindHistory],
    hall: [viewHall],
    mes: [viewMonth, bindMonth],
    config: [viewConfig, bindConfig],
  };

  function parseHash() {
    const raw = location.hash.replace(/^#\/?/, '');
    const [path, qs] = raw.split('?');
    return { path: routes[path] ? path : '', params: new URLSearchParams(qs || '') };
  }

  let lastPath = null;
  function render() {
    if (!state.loaded) { view.innerHTML = '<div class="empty">⏳ Carregando…</div>'; return; }
    const { path, params } = parseHash();
    const [v, bind] = routes[path];
    view.innerHTML = v(params);
    if (bind) bind(params);
    $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === path));
    if (lastPath !== path) window.scrollTo(0, 0);
    lastPath = path;
  }

  // ---------- inicialização ----------
  async function start() {
    document.title = C.clubName;
    $('#brandName').textContent = C.clubName; $('#footName').textContent = C.clubName;
    $('#brandTag').textContent = C.tagline;
    $('#footMode').textContent = S.mode === 'supabase' ? 'Placar online · feito com software livre' : 'Modo local · feito com software livre';
    const c = C.contact || {};
    $('#footContact').innerHTML = [
      c.whatsapp && `<a href="https://wa.me/${encodeURIComponent(c.whatsapp)}" target="_blank" rel="noopener">WhatsApp</a>`,
      c.instagram && `<a href="https://instagram.com/${encodeURIComponent(c.instagram)}" target="_blank" rel="noopener">Instagram</a>`,
    ].filter(Boolean).join('');
    $('#navToggle').addEventListener('click', () => { const n = $('#nav'); n.classList.toggle('open'); $('#navToggle').setAttribute('aria-expanded', n.classList.contains('open')); });
    $('#nav').addEventListener('click', (e) => { if (e.target.tagName === 'A') $('#nav').classList.remove('open'); });
    window.addEventListener('hashchange', render);

    render();
    await guard(async () => { await S.init(); await loadAll(); });
    state.loaded = true;
    render();

    // Placar ao vivo (Supabase realtime)
    S.onCurrentChange(async (data) => {
      if (S.canWrite() && JSON.stringify(data) === JSON.stringify(state.current)) return;
      const finishedNow = data && data.status === 'finished' && !(state.current && state.current.status === 'finished');
      state.current = data;
      if (finishedNow) state.records = await S.listTournaments();
      const p = parseHash().path;
      if (p === 'sorteio' || p === '') render();
    });
    S.onAuth(() => render());
  }

  start();
})();
