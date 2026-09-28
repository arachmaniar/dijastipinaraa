/**
 * diJastipinaraa — Google Apps Script backend
 *
 * SETUP
 * 1. Buka Spreadsheet > Extensions > Apps Script, paste file ini.
 * 2. Isi DRIVE_FOLDER_ID di bawah (ID folder induk JASTIPINARAA).
 * 3. (Opsional) jalankan setupSheets_() sekali untuk membuat header tab.
 * 4. Deploy > New deployment > Web app
 *      Execute as: Me | Who has access: Anyone
 *    Salin URL-nya ke APPS_SCRIPT_URL di config.js.
 *
 * Foto: beri nama file = sku_id (S001.jpg) atau product_id (P001.jpg) di folder Drive
 *       (share: Anyone with the link - Viewer).
 */

const DRIVE_FOLDER_ID = 'ISI_FOLDER_ID_DRIVE';
const SHEETS = { products: 'Products', config: 'Config', orders: 'Orders' };
const CATALOG_CACHE_SEC = 60;
const IMAGE_CACHE_SEC = 600;

// ---------- Entry points ----------

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || 'catalog';
  try {
    if (action === 'catalog') return json_(getCatalog_());
    if (action === 'stock') return json_({ ok: true, stock: getStock_() });
    return json_({ ok: false, error: 'UNKNOWN_ACTION' });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.action === 'order') return json_(createOrder_(body));
    return json_({ ok: false, error: 'UNKNOWN_ACTION' });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

// ---------- Catalog ----------

function getCatalog_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('catalog');
  if (hit) return JSON.parse(hit);

  const images = imageMap_();
  const products = readProducts_()
    .filter(p => p.active)
    .map(p => {
      const fileId = p.image_file_id || images[p.sku_id.toLowerCase()] || images[p.product_id.toLowerCase()] || '';
      p.image_url_card = fileId ? thumb_(fileId, 400) : '';
      p.image_url_detail = fileId ? thumb_(fileId, 800) : '';
      delete p.image_file_id;
      delete p.active;
      return p;
    });

  const result = { ok: true, config: readConfig_(), products: products };
  const s = JSON.stringify(result);
  if (s.length < 90000) cache.put('catalog', s, CATALOG_CACHE_SEC); // limit cache 100KB per key
  return result;
}

function getStock_() {
  // Tanpa cache: selalu baca stok terbaru
  const out = {};
  readProducts_().forEach(p => { out[p.sku_id] = p.active ? p.stock : 0; });
  return out;
}

// ---------- Orders ----------

function createOrder_(body) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const cfg = readConfig_();
    const bySku = {};
    readProducts_().forEach(p => { bySku[p.sku_id] = p; });

    const items = [];
    const problems = [];
    (body.items || []).forEach(i => {
      const p = bySku[String(i.sku_id)];
      const qty = Math.floor(Number(i.qty));
      if (!p || !p.active || !(qty > 0)) { problems.push({ sku_id: i.sku_id, available: 0 }); return; }
      if (qty > p.stock) { problems.push({ sku_id: p.sku_id, available: p.stock }); return; }
      items.push(Object.assign({}, p, { qty: qty }));
    });
    if (problems.length || !items.length) return { ok: false, error: 'STOCK', problems: problems };

    const totals = calcTotals_(items, cfg);
    const orderId = String(body.orderId || '').trim() || ('JP-' + Utilities.getUuid().slice(0, 6).toUpperCase());

    const sh = SpreadsheetApp.getActive().getSheetByName(SHEETS.orders);
    const last = sh.getLastRow();
    if (last > 1) {
      const ids = sh.getRange(2, 1, last - 1, 1).getValues().flat();
      if (ids.indexOf(orderId) !== -1) return { ok: true, orderId: orderId, totals: totals, duplicate: true }; // idempotent
    }

    const snapshot = items.map(i => ({
      sku_id: i.sku_id, product_name: i.product_name, variant: i.variant, store_name: i.store_name,
      qty: i.qty, final_price: i.final_price
    }));
    const customer = body.customer || {};
    sh.appendRow([
      orderId, new Date(), customer.name || '', customer.note || '', JSON.stringify(snapshot),
      totals.nominalPembelian, totals.totalBelanja, totals.jumlahToko, totals.feeJastip,
      totals.ongkirKemasan, totals.grandTotal, 'Pending', false
    ]);
    return { ok: true, orderId: orderId, totals: totals };
  } finally {
    lock.releaseLock();
  }
}

// Aturan hitung. Ubah di sini jika aturan ongkir berubah (harus sama dengan calculateShipping() di frontend).
function calcTotals_(items, cfg) {
  let nominal = 0, total = 0, qtyAll = 0, ongkir = 0;
  const stores = {};
  items.forEach(i => {
    nominal += i.original_price * i.qty;
    total += i.final_price * i.qty;
    qtyAll += i.qty;
    ongkir += i.shipping_packaging_cost * i.qty; // ASUMSI: biaya per unit
    stores[normStore_(i.store_name)] = true;
  });
  const jumlahToko = Object.keys(stores).length;
  const fee = jumlahToko * cfg.fee_per_store + Math.max(0, qtyAll - cfg.free_item_qty) * cfg.extra_item_fee;
  return {
    nominalPembelian: nominal, totalBelanja: total, jumlahToko: jumlahToko,
    feeJastip: fee, ongkirKemasan: ongkir, grandTotal: total + fee + ongkir
  };
}

// Stok berkurang SEKALI saat status order diubah jadi "Confirmed"
function onEdit(e) {
  const sh = e.range.getSheet();
  if (sh.getName() !== SHEETS.orders || e.range.getRow() < 2) return;
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const statusCol = head.indexOf('status') + 1;
  const dedCol = head.indexOf('stock_deducted') + 1;
  const itemsCol = head.indexOf('items_json') + 1;
  if (e.range.getColumn() !== statusCol || e.value !== 'Confirmed') return;

  const row = e.range.getRow();
  if (sh.getRange(row, dedCol).getValue() === true) return;

  const items = JSON.parse(sh.getRange(row, itemsCol).getValue() || '[]');
  const ps = SpreadsheetApp.getActive().getSheetByName(SHEETS.products);
  const data = ps.getDataRange().getValues();
  const h = data[0].map(String);
  const skuIdx = h.indexOf('sku_id'), stockIdx = h.indexOf('stock');
  items.forEach(it => {
    for (let r = 1; r < data.length; r++) {
      if (String(data[r][skuIdx]).trim() === it.sku_id) {
        ps.getRange(r + 1, stockIdx + 1).setValue(Math.max(0, Number(data[r][stockIdx]) - it.qty));
        break;
      }
    }
  });
  sh.getRange(row, dedCol).setValue(true);
  CacheService.getScriptCache().remove('catalog');
}

// ---------- Sheet readers ----------

function readTable_(name) {
  const sh = SpreadsheetApp.getActive().getSheetByName(name);
  const values = sh.getDataRange().getValues();
  const head = values[0].map(h => String(h).trim());
  return values.slice(1)
    .filter(r => r.some(c => c !== ''))
    .map(r => { const o = {}; head.forEach((h, i) => { o[h] = r[i]; }); return o; });
}

function readProducts_() {
  return readTable_(SHEETS.products).map(r => {
    const finalPrice = num_(r.final_price);
    return {
      sku_id: str_(r.sku_id), product_id: str_(r.product_id), category: str_(r.category),
      product_name: str_(r.product_name), store_name: str_(r.store_name), variant: str_(r.variant),
      original_price: num_(r.original_price) || finalPrice, final_price: finalPrice,
      stock: num_(r.stock), shipping_packaging_cost: num_(r.shipping_packaging_cost),
      description: str_(r.description), material: str_(r.material), weight: str_(r.weight),
      packaging: str_(r.packaging), short_note: str_(r.short_note),
      image_file_id: str_(r.image_file_id), active: bool_(r.active)
    };
  }).filter(p => p.sku_id && p.product_id);
}

function readConfig_() {
  const cfg = { wa_number: '', fee_per_store: 15000, extra_item_fee: 3000, free_item_qty: 3 };
  readTable_(SHEETS.config).forEach(r => {
    const k = str_(r.key);
    if (!k) return;
    cfg[k] = (k === 'wa_number') ? str_(r.value) : num_(r.value);
  });
  return cfg;
}

// ---------- Drive images ----------

function imageMap_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('images');
  if (hit) return JSON.parse(hit);
  const map = {};
  walk_(DriveApp.getFolderById(DRIVE_FOLDER_ID), map);
  const s = JSON.stringify(map);
  if (s.length < 90000) cache.put('images', s, IMAGE_CACHE_SEC);
  return map;
}

function walk_(folder, map) {
  const files = folder.getFiles();
  while (files.hasNext()) {
    const f = files.next();
    if (String(f.getMimeType()).indexOf('image/') !== 0) continue;
    map[f.getName().replace(/\.[^.]+$/, '').toLowerCase()] = f.getId();
  }
  const subs = folder.getFolders();
  while (subs.hasNext()) walk_(subs.next(), map);
}

function thumb_(id, w) { return 'https://drive.google.com/thumbnail?id=' + id + '&sz=w' + w; }

// ---------- Helpers ----------

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function str_(v) { return v === undefined || v === null ? '' : String(v).trim(); }
function num_(v) { const n = Number(String(v).replace(/[^\d.-]/g, '')); return isNaN(n) ? 0 : n; }
function bool_(v) { return v === true || String(v).toUpperCase() === 'TRUE'; }
function normStore_(s) { return String(s).trim().toLowerCase().replace(/\s+/g, ' '); }

// Jalankan sekali untuk membuat header tab (tidak menimpa tab yang sudah ada)
function setupSheets_() {
  const ss = SpreadsheetApp.getActive();
  const defs = {
    Products: ['sku_id', 'product_id', 'category', 'product_name', 'store_name', 'variant', 'original_price', 'final_price', 'stock', 'shipping_packaging_cost', 'description', 'material', 'weight', 'packaging', 'short_note', 'image_file_id', 'active'],
    Config: ['key', 'value'],
    Orders: ['order_id', 'created_at', 'customer_name', 'note', 'items_json', 'nominal_pembelian', 'total_belanja', 'jumlah_toko', 'fee_jastip', 'ongkir_kemasan', 'grand_total', 'status', 'stock_deducted']
  };
  Object.keys(defs).forEach(name => {
    let sh = ss.getSheetByName(name);
    if (!sh) { sh = ss.insertSheet(name); sh.getRange(1, 1, 1, defs[name].length).setValues([defs[name]]); }
  });
  const cfg = ss.getSheetByName('Config');
  if (cfg.getLastRow() < 2) {
    cfg.getRange(2, 1, 4, 2).setValues([['wa_number', ''], ['fee_per_store', 15000], ['extra_item_fee', 3000], ['free_item_qty', 3]]);
  }
}
