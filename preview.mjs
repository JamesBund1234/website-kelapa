// Local-only preview server for Dapung Coconat.
// Serves the project root (index.html / admin.html at the top level),
// the dist/ assets they reference, the product photos, and a seeded
// GET /functions/v1/app/api/catalog so the customer page renders fully
// without the deployed backend. Not part of the published package.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = 4173;

const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const business = {
  name: 'Dapung Coconat',
  tagline: 'Segarnya Kelapa Muda',
  description: 'Nikmati aneka olahan kelapa segar langsung dari kebun — minuman, es, dan camilan yang menggugah selera.',
  address: 'Jl. Kebun Kelapa No. 12, Yogyakarta',
  whatsapp: '6281234567890',
  hours: [
    { days: 'Senin – Jumat', time: '09.00 – 21.00' },
    { days: 'Sabtu – Minggu', time: '08.00 – 22.00' },
  ],
};

const categories = [
  { id: 'cat-minuman', name: 'Minuman', sort_order: 1 },
  { id: 'cat-dessert', name: 'Es & Dessert', sort_order: 2 },
  { id: 'cat-camilan', name: 'Camilan', sort_order: 3 },
];

const m = (id, name, description, price, category_id, is_best_seller, slug) => ({
  id, name, description, price, category_id, is_best_seller,
  image_url: `/assets/images/${slug}.png`,
});

const menus = [
  m('m1', 'Es Kelapa Muda', 'Air kelapa muda asli dengan daging kelapa lembut dan es batu.', 9000, 'cat-minuman', true, 'es-kelapa-muda'),
  m('m2', 'Es Kelapa Kopyor', 'Kelapa kopyor legit dengan sirup gula aren dan es serut.', 12000, 'cat-minuman', true, 'es-kelapa-kopyor'),
  m('m3', 'Kopi Kelapa Gula Aren', 'Espresso dengan air kelapa dan gula aren, creamy dan segar.', 14000, 'cat-minuman', false, 'kopi-kelapa-gula-aren'),
  m('m4', 'Smoothie Kelapa Mangga', 'Smoothie kelapa muda dicampur mangga harum yang manis.', 15000, 'cat-minuman', true, 'smoothie-kelapa-mangga'),
  m('m5', 'Es Cendol Kelapa', 'Cendol kenyal, santan kelapa, dan gula merah cair.', 10000, 'cat-dessert', false, 'es-cendol-kelapa'),
  m('m6', 'Es Krim Kelapa Bakar', 'Es krim kelapa dengan serutan kelapa bakar yang gurih.', 16000, 'cat-dessert', false, 'es-krim-kelapa-bakar'),
  m('m7', 'Puding Kelapa Muda', 'Puding lembut dengan potongan kelapa muda segar.', 11000, 'cat-dessert', false, 'puding-kelapa-muda'),
  m('m8', 'Kelapa Bakar Madu', 'Daging kelapa muda dibakar, disiram madu, dan taburan wijen.', 13000, 'cat-camilan', true, 'kelapa-bakar-madu'),
  m('m9', 'Klepon Kelapa', 'Klepon isi gula merah berbalut parutan kelapa.', 8000, 'cat-camilan', false, 'klepon-kelapa'),
  m('m10', 'Kue Lapis Kelapa', 'Kue lapis legit bersantan dengan taburan kelapa parut.', 7000, 'cat-camilan', false, 'kue-lapis-kelapa'),
  m('m11', 'Roti Bakar Kelapa', 'Roti bakar isi selai kelapa, mentega, dan meses.', 12000, 'cat-camilan', false, 'roti-bakar-kelapa'),
  m('m12', 'Serabi Kuah Kelapa', 'Serabi lembut dengan kuah santan kelapa dan gula merah.', 9000, 'cat-camilan', false, 'serabi-kuah-kelapa'),
];

function isSafePath(rel) {
  const segs = rel.split('/').filter(Boolean);
  return !segs.some((s) => s.startsWith('.') || s === 'node_modules');
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const p = decodeURIComponent(url.pathname);
  try {
    if (p === '/functions/v1/app/api/catalog') {
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ business, categories, menus }));
      return;
    }
    if (p === '/functions/v1/app/api/health') {
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end('{"ok":true}');
      return;
    }
    const rel = p === '/' ? 'index.html' : p.slice(1);
    if (!isSafePath(rel)) throw new Error('blocked path');
    const filePath = join(ROOT, rel);
    const data = await readFile(filePath);
    res.setHeader('content-type', types[extname(filePath)] || 'application/octet-stream');
    res.end(data);
  } catch {
    res.statusCode = 404;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end('not found');
  }
}).listen(PORT, '127.0.0.1', () => console.log(`Dapung Coconat preview: http://127.0.0.1:${PORT}/`));
