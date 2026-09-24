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
  const state = { records: [], current: null, undo: [], loaded: false, schedules: [] };

  // ---------- utilidades ----------
  const h = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtDate = (d) => (d ? d.split('-').reverse().join('/') : '—');
  const todayLocal = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  // Um torneio só está "ao vivo" se estiver rodando e a data dele já chegou
  const isLive = (t) => !!t && t.status === 'running' && !((t.date || '') > todayLocal());
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

  // Banner fotográfico no topo de cada página
  const ROUTE_IMG = { sorteio: 'sorteio', ranking: 'ranking', '1x1': 'duel', historico: 'history', hall: 'hall', mes: 'month', config: 'config' };
  const img = (k) => (C.images && (C.images[k] || C.images.hero)) || '';
  function head(eyebrow, title, sub) {
    const src = img(ROUTE_IMG[parseHash().path] || 'hero');
    return `<section class="banner" style="--img:url('${h(src)}')"><div class="banner__in">
      <div class="eyebrow">${h(eyebrow)}</div><h1 class="page-title">${h(title)}</h1>${sub ? `<p class="page-sub">${h(sub)}</p>` : ''}
    </div></section>`;
  }

  // Bola de sinuca numerada (1–15): posições e destaques
  function ball(n, size = '') {
    const k = ((n - 1) % 15) + 1;
    return `<span class="ball b${k} ${size}" aria-label="${n}º"><i>${n}</i></span>`;
  }
  // "Bola" do jogador: cor fixa pelo nome + iniciais
  function pball(name, size = '') {
    let x = 0; for (const c of String(name)) x = (x * 31 + c.charCodeAt(0)) >>> 0;
    const ini = String(name).trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
    return `<span class="ball pb b${(x % 15) + 1} ${size}" aria-hidden="true"><i>${h(ini)}</i></span>`;
  }

  function livesHtml(p, lives) {
    const left = Math.max(0, lives - p.losses);
    return `<span class="lives" title="${left} de ${lives} vidas" aria-label="${left} de ${lives} vidas">${'<i class="on"></i>'.repeat(left)}${'<i></i>'.repeat(lives - left)}</span>`;
  }

  const flagBadges = (f) => `${f && f.gato ? '<span class="fl fl-gato" title="Gato">🐱</span>' : ''}${f && f.suicidio ? '<span class="fl fl-sui" title="Suicídio">💀</span>' : ''}`;
  function duelMini(d, w, f) {
    const cls = (n) => (w ? (n === w ? 'w' : 'l') : '');
    return `<span class="duel-mini">${flagBadges(f)}<span class="${cls(d[0])}">${w === d[0] ? '✓ ' : ''}${h(d[0])}</span><span class="vs">vs</span><span class="${cls(d[1])}">${w === d[1] ? '✓ ' : ''}${h(d[1])}</span></span>`;
  }

  function roundsHtml(rounds) {
    return rounds.map((r, i) => `
      <div class="round-label">RODADA ${i + 1}</div>
      <div>${r.duels.map((d, j) => duelMini(d, r.winners[j], r.flags && r.flags[j])).join('')}
      ${r.byes.map((b) => `<span class="duel-mini"><span class="vs">bye ·</span> <b>${h(b)}</b> <span class="vs">avança</span></span>`).join('')}</div>`).join('');
  }

  // ---------- persistência ----------
  async function loadAll() {
    const [records, current, schedules] = await Promise.all([S.listTournaments(), S.getCurrent(), S.listSchedules()]);
    state.records = records || [];
    state.current = current || null;
    state.schedules = schedules || [];
    state.loaded = true;
  }

  const lastBy = (t) => t && t.lastBy;
  async function saveCurrent() {
    if (state.current && S.mode === 'supabase' && S.user()) state.current.lastBy = S.displayName();
    await S.setCurrent(state.current);
  }

  function snapshot() {
    state.undo.push(JSON.stringify(state.current));
    if (state.undo.length > 40) state.undo.shift();
  }

  // Muta o torneio atual com desfazer + persistência + histórico ao terminar
  async function mutate(fn, { admin = false } = {}) {
    if (admin ? !S.canWrite() : !S.canScore()) throw new Error(admin ? 'Só o administrador pode fazer isso.' : 'Entre na sua conta para lançar o placar.');
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
      ${ball(i + 1, i < 3 ? 'lg' : '')}
      <h3>${h(s.name)}</h3>
      <div class="titles">${plural(s.titles, 'título', 'títulos')}</div>
      <div class="meta"><span class="tag gold">★ ${plural(s.undefeated, 'invicto', 'invictos')}</span><span class="tag">🥈 ${plural(s.vices, 'vice', 'vices')}</span></div>
    </article>`;
  }

  function tournamentCard(t, { admin = false, open = false } = {}) {
    return `<article class="card tourn" data-id="${h(t.id)}">
      <div class="tourn__head">
        <div><h3>${h(t.name)}</h3><div class="muted mono" style="font-size:12px">${fmtDate(t.date)} · ${plural(t.players, 'jogador', 'jogadores')}${t.lives ? ` · ${t.lives} vidas` : ''}</div></div>
        <div class="tourn__win">${t.winner ? pball(t.winner, 'sm') : ''}<div><b>🏆 ${h(t.winner || '—')}</b><small>vice ${h(t.runnerUp || '—')}</small></div></div>
        <div class="btn-row">${E.isRanked(t) ? '<span class="tag gold">🏆 RANKING</span>' : '<span class="tag">🤝 AMISTOSO</span>'}${t.undefeated ? '<span class="tag gold">INVICTO</span>' : ''}
          ${admin ? `<button class="btn btn-sm" data-rank="${h(t.id)}" title="${E.isRanked(t) ? 'Marcar como amistoso (não vale ranking)' : 'Marcar como válido para o ranking'}">${E.isRanked(t) ? 'Tirar do ranking' : 'Pôr no ranking'}</button>
          <button class="btn btn-sm btn-danger" data-del="${h(t.id)}" title="Excluir torneio">✕</button>` : ''}</div>
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

    const live = isLive(cur);
    const nextS = upcoming()[0];
    const top = hall[0];
    return `
      <section class="hero" style="--img:url('${h(img('hero'))}')">
        <div class="hero__in">
          <div class="hero__copy">
            <div class="eyebrow">Clube de sinuca · desde a primeira tacada</div>
            <h1>${h(C.clubName)}</h1>
            <p>${h(C.tagline)}. Sorteio de duelos, placar ao vivo, ranking e o histórico de cada torneio da casa.</p>
            <div class="btn-row"><a class="btn btn-primary btn-lg" href="${live || S.canWrite() ? '#/sorteio' : '#/historico'}">${live ? 'Acompanhar ao vivo' : S.canWrite() ? 'Montar torneio' : 'Ver torneios'}</a><a class="btn btn-ghost btn-lg" href="#/ranking">Ver ranking</a></div>
          </div>
          <aside class="hero__card">
            ${live ? `<div class="live-tag"><span class="pulse"></span>AO VIVO · RODADA ${cur.rounds.length || 1}</div>
              <h2>${h(cur.name)}</h2>
              <p>${plural(E.alive(cur).length, 'jogador ainda na mesa', 'jogadores ainda na mesa')}</p>
              <div class="hero__balls">${E.alive(cur).slice(0, 8).map((p) => `<span title="${h(p.name)}">${pball(p.name)}</span>`).join('')}</div>
              <a class="btn btn-primary btn-block" href="#/sorteio">Ver os duelos</a>`
            : nextS ? `<div class="live-tag gold">📅 Próximo torneio</div>
              <h2>${h(nextS.name)}</h2>
              <p>${fmtWhen(nextS.startsAt)}${nextS.place ? ' · ' + h(nextS.place) : ''}</p>
              <div class="sched__cd big ${isOpen(nextS) ? 'on' : ''}" data-until="${h(nextS.startsAt)}">${countdown(nextS.startsAt)}</div>
              <a class="btn btn-ghost btn-block" href="#/sorteio">Ver agenda</a>`
            : top ? `<div class="live-tag gold">Maior campeão</div>
              <div class="hero__champ">${pball(top.name, 'lg')}<div><h2>${h(top.name)}</h2><p>${plural(top.titles, 'título', 'títulos')} · ${plural(top.vices, 'vice', 'vices')}</p></div></div>
              <a class="btn btn-ghost btn-block" href="#/hall">Hall da Fama</a>`
            : (S.canWrite() ? `<div class="live-tag">Primeira partida</div><h2>A mesa está livre</h2><p>Cadastre os jogadores e sorteie os primeiros duelos.</p><a class="btn btn-primary btn-block" href="#/sorteio">Começar</a>` : `<div class="live-tag">Em breve</div><h2>A mesa está livre</h2><p>Os torneios aparecem aqui assim que o primeiro for disputado.</p>`)}
          </aside>
        </div>
      </section>

      <section class="statband">
        <div><b>${recs.length}</b><span>torneios</span></div>
        <div><b>${players.length}</b><span>jogadores</span></div>
        <div><b>${duels}</b><span>duelos disputados</span></div>
        <div><b>${recs.filter((t) => t.undefeated).length}</b><span>títulos invictos</span></div>
      </section>

      ${upcoming().length ? `<section class="section">
        <div class="sec-head"><div class="eyebrow">Agenda</div><h2>Próximos torneios</h2><div class="cue" aria-hidden="true"></div></div>
        ${upcoming().slice(0, 3).map((x) => scheduleCard(x)).join('')}
      </section>` : ''}

      <section class="section">
        <div class="sec-head"><div class="eyebrow">Hall da Fama</div><h2>Maiores campeões</h2><div class="cue" aria-hidden="true"></div></div>
        ${hall.length ? `<div class="podium">${hall.slice(0, 3).map(champCard).join('')}</div>
          ${hall.length > 3 ? `<div class="carousel" style="margin-top:14px">${hall.slice(3, 10).map((s, i) => champCard(s, i + 3)).join('')}</div>` : ''}
          <p style="text-align:center;margin-top:14px"><a href="#/hall">Ver Hall da Fama completo (${hall.length}) ▸</a></p>`
          : '<div class="empty">Nenhum campeão ainda. Comece o primeiro torneio em <a href="#/sorteio">Sorteio</a>!</div>'}
      </section>

      <section class="section">
        <div class="sec-head"><div class="eyebrow">Histórico</div><h2>Últimos torneios</h2><div class="cue" aria-hidden="true"></div></div>
        ${recs.length ? `<p class="sec-link"><a href="#/historico">Histórico completo (${recs.length}) ▸</a></p>` : ''}
        ${recs.length ? recs.slice(0, 4).map((t) => tournamentCard(t)).join('') : '<div class="empty">Nenhum torneio finalizado ainda.</div>'}
      </section>`;
  }

  // ---------- Agenda de torneios ----------
  const upcoming = () => state.schedules.filter((x) => (x.status || 'scheduled') === 'scheduled')
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const isOpen = (sc) => Date.now() >= new Date(sc.startsAt).getTime();
  const WD = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  function fmtWhen(iso) {
    const d = new Date(iso);
    return `${WD[d.getDay()]}, ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()} às ${String(d.getHours()).padStart(2, '0')}h${String(d.getMinutes()).padStart(2, '0')}`;
  }
  function countdown(iso) {
    let ms = new Date(iso).getTime() - Date.now();
    if (ms <= 0) return 'liberado para começar';
    const m = Math.ceil(ms / 60000), d = Math.floor(m / 1440), hh = Math.floor((m % 1440) / 60), mm = m % 60;
    return 'começa em ' + (d ? `${d}d ${hh}h` : hh ? `${hh}h ${String(mm).padStart(2, '0')}min` : `${mm} min`);
  }
  const localInput = (iso) => { const d = iso ? new Date(iso) : new Date(Date.now() + 86400000); d.setSeconds(0, 0); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
  const ymdLocal = (iso) => localInput(iso).slice(0, 10);

  function scheduleCard(sc, { admin = false } = {}) {
    const open = isOpen(sc);
    return `<article class="card sched ${open ? 'sched--open' : ''}">
      <div class="sched__date"><b>${String(new Date(sc.startsAt).getDate()).padStart(2, '0')}</b><span>${['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'][new Date(sc.startsAt).getMonth()]}</span></div>
      <div class="sched__info"><h3>${h(sc.name)}</h3>
        <div class="muted">${fmtWhen(sc.startsAt)}${sc.place ? ' · ' + h(sc.place) : ''}</div>
        <div class="btn-row" style="gap:6px;margin-top:6px">${sc.ranked !== false ? '<span class="tag gold">🏆 RANKING</span>' : '<span class="tag">🤝 AMISTOSO</span>'}<span class="tag">${sc.lives} vidas</span>${sc.players && sc.players.length ? `<span class="tag">${plural(sc.players.length, 'confirmado', 'confirmados')}</span>` : ''}</div>
        ${sc.notes ? `<p class="muted" style="margin:6px 0 0;font-size:14px">${h(sc.notes)}</p>` : ''}</div>
      <div class="sched__act"><div class="sched__cd ${open ? 'on' : ''}" data-until="${h(sc.startsAt)}">${countdown(sc.startsAt)}</div>
        ${admin ? `<div class="btn-row" style="justify-content:flex-end">
          <button class="btn btn-sm btn-primary" data-sstart="${h(sc.id)}" ${open && !state.current ? '' : 'disabled'} title="${!open ? 'Só pode começar na data e hora agendadas' : state.current ? 'Finalize o torneio em andamento antes' : 'Iniciar agora'}">▶ Iniciar</button>
          <button class="btn btn-sm" data-sedit="${h(sc.id)}">Editar</button>
          <button class="btn btn-sm btn-danger" data-sdel="${h(sc.id)}" title="Cancelar agendamento">✕</button></div>` : ''}
      </div></article>`;
  }
  function scheduleList({ admin = false } = {}) {
    const list = upcoming();
    return `<section class="section" style="margin-top:0;margin-bottom:28px">
      <div class="section-title"><span>📅 Agenda de torneios</span>${admin ? '<button class="btn btn-sm btn-primary" id="sNew">＋ Agendar torneio</button>' : ''}</div>
      ${list.length ? list.map((x) => scheduleCard(x, { admin })).join('') : `<div class="empty">Nenhum torneio agendado.${admin ? ' Use “Agendar torneio” para marcar o próximo do ranking.' : ''}</div>`}
    </section>`;
  }
  function scheduleForm(sc, prefill) {
    const e = sc || { name: '', startsAt: null, lives: C.defaultLives, ranked: true, players: [], place: '', notes: '', ...(prefill || {}) };
    const known = E.allPlayers(state.records);
    const o = overlay(`<form class="card modal" id="sForm" style="max-width:560px">
      <h2>${sc ? 'Editar agendamento' : 'Agendar torneio'}</h2>
      <div style="display:grid;gap:12px">
        <div class="field"><label for="sfName">Nome</label><input class="input" id="sfName" required maxlength="60" placeholder="Ex.: Etapa 5 do Ranking" value="${h(e.name)}"></div>
        <div class="form-row" style="grid-template-columns:1fr 110px">
          <div class="field"><label for="sfWhen">Data e hora de início</label><input class="input" id="sfWhen" type="datetime-local" required value="${localInput(e.startsAt)}"></div>
          <div class="field"><label for="sfLives">Vidas</label><input class="input" id="sfLives" type="number" min="1" max="9" value="${h(e.lives)}"></div></div>
        <div class="field"><label for="sfPlace">Local (opcional)</label><input class="input" id="sfPlace" maxlength="60" value="${h(e.place || '')}"></div>
        <label class="switch"><input type="checkbox" id="sfRanked" ${e.ranked !== false ? 'checked' : ''}><span class="switch__ui" aria-hidden="true"></span><span><b>Vale para o Ranking da temporada</b></span></label>
        <div class="field"><label for="sfPlayers">Jogadores confirmados (opcional, separados por vírgula)</label>
          <textarea class="input" id="sfPlayers" rows="3" placeholder="Pode completar na hora de iniciar">${h((e.players || []).join(', '))}</textarea>
          ${known.length ? `<div class="chips" style="margin-top:6px">${known.slice(0, 30).map((n) => `<button type="button" class="chip chip-add" data-sfadd="${h(n)}">＋ ${h(n)}</button>`).join('')}</div>` : ''}</div>
        <div class="field"><label for="sfNotes">Observações (opcional)</label><input class="input" id="sfNotes" maxlength="140" value="${h(e.notes || '')}"></div>
      </div>
      <p class="legend">O torneio só poderá ser iniciado a partir da data e hora marcadas. A regra também é conferida pelo servidor.</p>
      <div class="btn-row"><button class="btn btn-primary" type="submit">${sc ? 'Salvar' : 'Agendar'}</button><button class="btn" type="button" id="sfX">Voltar</button></div>
    </form>`);
    $('#sfX', o).onclick = closeOverlay;
    $$('[data-sfadd]', o).forEach((b) => b.addEventListener('click', () => {
      const ta = $('#sfPlayers', o); const cur = ta.value.split(',').map(E.norm).filter(Boolean);
      if (!cur.includes(b.dataset.sfadd)) ta.value = cur.concat(b.dataset.sfadd).join(', ');
      b.remove();
    }));
    $('#sForm', o).addEventListener('submit', (ev) => { ev.preventDefault(); guard(async () => {
      const when = $('#sfWhen', o).value; if (!when) throw new Error('Informe data e hora.');
      const startsAt = new Date(when).toISOString();
      if (!sc && new Date(startsAt) < new Date(Date.now() - 60000)) throw new Error('Escolha uma data e hora no futuro.');
      const players = [...new Set($('#sfPlayers', o).value.split(/[,;\n]/).map(E.norm).filter(Boolean))];
      const rec = { ...(sc || {}), id: (sc && sc.id) || E.uid(), name: E.norm($('#sfName', o).value) || 'Torneio do Ranking', startsAt,
        lives: Math.max(1, parseInt($('#sfLives', o).value, 10) || C.defaultLives), ranked: $('#sfRanked', o).checked,
        place: E.norm($('#sfPlace', o).value), notes: E.norm($('#sfNotes', o).value), players, status: 'scheduled' };
      await S.saveSchedule(rec);
      state.schedules = state.schedules.filter((x) => x.id !== rec.id).concat(rec);
      if (prefill && prefill.fromDraft) Object.assign(draft, { name: '', date: '', lives: C.defaultLives, players: [], ranked: true, scheduledId: null });
      closeOverlay(); toast(sc ? 'Agendamento atualizado' : `Torneio agendado para ${fmtWhen(startsAt)}`); render();
    }); });
  }
  function bindSchedules() {
    const n = $('#sNew'); if (n) n.addEventListener('click', () => scheduleForm(null));
    $$('[data-sedit]').forEach((b) => b.addEventListener('click', () => scheduleForm(state.schedules.find((x) => x.id === b.dataset.sedit))));
    $$('[data-sdel]').forEach((b) => b.addEventListener('click', () => guard(async () => {
      const sc = state.schedules.find((x) => x.id === b.dataset.sdel);
      if (!(await ask(`Cancelar o agendamento "${sc.name}" (${fmtWhen(sc.startsAt)})?`, 'Cancelar agendamento'))) return;
      await S.deleteSchedule(sc.id); state.schedules = state.schedules.filter((x) => x.id !== sc.id); toast('Agendamento cancelado'); render();
    })));
    $$('[data-sstart]').forEach((b) => b.addEventListener('click', () => {
      const sc = state.schedules.find((x) => x.id === b.dataset.sstart);
      if (!isOpen(sc)) return toast(`Este torneio só pode começar ${fmtWhen(sc.startsAt)}.`, true);
      Object.assign(draft, { name: sc.name, date: ymdLocal(sc.startsAt), lives: sc.lives, ranked: sc.ranked !== false, players: (sc.players || []).slice(), scheduledId: sc.id });
      render(); const f = $('#tName'); if (f) f.scrollIntoView({ behavior: 'smooth', block: 'center' });
      toast('Confira os jogadores presentes e clique em “Sortear duelos”.');
    }));
  }

  // ---------- Sorteio / torneio ----------
  const draft = { name: '', date: '', lives: C.defaultLives, players: [], ranked: true };

  function viewSorteio() {
    const cur = state.current;
    if (!cur) return viewSetup();
    return viewRunning(cur);
  }

  function viewSetup() {
    const can = S.canWrite();
    if (!can && S.mode === 'supabase') {
      return `${head('Sorteio', 'Nenhum torneio em andamento', 'Quando o administrador criar o torneio, os duelos aparecem aqui ao vivo.')}
        ${scheduleList()}
        <div class="empty" style="max-width:640px;margin:0 auto">A mesa está livre no momento. Veja o <a href="#/ranking">ranking</a> ou o <a href="#/historico">histórico</a> enquanto isso.</div>
        ${S.user() ? '' : '<p style="text-align:center;margin-top:18px;font-size:14px" class="muted">Quer ajudar a lançar o placar? <a href="#/config">Entre ou crie sua conta</a></p>'}`;
    }
    const known = E.allPlayers(state.records).filter((n) => !draft.players.some((p) => E.key(p) === E.key(n)));
    const freq = E.playerStats(state.records).sort((a, b) => b.participations - a.participations).map((s) => s.name)
      .filter((n) => known.includes(n)).slice(0, 24);
    if (!draft.date) draft.date = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

    const linked = draft.scheduledId && state.schedules.find((x) => x.id === draft.scheduledId);
    const future = !linked && (draft.date || '') > todayLocal();
    return `${head('Sorteio', 'Novo Torneio', 'Cadastre os participantes e deixe o sorteio montar os duelos')}
      ${!can ? loginHint() : ''}
      ${scheduleList({ admin: can })}
      <div class="card" style="max-width:760px;margin:0 auto">
        ${linked ? `<div class="sched-link">📅 Iniciando o torneio agendado <b>${h(linked.name)}</b> (${fmtWhen(linked.startsAt)}). <button class="btn btn-sm" id="unlinkS">Desvincular</button></div>` : '<h3 class="section-title" style="font-size:18px">Começar um torneio agora</h3>'}
        <div class="form-row">
          <div class="field"><label for="tName">Nome do torneio</label><input class="input" id="tName" placeholder="Ex.: Terça Maluca" value="${h(draft.name)}" maxlength="60"></div>
          <div class="field"><label for="tDate">Data</label><input class="input" id="tDate" type="date" value="${h(draft.date)}"></div>
          <div class="field"><label for="tLives">Vidas</label><input class="input" id="tLives" type="number" min="1" max="9" value="${h(draft.lives)}"></div>
        </div>
        <label class="switch" style="margin-top:16px">
          <input type="checkbox" id="tRanked" ${draft.ranked ? 'checked' : ''}>
          <span class="switch__ui" aria-hidden="true"></span>
          <span><b>Vale para o Ranking da temporada</b><small class="muted">Desmarque para amistosos, treinos ou torneios de fora. Eles ficam no histórico, mas não contam pontos.</small></span>
        </label>
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
          ${future ? `<div class="sched-link">📅 A data escolhida (${fmtDate(draft.date)}) é futura. Torneios futuros não começam agora: eles vão para a <b>agenda</b> e só podem ser iniciados no dia e horário marcados.</div>
          <button class="btn btn-primary btn-block" id="toSchedule" ${!can ? 'disabled' : ''}>📅 Agendar para ${fmtDate(draft.date)}</button>`
          : `<button class="btn btn-primary btn-block" id="startBtn" ${draft.players.length < 2 || !can ? 'disabled' : ''}>🎱 Sortear duelos agora</button>`}
          ${draft.players.length ? '<button class="btn btn-block btn-danger" id="clearDraft">Limpar participantes</button>' : ''}
        </div>
        <p class="legend">Regra: cada jogador tem <b>${h(draft.lives)} vidas</b>. A cada rodada os vivos são sorteados em duelos (com número ímpar, um jogador descansa — “bye”). Quem perde todas as vidas está fora. O último que sobrar é o campeão; o último eliminado é o vice. Campeão sem nenhuma derrota = <b>invicto</b>.</p>
      </div>`;
  }

  function bindSetup() {
    bindSchedules();
    const ul = $('#unlinkS'); if (ul) ul.addEventListener('click', () => { draft.scheduledId = null; render(); });
    const sync = () => { draft.name = $('#tName').value; draft.date = $('#tDate').value; draft.lives = $('#tLives').value; draft.ranked = $('#tRanked').checked; };
    ['#tName', '#tDate', '#tLives', '#tRanked'].forEach((s) => $(s).addEventListener('input', sync));
    $('#tDate').addEventListener('change', () => { sync(); render(); });
    const ts = $('#toSchedule');
    if (ts) ts.addEventListener('click', () => { sync(); scheduleForm(null, { name: draft.name, startsAt: new Date(draft.date + 'T20:00').toISOString(), lives: draft.lives, ranked: draft.ranked, players: draft.players.slice(), fromDraft: true }); });
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
    const sb = $('#startBtn'); if (sb) sb.addEventListener('click', () => guard(async () => {
      sync();
      if (!S.canWrite()) throw new Error('Entre como administrador.');
      if (!draft.name.trim()) { $('#tName').focus(); throw new Error('Dê um nome ao torneio.'); }
      const sc = draft.scheduledId && state.schedules.find((x) => x.id === draft.scheduledId);
      if (sc && !isOpen(sc)) throw new Error(`Este torneio só pode começar ${fmtWhen(sc.startsAt)}.`);
      if (!sc && (draft.date || '') > todayLocal()) throw new Error('Data futura: use "Agendar" — o torneio só pode começar no dia marcado.');
      const t = E.newTournament({ name: draft.name, date: draft.date, lives: draft.lives, players: draft.players, ranked: draft.ranked, scheduledId: sc ? sc.id : null });
      if (t.participants.length < 2) throw new Error('Adicione ao menos 2 jogadores.');
      E.drawRound(t);
      state.current = t; state.undo = [];
      await saveCurrent();
      if (sc) { const done = { ...sc, status: 'started', tournamentId: t.id }; await S.saveSchedule(done); state.schedules = state.schedules.map((x) => (x.id === sc.id ? done : x)); }
      Object.assign(draft, { name: '', date: '', lives: C.defaultLives, players: [], ranked: true, scheduledId: null });
      await drawAnimation(t);
      render();
    }));
  }

  function viewRunning(t) {
    const can = S.canScore();      // lança placar (marcador ou admin)
    const adm = S.canWrite();      // gerencia o torneio (só admin)
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
        <div class="btn-row" style="justify-content:center;margin-top:18px">${adm ? '<button class="btn btn-primary" id="newT">Novo torneio</button>' : ''}<a class="btn" href="#/historico">Ver no histórico</a></div>
        <p class="muted" style="font-size:12px;margin-top:10px">Torneio salvo no histórico automaticamente.</p></div>`;
    } else if (open) {
      const done = r.winners.filter(Boolean).length;
      main = `<div class="felt"><h2 class="section-title">Rodada ${t.rounds.length} <span class="mono felt__count">${done}/${r.duels.length} definidos</span></h2>
        ${can ? '<p class="muted" style="margin-top:-6px;font-size:13px">Toque no nome de quem venceu cada duelo.</p>' : ''}
        ${r.duels.map((d, i) => {
          const w = r.winners[i];
          const btn = (n) => `<button class="pick ${w ? (w === n ? 'win' : 'lose') : ''}" data-duel="${i}" data-name="${h(n)}" ${can ? '' : 'disabled'}>${pball(n, 'sm')}<span class="nm">${h(n)}</span></button>`;
          const f = E.flagOf(r, i);
          const fb = (k, ico, label) => `<button class="flag ${f[k] ? 'on' : ''}" data-flag="${k}" data-duel="${i}" aria-pressed="${!!f[k]}" ${can ? '' : 'disabled'} title="${label}">${ico} ${label}</button>`;
          const flags = (can || f.gato || f.suicidio) ? `<div class="flags">${can ? fb('gato', '🐱', 'Gato') + fb('suicidio', '💀', 'Suicídio') : flagBadges(f)}</div>` : '';
          return `<div class="duel ${state.justDrawn ? 'anim' : ''}" style="animation-delay:${i * 60}ms"><span class="n">DUELO ${i + 1}</span>${btn(d[0])}<span class="vs">${ball(8, 'xs')}</span>${btn(d[1])}${flags}</div>`;
        }).join('')}
        ${r.byes.map((b) => `<div class="bye">😴 <b>${h(b)}</b> descansa nesta rodada (bye)</div>`).join('')}
        ${can ? `<button class="btn btn-primary btn-block" id="closeRound" style="margin-top:14px" ${E.canCloseRound(t) ? '' : 'disabled'}>Confirmar resultados da rodada ${t.rounds.length}</button>` : ''}
      </div>`;
    } else {
      main = `<div class="card" style="text-align:center"><h2 style="margin-top:0">Rodada ${t.rounds.length} encerrada</h2>
        <p class="muted">${plural(alive.length, 'jogador vivo', 'jogadores vivos')}. ${can ? (adm ? 'Ajuste participantes se precisar e sorteie a próxima.' : 'Sorteie a próxima rodada.') : 'Aguardando o próximo sorteio…'}</p>
        ${can ? `<button class="btn btn-primary" id="drawNext">🎱 Sortear rodada ${t.rounds.length + 1}</button>` : ''}</div>`;
    }

    return `${head(finished ? 'Torneio finalizado' : 'Torneio em andamento', t.name, `${fmtDate(t.date)} · ${plural(t.participants.length, 'jogador', 'jogadores')} · ${t.lives} vidas · ${E.isRanked(t) ? 'Vale para o ranking' : 'Amistoso (não vale ranking)'}`)}
      ${!can ? loginHint(true) : ''}${S.mode === 'supabase' && lastBy(t) ? `<p class="muted" style="text-align:center;margin:-18px 0 18px;font-size:13px">Último lançamento por <b>${h(lastBy(t))}</b></p>` : ''}
      <div class="t-layout">
        <div>${main}
          ${closed.length ? `<div class="card" style="margin-top:14px"><details class="rounds" style="border:0;margin:0;padding:0" ${finished ? 'open' : ''}><summary>Rodadas anteriores (${closed.length})</summary>${roundsHtml(closed)}</details></div>` : ''}
        </div>
        <aside>
          <div class="card"><h3 style="margin:0 0 8px;font-size:15px">Na disputa (${alive.length})</h3>
            <ul class="plist">${alive.map((p) => `<li><span class="who">${pball(p.name, 'sm')}${h(p.name)}</span>${livesHtml(p, t.lives)}</li>`).join('')}</ul>
            ${out.length ? `<h3 style="margin:16px 0 8px;font-size:15px">Eliminados (${out.length})</h3>
              <ul class="plist">${out.map((p) => `<li class="out"><span>${h(p.name)}</span><span class="mono" style="font-size:11px">${p.withdrew ? 'saiu' : 'R' + p.eliminatedRound}</span></li>`).join('')}</ul>` : ''}
          </div>
          ${can && !adm ? `<div class="card" style="margin-top:14px;display:grid;gap:8px">
            <div class="muted" style="font-size:13px">Você é <b>marcador</b>: pode lançar vencedores, confirmar rodadas e sortear a próxima.</div>
            ${!finished ? `<button class="btn btn-sm" id="undoBtn" ${state.undo.length ? '' : 'disabled'}>↶ Desfazer minha última ação</button>` : ''}
            ${open && !r.winners.some(Boolean) ? '<button class="btn btn-sm" id="redrawBtn">⟳ Refazer sorteio da rodada</button>' : ''}
          </div>` : ''}
          ${adm ? `<div class="card" style="margin-top:14px;display:grid;gap:8px">
            <button class="btn btn-sm" id="rankT" title="Alterar se este torneio conta para o ranking">${E.isRanked(t) ? '🏆 Vale ranking: SIM' : '🤝 Amistoso: não vale ranking'}</button>
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
    $$('.flag[data-flag]').forEach((b) => b.addEventListener('click', () => guard(async () => {
      await mutate((x) => E.toggleFlag(x, +b.dataset.duel, b.dataset.flag)); render();
    })));
    $$('.pick[data-duel]').forEach((b) => b.addEventListener('click', () => guard(async () => {
      await mutate((x) => E.setWinner(x, +b.dataset.duel, b.dataset.name)); render();
    })));
    const on = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', () => guard(fn)); };
    on('#closeRound', async () => { await mutate((x) => E.closeRound(x)); render(); });
    on('#drawNext', async () => { await mutate((x) => E.drawRound(x)); await drawAnimation(state.current); render(); });
    on('#redrawBtn', async () => { await mutate((x) => { x.rounds.pop(); E.drawRound(x); }); await drawAnimation(state.current); render(); });
    on('#undoBtn', undo);
    on('#rankT', async () => {
      await mutate((x) => { x.ranked = !E.isRanked(x); }, { admin: true });
      if (state.current.status === 'finished') { const rec = E.toRecord(state.current); await S.saveTournament(rec); state.records = state.records.filter((r) => r.id !== rec.id).concat(rec); }
      toast(E.isRanked(state.current) ? 'Torneio vale para o ranking' : 'Torneio marcado como amistoso'); render();
    });
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
      $('#wdOk', o).onclick = () => guard(async () => { const n = $('#wdSel', o).value; closeOverlay(); await mutate((x) => E.withdraw(x, n), { admin: true }); render(); });
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
        await mutate((x) => E.addLatePlayer(x, n, l), { admin: true }); closeOverlay(); render();
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
    overlay(`<div class="card modal celebrate">${pball(t.winner, 'xl')}<div class="muted">${h(t.name)}</div>
      <h2>${h(t.winner)}</h2><div>${t.undefeated ? '<span class="tag gold">CAMPEÃO INVICTO</span>' : 'é o campeão!'}</div>
      <p class="muted">Vice: ${h(t.runnerUp || '—')}</p><button class="btn btn-primary" onclick="document.getElementById('overlay').click()">Fechar</button></div>`);
  }

  // ---------- Filtro: válidos para o ranking x demais ----------
  const curYear = String(new Date().getFullYear());
  const flt = {
    ranking: { type: 'ranked', season: null },
    historico: { type: 'all', season: 'all' },
    hall: { type: 'all', season: 'all' },
    mes: { type: 'all', season: 'all' },
    '1x1': { type: 'all', season: 'all' },
  };
  try { const saved = JSON.parse(localStorage.getItem('ctd.filters') || '{}'); for (const k in saved) if (flt[k]) Object.assign(flt[k], saved[k]); } catch {}
  function recsFor(page) {
    const f = flt[page];
    const ss = E.seasons(state.records);
    if (f.season === null) f.season = ss.includes(curYear) ? curYear : (ss[0] || 'all'); // padrão: temporada atual
    if (f.season !== 'all' && !ss.includes(f.season)) f.season = 'all';
    return E.filterRecords(state.records, f);
  }
  function filterBar(page, { season = true } = {}) {
    const f = flt[page];
    const base = E.filterRecords(state.records, { type: 'all', season: f.season || 'all' });
    const n = { ranked: base.filter(E.isRanked).length, friendly: base.filter((r) => !E.isRanked(r)).length, all: base.length };
    const btn = (k, label) => `<button class="seg__btn ${f.type === k ? 'on' : ''}" data-ft="${k}" aria-pressed="${f.type === k}">${label} <span>${n[k]}</span></button>`;
    const ss = E.seasons(state.records);
    return `<div class="filterbar">
      <div class="seg" role="group" aria-label="Tipo de torneio">${btn('ranked', '🏆 Válidos p/ ranking')}${btn('friendly', '🤝 Amistosos')}${btn('all', 'Todos')}</div>
      ${season ? `<label class="season"><span>Temporada</span><select class="input" id="fseason"><option value="all" ${f.season === 'all' ? 'selected' : ''}>Todas</option>${ss.map((y) => `<option value="${y}" ${f.season === y ? 'selected' : ''}>${y}</option>`).join('')}</select></label>` : ''}
    </div>`;
  }
  function bindFilter(page) {
    const save = () => { try { localStorage.setItem('ctd.filters', JSON.stringify(flt)); } catch {} };
    $$('[data-ft]').forEach((b) => b.addEventListener('click', () => { flt[page].type = b.dataset.ft; save(); render(); }));
    const se = $('#fseason'); if (se) se.addEventListener('change', () => { flt[page].season = se.value; save(); render(); });
  }
  const filterLabel = (page) => {
    const f = flt[page];
    return `${f.type === 'ranked' ? 'Só torneios válidos para o ranking' : f.type === 'friendly' ? 'Só amistosos' : 'Todos os torneios'}${f.season && f.season !== 'all' ? ` · temporada ${f.season}` : ''}`;
  };

  // ---------- Ranking ----------
  const rankSort = { key: 'points', dir: -1 };
  function viewRanking() {
    const sc = C.scoring.ranking;
    const recs = recsFor('ranking');
    let rows = E.ranking(recs, sc);
    const pos = new Map(rows.map((r, i) => [r.name, i + 1]));
    const k = rankSort.key;
    if (k !== 'points') rows = rows.slice().sort((a, b) => (typeof a[k] === 'string' ? a[k].localeCompare(b[k]) : a[k] - b[k]) * rankSort.dir || a.name.localeCompare(b.name));
    else if (rankSort.dir === 1) rows = rows.slice().reverse();
    const cols = [['pos', '#'], ['name', 'Nome'], ['titles', '🏆 Títulos'], ['vices', '🥈 Vices'], ['undefeated', '⭐ Invictos'], ['participations', '🎱 Torneios'], ['wins', '✅ Vitórias'], ['losses', '❌ Derrotas'], ['winPct', '📊 % Vitória'], ['gatos', '🐱 Gatos'], ['suicidios', '💀 Suicídios'], ['points', '🏅 Pontos']];

    return `${head('Ranking', flt.ranking.type === 'ranked' && flt.ranking.season !== 'all' ? `Ranking da Temporada ${flt.ranking.season}` : 'Estatísticas dos Jogadores', `${filterLabel('ranking')} · ${plural(recs.length, 'torneio', 'torneios')}`)}
      ${filterBar('ranking')}
      ${rows.length ? `<div class="table-wrap"><table><thead><tr>${cols.map(([c, l]) => `<th data-sort="${c}" class="${c === 'name' ? 'name' : ''} ${rankSort.key === c ? 'sorted' : ''}">${l}${rankSort.key === c ? (rankSort.dir < 0 ? ' ▾' : ' ▴') : ''}</th>`).join('')}</tr></thead>
        <tbody>${rows.map((s) => { const p = pos.get(s.name); return `<tr class="rank-${p}"><td>${p <= 3 ? ball(p, 'xs') : p}</td><td class="name"><a class="who" href="#/1x1?a=${encodeURIComponent(s.name)}">${pball(s.name, 'sm')}${h(s.name)}</a></td><td>${s.titles}</td><td>${s.vices}</td><td>${s.undefeated}</td><td>${s.participations}</td><td>${s.wins}</td><td>${s.losses}</td>
          <td><div style="display:flex;align-items:center;gap:8px;justify-content:center">${pct(s.winPct)}<div class="bar"><i style="width:${s.winPct}%"></i></div></div></td><td title="${s.gatosSofridos} sofridos">${s.gatos}</td><td>${s.suicidios}</td><td class="pts">${s.points.toLocaleString('pt-BR')}</td></tr>`; }).join('')}</tbody></table></div>`
        : '<div class="empty">Nenhum torneio neste filtro. Troque o filtro acima ou finalize um torneio.</div>'}
      <section class="section card"><h2 class="section-title">Como os pontos são calculados</h2>
        <div class="legend">🏆 Título = <b>${sc.title}</b> pts · ⭐ Título invicto = <b>+${sc.undefeated}</b> · 🥈 Vice = <b>${sc.vice}</b> · ✅ Vitória em duelo = <b>${sc.win}</b> ·
        📊 Aproveitamento = <b>${sc.winPct}</b> pt por % · 🎱 Frequência = log₂(torneios + 1) × <b>${sc.participation}</b><br>
        <span class="muted">Clique no cabeçalho para ordenar. Valores ajustáveis em <code>config.js</code>.</span></div></section>`;
  }
  function bindRanking() {
    bindFilter('ranking');
    $$('th[data-sort]').forEach((th) => th.addEventListener('click', () => {
      let k = th.dataset.sort; if (k === 'pos') k = 'points';
      rankSort.dir = rankSort.key === k ? -rankSort.dir : (k === 'name' || k === 'losses' ? 1 : -1);
      rankSort.key = k; render();
    }));
  }

  // ---------- 1x1 ----------
  function viewPair(params) {
    const players = E.allPlayers(state.records);
    const a = params.get('a') || '', b = params.get('b') || '';
    const opt = (sel) => `<option value="">— escolher —</option>${players.map((n) => `<option ${n === sel ? 'selected' : ''}>${h(n)}</option>`).join('')}`;
    let body = '';
    if (a && b && a !== b) {
      const recs = recsFor('1x1');
      const r = E.headToHead(recs, a, b);
      const st = new Map(E.playerStats(recs).map((s) => [s.name, s]));
      const sa = st.get(a) || {}, sb = st.get(b) || {};
      const row = (label, k, fmt = (x) => x ?? 0, higher = true) => {
        const x = sa[k] ?? 0, y = sb[k] ?? 0;
        const ca = x === y ? '' : (x > y) === higher ? 'better' : '', cb = x === y ? '' : (y > x) === higher ? 'better' : '';
        return `<tr><td class="${ca}">${fmt(x)}</td><td>${label}</td><td class="${cb}">${fmt(y)}</td></tr>`;
      };
      body = `
        <div class="card" style="margin-top:18px"><div class="score">
          <div>${pball(a, 'lg')}<div class="num ${r.a > r.b ? 'lead' : ''}">${r.a}</div><div class="who">${h(a)}</div></div>
          <div class="score__mid">${ball(8, 'lg')}<div class="mono">${plural(r.duels.length, 'duelo', 'duelos')}</div></div>
          <div>${pball(b, 'lg')}<div class="num ${r.b > r.a ? 'lead' : ''}">${r.b}</div><div class="who">${h(b)}</div></div></div>
          ${r.duels.length ? `<div class="bar" style="height:10px;margin-top:16px"><i style="width:${(r.a / r.duels.length) * 100}%"></i></div>` : ''}
        </div>
        <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(280px,1fr));margin-top:14px">
          <div class="card"><h3 style="margin-top:0;font-size:15px">Comparativo geral</h3><table class="cmp"><tbody>
            ${row('Títulos', 'titles')}${row('Invictos', 'undefeated')}${row('Vices', 'vices')}${row('Torneios', 'participations')}${row('Vitórias', 'wins')}${row('Derrotas', 'losses', undefined, false)}${row('% Vitória', 'winPct', pct)}${row('🐱 Gatos aplicados', 'gatos')}${row('🐱 Gatos sofridos', 'gatosSofridos', undefined, false)}${row('💀 Suicídios', 'suicidios', undefined, false)}
          </tbody></table></div>
          <div class="card"><h3 style="margin-top:0;font-size:15px">Histórico de duelos diretos</h3>
            ${r.duels.length ? `<ul class="plist">${r.duels.map((d) => `<li><span><b style="color:var(--felt-2)">✓ ${h(d.winner)}</b> ${flagBadges(d)}${d.final ? ' <span class="tag gold">final</span>' : ''}<br><small class="muted">${h(d.tournament)} · R${d.round}</small></span><span class="muted mono" style="font-size:12px">${fmtDate(d.date)}</span></li>`).join('')}</ul>`
              : '<div class="empty">Esses dois ainda não se enfrentaram.</div>'}</div>
        </div>`;
    } else if (a && a === b) body = '<div class="empty" style="margin-top:18px">Escolha dois jogadores diferentes.</div>';
    return `${modeTabs('par')}
      <div class="card"><div class="vs-pick">
        <div class="field"><label>Jogador A</label><select class="input" id="pa">${opt(a)}</select></div>
        <div class="big">VS</div>
        <div class="field"><label>Jogador B</label><select class="input" id="pb">${opt(b)}</select></div></div></div>${body}`;
  }
  function modeTabs(mode) {
    return `<div class="seg" role="tablist" style="margin-bottom:16px">
      <a class="seg__btn ${mode === 'par' ? 'on' : ''}" href="#/1x1" role="tab" aria-selected="${mode === 'par'}">1 × 1</a>
      <a class="seg__btn ${mode === 'grupo' ? 'on' : ''}" href="#/1x1?modo=grupo" role="tab" aria-selected="${mode === 'grupo'}">Grupo de jogadores</a></div>`;
  }

  function viewGroup(params) {
    const players = E.allPlayers(state.records);
    const sel = (params.get('g') || '').split('|').filter((n) => players.includes(n));
    const chips = players.map((n) => `<button class="chip ${sel.includes(n) ? 'chip-on' : 'chip-add'}" data-g="${h(n)}" aria-pressed="${sel.includes(n)}">${sel.includes(n) ? '✓ ' : '＋ '}${h(n)}</button>`).join('');
    let out = '';
    if (sel.length >= 2) {
      const g = E.groupH2H(recsFor('1x1'), sel);
      const order = g.rows.map((r) => r.name);
      out = `
        <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr));margin-top:16px;align-items:start">
          <div class="card"><h3 class="section-title" style="font-size:18px">Consolidado entre eles</h3>
            <div class="table-wrap"><table><thead><tr><th>#</th><th class="name">Jogador</th><th>Duelos</th><th>✅ V</th><th>❌ D</th><th>📊 %</th><th>🐱</th><th>💀</th></tr></thead>
            <tbody>${g.rows.map((r, i) => `<tr class="rank-${i + 1}"><td>${i < 3 && r.games ? ball(i + 1, 'xs') : i + 1}</td><td class="name"><span class="who">${pball(r.name, 'sm')}${h(r.name)}</span></td><td>${r.games}</td><td>${r.wins}</td><td>${r.losses}</td>
              <td><div style="display:flex;align-items:center;gap:8px;justify-content:center">${pct(r.winPct)}<div class="bar"><i style="width:${r.winPct}%"></i></div></div></td><td>${r.gatos}</td><td>${r.suicidios}</td></tr>`).join('')}</tbody></table></div>
            <p class="legend">Conta apenas os duelos em que os dois lados estão no grupo selecionado.</p></div>
          <div class="card"><h3 class="section-title" style="font-size:18px">Cruzamento (linha venceu × coluna)</h3>
            <div class="table-wrap"><table class="matrix"><thead><tr><th class="name">Vitórias de ↓ sobre →</th>${order.map((n) => `<th title="${h(n)}">${pball(n, 'xs')}</th>`).join('')}</tr></thead>
            <tbody>${order.map((a) => `<tr><td class="name"><span class="who">${pball(a, 'xs')}${h(a)}</span></td>${order.map((b) => {
              if (a === b) return '<td class="mx-self">—</td>';
              const w = g.vs(a, b), l = g.vs(b, a);
              const cls = w + l === 0 ? 'mx-none' : w > l ? 'mx-win' : w < l ? 'mx-lose' : 'mx-tie';
              return `<td class="${cls}" title="${h(a)} ${w} × ${l} ${h(b)}"><a href="#/1x1?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}">${w + l ? `${w}–${l}` : '·'}</a></td>`;
            }).join('')}</tr>`).join('')}</tbody></table></div>
            <p class="legend">Verde = leva vantagem · vermelho = em desvantagem · clique numa célula para ver o 1×1.</p></div>
        </div>
        <div class="card" style="margin-top:16px"><h3 class="section-title" style="font-size:18px">Duelos entre os selecionados <span class="muted mono" style="font-size:14px">${plural(g.duels.length, 'duelo', 'duelos')}</span></h3>
          ${g.duels.length ? `<ul class="plist">${g.duels.slice(0, 60).map((d) => `<li><span><b style="color:#7fe0b0">✓ ${h(d.winner)}</b> <span class="muted">venceu</span> ${h(d.loser)} ${flagBadges(d)}<br><small class="muted">${h(d.tournament)} · R${d.round} · ${d.ranked ? 'ranking' : 'amistoso'}</small></span><span class="muted mono" style="font-size:13px">${fmtDate(d.date)}</span></li>`).join('')}</ul>
            ${g.duels.length > 60 ? '<p class="legend">Mostrando os 60 mais recentes.</p>' : ''}` : '<div class="empty">Esses jogadores ainda não se enfrentaram neste filtro.</div>'}
        </div>`;
    } else out = '<div class="empty" style="margin-top:16px">Selecione pelo menos 2 jogadores acima.</div>';
    return `${modeTabs('grupo')}
      <div class="card"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:10px">
        <h3 style="margin:0;font-family:var(--display);text-transform:uppercase;font-weight:600">Escolha os jogadores (${sel.length})</h3>
        <span class="btn-row">${sel.length ? '<button class="btn btn-sm" id="gClear">Limpar</button>' : ''}<button class="btn btn-sm" id="gTop">Top 5 do ranking</button></span></div>
        <div class="chips">${chips || '<span class="muted">Nenhum jogador ainda.</span>'}</div></div>${out}`;
  }

  function viewH2H(params) {
    const grupo = params.get('modo') === 'grupo';
    return `${head('Estatísticas', grupo ? 'Confrontos do Grupo' : 'Confronto 1×1', grupo ? 'Selecione vários jogadores e veja o consolidado só das partidas entre eles' : 'Compare dois jogadores e veja o histórico de duelos diretos')}
      ${filterBar('1x1')}
      ${grupo ? viewGroup(params) : viewPair(params)}`;
  }
  function bindH2H() {
    bindFilter('1x1');
    if (parseHash().params.get('modo') === 'grupo') {
      const cur = (parseHash().params.get('g') || '').split('|').filter(Boolean);
      const setG = (list) => { const q = new URLSearchParams({ modo: 'grupo' }); if (list.length) q.set('g', list.join('|')); location.hash = '#/1x1?' + q; };
      $$('[data-g]').forEach((b) => b.addEventListener('click', () => { const n = b.dataset.g; setG(cur.includes(n) ? cur.filter((x) => x !== n) : cur.concat(n)); }));
      const c = $('#gClear'); if (c) c.addEventListener('click', () => setG([]));
      $('#gTop').addEventListener('click', () => setG(E.ranking(recsFor('1x1'), C.scoring.ranking).slice(0, 5).map((r) => r.name)));
      return;
    }
    const go = () => { const q = new URLSearchParams(); if ($('#pa').value) q.set('a', $('#pa').value); if ($('#pb').value) q.set('b', $('#pb').value); location.hash = '#/1x1?' + q; };
    $('#pa').addEventListener('change', go); $('#pb').addEventListener('change', go);
  }

  // ---------- Histórico ----------
  let histFilter = '';
  function viewHistory() {
    const admin = S.canWrite();
    const recs = recsFor('historico').slice().sort((x, y) => (y.date || '').localeCompare(x.date || '')).filter((t) => !histFilter || E.key(JSON.stringify([t.name, t.participants])).includes(E.key(histFilter)));
    return `${head('Histórico', 'Torneios Anteriores', `${plural(state.records.length, 'torneio disputado', 'torneios disputados')}`)}
      ${filterBar('historico')}
      <input class="input" id="hf" placeholder="Filtrar por nome do torneio ou jogador…" value="${h(histFilter)}" style="margin-bottom:14px">
      <div id="hl">${recs.length ? recs.map((t) => tournamentCard(t, { admin })).join('') : '<div class="empty">Nenhum torneio encontrado.</div>'}</div>`;
  }
  function bindHistory() {
    bindFilter('historico');
    $$('[data-rank]').forEach((b) => b.addEventListener('click', () => guard(async () => {
      const t = state.records.find((r) => r.id === b.dataset.rank);
      const rec = { ...t, ranked: !E.isRanked(t) };
      await S.saveTournament(rec);
      state.records = state.records.map((r) => (r.id === rec.id ? rec : r));
      toast(rec.ranked ? `"${rec.name}" agora vale para o ranking` : `"${rec.name}" marcado como amistoso`); render();
    })));
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
    const hall = E.hallOfFame(recsFor('hall'));
    return `${head('Hall da Fama', 'Ranking de Campeões', filterLabel('hall'))}
      ${filterBar('hall')}
      ${hall.length ? `<div class="podium">${hall.slice(0, 3).map(champCard).join('')}</div>
        ${hall.length > 3 ? `<div class="grid grid-auto" style="margin-top:14px">${hall.slice(3).map((s, i) => champCard(s, i + 3)).join('')}</div>` : ''}`
        : '<div class="empty">Nenhum campeão ainda.</div>'}`;
  }

  // ---------- Melhores do mês ----------
  let monthSel = '';
  function viewMonth() {
    const mrecs = recsFor('mes');
    const ms = E.months(mrecs);
    if (!ms.includes(monthSel)) monthSel = ms[0] || '';
    const sc = C.scoring.monthly;
    const { tournaments, rows } = monthSel ? E.monthly(mrecs, monthSel, sc) : { tournaments: 0, rows: [] };
    const top = (k, min = 0) => rows.filter((r) => r[k] > min).slice().sort((a, b) => b[k] - a[k] || b.points - a.points)[0];
    const eligible = rows.filter((r) => r.games >= 5);
    const best = eligible.slice().sort((a, b) => b.winPct - a.winPct || b.games - a.games)[0];
    const hl = [
      ['👑', 'Rei do mês', rows[0], (r) => `${r.points.toLocaleString('pt-BR')} pts`],
      ['🏆', 'Mais títulos', top('titles'), (r) => plural(r.titles, 'título', 'títulos')],
      ['✅', 'Mais vitórias', top('wins'), (r) => plural(r.wins, 'vitória', 'vitórias')],
      ['📊', 'Melhor aproveitamento', best, (r) => `${pct(r.winPct)} em ${r.games} duelos`],
      ['🐱', 'Rei do gato', top('gatos'), (r) => plural(r.gatos, 'gato aplicado', 'gatos aplicados')],
      ['💀', 'Mais suicídios', top('suicidios'), (r) => plural(r.suicidios, 'suicídio', 'suicídios')],
      ['🎱', 'Mais presente', top('participations'), (r) => plural(r.participations, 'torneio', 'torneios')],
      ['🥈', 'Mais vices', top('vices'), (r) => plural(r.vices, 'vice', 'vices')],
    ];
    return `${head('Power Ranking', 'Melhores do Mês', filterLabel('mes'))}
      ${filterBar('mes', { season: false })}
      ${ms.length ? `<div style="display:flex;gap:10px;align-items:center;justify-content:center;margin-bottom:22px;flex-wrap:wrap">
          <select class="input" id="ms" style="max-width:240px">${ms.map((m) => `<option value="${m}" ${m === monthSel ? 'selected' : ''}>${fmtMonth(m)}</option>`).join('')}</select>
          <span class="muted">${plural(tournaments, 'torneio', 'torneios')}</span></div>
        <div class="grid grid-3 highlights">${hl.map(([ico, label, r, fmt]) => `<div class="card"><div class="ico">${ico}</div><small>${label}</small><b>${r ? h(r.name) : '—'}</b><small>${r ? fmt(r) : ''}</small></div>`).join('')}</div>
        <section class="section"><h2 class="section-title">Power Ranking de ${fmtMonth(monthSel)}</h2>
          <div class="table-wrap"><table><thead><tr><th>#</th><th class="name">Nome</th><th>🏆</th><th>⭐</th><th>🥈</th><th>✅ V</th><th>❌ D</th><th>📊 %</th><th>🐱</th><th>💀</th><th>🎱</th><th>Pts</th></tr></thead>
          <tbody>${rows.map((s, i) => `<tr class="rank-${i + 1}"><td>${i < 3 ? ball(i + 1, 'xs') : i + 1}</td><td class="name"><span class="who">${pball(s.name, 'sm')}${h(s.name)}</span></td><td>${s.titles}</td><td>${s.undefeated}</td><td>${s.vices}</td><td>${s.wins}</td><td>${s.losses}</td><td>${pct(s.winPct)}</td><td>${s.gatos}</td><td>${s.suicidios}</td><td>${s.participations}</td><td class="pts">${s.points.toLocaleString('pt-BR')}</td></tr>`).join('')}</tbody></table></div>
          <p class="legend">Pontuação: 🏆 Título = ${sc.title} · ⭐ Invicto = +${sc.undefeated} · 🥈 Vice = ${sc.vice} · ✅ Vitória em duelo = ${sc.win} · 🎱 Participação = ${sc.participation}. “Melhor aproveitamento” exige ao menos 5 duelos no mês.</p></section>`
        : '<div class="empty">Nenhum torneio neste filtro.</div>'}`;
  }
  function bindMonth() {
    bindFilter('mes'); const s = $('#ms'); if (s) s.addEventListener('change', () => { monthSel = s.value; render(); }); }

  // ---------- Configurações / backup ----------
  function loginHint(live) {
    if (S.mode !== 'supabase') return '';
    if (live) return '<div class="card" style="margin:0 auto 18px;text-align:center;font-size:14px"><span class="pulse"></span>Placar ao vivo. Quer lançar os resultados? <a href="#/config">Entre ou crie sua conta de marcador</a>.</div>';
    return `<div class="card" style="margin:0 auto 16px;max-width:760px;text-align:center;font-size:14px">${live ? '👀 Você está vendo o placar ao vivo. ' : ''}Para ${live ? 'lançar resultados' : 'criar torneios'}, <a href="#/config">entre como administrador</a>.</div>`;
  }

  let accTab = 'login';
  function accountCard() {
    if (S.user()) {
      const role = S.role();
      return `<div class="card"><h3 style="margin-top:0">Minha conta</h3>
        <div class="who" style="margin-bottom:10px">${pball(S.displayName(), 'lg')}<div><b style="font-size:18px">${h(S.displayName())}</b><div class="muted" style="font-size:13px">${h(S.user().email)}</div></div></div>
        <p>${role === 'admin' ? '<span class="tag gold">ADMINISTRADOR</span> Acesso total.' : role === 'scorer' ? '<span class="tag green">MARCADOR</span> Pode lançar o placar do torneio em andamento.' : '<span class="tag red">BLOQUEADO</span> Fale com o administrador.'}</p>
        <div class="btn-row">${role !== 'blocked' ? '<a class="btn btn-primary" href="#/sorteio">Ir para o placar</a>' : ''}<button class="btn" id="logout">Sair</button></div></div>`;
    }
    const tab = (k, l) => `<button class="seg__btn ${accTab === k ? 'on' : ''}" data-acc="${k}">${l}</button>`;
    return `<div class="card"><h3 style="margin-top:0">Acesso</h3>
      <div class="seg" style="margin-bottom:14px">${tab('login', 'Entrar')}${tab('signup', 'Criar conta')}</div>
      ${accTab === 'login'
        ? `<form id="loginForm" style="display:grid;gap:10px"><input class="input" id="lEmail" type="email" placeholder="E-mail" required autocomplete="username">
            <input class="input" id="lPass" type="password" placeholder="Senha" required autocomplete="current-password"><button class="btn btn-primary">Entrar</button></form>`
        : `<form id="signupForm" style="display:grid;gap:10px"><input class="input" id="sName" placeholder="Seu nome ou apelido" required maxlength="40" autocomplete="nickname">
            <input class="input" id="sEmail" type="email" placeholder="E-mail" required autocomplete="email">
            <input class="input" id="sPass" type="password" placeholder="Senha (mín. 6 caracteres)" required minlength="6" autocomplete="new-password"><button class="btn btn-primary">Criar conta de marcador</button></form>`}
      <p class="muted" style="font-size:12.5px;margin-bottom:0">Visitantes veem tudo sem entrar. Com uma conta de <b>marcador</b> você lança os vencedores dos duelos do torneio em andamento.</p></div>`;
  }

  function viewConfig() {
    const sb = S.mode === 'supabase';
    const players = E.allPlayers(state.records);
    return `${head(sb ? 'Conta' : 'Configurações', sb ? (S.user() ? 'Minha conta' : 'Entrar ou criar conta') : 'Dados e Backup', sb ? 'Visitantes veem tudo · marcadores lançam o placar · o administrador gerencia os torneios' : 'Modo local — dados salvos neste navegador')}
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr))">
        ${sb ? accountCard() + (S.canWrite() ? '<div class="card" id="usersCard"><h3 style="margin-top:0">Marcadores cadastrados</h3><div class="muted">⏳ Carregando…</div></div>' : '')
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
    on('#loginForm', 'submit', async (e) => { e.preventDefault(); await S.signIn($('#lEmail').value, $('#lPass').value); toast(`Bem-vindo, ${S.displayName()}!`); render(); });
    on('#signupForm', 'submit', async (e) => {
      e.preventDefault();
      const r = await S.signUp(E.norm($('#sName').value), $('#sEmail').value.trim(), $('#sPass').value);
      if (r === 'confirm') { toast('Conta criada! Confirme pelo link enviado ao seu e-mail e depois entre.'); accTab = 'login'; }
      else toast('Conta criada! Você já pode lançar o placar.');
      render();
    });
    $$('[data-acc]').forEach((b) => b.addEventListener('click', () => { accTab = b.dataset.acc; render(); }));
    if ($('#usersCard')) guard(async () => {
      const list = await S.listProfiles();
      const card = $('#usersCard'); if (!card) return;
      card.innerHTML = `<h3 style="margin-top:0">Marcadores cadastrados (${list.length})</h3>
        ${list.length ? `<ul class="plist">${list.map((u) => `<li><span class="who">${pball(u.name || u.email, 'sm')}<span>${h(u.name || '—')}<br><small class="muted">${h(u.email)} · desde ${fmtDate((u.created_at || '').slice(0, 10))}</small></span></span>
          ${u.user_id === S.user().id ? '<span class="tag gold">você</span>' : `<button class="btn btn-sm ${u.blocked ? '' : 'btn-danger'}" data-block="${h(u.user_id)}" data-v="${u.blocked ? '0' : '1'}">${u.blocked ? 'Desbloquear' : 'Bloquear'}</button>`}</li>`).join('')}</ul>` : '<div class="empty">Ninguém se cadastrou ainda.</div>'}
        <p class="legend">Contas novas já entram como marcador. Bloqueie quem não deve lançar placar.</p>`;
      $$('[data-block]', card).forEach((b) => b.addEventListener('click', () => guard(async () => {
        await S.setBlocked(b.dataset.block, b.dataset.v === '1'); toast(b.dataset.v === '1' ? 'Marcador bloqueado' : 'Marcador desbloqueado'); render();
      })));
    });
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
    hall: [viewHall, () => bindFilter('hall')],
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
    const acc = $('#navAcc');
    if (acc) acc.textContent = S.mode !== 'supabase' ? '⚙' : S.user() ? `👤 ${S.displayName().split(' ')[0]}` : 'Entrar';
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
    if (C.photoCredits) $('#footCredits').innerHTML = 'Fotos: ' + C.photoCredits.map(([n, u]) => `<a href="${h(u)}" target="_blank" rel="noopener">${h(n)}</a>`).join(', ') + ' / Unsplash';
    $('#navToggle').addEventListener('click', () => { const n = $('#nav'); n.classList.toggle('open'); $('#navToggle').setAttribute('aria-expanded', n.classList.contains('open')); });
    $('#nav').addEventListener('click', (e) => { if (e.target.tagName === 'A') $('#nav').classList.remove('open'); });
    window.addEventListener('hashchange', render);

    render();
    await guard(async () => { await S.init(); await loadAll(); });
    state.loaded = true;
    render();

    // Placar ao vivo (Supabase realtime)
    S.onCurrentChange(async (data) => {
      if (S.canScore() && JSON.stringify(data) === JSON.stringify(state.current)) return;
      const finishedNow = data && data.status === 'finished' && !(state.current && state.current.status === 'finished');
      state.current = data;
      if (finishedNow) state.records = await S.listTournaments();
      const p = parseHash().path;
      if (p === 'sorteio' || p === '') render();
    });
    S.onAuth(() => render());

    // Contagem regressiva da agenda (atualiza a cada 20 s; libera o botão na hora certa)
    setInterval(() => {
      let flipped = false;
      $$('[data-until]').forEach((el) => {
        const open = Date.now() >= new Date(el.dataset.until).getTime();
        if (open !== el.classList.contains('on')) flipped = true;
        el.textContent = countdown(el.dataset.until);
      });
      if (flipped && !$('#overlay').innerHTML) render();
    }, 20000);
  }

  start();
})();
