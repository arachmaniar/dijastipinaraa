# diJastipinaraa — Jastip Catalog & Order App

## Project files

- `index.html`, `style.css`, `app.js` — aplikasi (mobile-first, vanilla)
- `config.js` — konfigurasi frontend (`APPS_SCRIPT_URL`)
- `apps-script/Code.gs` — backend Google Apps Script (di-paste ke editor Apps Script)
- `design-reference.png` — visual source of truth
- `ROO_CODE_INSTRUCTIONS.md` — instruksi implementasi untuk Roo Code
- `README.md` — ringkasan arsitektur dan setup

## Flow

```text
Intro (Lanjut) → Katalog ⇄ Detail Produk → Rekap Order → Generate Order
Generate Order → validasi stok → order tersimpan di tab Orders → WhatsApp terbuka dengan teks rekap
```

- Page 1: brand, hero, headline, 1 CTA `Lanjut`, floating WhatsApp. Tanpa USP, tanpa tanda panah.
- Page 2: search, 8 kategori, product cards, cart count, floating WhatsApp.
- Detail: foto, info produk, selector varian, status stok, `Tambah ke Keranjang`.
- Page 3: item + varian + qty, ringkasan biaya, `Generate Order`.

## Arsitektur

```text
Google Sheets (Products, Config, Orders)  +  Google Drive (foto)
                    ↓
        Apps Script Web App (JSON API)
                    ↓
              Frontend (search / filter / cart / hitung)
                    ↓
     tab Orders (log)  +  WhatsApp wa.me (teks prefilled)
```

Tidak ada credential Google di frontend. Frontend hanya memanggil URL Apps Script.

## Google Sheets

Satu baris di `Products` = satu SKU (varian). Varian boleh beda harga dan stok.

```text
sku_id | product_id | category | product_name | store_name | variant | original_price | final_price | stock | shipping_packaging_cost | description | material | weight | packaging | short_note | image_file_id | active
```

- `product_id` mengelompokkan varian dari produk yang sama.
- `category` dan `store_name` pakai dropdown agar ejaan seragam (fee dihitung per toko).
- Badge diskon dihitung otomatis dari `original_price` dan `final_price`.
- `image_file_id` opsional (override foto).

Tab `Config`: `wa_number`, `fee_per_store`, `extra_item_fee`, `free_item_qty`.
Tab `Orders`: diisi otomatis; ubah `status` jadi `Confirmed` untuk mengurangi stok (sekali saja).

## Google Drive

Upload foto ke folder `JASTIPINARAA/` (share: Anyone with the link – Viewer), dengan **nama file = `sku_id`** (mis. `S001.jpg`). Fallback: nama file = `product_id` untuk satu foto semua varian. Tidak perlu menyalin file ID.

## Stok

- `stock > 0` → bisa ditambahkan; `stock = 0` → `Habis`, tombol mati.
- Stok divalidasi ulang saat buka Rekap dan saat Generate Order (di frontend dan server).
- Stok tidak berkurang saat add-to-cart atau saat order dikirim, hanya saat status order `Confirmed`.

## Fee

```text
Fee Jastip = fee_per_store × jumlah toko + extra_item_fee × max(0, total qty − free_item_qty)
Ongkir & Kemasan = Σ (shipping_packaging_cost × qty)      ← asumsi per unit
Grand Total = Total Belanja + Fee Jastip + Ongkir & Kemasan
```

Nilai default: Rp15.000/toko, Rp3.000 per unit ke-4 dst. Semua bisa diubah di tab `Config`.

## Pesan WhatsApp

Selalu diawali `Hallo araa, ini rekap order aku yaa`, lalu Order ID, daftar item (dengan varian dan toko), rincian biaya, dan Grand Total. Jika pencatatan ke Sheet gagal, WhatsApp tetap terbuka.

## Setup (satu kali)

1. Buat Spreadsheet dengan tab `Products`, `Config`, `Orders` (atau jalankan `setupSheets_()` di `Code.gs`).
2. Paste `apps-script/Code.gs`, isi `DRIVE_FOLDER_ID`, lalu Deploy → Web app (Execute as: Me, Access: Anyone).
3. Isi `APPS_SCRIPT_URL` di `config.js`.
4. Isi tab `Config` (terutama `wa_number`, format `62812...`).
5. Isi `Products` dan upload foto ke Drive.

Setelah itu katalog tidak perlu diedit di `index.html`.

## Visual

`design-reference.png` adalah visual source of truth: clean Gen Z, white/off-white, rounded cards, whitespace lega, rounded typography, aksen pastel, icon konsisten, mobile-first. Tanpa emoji sebagai UI final. Jika PNG bertentangan dengan teks dokumen (USP, panah, label CTA, tab Profil), teks yang menang.
