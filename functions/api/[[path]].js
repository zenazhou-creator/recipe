// Recipe sync API as a Cloudflare Pages Function: answers /api/sync and /api/img/<id>/<thumb|full> on the SAME domain as the page.
// Needs on the Pages project: D1 binding "DB", secret "SYNC_KEY", optional variable PUBLIC_READ = 1 (anyone may read; writes always need the key).
export async function onRequest({ request: req, env, params }) {
  const json = o => new Response(JSON.stringify(o), { headers: { 'Content-Type': 'application/json' } });
  const deny = (s, t) => new Response(t, { status: s });
  const open = req.method === 'GET' && env.PUBLIC_READ === '1';
  if (!open && (!env.SYNC_KEY || req.headers.get('X-Key') !== env.SYNC_KEY)) return deny(401, 'Unauthorized');
  const p = [].concat(params.path || []), u = new URL(req.url);

  if (p[0] === 'sync' && req.method === 'GET') {                       // pull: everything written since a server timestamp
    const now = Date.now(), since = +u.searchParams.get('since') || 0;
    const { results } = await env.DB.prepare('SELECT id, data, updated, deleted FROM recipes WHERE srv >= ?').bind(since).all();
    const c = await env.DB.prepare("SELECT v, updated FROM kv WHERE k = 'cats'").first();
    return json({ now, recipes: results, cats: c ? { data: c.v, updated: c.updated } : null });
  }
  if (p[0] === 'sync' && req.method === 'POST') {                      // push: a recipe is only overwritten by a newer edit
    const b = await req.json(), now = Date.now();
    const st = env.DB.prepare('INSERT INTO recipes (id, data, updated, deleted, srv) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(id) DO UPDATE SET data = ?2, updated = ?3, deleted = ?4, srv = ?5 WHERE ?3 > recipes.updated');
    const batch = b.recipes.map(r => st.bind(r.id, r.data, r.updated, r.deleted, now));
    if (b.cats) batch.push(env.DB.prepare("INSERT INTO kv (k, v, updated) VALUES ('cats', ?1, ?2) ON CONFLICT(k) DO UPDATE SET v = ?1, updated = ?2 WHERE ?2 > kv.updated").bind(b.cats.data, b.cats.updated));
    if (batch.length) await env.DB.batch(batch);
    return json({ ok: 1 });
  }
  if (p[0] === 'img' && p[1] && p[2]) {                                // images: /api/img/<recipeId>/<thumb|full>
    const k = p[1] + '/' + p[2];
    if (req.method === 'PUT') { await env.DB.prepare('INSERT OR REPLACE INTO imgs (k, v) VALUES (?, ?)').bind(k, await req.text()).run(); return json({ ok: 1 }); }
    const o = await env.DB.prepare('SELECT v FROM imgs WHERE k = ?').bind(k).first();
    return o ? new Response(o.v) : deny(404, 'Not found');
  }
  return deny(404, 'Not found');
}
