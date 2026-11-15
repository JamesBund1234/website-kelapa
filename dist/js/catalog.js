import { requestJson, errorMessage, formatRp } from './api.js';

const $ = (sel) => document.querySelector(sel);
const state = {
  business: null,
  categories: [],
  menus: [],
  filter: 'all',
  cart: JSON.parse(localStorage.getItem('dapung_cart') || '[]'),
};

const CART_KEY = 'dapung_cart';

/* ---------- helpers ---------- */
function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function waLink(number, text) {
  const digits = String(number || '').replace(/\D/g, '');
  const base = digits ? `https://wa.me/${digits}` : '#';
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2200);
}

function saveCart() { localStorage.setItem(CART_KEY, JSON.stringify(state.cart)); }

/* ---------- render ---------- */
function renderChips() {
  const wrap = $('#categoryChips');
  wrap.innerHTML = '';
  const all = el('button', 'chip' + (state.filter === 'all' ? ' active' : ''), 'Semua');
  all.type = 'button';
  all.addEventListener('click', () => { state.filter = 'all'; renderChips(); renderGrid(); });
  wrap.appendChild(all);
  for (const c of state.categories) {
    const chip = el('button', 'chip' + (state.filter === c.id ? ' active' : ''), c.name);
    chip.type = 'button';
    chip.addEventListener('click', () => { state.filter = c.id; renderChips(); renderGrid(); });
    wrap.appendChild(chip);
  }
}

function menuCard(m, compact = false) {
  const card = el('article', 'card');
  const media = el('div', 'card-media');
  if (m.image_url) {
    const img = el('img');
    img.src = m.image_url;
    img.alt = m.name;
    img.loading = 'lazy';
    media.appendChild(img);
  } else {
    media.style.background = 'linear-gradient(135deg,#16815B,#0E5C41)';
  }
  if (m.is_best_seller) {
    media.appendChild(el('span', 'card-badge', '⭐ Terlaris'));
  }
  card.appendChild(media);

  const body = el('div', 'card-body');
  body.appendChild(el('div', 'card-cat', categoryName(m.category_id)));
  body.appendChild(el('h3', 'card-name', m.name));
  body.appendChild(el('p', 'card-desc', m.description || ''));
  const foot = el('div', 'card-foot');
  const price = el('div', 'price');
  price.append(el('small', null, 'Rp '), document.createTextNode(Number(m.price).toLocaleString('id-ID')));
  foot.appendChild(price);
  const add = el('button', 'add-btn', '+');
  add.type = 'button';
  add.setAttribute('aria-label', 'Tambah ' + m.name);
  add.addEventListener('click', () => { addToCart(m); });
  foot.appendChild(add);
  body.appendChild(foot);
  card.appendChild(body);
  if (compact) card.style.height = '100%';
  return card;
}

function renderGrid() {
  const grid = $('#menuGrid');
  const list = state.menus.filter((m) => state.filter === 'all' || m.category_id === state.filter);
  grid.innerHTML = '';
  $('#menuEmpty').hidden = list.length > 0;
  grid.hidden = list.length === 0;
  for (const m of list) grid.appendChild(menuCard(m));
}

function renderBest() {
  const grid = $('#bestGrid');
  grid.innerHTML = '';
  const best = state.menus.filter((m) => m.is_best_seller);
  const items = best.length ? best : state.menus.slice(0, 4);
  for (const m of items.slice(0, 8)) {
    const card = el('div', 'band-card');
    if (m.image_url) {
      const img = el('img');
      img.src = m.image_url; img.alt = m.name; img.loading = 'lazy';
      card.appendChild(img);
    }
    const wrap = el('div');
    wrap.style.flex = '1';
    wrap.appendChild(el('div', 'bc-name', m.name));
    wrap.appendChild(el('div', 'bc-price', formatRp(m.price)));
    card.appendChild(wrap);
    const add = el('button', 'add-btn', '+');
    add.type = 'button';
    add.setAttribute('aria-label', 'Tambah ' + m.name);
    add.addEventListener('click', () => addToCart(m));
    card.appendChild(add);
    grid.appendChild(card);
  }
  if (!items.length) grid.innerHTML = '<p style="color:#fff;opacity:.8">Belum ada menu terlaris.</p>';
}

function renderInfo() {
  const b = state.business || {};
  $('#hoursList').innerHTML = '';
  const hours = Array.isArray(b.hours) ? b.hours : [];
  if (!hours.length) {
    $('#hoursList').appendChild(el('p', null, 'Jam buka belum diatur.'));
  }
  for (const h of hours) {
    const row = el('div', 'hours-row');
    row.appendChild(el('span', null, h.days));
    row.appendChild(el('b', null, h.time));
    $('#hoursList').appendChild(row);
  }
  $('#addressText').textContent = b.address || 'Alamat belum diatur.';
  $('#heroLead').textContent = b.description || $('#heroLead').textContent;
  $('#footTag').textContent = b.tagline || 'Segar dari kebun';
  document.title = (b.name || 'Dapung Coconat') + ' — Segarnya Kelapa Muda';

  const wa = waLink(b.whatsapp);
  $('#heroWaBtn').href = wa;
  $('#floatWa').href = wa;
  $('#footWaLink').href = wa;
}

function categoryName(id) {
  const c = state.categories.find((x) => x.id === id);
  return c ? c.name : 'Menu';
}

/* ---------- cart ---------- */
function addToCart(m) {
  const found = state.cart.find((i) => i.id === m.id);
  if (found) found.qty += 1;
  else state.cart.push({ id: m.id, name: m.name, price: m.price, qty: 1, image_url: m.image_url });
  saveCart(); renderCart(); openDrawer();
  toast(`${m.name} ditambahkan`);
}

function renderCart() {
  const wrap = $('#cartItems');
  wrap.innerHTML = '';
  const count = state.cart.reduce((n, i) => n + i.qty, 0);
  const badge = $('#cartCount');
  badge.hidden = count === 0;
  badge.textContent = count;

  if (!state.cart.length) {
    wrap.appendChild(el('div', 'empty-cart', ''));
    wrap.querySelector('.empty-cart').innerHTML = '<div class="big">🛒</div><p>Keranjang masih kosong.<br/>Yuk pilih menu favoritmu!</p>';
    $('#cartFoot').hidden = true;
    return;
  }

  for (const item of state.cart) {
    const row = el('div', 'cart-item');
    if (item.image_url) {
      const img = el('img');
      img.src = item.image_url; img.alt = item.name;
      row.appendChild(img);
    }
    const body = el('div', 'ci-body');
    body.appendChild(el('div', 'ci-name', item.name));
    body.appendChild(el('div', 'ci-price', formatRp(item.price)));
    const qty = el('div', 'qty');
    const minus = el('button', null, '−');
    minus.type = 'button';
    minus.addEventListener('click', () => { item.qty -= 1; if (item.qty <= 0) state.cart = state.cart.filter(x => x.id !== item.id); saveCart(); renderCart(); });
    const plus = el('button', null, '+');
    plus.type = 'button';
    plus.addEventListener('click', () => { item.qty += 1; saveCart(); renderCart(); });
    qty.append(minus, el('span', null, String(item.qty)), plus);
    body.appendChild(qty);
    const rm = el('button', 'ci-remove', 'Hapus');
    rm.type = 'button';
    rm.addEventListener('click', () => { state.cart = state.cart.filter(x => x.id !== item.id); saveCart(); renderCart(); });
    body.appendChild(rm);
    row.appendChild(body);
    wrap.appendChild(row);
  }

  const total = state.cart.reduce((n, i) => n + i.price * i.qty, 0);
  $('#cartTotal').textContent = formatRp(total);
  $('#cartFoot').hidden = false;
}

function checkout() {
  if (!state.cart.length) return;
  const b = state.business || {};
  const lines = state.cart.map((i, idx) => `${idx + 1}. ${i.name} x${i.qty} — ${formatRp(i.price * i.qty)}`);
  const total = state.cart.reduce((n, i) => n + i.price * i.qty, 0);
  const text = `Halo ${b.name || 'Dapung Coconat'}! Saya ingin memesan:\n\n${lines.join('\n')}\n\nTotal: ${formatRp(total)}\n\nNama: \nCatatan: `;
  window.open(waLink(b.whatsapp, text), '_blank', 'noopener');
}

/* ---------- drawer ---------- */
function openDrawer() {
  $('#drawer').classList.add('open');
  $('#drawerOverlay').classList.add('open');
}
function closeDrawer() {
  $('#drawer').classList.remove('open');
  $('#drawerOverlay').classList.remove('open');
}

/* ---------- load ---------- */
async function load() {
  try {
    const data = await requestJson('/api/catalog');
    if (!data || typeof data !== 'object' || !Array.isArray(data.menus) || !Array.isArray(data.categories)) {
      throw new Error('invalid');
    }
    state.business = data.business || {};
    state.categories = data.categories;
    state.menus = data.menus;
    renderChips();
    renderGrid();
    renderBest();
    renderInfo();
    $('#statMenus').textContent = state.menus.length;
    $('#statBest').textContent = state.menus.filter(m => m.is_best_seller).length;
    const hero = state.menus.find(m => m.is_best_seller) || state.menus[0];
    if (hero?.image_url) $('#heroImg').src = hero.image_url;
  } catch (err) {
    $('#menuGrid').innerHTML = '';
    $('#menuEmpty').hidden = false;
    $('#menuEmpty').querySelector('h3').textContent = 'Gagal memuat menu';
    $('#menuEmpty').querySelector('p').textContent = errorMessage(err);
  }
}

/* ---------- init ---------- */
$('#cartOpenBtn').addEventListener('click', openDrawer);
$('#drawerClose').addEventListener('click', closeDrawer);
$('#drawerOverlay').addEventListener('click', closeDrawer);
$('#checkoutBtn').addEventListener('click', checkout);
$('#year').textContent = new Date().getFullYear();

renderCart();
load();
