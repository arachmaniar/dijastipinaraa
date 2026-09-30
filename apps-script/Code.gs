/**
 * JASTIPINARAA — Google Apps Script Backend
 *
 * Google Sheet:
 *   ID   : 1s4OhHxgHpX0pCMJARUpzBAEwkp67OMe39_NlhP9Bu90
 *   Tab  : Products
 *
 * Google Drive:
 *   Folder ID: 1-9N4UeFHcISI17fLrRj42Xsa9-kD4U1v
 *
 * Deployment:
 *   Deploy > New deployment > Web app
 *   Execute as: Me
 *   Who has access: Anyone
 *
 * Frontend should send POST body as text/plain containing JSON.
 * This avoids the common application/json CORS preflight issue with
 * Apps Script Web Apps.
 *
 * Supported actions:
 *   catalog
 *   product
 *   image
 *   health
 *
 * Example POST:
 *   {"action":"catalog"}
 *   {"action":"product","product_id":"PROD-001"}
 *   {"action":"image","sku_id":"SKU-001","product_id":"PROD-001"}
 */

const CONFIG = {
  SPREADSHEET_ID: '1s4OhHxgHpX0pCMJARUpzBAEwkp67OMe39_NlhP9Bu90',
  PRODUCTS_SHEET_NAME: 'Products',
  DRIVE_FOLDER_ID: '1-9N4UeFHcISI17fLrRj42Xsa9-kD4U1v',

  // Expected image extensions.
  IMAGE_EXTENSIONS: ['jpg', 'jpeg', 'png', 'webp', 'gif'],

  // Only active Products rows are returned by catalog/product.
  ACTIVE_ONLY: true,
};


/* =========================================================
 * WEB APP ENTRY POINTS
 * ======================================================= */

function doGet(e) {
  const params = (e && e.parameter) || {};
  const action = params.action || 'health';

  try {
    let result;

    switch (action) {
      case 'health':
        result = health_();
        break;

      case 'catalog':
        result = getCatalog_();
        break;

      case 'product':
        result = getProduct_(params.product_id || '');
        break;

      case 'image':
        result = getImage_({
          sku_id: params.sku_id || '',
          product_id: params.product_id || '',
        });
        break;

      default:
        throw new Error('Unknown action: ' + action);
    }

    return jsonOutput_(result);
  } catch (error) {
    return jsonOutput_(errorResponse_(error));
  }
}


function doPost(e) {
  try {
    const body = parseRequestBody_(e);
    const action = body.action || '';

    let result;

    switch (action) {
      case 'health':
        result = health_();
        break;

      case 'catalog':
        result = getCatalog_();
        break;

      case 'product':
        result = getProduct_(body.product_id || '');
        break;

      case 'image':
        result = getImage_(body);
        break;

      default:
        throw new Error('Unknown or missing action: ' + action);
    }

    return jsonOutput_(result);
  } catch (error) {
    return jsonOutput_(errorResponse_(error));
  }
}


/* =========================================================
 * API ACTIONS
 * ======================================================= */

function health_() {
  const sheet = getProductsSheet_();

  return {
    ok: true,
    service: 'jastipinaraa-gas',
    sheet: CONFIG.PRODUCTS_SHEET_NAME,
    sheetLastRow: sheet.getLastRow(),
    timestamp: new Date().toISOString(),
  };
}


/**
 * Return active product/SKU rows from Products.
 *
 * IMPORTANT:
 * We preserve one object per SKU row.
 * The frontend can group by product_id for Product Detail variants.
 */
function getCatalog_() {
  const rows = readProducts_();

  const products = CONFIG.ACTIVE_ONLY
    ? rows.filter(row => isActive_(row.active))
    : rows;

  return {
    ok: true,
    action: 'catalog',
    count: products.length,
    products: products,
  };
}


/**
 * Return all active SKU rows sharing the requested product_id.
 *
 * This is the source used by Product Detail to build:
 *   Pilih Varian
 *
 * No variant names are hard-coded here.
 */
function getProduct_(productId) {
  const id = String(productId || '').trim();

  if (!id) {
    throw new Error('product_id is required');
  }

  const rows = readProducts_();

  let matches = rows.filter(row =>
    String(row.product_id || '').trim() === id
  );

  if (CONFIG.ACTIVE_ONLY) {
    matches = matches.filter(row => isActive_(row.active));
  }

  if (!matches.length) {
    return {
      ok: true,
      action: 'product',
      product_id: id,
      found: false,
      skus: [],
    };
  }

  return {
    ok: true,
    action: 'product',
    product_id: id,
    found: true,
    sku_count: matches.length,
    skus: matches,
  };
}


/**
 * Image lookup:
 *
 * 1. Try exact SKU ID first.
 * 2. If not found, try product ID.
 *
 * This matches the user's Drive naming convention.
 *
 * IMPORTANT:
 * The script does NOT change Drive sharing permissions.
 */
function getImage_(request) {
  const skuId = String(request.sku_id || '').trim();
  const productId = String(request.product_id || '').trim();

  if (!skuId && !productId) {
    throw new Error('sku_id or product_id is required');
  }

  const folder = DriveApp.getFolderById(CONFIG.DRIVE_FOLDER_ID);

  let file = null;
  let matchedBy = null;

  if (skuId) {
    file = findImageByBaseName_(folder, skuId);
    if (file) matchedBy = 'sku_id';
  }

  if (!file && productId) {
    file = findImageByBaseName_(folder, productId);
    if (file) matchedBy = 'product_id';
  }

  if (!file) {
    return {
      ok: true,
      action: 'image',
      found: false,
      sku_id: skuId,
      product_id: productId,
    };
  }

  return {
    ok: true,
    action: 'image',
    found: true,
    matched_by: matchedBy,
    file_id: file.getId(),
    file_name: file.getName(),
    mime_type: file.getMimeType(),

    // Useful metadata for the frontend.
    // This is NOT guaranteed to be directly embeddable if the file
    // remains private in Drive.
    drive_url: file.getUrl(),

    // Google Drive thumbnail endpoint. It requires appropriate
    // file accessibility when used directly by a browser.
    thumbnail_url:
      'https://drive.google.com/thumbnail?id=' +
      encodeURIComponent(file.getId()) +
      '&sz=w1000',
  };
}


/* =========================================================
 * GOOGLE SHEETS
 * ======================================================= */

function getProductsSheet_() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.PRODUCTS_SHEET_NAME);

  if (!sheet) {
    throw new Error(
      'Sheet tab "' + CONFIG.PRODUCTS_SHEET_NAME + '" was not found.'
    );
  }

  return sheet;
}


function readProducts_() {
  const sheet = getProductsSheet_();
  const values = sheet.getDataRange().getValues();

  if (!values.length) return [];

  const headers = values[0].map(header =>
    String(header).trim()
  );

  validateProductHeaders_(headers);

  return values
    .slice(1)
    .filter(row => row.some(cell => cell !== ''))
    .map(row => {
      const obj = {};

      headers.forEach((header, index) => {
        obj[header] = normalizeCell_(row[index]);
      });

      return obj;
    });
}


function validateProductHeaders_(headers) {
  const required = [
    'sku_id',
    'product_id',
    'category',
    'product_name',
    'store_name',
    'variant',
    'original_price',
    'final_price',
    'stock',
    'shipping_packaging_cost',
    'description',
    'material',
    'weight',
    'packaging',
    'short_note',
    'image_file_id',
    'active',
  ];

  const missing = required.filter(header =>
    headers.indexOf(header) === -1
  );

  if (missing.length) {
    throw new Error(
      'Products sheet is missing required columns: ' +
      missing.join(', ')
    );
  }
}


/* =========================================================
 * GOOGLE DRIVE IMAGE SEARCH
 * ======================================================= */

/**
 * Searches the supplied folder recursively.
 *
 * Filename matching:
 *   SKU-001.png  -> base name SKU-001
 *   SKU-001.jpg  -> base name SKU-001
 *
 * Also tolerates filenames where Drive has an extension.
 */
function findImageByBaseName_(rootFolder, targetId) {
  const target = normalizeId_(targetId);

  if (!target) return null;

  return findImageRecursive_(rootFolder, target);
}


function findImageRecursive_(folder, target) {
  const files = folder.getFiles();

  while (files.hasNext()) {
    const file = files.next();

    if (!isImageFile_(file)) continue;

    const baseName = getBaseName_(file.getName());

    if (normalizeId_(baseName) === target) {
      return file;
    }
  }

  const folders = folder.getFolders();

  while (folders.hasNext()) {
    const subfolder = folders.next();
    const result = findImageRecursive_(subfolder, target);

    if (result) return result;
  }

  return null;
}


function isImageFile_(file) {
  const mime = String(file.getMimeType() || '').toLowerCase();

  if (mime.indexOf('image/') === 0) {
    return true;
  }

  const extension = getExtension_(file.getName());

  return CONFIG.IMAGE_EXTENSIONS.indexOf(extension) !== -1;
}


function getBaseName_(fileName) {
  const name = String(fileName || '').trim();
  const lastDot = name.lastIndexOf('.');

  if (lastDot <= 0) return name;

  return name.substring(0, lastDot);
}


function getExtension_(fileName) {
  const name = String(fileName || '').toLowerCase();
  const lastDot = name.lastIndexOf('.');

  if (lastDot === -1) return '';

  return name.substring(lastDot + 1);
}


/* =========================================================
 * HELPERS
 * ======================================================= */

function parseRequestBody_(e) {
  if (!e || !e.postData || !e.postData.contents) {
    return {};
  }

  const raw = String(e.postData.contents).trim();

  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error('Request body must contain valid JSON.');
  }
}


function normalizeCell_(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return value;
}


function normalizeId_(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}


function isActive_(value) {
  if (value === true) return true;

  const normalized = String(value || '')
    .trim()
    .toLowerCase();

  return [
    'true',
    '1',
    'yes',
    'y',
    'active',
    'aktif',
  ].indexOf(normalized) !== -1;
}


function jsonOutput_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}


function errorResponse_(error) {
  return {
    ok: false,
    error: error && error.message
      ? error.message
      : String(error),
  };
}
