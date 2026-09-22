// ============================================================
//  Armazenamento: modo local (localStorage) ou Supabase (online).
// ============================================================
(function () {
  'use strict';
  const C = window.CTD_CONFIG;
  const E = window.CTD_ENGINE;

  // ---------------- Local ----------------
  const LK = { t: 'ctd.tournaments', c: 'ctd.current' };
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
  const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch (e) { console.error('Não foi possível salvar no navegador', e); } };

  const LocalStore = {
    mode: 'local',
    async init() {},
    canWrite: () => true,
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
  };

  // ---------------- Supabase ----------------
  function makeSupabaseStore() {
    const sb = window.supabase.createClient(C.supabaseUrl, C.supabaseAnonKey);
    let session = null;
    const authCbs = [];
    const fail = (error) => { if (error) throw new Error(error.message); };
    const toRow = (r) => ({ id: r.id, name: r.name, date: r.date || null, data: r });

    return {
      mode: 'supabase',
      async init() {
        const { data } = await sb.auth.getSession();
        session = data.session;
        sb.auth.onAuthStateChange((_e, s) => { session = s; authCbs.forEach((f) => f(s)); });
      },
      canWrite: () => !!session,
      user: () => session && session.user,
      async signIn(email, password) { const { error } = await sb.auth.signInWithPassword({ email, password }); fail(error); },
      async signOut() { await sb.auth.signOut(); },
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
      async saveTournament(rec) { const { error } = await sb.from('tournaments').upsert(toRow(rec)); fail(error); },
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
        const { error } = await sb.from('current_tournament').upsert({ id: 1, data: t, updated_at: new Date().toISOString() }); fail(error);
      },
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
