# ROO CODE — FINALIZE diJastipinaraa

## 0. CRITICAL INSTRUCTION

`design-reference.png` di root project adalah **VISUAL SOURCE OF TRUTH** untuk tampilan.
Jangan mendesain ulang UI dari nol. Pertahankan sedekat mungkin: layout, spacing, hierarchy, card shape, typography, button shape, icon treatment, category navigation, hero illustration, colors, proportions, clean Gen Z feel.

**Jika `design-reference.png` bertentangan dengan teks di dokumen ini, TEKS YANG MENANG.** Konflik yang sudah diketahui:

| Di PNG | Yang benar |
|---|---|
| 3 USP di Page 1 | HAPUS |
| CTA `Mengerti →` | `Lanjut` (tanpa panah) |
| CTA `Lanjut ke Checkout →` | `Generate Order` (tanpa panah) |
| Bottom nav: Katalog / Rekap / Profil | Hanya Katalog dan Rekap. HAPUS Profil |
| Angka di mockup (harga, total, fee) | Dummy. Semua angka HARUS dihitung dari data, jangan disalin dari PNG |

Do NOT use emoji as final UI icons.

---

# 1. STACK & FILE STRUCTURE

HTML/CSS/JavaScript vanilla, mobile-first, tanpa framework.

```text
/
├── index.html
├── style.css
├── app.js
├── config.js            ← satu-satunya file config frontend
├── design-reference.png
├── assets/
│   ├── icons/
│   ├── logo/
│   └── hero/
└── apps-script/
    └── Code.gs          ← backend (di-paste ke Google Apps Script, bukan di-deploy dari sini)
```

Wajib: responsive, clean, simple, Gen Z, white/off-white, rounded cards, generous whitespace, modern rounded typography.
Dilarang: excessive gradient, heavy shadow, glassmorphism, UI ala marketplace yang ramai.

---

# 2. FINAL APP FLOW

```text
Page 1 — Intro
      ↓ Lanjut
Page 2 — Katalog  ⇄  Page 2A — Detail Produk
      ↓ cart
Page 3 — Rekap Order
      ↓ Generate Order
Validasi stok → simpan order ke Google Sheet → buka WhatsApp dengan teks rekap
```

**Tidak ada PDF di flow utama.** Semua CTA teks saja, tanpa tanda panah.

---

# 3. PAGE 1 — INTRO

Isi: logo/brand, hero illustration, headline, deskripsi singkat, **hanya 1 CTA `Lanjut`**, floating WhatsApp button.
HAPUS 3 USP. Jangan tambah CTA kedua.
Hero illustration wajib mengikuti `design-reference.png` (pakai asset di `/assets/hero/` jika ada). Jangan ganti dengan emoji / stock illustration / icon acak.

---

# 4. PAGE 2 — KATALOG

Isi: header, search bar, category navigation, product grid, cart count (realtime), floating WhatsApp button.

## Categories (8, nama kanonik — harus identik dengan dropdown di Sheet)

1. Makanan Berat
2. Minuman
3. Snack
4. Roti & Kue
5. Sarung
6. Sprei Adem
7. Gendongan
8. Sarung Encim (icon kebaya)

Urutan tampil mengikuti urutan di atas. Icon: simple, rounded, minimal, satu icon family, bukan emoji.
Kategori horizontal-scroll di mobile. Kategori aktif: pastel yellow, rounded, subtle border, icon + label.

Perilaku kategori:
- State awal `activeCategory = 'Semua'` (tidak ada chip aktif, judul section `Semua Produk`).
- Tap kategori → filter. Tap kategori yang sedang aktif → kembali ke `Semua`.

---

# 5. SEARCH

Search mencari `product_name` dan `store_name`:
- case-insensitive, partial match, trim whitespace, realtime (tanpa Enter)
- Search + category bisa dipakai bersamaan (category = filter tambahan)

```javascript
let activeCategory = 'Semua';
let searchQuery = '';

// Filter bekerja pada PRODUK (hasil grouping SKU by product_id)
function getFilteredProducts() {
  const q = searchQuery.trim().toLowerCase();
  return products.filter(p =>
    (activeCategory === 'Semua' || p.category === activeCategory) &&
    (!q ||
      p.product_name.toLowerCase().includes(q) ||
      p.store_name.toLowerCase().includes(q))
  );
}
```

Empty state: `Tidak menemukan produk` + tombol `Reset pencarian`.
Back dari detail HARUS mengembalikan category + search + scroll position sebelumnya.

---

# 6. PRODUCT CARD

Card: foto, nama produk, nama toko, short description (`short_note`), harga coret (hanya jika diskon), harga final, badge diskon (jika ada), tombol add.

Aturan harga & badge:
- Produk punya banyak varian dengan harga berbeda → tampil `Mulai dari Rp X` (harga final termurah dari varian yang punya stok; jika semua habis, dari semua varian).
- Badge diskon **dihitung otomatis**: `round((original_price - final_price) / original_price * 100)` → `Diskon N%`. Hanya tampil jika `original_price > final_price`. Tidak ada kolom `sale_label` manual.
- Semua varian stok 0 → badge/label `Habis`, tombol add disabled.

Aturan tombol `+` di card:
- Produk dengan **1 varian** (atau tanpa varian) dan stok > 0 → langsung tambah ke cart (qty +1).
- Produk dengan **>1 varian** → buka Product Detail (varian belum dipilih).
- Klik foto/area card → Product Detail.

Foto card memakai `image_url_card` dari API (lihat bagian 13). Tampilkan `loading="lazy"`, skeleton saat load, fallback placeholder jika gagal, ukuran card tidak boleh berubah.

---

# 7. PRODUCT DETAIL

Tampilkan: Back, foto besar (`image_url_detail`), badge diskon (jika ada), nama produk, nama toko, harga (+ harga coret bila diskon), deskripsi, bahan, berat, kemasan, **selector varian**, **status stok**, CTA `Tambah ke Keranjang`.

## Varian
- Varian = baris SKU dengan `product_id` yang sama.
- Chip varian: varian stok 0 tampil disabled dengan label `Habis` (tidak bisa dipilih).
- Default terpilih = varian pertama yang stok > 0.
- Saat varian dipilih: harga, harga coret, badge diskon, stok, dan foto (jika SKU punya foto sendiri) ikut berubah.
- Produk tanpa varian (kolom `variant` kosong) → tidak ada selector.
- Semua varian stok 0 → semua chip disabled, CTA disabled, tampil `Habis`.
- CTA disabled juga jika varian belum dipilih (jika ada >1 varian dan tidak ada yang default).

## Status stok
- `stock > 0` → `Tersedia` (boleh tampilkan `Sisa N` jika stok ≤ 5)
- `stock = 0` → `Habis`

Varian tersimpan di cart, tampil di Rekap Order, dan masuk pesan WhatsApp.

---

# 8. STOCK RULES

Google Sheets = source of truth stok. Stok dibaca per **SKU** (per varian).

```text
stock > 0  → available, add enabled
stock = 0  → "Habis", add disabled  (jangan hanya di-hide)
```

- Qty di cart tidak boleh melebihi stok SKU tersebut.
- Saat membuka Page 3 dan saat `Generate Order`: panggil `action=stock` (tanpa cache) dan validasi ulang. Jika ada item yang stoknya berubah/habis → tampilkan pesan jelas per item, sesuaikan qty otomatis / tandai item, dan batalkan proses sampai user konfirmasi.
- **Jangan kurangi stok saat item masuk cart atau saat order dikirim.** Stok dikurangi setelah kamu mengubah `status` order menjadi `Confirmed` di tab Orders (lihat `Code.gs`, fungsi `onEdit`).

---

# 9. CART & PAGE 3 — REKAP ORDER

Cart:
- Key item = `sku_id`. Simpan `{sku_id, qty}` di `localStorage` agar tidak hilang saat refresh. Saat load, validasi ulang ke katalog terbaru (buang SKU yang tidak aktif / tidak ada).
- Tampilkan cart count realtime di header Page 2 dan 2A.

Page 3 menampilkan per item: foto, nama produk, toko, **varian terpilih**, harga, qty +/-, delete. Ada `Hapus Semua`.

Opsional di Page 3 (di atas CTA): input `Nama` dan `Catatan` (keduanya opsional, satu baris masing-masing).

## Perhitungan

Semua angka konfigurasi diambil dari tab `Config` (dikirim lewat API), **bukan hard-code**.

```javascript
// Nominal Pembelian = harga SEBELUM diskon
nominalPembelian = sum(item.original_price * item.qty);

// Total Belanja = harga SETELAH diskon
totalBelanja = sum(item.final_price * item.qty);

// Jumlah Toko = distinct store_name (normalisasi: trim, lowercase, spasi ganda → satu)
jumlahToko = new Set(items.map(i => normalizeStore(i.store_name))).size;

// Fee Jastip — "item ke-4 dst" dihitung per UNIT (total quantity), bukan per produk berbeda
feeJastip =
  jumlahToko * config.fee_per_store +                       // default 15000
  Math.max(0, totalQty - config.free_item_qty) * config.extra_item_fee;  // default 3 dan 3000

// Ongkir & Kemasan (ASUMSI: per unit; lihat catatan)
ongkirKemasan = sum(item.shipping_packaging_cost * item.qty);

grandTotal = totalBelanja + feeJastip + ongkirKemasan;
```

> **CATATAN — ASUMSI ONGKIR**: `shipping_packaging_cost` diperlakukan sebagai biaya **per unit** per SKU. Aturan ini hanya ada di SATU fungsi (`calculateShipping()` di frontend dan `calcTotals_()` di `Code.gs`) supaya mudah diganti bila ternyata harus per toko / flat per order.

CTA utama: `Generate Order` (tanpa panah). Floating WhatsApp button TIDAK tampil di Page 3.

---

# 10. GENERATE ORDER → SHEET → WHATSAPP

Saat user menekan `Generate Order`:

1. Validasi cart tidak kosong.
2. Validasi stok terbaru (`action=stock`). Jika gagal → tampilkan pesan, stop.
3. Hitung semua total.
4. Buat `orderId` di frontend: format `JP-YYMMDD-XXXX` (XXXX = 4 karakter acak dari `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, tanpa karakter yang mirip).
5. `POST` order ke Apps Script (`action=order`). Server memvalidasi ulang stok, menghitung ulang total, dan menyimpan ke tab `Orders` dengan status `Pending`.
6. Bangun teks WhatsApp dan buka `https://wa.me/<wa_number>?text=<encodeURIComponent(teks)>`.
7. Kosongkan cart hanya setelah WhatsApp dibuka.

Aturan penting:
- **Jika langkah 5 gagal (network/timeout)**, WhatsApp TETAP dibuka dengan teks yang sama (pakai total dari frontend), lalu tampilkan info kecil `Order belum tercatat di sistem, tetap kirim pesan WhatsApp`. Order tidak boleh hilang hanya karena pencatatan gagal.
- Jika server menjawab `error: 'STOCK'` → jangan buka WhatsApp; tampilkan item yang bermasalah beserta sisa stoknya.
- Buka WhatsApp dengan `window.location.href = url` (BUKAN `window.open` setelah `await`, karena sering diblok popup blocker iOS Safari). Sediakan tombol fallback `Buka WhatsApp` bila redirect tidak terjadi.
- Disable tombol `Generate Order` selama proses berjalan (cegah double submit). Server idempotent terhadap `orderId` yang sama.
- Tidak ada PDF, tidak ada Web Share API, tidak ada klaim "attachment otomatis".

## Template pesan WhatsApp (WAJIB dibuka dengan kalimat ini)

```javascript
function buildWaMessage(order) {
  const rp = n => 'Rp' + Number(n).toLocaleString('id-ID');
  const lines = [
    'Hallo araa, ini rekap order aku yaa',
    '',
    '*REKAP ORDER JASTIP*',
    `Order ID: ${order.orderId}`
  ];
  if (order.customerName) lines.push(`Nama: ${order.customerName}`);
  lines.push('');

  order.items.forEach((it, i) => {
    const v = it.variant ? ` (${it.variant})` : '';
    lines.push(`${i + 1}. ${it.product_name}${v} - ${it.store_name}`);
    lines.push(`   ${it.qty} x ${rp(it.final_price)} = ${rp(it.qty * it.final_price)}`);
  });

  lines.push(
    '',
    `Total Belanja: ${rp(order.totalBelanja)}`,
    `Jumlah Toko: ${order.jumlahToko}`,
    `Fee Jastip: ${rp(order.feeJastip)}`,
    `Ongkir & Kemasan: ${rp(order.ongkirKemasan)}`,
    `*Grand Total: ${rp(order.grandTotal)}*`
  );
  if (order.note) lines.push('', `Catatan: ${order.note}`);
  lines.push('', 'Mohon dicek & dikonfirmasi yaa. Terima kasih!');
  return lines.join('\n');
}
```

Jika panjang teks > ±1500 karakter, gunakan versi ringkas per item (`N. Nama (varian) x qty`) tanpa baris hitungan harga, agar URL tidak kepanjangan.

---

# 11. FLOATING WHATSAPP BUTTON

Page 1 dan Page 2 WAJIB punya floating WhatsApp button (label `Tanya Order`). Membuka WhatsApp dengan teks:

```text
Halo, saya mau tanya tentang order jastip.
```

Nomor diambil dari `Config` (`wa_number`); sebelum katalog selesai dimuat gunakan `WA_NUMBER_FALLBACK` dari `config.js` bila diisi, jika tidak sembunyikan tombol sampai config tersedia. Tidak tampil di Page 3. Tidak boleh menutupi kontrol penting.

---

# 12. GOOGLE SHEETS — STRUKTUR (SSOT)

Spreadsheet punya 3 tab. Satu baris di `Products` = satu **SKU (varian)**.

## Tab `Products`

```text
sku_id | product_id | category | product_name | store_name | variant | original_price | final_price | stock | shipping_packaging_cost | description | material | weight | packaging | short_note | image_file_id | active
```

| Kolom | Aturan |
|---|---|
| `sku_id` | Unik per baris, jangan pernah diubah setelah dipakai (dipakai juga sebagai nama file foto) |
| `product_id` | Sama untuk semua varian dari satu produk. Frontend grouping berdasarkan ini, BUKAN `product_name` |
| `category` | Dropdown (data validation) dari 8 kategori kanonik |
| `store_name` | Dropdown / konsisten. Fee dihitung per toko, jadi ejaan harus seragam |
| `variant` | Kosong jika produk tanpa varian |
| `original_price` | Harga sebelum diskon. Kosong = dianggap sama dengan `final_price` (tidak diskon) |
| `final_price` | Harga jual per SKU (boleh beda antar varian) |
| `stock` | Angka per SKU |
| `shipping_packaging_cost` | Biaya per unit (lihat asumsi di bagian 9) |
| `description`, `material`, `weight`, `packaging` | Level produk; jika beda antar baris dalam satu `product_id`, pakai baris pertama yang aktif |
| `image_file_id` | OPSIONAL, override manual. Normalnya kosong (foto dicocokkan lewat nama file) |
| `active` | Checkbox. Hanya `TRUE` yang tampil |

Contoh:

```text
S001 | P001 | Sarung   | Sarung Batik Solo | Toko Sinar Mas | Biru    | 100000 | 85000 | 5 | 8000
S002 | P001 | Sarung   | Sarung Batik Solo | Toko Sinar Mas | Cokelat | 100000 | 85000 | 0 | 8000
S003 | P001 | Sarung   | Sarung Batik Solo | Toko Sinar Mas | Hitam   | 120000 | 99000 | 3 | 8000
```

## Tab `Config` (kolom `key` | `value`)

```text
wa_number          62812xxxxxxx     ← format internasional, tanpa + dan tanpa 0 di depan
fee_per_store      15000
extra_item_fee     3000
free_item_qty      3
```

## Tab `Orders` (diisi otomatis oleh Apps Script)

```text
order_id | created_at | customer_name | note | items_json | nominal_pembelian | total_belanja | jumlah_toko | fee_jastip | ongkir_kemasan | grand_total | status | stock_deducted
```

`status` dropdown: `Pending`, `Confirmed`, `Cancelled`.

---

# 13. APPS SCRIPT API CONTRACT

Backend = `apps-script/Code.gs` (Web App, Execute as: Me, Access: Anyone). Frontend HANYA memanggil URL ini (`APPS_SCRIPT_URL` di `config.js`). Tidak ada credential Google, API key, atau service account di frontend/HTML/JS/repo.

### `GET ?action=catalog`

```json
{
  "ok": true,
  "config": { "wa_number": "62812...", "fee_per_store": 15000, "extra_item_fee": 3000, "free_item_qty": 3 },
  "products": [
    {
      "sku_id": "S001", "product_id": "P001", "category": "Sarung",
      "product_name": "...", "store_name": "...", "variant": "Biru",
      "original_price": 100000, "final_price": 85000, "stock": 5,
      "shipping_packaging_cost": 8000,
      "description": "...", "material": "...", "weight": "...", "packaging": "...", "short_note": "...",
      "image_url_card": "https://drive.google.com/thumbnail?id=...&sz=w400",
      "image_url_detail": "https://drive.google.com/thumbnail?id=...&sz=w800"
    }
  ]
}
```

Hanya SKU `active = TRUE`. Response di-cache ±60 detik di server.

### `GET ?action=stock`

```json
{ "ok": true, "stock": { "S001": 5, "S002": 0 } }
```

TANPA cache. Dipakai saat buka Page 3 dan saat Generate Order.

### `POST` (`Content-Type: text/plain` agar tidak memicu CORS preflight; body tetap JSON string)

```json
{ "action": "order", "orderId": "JP-260928-A7K2",
  "customer": { "name": "", "note": "" },
  "items": [ { "sku_id": "S001", "qty": 2 } ] }
```

Sukses: `{ "ok": true, "orderId": "...", "totals": { ... } }`
Stok bermasalah: `{ "ok": false, "error": "STOCK", "problems": [ { "sku_id": "S001", "available": 1 } ] }`

Server menghitung ulang total sendiri (jangan percaya angka dari frontend).

## Frontend adapter

```javascript
async function fetchProducts() {}   // catalog → validasi field wajib → group by product_id → state → render
```

Wajib: fetch → parse JSON → validasi field wajib (`sku_id`, `product_id`, `category`, `product_name`, `store_name`, `final_price`, `stock`; baris tidak valid di-skip + `console.warn`) → simpan state → render. Tampilkan loading (skeleton) dan error state (dengan tombol `Coba lagi`).
Simpan katalog terakhir di `localStorage` dan tampilkan lebih dulu sambil fetch terbaru (stale-while-revalidate), karena cold start Apps Script bisa lambat.

---

# 14. GOOGLE DRIVE — FOTO PRODUK

Google Drive = source of truth foto. Tujuan: **upload file baru ke Drive → otomatis muncul, tanpa menyalin ID**.

Aturan:
- Folder induk `JASTIPINARAA/` (boleh punya subfolder per kategori untuk kerapian; script memindai rekursif). Share: **Anyone with the link – Viewer**.
- **Nama file = `sku_id`** (contoh `S001.jpg`). Jika tidak ada file untuk SKU, fallback ke file bernama `product_id` (contoh `P001.jpg`, satu foto untuk semua varian). Ekstensi bebas.
- Pencocokan dilakukan di **Apps Script** (memindai folder, hasil di-cache ±10 menit), bukan di frontend. Frontend tidak pernah mencari file di Drive dan tidak memakai nama produk sebagai key.
- `image_file_id` di Sheet bersifat override opsional (menang atas pencocokan nama file).
- URL gambar dari API memakai format thumbnail berukuran (`w400` card, `w800` detail). Jangan pakai URL `/edit` atau `uc?export=view`.

Frontend:

```javascript
function getImageUrl(product, size = 'card') {}  // pakai image_url_card / image_url_detail dari API
```

Jika gambar hilang/rusak: tampilkan placeholder, pertahankan dimensi card.

---

# 15. DATA ARCHITECTURE

```text
Google Sheets (Products, Config, Orders) + Drive (foto)
              ↓
      Apps Script Web App
              ↓
      fetchProducts()  →  flat SKU list  →  group by product_id
              ↓
      Product State  →  Search + Category filter
              ↓
      Product Detail (varian)  →  Cart State (by sku_id)
              ↓
      validateStock()  →  calculate*()  →  submitOrder()
              ↓
      Tab Orders  +  WhatsApp (wa.me prefilled)
```

Fungsi:

```javascript
fetchProducts()  groupBySku()  renderCategories()  getFilteredProducts()
renderProducts()  renderProductDetail()  selectVariant()
addToCart()  updateCart()  removeFromCart()  clearCart()
validateStock()  calculateSubtotal()  calculateShipping()
calculateJastipFee()  calculateGrandTotal()  renderSummary()
generateOrderId()  submitOrder()  buildWaMessage()  openWhatsApp()
```

---

# 16. VISUAL RULES

Pertahankan: white/off-white background, dark navy/charcoal typography, pastel yellow accent, red discount badge, light borders, rounded cards, modern rounded typography, simple iconography, generous whitespace, compact mobile controls.
Gunakan SVG asset di `/assets/icons/`, `/assets/logo/`, `/assets/hero/` jika ada. Jangan digambar ulang atau diganti icon library acak. Tidak ada emoji sebagai icon final.

---

# 17. RESPONSIVE

Test: 360px, 390px, 768px, 1024px+.
Mobile: kategori horizontal scroll, search full width, grid 2 kolom, tombol touch-friendly, floating WA tidak menutup kontrol penting.
Desktop: 3–4 kolom, konten terpusat dan mudah dibaca.

---

# 18. UX STATES

Implement: loading, error (Sheets gagal), katalog kosong, search no result, cart kosong, gambar rusak/hilang, stok 0, stok tidak cukup, varian belum dipilih, order gagal dicatat (WA tetap terbuka), stok berubah saat Generate Order, tombol `Buka WhatsApp` fallback.

---

# 19. QA

1. Intro → Katalog (tanpa USP, tanpa panah)
2. Floating WA di Page 1, Page 2; tidak ada di Page 3
3. Search produk / toko / partial / huruf besar-kecil
4. Search + kategori; tap kategori aktif → kembali ke Semua
5. Back dari detail: kategori + search + scroll tetap
6. Produk 1 varian: `+` di card langsung add
7. Produk multi-varian: `+` di card membuka detail
8. Selector varian: harga/stok/foto ikut berubah
9. Varian stok 0: chip disabled + `Habis`
10. Semua varian stok 0: card `Habis`, CTA mati
11. Card multi-harga menampilkan `Mulai dari`
12. Badge diskon otomatis benar; tanpa diskon tidak tampil
13. Qty tidak melebihi stok SKU
14. Delete, Hapus Semua, cart bertahan setelah refresh
15. Fee: 1 item/1 toko; 3 item/1 toko; 4 item/1 toko; 4 item/2 toko
16. Nominal Pembelian vs Total Belanja benar (produk diskon & non-diskon)
17. Ongkir & Kemasan sesuai Sheet
18. Toko dengan ejaan/spasi berbeda dihitung satu toko
19. Ubah stok/harga di Sheet → tampil setelah cache habis (±60 dtk)
20. Upload foto baru bernama `sku_id` di Drive → muncul (±10 mnt)
21. Sheets gagal load → error state + `Coba lagi`
22. Foto hilang / rusak → placeholder
23. Generate Order sukses: baris baru di tab Orders (status Pending), WA terbuka
24. Pesan WA diawali `Hallo araa, ini rekap order aku yaa`, total sama dengan Page 3
25. Stok berubah sebelum Generate Order → pesan jelas, WA tidak terbuka
26. Apps Script gagal saat POST → WA tetap terbuka + info
27. Double klik `Generate Order` → tidak ada order ganda
28. Ubah status Confirmed → stok berkurang sekali saja
29. 360px, 390px, tablet, desktop
30. Visual sesuai `design-reference.png` (dengan pengecualian di bagian 0)

---

# 20. PRODUCTION RULES

DO NOT:
- hard-code katalog, stok, harga, ongkir, fee, nomor WA, mapping foto
- pakai emoji sebagai icon final
- tinggalkan dummy data sebagai sumber produksi
- expose credential Google / secret di frontend atau repo
- membuat PDF / Web Share API di flow utama
- mengurangi stok saat add-to-cart atau saat order dikirim
- menyalin angka dari mockup PNG

MUST:
- Sheets = katalog/stok/harga/config/order log; Drive = foto
- satu baris = satu SKU, grouping by `product_id`
- search produk + toko, filter kategori
- validasi stok di frontend dan di server
- perhitungan sama di frontend dan Apps Script
- WhatsApp selalu bisa terbuka walau pencatatan gagal

---

# 21. FINAL OUTPUT

Setelah implementasi:
1. Bersihkan kode, hapus logika/dummy prototype.
2. Jalankan seluruh QA di atas dan laporkan hasilnya.
3. Tambahkan komentar singkat untuk konfigurasi Sheets/Drive di `config.js` dan `Code.gs`.
4. Berikan struktur folder final.
5. Daftar HANYA nilai yang harus diisi user:
   - `APPS_SCRIPT_URL` di `config.js` (dan opsional `WA_NUMBER_FALLBACK`)
   - `DRIVE_FOLDER_ID` di `Code.gs`
   - Tab `Config`: `wa_number`, `fee_per_store`, `extra_item_fee`, `free_item_qty`
   - Isi tab `Products` dan upload foto bernama `sku_id` ke folder Drive

Jangan redesign dari nol. Gunakan `design-reference.png` sebagai acuan visual utama.
