// Dapung Coconat — application routes.
// Dependency injection is only for local tests; index.ts retains Deno.serve.
// This module never consumes owner IDs, object paths or DB tokens from clients.
export function application({ db, storage, BackendError }) {
  const isUuid = v => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
  const fail = (code, status) => { throw new BackendError(code, status); };
  const rows = result => { if (result.error) fail(result.error.code, result.error.status); return result.data; };
  const nowIso = () => new Date().toISOString();

  const ADMIN_COOKIE = '__Host-dapung_admin';
  const SESSION_TTL_SECONDS = 12 * 60 * 60;
  const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
  const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  const LOGIN_KEY = 'admin_login';
  const LOGIN_MAX_ATTEMPTS = 10;
  const LOGIN_WINDOW_MS = 5 * 60 * 1000;

  /* ---------- input validation ---------- */
  function strField(v, min, max) {
    if (typeof v !== 'string') fail('invalid_input', 400);
    const s = v.trim();
    if (s.length < min) fail('invalid_input', 400);
    if (new TextEncoder().encode(s).length > max) fail('invalid_input', 400);
    return s;
  }
  function intField(v, min, max) {
    if (!Number.isInteger(v) || v < min || v > max) fail('invalid_input', 400);
    return v;
  }
  function optionalUuid(v) {
    if (v === null || v === undefined || v === '') return null;
    if (!isUuid(v)) fail('invalid_input', 400);
    return v;
  }

  async function readJson(request) {
    if (!(request.headers.get('content-type') || '').startsWith('application/json')) fail('invalid_input', 400);
    const reader = request.body?.getReader();
    if (!reader) fail('invalid_input', 400);
    let size = 0; const chunks = [];
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 65536) { await reader.cancel(); fail('payload_too_large', 413); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    if (size === 0) return {};
    const bytes = new Uint8Array(size); let off = 0;
    for (const c of chunks) { bytes.set(c, off); off += c.length; }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { fail('invalid_input', 400); }
  }

  /* ---------- admin session (stateless HMAC cookie) ---------- */
  function b64url(bytes) {
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64urlDecode(str) {
    const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '='));
    return Uint8Array.from(bin, c => c.charCodeAt(0));
  }
  async function hmacKey() {
    const secret = Deno.env.get('APP_SESSION_SECRET') || '';
    if (!secret) fail('service_not_configured', 503);
    return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  }
  async function signToken(payload) {
    const key = await hmacKey();
    const data = new TextEncoder().encode(JSON.stringify(payload));
    const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, data));
    return b64url(data) + '.' + b64url(sig);
  }
  async function verifyToken(token) {
    if (typeof token !== 'string' || token.length > 600) return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    try {
      const key = await hmacKey();
      const data = b64urlDecode(parts[0]);
      const sig = b64urlDecode(parts[1]);
      if (sig.length !== 32) return null;
      const ok = await crypto.subtle.verify('HMAC', key, sig, data);
      if (!ok) return null;
      const payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data));
      if (!payload || payload.sub !== 'admin' || !Number.isFinite(payload.exp) || payload.exp <= Date.now() / 1000) return null;
      return payload;
    } catch { return null; }
  }
  function sessionTokenFrom(request) {
    const header = request.headers.get('cookie') || '';
    if (!header) return null;
    for (const part of header.split(';')) {
      const t = part.trim();
      if (t.startsWith(ADMIN_COOKIE + '=')) return t.slice(ADMIN_COOKIE.length + 1);
    }
    return null;
  }
  function sessionCookie(value, maxAgeSeconds) {
    return `${ADMIN_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
  }
  async function requireAdmin(request) {
    const token = sessionTokenFrom(request);
    if (!token) fail('login_required', 401);
    if (!(await verifyToken(token))) fail('login_required', 401);
  }
  async function timingSafeEqualStr(a, b) {
    const ea = new TextEncoder().encode(a);
    const eb = new TextEncoder().encode(b);
    const ha = new Uint8Array(await crypto.subtle.digest('SHA-256', ea));
    const hb = new Uint8Array(await crypto.subtle.digest('SHA-256', eb));
    let diff = 0;
    for (let i = 0; i < ha.length; i++) diff |= ha[i] ^ hb[i];
    return diff === 0;
  }

  /* ---------- login rate limiter (best-effort fixed window) ---------- */
  async function loginAllowed() {
    const found = rows(await db.from('auth_limiter').select('window_started_at,attempt_count').eq('key', LOGIN_KEY).limit(1));
    if (!found.length) {
      rows(await db.from('auth_limiter').insert({ key: LOGIN_KEY, window_started_at: nowIso(), attempt_count: 1 }));
      return true;
    }
    const ws = Date.parse(found[0].window_started_at);
    const now = Date.now();
    if (!Number.isFinite(ws) || ws + LOGIN_WINDOW_MS <= now) {
      rows(await db.from('auth_limiter').update({ window_started_at: nowIso(), attempt_count: 1 }).eq('key', LOGIN_KEY));
      return true;
    }
    if (found[0].attempt_count >= LOGIN_MAX_ATTEMPTS) return false;
    rows(await db.from('auth_limiter').update({ attempt_count: found[0].attempt_count + 1 }).eq('key', LOGIN_KEY));
    return true;
  }

  /* ---------- settings ---------- */
  async function getSettingsMap() {
    const all = rows(await db.from('settings').select('key,value'));
    const map = {};
    for (const r of all) map[r.key] = r.value;
    return map;
  }
  async function setSetting(key, value) {
    rows(await db.from('settings').insertIfAbsent({ key, value, updated_at: nowIso() }, { onConflict: 'key' }));
    rows(await db.from('settings').update({ value, updated_at: nowIso() }).eq('key', key).select('key'));
  }
  function businessFrom(map) {
    return {
      name: map.name || 'Dapung Coconat',
      tagline: map.tagline || 'Segar dari kebun',
      description: map.description || '',
      address: map.address || '',
      whatsapp: map.whatsapp || '',
      hours: map.hours || '',
    };
  }
  function parseHours(text) {
    if (!text) return [];
    const out = [];
    for (const line of String(text).split('\n')) {
      const t = line.trim();
      if (!t) continue;
      const sep = t.indexOf('|') >= 0 ? t.indexOf('|') : t.indexOf(':');
      if (sep > 0) out.push({ days: t.slice(0, sep).trim(), time: t.slice(sep + 1).trim() });
      else out.push({ days: t, time: '' });
    }
    return out;
  }

  /* ---------- images ---------- */
  async function imageUrl(imagePath, ttlSeconds) {
    if (!imagePath) return null;
    const { signedUrl } = await storage.createSignedUrl(imagePath, ttlSeconds);
    return signedUrl;
  }
  async function verifyImage(response, expectedSize) {
    const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    if (!response.ok || !response.body || !IMAGE_TYPES[type]) {
      await response.body?.cancel().catch(() => {});
      fail('invalid_upload', 422);
    }
    const reader = response.body.getReader();
    let size = 0, timedOut = false;
    const timer = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => {}); }, 15000);
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (timedOut) fail('storage_unavailable', 503);
        if (done) break;
        size += value.byteLength;
        if (size > MAX_IMAGE_BYTES) fail('invalid_upload', 422);
      }
    } catch (error) {
      if (error instanceof BackendError) throw error;
      fail('storage_unavailable', 503);
    } finally {
      clearTimeout(timer);
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    if (size === 0 || size !== expectedSize) fail('invalid_upload', 422);
    return { size, contentType: type };
  }

  /* ---------- data access ---------- */
  async function requireMenu(id) {
    const found = rows(await db.from('menus').select('id,image_path').eq('id', id).limit(1));
    if (!found.length) fail('not_found', 404);
    return found[0];
  }
  async function requireCategory(id) {
    const found = rows(await db.from('categories').select('id').eq('id', id).limit(1));
    if (!found.length) fail('not_found', 404);
    return found[0];
  }

  /* ---------- public catalog ---------- */
  async function catalog() {
    const map = await getSettingsMap();
    const cats = rows(await db.from('categories').select('id,name,sort_order').order('sort_order', { ascending: true }).order('name', { ascending: true }));
    const menus = rows(await db.from('menus')
      .select('id,category_id,name,description,price,image_path,is_best_seller,is_available,sort_order')
      .eq('is_available', true)
      .order('sort_order', { ascending: true }).order('name', { ascending: true }));
    const out = [];
    for (const m of menus) {
      out.push({
        id: m.id, category_id: m.category_id, name: m.name, description: m.description,
        price: m.price, is_best_seller: m.is_best_seller, sort_order: m.sort_order,
        image_url: m.image_path ? await imageUrl(m.image_path, 3600) : null,
      });
    }
    return Response.json({ business: { ...businessFrom(map), hours: parseHours(map.hours) }, categories: cats, menus: out });
  }

  /* ---------- admin state ---------- */
  async function adminState() {
    const map = await getSettingsMap();
    const cats = rows(await db.from('categories').select('id,name,sort_order').order('sort_order', { ascending: true }).order('name', { ascending: true }));
    const menus = rows(await db.from('menus')
      .select('id,category_id,name,description,price,image_path,is_best_seller,is_available,sort_order')
      .order('sort_order', { ascending: true }).order('name', { ascending: true }));
    const countByCat = {};
    for (const m of menus) countByCat[m.category_id] = (countByCat[m.category_id] || 0) + 1;
    const categories = cats.map(c => ({ ...c, menu_count: countByCat[c.id] || 0 }));
    const out = [];
    for (const m of menus) {
      out.push({
        id: m.id, category_id: m.category_id, name: m.name, description: m.description,
        price: m.price, image_path: m.image_path, is_best_seller: m.is_best_seller,
        is_available: m.is_available, sort_order: m.sort_order,
        image_url: m.image_path ? await imageUrl(m.image_path, 300) : null,
      });
    }
    return Response.json({ business: businessFrom(map), categories, menus: out });
  }

  /* ---------- login / logout ---------- */
  async function login(request) {
    const body = await readJson(request);
    const pw = typeof body?.password === 'string' ? body.password : '';
    const expected = Deno.env.get('APP_ADMIN_PASSWORD') || '';
    if (!expected) fail('service_not_configured', 503);
    if (!(await loginAllowed())) fail('rate_limited', 429);
    const ok = pw.length > 0 && new TextEncoder().encode(pw).length <= 256 && (await timingSafeEqualStr(pw, expected));
    if (!ok) fail('invalid_credentials', 401);
    const token = await signToken({ sub: 'admin', exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS });
    return Response.json({ ok: true }, { headers: { 'set-cookie': sessionCookie(token, SESSION_TTL_SECONDS) } });
  }
  function logout() {
    return Response.json({ ok: true }, { headers: { 'set-cookie': sessionCookie('', 0) } });
  }

  /* ---------- menu CRUD ---------- */
  async function createMenu(request) {
    const body = await readJson(request);
    const name = strField(body?.name, 1, 80);
    const description = strField(body?.description ?? '', 0, 600);
    const price = intField(body?.price ?? 0, 0, 100000000);
    const categoryId = optionalUuid(body?.category_id);
    if (categoryId) await requireCategory(categoryId);
    const isBestSeller = !!body?.is_best_seller;
    const isAvailable = body?.is_available !== false;
    const sortOrder = intField(body?.sort_order ?? 0, 0, 1000000);
    const id = crypto.randomUUID();
    const inserted = rows(await db.from('menus').insert({
      id, category_id: categoryId, name, description, price,
      is_best_seller: isBestSeller, is_available: isAvailable, sort_order: sortOrder,
      created_at: nowIso(), updated_at: nowIso(),
    }).select('id'));
    return Response.json(inserted[0], { status: 201 });
  }

  async function updateMenu(id, request) {
    const body = await readJson(request);
    const patch = {};
    if ('name' in body) patch.name = strField(body.name, 1, 80);
    if ('description' in body) patch.description = strField(body.description, 0, 600);
    if ('price' in body) patch.price = intField(body.price, 0, 100000000);
    if ('is_best_seller' in body) patch.is_best_seller = !!body.is_best_seller;
    if ('is_available' in body) patch.is_available = !!body.is_available;
    if ('sort_order' in body) patch.sort_order = intField(body.sort_order, 0, 1000000);
    if ('category_id' in body) {
      patch.category_id = optionalUuid(body.category_id);
      if (patch.category_id) await requireCategory(patch.category_id);
    }
    if (!Object.keys(patch).length) fail('invalid_input', 400);
    patch.updated_at = nowIso();
    const updated = rows(await db.from('menus').update(patch).eq('id', id).select('id'));
    if (!updated.length) fail('not_found', 404);
    return Response.json(updated[0]);
  }

  async function deleteMenu(id) {
    const menu = await requireMenu(id);
    rows(await db.from('menus').delete().eq('id', id).select('id'));
    if (menu.image_path) { try { await storage.remove([menu.image_path]); } catch { /* best effort */ } }
    return Response.json({ ok: true });
  }

  /* ---------- image upload (signed URL flow) ---------- */
  async function startImage(id, request) {
    await requireMenu(id);
    const body = await readJson(request);
    const contentType = typeof body?.contentType === 'string' ? body.contentType.toLowerCase() : '';
    const ext = IMAGE_TYPES[contentType];
    if (!ext) fail('invalid_upload', 422);
    const objectPath = `menu-images/${crypto.randomUUID()}.${ext}`;
    const { signedUrl } = await storage.createSignedUploadUrl(objectPath, { upsert: false });
    return Response.json({ objectPath, signedUrl }, { status: 201 });
  }

  async function completeImage(id, request) {
    const menu = await requireMenu(id);
    const body = await readJson(request);
    const objectPath = typeof body?.objectPath === 'string' ? body.objectPath : '';
    if (!/^menu-images\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z]{2,5}$/.test(objectPath)) fail('invalid_upload', 422);
    const size = intField(body?.size ?? 0, 1, MAX_IMAGE_BYTES);
    let downloaded;
    try { downloaded = await storage.download(objectPath); }
    catch (error) { if (error?.code === 'storage_object_not_found') fail('upload_pending', 409); throw error; }
    await verifyImage(downloaded, size);
    rows(await db.from('menus').update({ image_path: objectPath, updated_at: nowIso() }).eq('id', id).select('id'));
    if (menu.image_path && menu.image_path !== objectPath) { try { await storage.remove([menu.image_path]); } catch { /* best effort */ } }
    return Response.json({ ok: true, image_url: await imageUrl(objectPath, 300) });
  }

  /* ---------- category CRUD ---------- */
  async function createCategory(request) {
    const body = await readJson(request);
    const name = strField(body?.name, 1, 60);
    const sortOrder = intField(body?.sort_order ?? 0, 0, 1000000);
    const id = crypto.randomUUID();
    const inserted = rows(await db.from('categories').insert({ id, name, sort_order: sortOrder, created_at: nowIso() }).select('id'));
    return Response.json(inserted[0], { status: 201 });
  }
  async function updateCategory(id, request) {
    const body = await readJson(request);
    const patch = {};
    if ('name' in body) patch.name = strField(body.name, 1, 60);
    if ('sort_order' in body) patch.sort_order = intField(body.sort_order, 0, 1000000);
    if (!Object.keys(patch).length) fail('invalid_input', 400);
    const updated = rows(await db.from('categories').update(patch).eq('id', id).select('id'));
    if (!updated.length) fail('not_found', 404);
    return Response.json(updated[0]);
  }
  async function deleteCategory(id) {
    await requireCategory(id);
    rows(await db.from('menus').update({ category_id: null }).eq('category_id', id).select('id'));
    rows(await db.from('categories').delete().eq('id', id).select('id'));
    return Response.json({ ok: true });
  }

  /* ---------- settings ---------- */
  async function updateSettings(request) {
    const body = await readJson(request);
    if ('name' in body) await setSetting('name', strField(body.name, 1, 80));
    if ('tagline' in body) await setSetting('tagline', strField(body.tagline, 0, 120));
    if ('description' in body) await setSetting('description', strField(body.description, 0, 600));
    if ('address' in body) await setSetting('address', strField(body.address, 0, 300));
    if ('whatsapp' in body) {
      const wa = strField(body.whatsapp, 0, 30);
      if (wa && !/^[0-9+\-\s]{5,30}$/.test(wa)) fail('invalid_input', 400);
      await setSetting('whatsapp', wa);
    }
    if ('hours' in body) await setSetting('hours', strField(body.hours, 0, 1000));
    return Response.json({ ok: true, business: businessFrom(await getSettingsMap()) });
  }

  /* ---------- router ---------- */
  return async ctx => {
    const request = ctx.request;
    const pathname = new URL(request.url).pathname;
    const match = pathname.match(/^\/(?:functions\/v1\/)?(?:app|app-[0-9a-f]{32})(\/.*)?$/);
    if (!match) fail('not_found', 404);
    const path = match[1] || '/';

    if (path === '/api/health' && request.method === 'GET') return Response.json({ ok: true });
    if (path === '/api/catalog' && request.method === 'GET') return await catalog();

    if (path === '/api/admin/login' && request.method === 'POST') return await login(request);
    if (path === '/api/admin/logout' && request.method === 'POST') return logout();

    await requireAdmin(request);

    if (path === '/api/admin/me' && request.method === 'GET') return Response.json({ ok: true });
    if (path === '/api/admin/state' && request.method === 'GET') return await adminState();

    if (path === '/api/admin/menus' && request.method === 'POST') return await createMenu(request);

    const menuMatch = path.match(/^\/api\/admin\/menus\/([0-9a-f-]{36})$/);
    if (menuMatch && isUuid(menuMatch[1])) {
      if (request.method === 'PATCH') return await updateMenu(menuMatch[1], request);
      if (request.method === 'DELETE') return await deleteMenu(menuMatch[1]);
    }
    const imageStart = path.match(/^\/api\/admin\/menus\/([0-9a-f-]{36})\/image$/);
    if (imageStart && isUuid(imageStart[1]) && request.method === 'POST') return await startImage(imageStart[1], request);
    const imageDone = path.match(/^\/api\/admin\/menus\/([0-9a-f-]{36})\/image\/complete$/);
    if (imageDone && isUuid(imageDone[1]) && request.method === 'POST') return await completeImage(imageDone[1], request);

    if (path === '/api/admin/categories' && request.method === 'POST') return await createCategory(request);
    const catMatch = path.match(/^\/api\/admin\/categories\/([0-9a-f-]{36})$/);
    if (catMatch && isUuid(catMatch[1])) {
      if (request.method === 'PATCH') return await updateCategory(catMatch[1], request);
      if (request.method === 'DELETE') return await deleteCategory(catMatch[1]);
    }

    if (path === '/api/admin/settings' && request.method === 'PATCH') return await updateSettings(request);

    fail('not_found', 404);
  };
}
