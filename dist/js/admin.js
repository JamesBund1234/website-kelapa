import { requestJson, errorMessage, formatRp } from './api.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const state = { categories: [], menus: [], business: {} };
let editingMenuId = null;
let pendingPhoto = null;

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2400);
}

function showLogin() { $('#loginView').hidden = false; $('#dashView').hidden = true; }
function showDash() { $('#loginView').hidden = true; $('#dashView').hidden = false; }

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/* ---------- session ---------- */
async function checkSession() {
  try {
    await requestJson('/api/admin/me');
    showDash();
    await loadState();
  } catch {
    showLogin();
  }
}

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#loginBtn');
  btn.disabled = true;
  $('#loginError').textContent = '';
  try {
    await requestJson('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: $('#loginPassword').value }),
    });
    $('#loginPassword').value = '';
    showDash();
    await loadState();
  } catch (err) {
    $('#loginError').textContent = errorMessage(err);
  } finally {
    btn.disabled = false;
  }
});

$('#logoutBtn').addEventListener('click', async () => {
  try { await requestJson('/api/admin/logout', { method: 'POST' }); } catch { /* ignore */ }
  showLogin();
});

/* ---------- tabs ---------- */
$$('.tab').forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));
function switchTab(name) {
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  $$('.tab-panel').forEach((p) => { p.hidden = p.id !== 'tab-' + name; });
}

/* ---------- load ---------- */
async function loadState() {
  const data = await requestJson('/api/admin/state');
  state.categories = data.categories || [];
  state.menus = data.menus || [];
  state.business = data.business || {};
  renderMenus();
  renderCategories();
  renderSettings();
}

/* ---------- menus ---------- */
function catName(id) {
  const c = state.categories.find((x) => x.id === id);
  return c ? c.name : null;
}

function renderMenus() {
  const wrap = $('#menuList');
  wrap.innerHTML = '';
  $('#menuCountText').textContent = `${state.menus.length} menu · ${state.menus.filter(m => m.is_available).length} tampil`;
  if (!state.menus.length) {
    const empty = el('div', 'empty', '');
    empty.innerHTML = '<div class="big">🥥</div><p>Belum ada menu. Klik "Tambah Menu".</p>';
    wrap.appendChild(empty);
    return;
  }
  for (const m of state.menus) wrap.appendChild(menuRow(m));
}

function menuRow(m) {
  const row = el('div', 'menu-row' + (m.is_available ? '' : ' off'));

  if (m.image_url) {
    const img = el('img', 'menu-thumb');
    img.src = m.image_url; img.alt = m.name; img.loading = 'lazy';
    row.appendChild(img);
  } else {
    row.appendChild(el('div', 'menu-thumb-ph', '🥥'));
  }

  const body = el('div', 'mr-body');
  const name = el('div', 'mr-name');
  name.appendChild(el('span', null, m.name));
  if (m.is_best_seller) name.appendChild(el('span', 'tag best', '⭐ Terlaris'));
  if (catName(m.category_id)) name.appendChild(el('span', 'tag cat', catName(m.category_id)));
  if (!m.is_available) name.appendChild(el('span', 'tag hidden', 'Disembunyikan'));
  body.appendChild(name);
  body.appendChild(el('div', 'mr-sub', m.description || 'Tanpa deskripsi'));
  row.appendChild(body);

  row.appendChild(el('div', 'mr-price', formatRp(m.price)));

  const actions = el('div', 'mr-actions');

  const star = el('button', 'icon-btn star' + (m.is_best_seller ? ' on' : ''), '⭐');
  star.type = 'button';
  star.title = 'Tandai terlaris';
  star.addEventListener('click', () => patchMenu(m.id, { is_best_seller: !m.is_best_seller }, 'Status terlaris diperbarui'));
  actions.appendChild(star);

  const toggle = el('label', 'switch');
  toggle.title = 'Tampilkan / sembunyikan';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = !!m.is_available;
  input.addEventListener('change', () => patchMenu(m.id, { is_available: input.checked }, input.checked ? 'Menu ditampilkan' : 'Menu disembunyikan'));
  const slider = el('span', 'slider');
  toggle.append(input, slider);
  actions.appendChild(toggle);

  const edit = el('button', 'icon-btn', '✎');
  edit.type = 'button';
  edit.title = 'Edit menu';
  edit.addEventListener('click', () => openMenuModal(m));
  actions.appendChild(edit);

  const del = el('button', 'icon-btn danger', '🗑');
  del.type = 'button';
  del.title = 'Hapus menu';
  del.addEventListener('click', async () => {
    if (!confirm(`Hapus menu "${m.name}"?`)) return;
    try {
      await requestJson('/api/admin/menus/' + m.id, { method: 'DELETE' });
      toast('Menu dihapus');
      await loadState();
    } catch (err) { toast(errorMessage(err)); }
  });
  actions.appendChild(del);

  row.appendChild(actions);
  return row;
}

async function patchMenu(id, patch, okMsg) {
  try {
    await requestJson('/api/admin/menus/' + id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    toast(okMsg);
    await loadState();
  } catch (err) { toast(errorMessage(err)); await loadState(); }
}

/* ---------- menu modal ---------- */
function populateCategorySelect() {
  const sel = $('#categorySelect');
  sel.innerHTML = '';
  const none = el('option', null, '— Tanpa kategori —');
  none.value = '';
  sel.appendChild(none);
  for (const c of state.categories) {
    const o = el('option', null, c.name);
    o.value = c.id;
    sel.appendChild(o);
  }
}

function openMenuModal(m) {
  editingMenuId = m ? m.id : null;
  pendingPhoto = null;
  $('#menuModalTitle').textContent = m ? 'Edit Menu' : 'Tambah Menu';
  $('#menuId').value = m ? m.id : '';
  const form = $('#menuForm');
  form.elements.name.value = m ? m.name : '';
  form.elements.description.value = m ? m.description : '';
  form.elements.price.value = m ? m.price : '';
  form.elements.sort_order.value = m ? m.sort_order : 0;
  form.elements.is_best_seller.checked = m ? !!m.is_best_seller : false;
  form.elements.is_available.checked = m ? !!m.is_available : true;
  $('#categorySelect').value = m?.category_id || '';
  $('#photoInput').value = '';
  $('#menuFormError').textContent = '';
  if (m?.image_url) {
    $('#photoImg').src = m.image_url;
    $('#photoImg').hidden = false;
    $('#photoPlaceholder').hidden = true;
  } else {
    $('#photoImg').src = '';
    $('#photoImg').hidden = true;
    $('#photoPlaceholder').hidden = false;
  }
  $('#menuModal').hidden = false;
}
function closeMenuModal() { $('#menuModal').hidden = true; }

$('#addMenuBtn').addEventListener('click', () => openMenuModal(null));
$('#menuCancelBtn').addEventListener('click', closeMenuModal);
$('#menuModalClose').addEventListener('click', closeMenuModal);

$('#photoInput').addEventListener('change', (e) => {
  pendingPhoto = e.target.files[0] || null;
  if (pendingPhoto) {
    $('#photoImg').src = URL.createObjectURL(pendingPhoto);
    $('#photoImg').hidden = false;
    $('#photoPlaceholder').hidden = true;
  }
});

async function uploadPhoto(id, file) {
  const contentType = file.type || 'image/jpeg';
  const start = await requestJson(`/api/admin/menus/${id}/image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contentType }),
  });
  const res = await fetch(start.signedUrl, {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'Content-Type': contentType },
    body: file,
  });
  if (!res.ok) throw new Error('upload_failed');
  await requestJson(`/api/admin/menus/${id}/image/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ objectPath: start.objectPath, size: file.size }),
  });
}

$('#menuForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const payload = {
    name: form.elements.name.value,
    description: form.elements.description.value,
    price: Number(form.elements.price.value),
    sort_order: Number(form.elements.sort_order.value),
    category_id: form.elements.category_id.value || null,
    is_best_seller: !!form.elements.is_best_seller.checked,
    is_available: !!form.elements.is_available.checked,
  };
  const btn = $('#menuSaveBtn');
  btn.disabled = true;
  $('#menuFormError').textContent = '';
  try {
    let id = editingMenuId;
    if (id) {
      await requestJson('/api/admin/menus/' + id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } else {
      const created = await requestJson('/api/admin/menus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      id = created.id;
    }
    if (pendingPhoto) {
      await uploadPhoto(id, pendingPhoto);
      toast('Foto diperbarui');
    }
    closeMenuModal();
    toast(editingMenuId ? 'Menu diperbarui' : 'Menu ditambahkan');
    await loadState();
  } catch (err) {
    $('#menuFormError').textContent = errorMessage(err);
  } finally {
    btn.disabled = false;
  }
});

/* ---------- categories ---------- */
function renderCategories() {
  const wrap = $('#catList');
  wrap.innerHTML = '';
  for (const c of state.categories) wrap.appendChild(catRow(c));
  if (!state.categories.length) {
    wrap.appendChild(el('div', 'empty', 'Belum ada kategori.'));
  }
}

function catRow(c) {
  const row = el('div', 'cat-row');
  const name = el('span', 'name', c.name);
  row.appendChild(name);
  row.appendChild(el('span', 'count', `${c.menu_count ?? 0} menu`));

  const rename = el('button', 'icon-btn', '✎');
  rename.type = 'button';
  rename.title = 'Ubah nama';
  rename.addEventListener('click', () => renameCategoryInline(row, c));
  row.appendChild(rename);

  const del = el('button', 'icon-btn danger', '🗑');
  del.type = 'button';
  del.title = 'Hapus kategori';
  del.addEventListener('click', async () => {
    if (!confirm(`Hapus kategori "${c.name}"? Menu di dalamnya menjadi tanpa kategori.`)) return;
    try {
      await requestJson('/api/admin/categories/' + c.id, { method: 'DELETE' });
      toast('Kategori dihapus');
      await loadState();
    } catch (err) { toast(errorMessage(err)); }
  });
  row.appendChild(del);
  return row;
}

function renameCategoryInline(row, c) {
  const input = document.createElement('input');
  input.className = 'input';
  input.value = c.name;
  input.maxLength = 60;
  const name = row.querySelector('.name');
  row.replaceChild(input, name);
  input.focus();
  let done = false;
  const save = async () => {
    if (done) return;
    done = true;
    const val = input.value.trim();
    if (val && val !== c.name) {
      try {
        await requestJson('/api/admin/categories/' + c.id, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: val }),
        });
        toast('Kategori diperbarui');
        await loadState();
      } catch (err) { toast(errorMessage(err)); await loadState(); }
    } else {
      row.replaceChild(name, input);
      name.textContent = c.name;
    }
  };
  input.addEventListener('blur', save);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { done = true; row.replaceChild(name, input); name.textContent = c.name; }
  });
}

$('#addCatBtn').addEventListener('click', async () => {
  const name = prompt('Nama kategori baru:');
  if (!name || !name.trim()) return;
  try {
    await requestJson('/api/admin/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), sort_order: state.categories.length }),
    });
    toast('Kategori ditambahkan');
    await loadState();
  } catch (err) { toast(errorMessage(err)); }
});

/* ---------- settings ---------- */
function renderSettings() {
  const f = $('#settingsForm');
  const b = state.business;
  f.elements.name.value = b.name || '';
  f.elements.tagline.value = b.tagline || '';
  f.elements.description.value = b.description || '';
  f.elements.address.value = b.address || '';
  f.elements.whatsapp.value = b.whatsapp || '';
  f.elements.hours.value = b.hours || '';
}

$('#settingsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const payload = {
    name: f.elements.name.value,
    tagline: f.elements.tagline.value,
    description: f.elements.description.value,
    address: f.elements.address.value,
    whatsapp: f.elements.whatsapp.value,
    hours: f.elements.hours.value,
  };
  const btn = $('#saveSettingsBtn');
  btn.disabled = true;
  try {
    await requestJson('/api/admin/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    toast('Pengaturan disimpan');
  } catch (err) {
    toast(errorMessage(err));
  } finally {
    btn.disabled = false;
  }
});

/* ---------- init ---------- */
checkSession();
