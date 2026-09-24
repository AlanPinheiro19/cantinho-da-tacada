// ============================================================
//  Armazenamento: modo local (localStorage) ou Supabase (online).
// ============================================================
(function () {
  'use strict';
  const C = window.CTD_CONFIG;
  const E = window.CTD_ENGINE;

  // ---------------- Local ----------------
  const LK = { t: 'ctd.tournaments', c: 'ctd.current', s: 'ctd.schedules' };
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
  const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch (e) { console.error('Não foi possível salvar no navegador', e); } };

  const LocalStore = {
    mode: 'local',
    async init() {},
    canWrite: () => true,
    canScore: () => true,
    isAdmin: () => true,
    role: () => 'admin',
    user: () => null,
    async listTournaments() { return lsGet(LK.t, []); },
    async saveTournament(rec) {
      const all = lsGet(LK.t, []).filter((x) => x.id !== rec.id);
      all.push(rec); lsSet(LK.t, all);
    },
    async deleteTournament(id) { lsSet(LK.t, lsGet(LK.t, []).filter((x) => x.id !== id)); },
    async replaceAll(recs) { lsSet(LK.t, recs); },
    async getCurrent() { return lsGet(LK.c, null); },
    async setCurrent(t) { lsSet(LK.c, t); },
    onCurrentChange() {},
    onAuth() {},
    async listSchedules() { return lsGet(LK.s, []); },
    async saveSchedule(sc) { lsSet(LK.s, lsGet(LK.s, []).filter((x) => x.id !== sc.id).concat(sc)); },
    async deleteSchedule(id) { lsSet(LK.s, lsGet(LK.s, []).filter((x) => x.id !== id)); },
  };

  // ---------------- Supabase ----------------
  function makeSupabaseStore() {
    const sb = window.supabase.createClient(C.supabaseUrl, C.supabaseAnonKey);
    let session = null;
    let admin = false;   // confirmado no banco (tabela admins), não no navegador
    let profile = null;  // perfil de marcador (tabela profiles)
    const authCbs = [];
    async function checkAdmin() {
      admin = false; profile = null;
      if (!session) return;
      const [a, p] = await Promise.all([
        sb.from('admins').select('user_id').eq('user_id', session.user.id).maybeSingle(),
        sb.from('profiles').select('name, blocked').eq('user_id', session.user.id).maybeSingle(),
      ]);
      admin = !!a.data; profile = p.data || null;
    }
    const fail = (error) => { if (error) throw new Error(error.message); };
    const toRow = (r) => ({ id: r.id, name: r.name, date: r.date || null, data: r });

    return {
      mode: 'supabase',
      async init() {
        const { data } = await sb.auth.getSession();
        session = data.session;
        await checkAdmin();
        sb.auth.onAuthStateChange(async (_e, s) => { session = s; await checkAdmin(); authCbs.forEach((f) => f(s)); });
      },
      // Permissões (a proteção real está nas regras do banco — ver schema.sql):
      //  administrador: tudo · marcador: só lança placar do torneio em andamento
      canWrite: () => !!session && admin,
      canScore: () => !!session && (admin || (!!profile && !profile.blocked)),
      isAdmin: () => admin,
      role: () => (!session ? null : admin ? 'admin' : profile && !profile.blocked ? 'scorer' : 'blocked'),
      user: () => session && session.user,
      displayName: () => (profile && profile.name) || (session && session.user.email) || '',
      async signIn(email, password) {
        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw new Error(/invalid/i.test(error.message) ? 'E-mail ou senha incorretos.' : error.message);
        session = data.session; await checkAdmin();
        if (!admin && (!profile || profile.blocked)) { await sb.auth.signOut(); session = null; throw new Error('Esta conta está bloqueada. Fale com o administrador.'); }
      },
      async signUp(name, email, password) {
        const { data, error } = await sb.auth.signUp({ email, password, options: { data: { name } } });
        if (error) throw new Error(/registered|already/i.test(error.message) ? 'Este e-mail já tem conta. Use "Entrar".' : /password/i.test(error.message) ? 'Senha fraca: use pelo menos 6 caracteres.' : error.message);
        if (!data.session) return 'confirm'; // projeto exige confirmação por e-mail
        session = data.session; await checkAdmin(); return 'ok';
      },
      async signOut() { await sb.auth.signOut(); session = null; admin = false; profile = null; },
      async listProfiles() {
        const { data, error } = await sb.from('profiles').select('user_id, name, email, blocked, created_at').order('created_at', { ascending: false });
        fail(error); return data;
      },
      async setBlocked(userId, blocked) { const { error } = await sb.from('profiles').update({ blocked }).eq('user_id', userId); fail(error); },
      onAuth(cb) { authCbs.push(cb); },
      async listTournaments() {
        const out = []; let from = 0; const page = 1000;
        for (;;) {
          const { data, error } = await sb.from('tournaments').select('data').order('date', { ascending: false }).range(from, from + page - 1);
          fail(error); out.push(...data.map((r) => r.data));
          if (data.length < page) break; from += page;
        }
        return out;
      },
      async saveTournament(rec) {
        // marcador só pode INSERIR o torneio que acabou de terminar; admin pode editar
        const q = admin ? sb.from('tournaments').upsert(toRow(rec)) : sb.from('tournaments').insert(toRow(rec));
        const { error } = await q; if (error && !/duplicate/i.test(error.message)) fail(error);
      },
      async deleteTournament(id) { const { error } = await sb.from('tournaments').delete().eq('id', id); fail(error); },
      async replaceAll(recs) {
        const { error: e1 } = await sb.from('tournaments').delete().neq('id', '00000000-0000-0000-0000-000000000000'); fail(e1);
        for (let i = 0; i < recs.length; i += 200) {
          const { error } = await sb.from('tournaments').insert(recs.slice(i, i + 200).map(toRow)); fail(error);
        }
      },
      async getCurrent() {
        const { data, error } = await sb.from('current_tournament').select('data').eq('id', 1).maybeSingle();
        fail(error); return data ? data.data : null;
      },
      async setCurrent(t) {
        const q = admin ? sb.from('current_tournament').upsert({ id: 1, data: t }) : sb.from('current_tournament').update({ data: t }).eq('id', 1);
        const { error } = await q; fail(error);
      },
      async listSchedules() {
        const { data, error } = await sb.from('scheduled_tournaments').select('data').order('starts_at');
        if (error && /does not exist|schema cache/i.test(error.message)) return []; // tabela ainda não criada
        fail(error); return data.map((r) => r.data);
      },
      async saveSchedule(sc) {
        const { error } = await sb.from('scheduled_tournaments').upsert({ id: sc.id, starts_at: sc.startsAt, status: sc.status || 'scheduled', data: sc }); fail(error);
      },
      async deleteSchedule(id) { const { error } = await sb.from('scheduled_tournaments').delete().eq('id', id); fail(error); },
      onCurrentChange(cb) {
        sb.channel('current').on('postgres_changes', { event: '*', schema: 'public', table: 'current_tournament' },
          (p) => cb(p.new ? p.new.data : null)).subscribe();
      },
    };
  }

  const useSupabase = !!(C.supabaseUrl && C.supabaseAnonKey && window.supabase);
  const store = useSupabase ? makeSupabaseStore() : LocalStore;

  // Exportar / importar (backup JSON)
  store.exportAll = async function () {
    return { app: 'cantinho-da-tacada', version: 1, exportedAt: new Date().toISOString(), tournaments: await store.listTournaments(), current: await store.getCurrent() };
  };
  store.importAll = async function (json, { merge = true } = {}) {
    const list = Array.isArray(json) ? json : (json.tournaments || []);
    const recs = list.map(E.normalizeRecord);
    if (merge) {
      const existing = await store.listTournaments();
      const ids = new Set(existing.map((r) => r.id));
      const sig = (r) => `${r.date}|${r.name}|${r.winner}|${r.players}`;
      const sigs = new Set(existing.map(sig));
      const fresh = recs.filter((r) => !ids.has(r.id) && !sigs.has(sig(r)));
      await store.replaceAll(existing.concat(fresh));
      return fresh.length;
    }
    await store.replaceAll(recs);
    return recs.length;
  };

  window.CTD_STORE = store;
})();
