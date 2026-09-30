// Main application logic for diJastipinaraa
// Mobile-first vanilla HTML/CSS/JS

// Global state
let state = {
  activeCategory: 'Semua',
  searchQuery: '',
  products: [],
  cart: {},
  config: null,
  loading: false,
  error: null,
  lastFetch: 0,
  scrollPositions: {},
  currentPage: 'intro',
  detailScrollPosition: 0,
  detailCategory: null,
  detailSearchQuery: null,
  detail: { productSkuId: '', selectedSkuId: '', quantity: 1 }
};

const imageRequests = new Map();

// DOM elements cache
const dom = {
  get: (selector) => document.querySelector(selector),
  all: (selector) => document.querySelectorAll(selector)
};

// Mock-catalogue image map. Only files that exist locally are listed here.
const LOCAL_CATALOG_IMAGES = Object.freeze({
  'Ayam Utuh Mbah Karto (2 sambal)': 'card-catalogue/Ayam Utuh Mbah Karto (2 sambal).png',
  'Bakso Alex': 'card-catalogue/Bakso Alex.png',
  'Kusuma Sari Kroket (isi 6)': 'card-catalogue/Kusuma Sari Kroket (isi 6).png',
  'Roti Abon Solo Floss Roll (isi 10)': 'card-catalogue/Roti Abon Solo Floss Roll (isi 10).png',
  'Sarung Katun Prisma H. Santoso': 'card-catalogue/Sarung Katun Prisma H. Santoso.png',
  'Gendongan Cap Anggur Hijau': 'card-catalogue/Gendongan Cap Anggur Hijau.png'
});

function getProductForSku(skuId) {
  return state.products.find(product => product.variants.some(variant => variant.sku_id === skuId));
}

function getProductById(productId) {
  return state.products.find(product => product.product_id === productId);
}

function getLocalImageUrl(product) {
  return LOCAL_CATALOG_IMAGES[product.product_name] || '';
}

function renderProductImage(product, variant = product.variants?.[0], className = '') {
  const localFallbackUrl = getLocalImageUrl(product);
  const skuId = variant?.sku_id || product.sku_id || '';
  const fallback = '<div class="placeholder placeholder-text">Gambar produk</div>';

  return `<img class="${className}" data-product-image data-sku-id="${skuId}" data-product-id="${product.product_id}" data-local-fallback="${localFallbackUrl}" alt="${product.product_name}" loading="lazy" hidden>${fallback}`;
}

function apiUrl(action, params = {}) {
  const url = new URL(config.APPS_SCRIPT_URL);
  url.searchParams.set('action', action);
  Object.entries(params).forEach(([key, value]) => {
    if (value) url.searchParams.set(key, value);
  });
  return url.toString();
}

async function fetchApi(action, params = {}) {
  const response = await fetch(apiUrl(action, params));
  if (!response.ok) throw new Error(`Permintaan katalog gagal (${response.status})`);
  const data = await response.json();
  if (!data.ok) throw new Error(data.error || 'Permintaan katalog gagal');
  return data;
}

function hydrateProductImages(container = document) {
  container.querySelectorAll('[data-product-image]').forEach(image => {
    const key = `${image.dataset.skuId}|${image.dataset.productId}`;
    if (!imageRequests.has(key)) {
      imageRequests.set(key, fetchApi('image', {
        sku_id: image.dataset.skuId,
        product_id: image.dataset.productId
      }).then(data => data.found ? (data.thumbnail_url || data.image_url || '') : '').catch(error => {
        console.warn('Product image unavailable:', error);
        return '';
      }));
    }

    imageRequests.get(key).then(url => {
      if (!image.isConnected) return;
      const localFallback = image.dataset.localFallback;
      if (!url && !localFallback) return;
      image.src = url || localFallback;
      image.hidden = false;
      image.onerror = () => {
        if (url && localFallback) {
          image.src = localFallback;
          image.dataset.localFallback = '';
        } else {
          image.hidden = true;
        }
      };
    });
  });
}

// Initialize the application
function init() {
  // Load config
  loadConfig();

  // Load products (with mock support)
  loadProducts();

  // Load cart from localStorage
  loadCart();

  // Setup event listeners
  setupEventListeners();

  // Initial render
  renderHeader();

  // Setup floating WhatsApp button
  setupFloatingWhatsApp();

  // Setup hash routing
  setupHashRouting();
}

// Load configuration
function loadConfig() {
  // Use the config object from config.js
  state.config = config;

}

// Load products from API or mock
async function loadProducts() {
  if (state.loading) return;

  state.loading = true;
  renderLoadingState();

  try {
    const data = await fetchApi('catalog');
      // Validate required fields
      const validProducts = (data.products || []).filter(p => {
        const hasRequired = p.sku_id && p.product_id && p.category && p.product_name && p.store_name && p.final_price !== undefined && p.stock !== undefined;
        if (!hasRequired) {
          console.warn('Product missing required fields:', p);
        }
        return hasRequired && p.active !== false && String(p.active).toLowerCase() !== 'false';
      }).map(p => ({
        ...p,
        original_price: Number(p.original_price) || 0,
        final_price: Number(p.final_price),
        stock: Math.max(0, Number(p.stock) || 0)
      }));

      // Group by product_id
      const grouped = groupBy(validProducts, 'product_id');

      // Convert to flat array for easier filtering
      const flatProducts = [];
      Object.values(grouped).forEach(productGroup => {
        const first = productGroup[0];
        // Keep every row in the parent product's SKU set, including rows
        // whose variant label is empty. The SKU remains the cart key.
        const variants = productGroup;
        const hasMultipleVariants = variants.length > 1 && variants.some(p => {
          const name = String(p.variant || '').trim().toLowerCase();
          return name && name !== 'no variant' && name !== 'standar';
        });

        // Determine price display
        let displayPrice = first.final_price;
        let originalPrice = first.original_price;
        let discountPercent = 0;

        if (originalPrice > first.final_price) {
          discountPercent = Math.round((originalPrice - first.final_price) / originalPrice * 100);
        }

        // Find cheapest available variant
        const availableVariants = productGroup.filter(p => p.stock > 0);
        if (availableVariants.length > 0) {
          const cheapest = availableVariants.reduce((min, p) => p.final_price < min.final_price ? p : min, availableVariants[0]);
          displayPrice = cheapest.final_price;
          originalPrice = cheapest.original_price;
          if (originalPrice > cheapest.final_price) {
            discountPercent = Math.round((originalPrice - cheapest.final_price) / originalPrice * 100);
          }
        } else {
          // All variants out of stock
          displayPrice = productGroup[0].final_price;
          originalPrice = productGroup[0].original_price;
          if (originalPrice > productGroup[0].final_price) {
            discountPercent = Math.round((originalPrice - productGroup[0].final_price) / originalPrice * 100);
          }
        }

        flatProducts.push({
          ...first,
          variants: productGroup,
          hasMultipleVariants,
          displayPrice,
          originalPrice,
          discountPercent,
          availableStock: availableVariants.reduce((sum, p) => sum + p.stock, 0),
          allOutOfStock: productGroup.every(p => p.stock === 0)
        });
      });

      state.products = flatProducts;
      state.config = { ...config, ...(data.config || {}) };

      // The cart is keyed by SKU, so only validate it after every product and
      // variant is available locally.
      validateCart();

      // Complete a direct detail URL once the local catalogue is available.
      const detailMatch = window.location.hash.match(/^#\/produk\/([^/]+)$/);
      if (state.currentPage === 'detail' && !state.detail.productSkuId && detailMatch) {
        showProductDetail(decodeURIComponent(detailMatch[1]));
      }

      // Render catalog
      renderCatalog();

      // Update floating WhatsApp number
      updateFloatingWhatsApp();
  } catch (error) {
    console.error('Error loading products:', error);
    state.error = error.message;
    renderErrorState();

    state.products = [];
  } finally {
    state.loading = false;
  }
}

// Group array by key
function groupBy(array, key) {
  return array.reduce((groups, item) => {
    const group = (item[key] || '').toString();
    groups[group] = groups[group] || [];
    groups[group].push(item);
    return groups;
  }, {});
}

// Load cart from localStorage
function loadCart() {
  const saved = localStorage.getItem('dijastipinaraa_cart');
  if (saved) {
    try {
      state.cart = JSON.parse(saved);
    } catch (e) {
      console.error('Error parsing cart:', e);
      state.cart = {};
    }
  }

}

// Validate cart items (remove invalid ones)
function validateCart() {
  // Catalogue data loads asynchronously. Keep the saved cart intact until
  // product variants are available to validate against.
  if (!state.products.length) return;

  const newCart = {};

  Object.entries(state.cart).forEach(([skuId, qty]) => {
    const product = getProductForSku(skuId);
    const variant = product?.variants.find(item => item.sku_id === skuId);
    const requestedQty = Math.floor(Number(qty));

    if (variant && requestedQty > 0) {
      if (variant.stock >= requestedQty) {
        newCart[skuId] = requestedQty;
      } else if (variant.stock > 0) {
        // Stock changed, so retain the selected SKU at its current maximum.
        newCart[skuId] = variant.stock;
      }
    }
  });

  state.cart = newCart;
  saveCart();
}

// Save cart to localStorage
function saveCart() {
  localStorage.setItem('dijastipinaraa_cart', JSON.stringify(state.cart));
}

// Setup event listeners
function setupEventListeners() {
  const homeLogo = dom.get('#homeLogo');
  if (homeLogo) {
    homeLogo.addEventListener('click', () => showPage('intro'));
    homeLogo.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        showPage('intro');
      }
    });
  }

  // Page navigation
  dom.all('.page button').forEach(btn => {
    btn.addEventListener('click', (e) => {
      if (e.target.closest('#btnLanjut')) return;

      const page = e.target.closest('.page');
      if (page) {
        const targetPage = page.getAttribute('data-page');
        if (targetPage) {
          showPage(targetPage);
        }
      }
    });
  });

  // Page 1 CTA: continue to the existing catalog route.
  const lanjutBtn = dom.get('#btnLanjut');
  if (lanjutBtn) {
    lanjutBtn.addEventListener('click', () => showPage('catalog'));
  }

  // Search input
  const searchInput = dom.get('#searchInput');
  if (searchInput) {
    let searchTimeout;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        state.searchQuery = e.target.value;
        renderCatalog();
      }, 300);
    });

    // Search clear button
    const searchClear = dom.get('#searchClear');
    if (searchClear) {
      searchClear.addEventListener('click', () => {
        searchInput.value = '';
        state.searchQuery = '';
        renderCatalog();
      });
    }
  }

  // Category navigation
  const categoryNav = dom.get('#categoryNav');
  if (categoryNav) {
    categoryNav.addEventListener('click', (e) => {
      const chip = e.target.closest('.category-chip');
      if (chip && chip.dataset.category) {
        const category = chip.dataset.category;

        // If clicking active category, reset to 'Semua'
        if (state.activeCategory === category) {
          state.activeCategory = 'Semua';
        } else {
          state.activeCategory = category;
        }

        // Update active state in UI
        dom.all('.category-chip').forEach(c => {
          c.classList.toggle('active', c.dataset.category === state.activeCategory);
          c.setAttribute('aria-selected', c.dataset.category === state.activeCategory ? 'true' : 'false');
        });

        renderCatalog();
      }
    });
  }

  // Retry button
  const retryBtn = dom.get('#btnRetry');
  if (retryBtn) {
    retryBtn.addEventListener('click', loadProducts);
  }

  // Reset search button
  const resetSearchBtn = dom.get('#btnResetSearch');
  if (resetSearchBtn) {
    resetSearchBtn.addEventListener('click', () => {
      state.searchQuery = '';
      if (dom.get('#searchInput')) dom.get('#searchInput').value = '';
      renderCatalog();
    });
  }

  // Cart actions
  const clearCartBtn = dom.get('#btnClearAll');
  if (clearCartBtn) {
    clearCartBtn.addEventListener('click', () => {
      if (confirm('Hapus semua item dari keranjang?')) {
        clearCart();
      }
    });
  }

  // Generate Order button
  const generateOrderBtn = dom.get('#btnGenerateOrder');
  if (generateOrderBtn) {
    generateOrderBtn.addEventListener('click', generateOrder);
  }

  const copyOrderBtn = dom.get('#btnCopyOrder');
  if (copyOrderBtn) copyOrderBtn.addEventListener('click', copyOrder);

  const goCatalogBtn = dom.get('#btnGoCatalog');
  if (goCatalogBtn) {
    goCatalogBtn.addEventListener('click', () => showPage('catalog'));
  }
  const goCatalogTopBtn = dom.get('#btnGoCatalogTop');
  if (goCatalogTopBtn) goCatalogTopBtn.addEventListener('click', () => showPage('catalog'));

  // Window resize for responsive behavior
  let resizeTimeout;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      renderCatalog();
    }, 250);
  });
}

// Show a page and update hash
function showPage(pageName) {
  // Save scroll position for current page
  if (state.currentPage) {
    const currentElement = dom.get(`#${state.currentPage === 'intro' ? 'pageIntro' : state.currentPage === 'catalog' ? 'pageCatalog' : state.currentPage === 'detail' ? 'pageDetail' : 'pageRecap'}`);
    if (currentElement) {
      state.scrollPositions[state.currentPage] = currentElement.scrollTop;
    }
  }

  // Hide all pages by adding hidden attribute
  dom.all('.page').forEach(p => {
    p.hidden = true;
    p.classList.remove('active');
  });

  // Show target page by removing hidden attribute
  let targetElement;
  switch (pageName) {
    case 'intro': targetElement = dom.get('#pageIntro'); break;
    case 'catalog': targetElement = dom.get('#pageCatalog'); break;
    case 'detail': targetElement = dom.get('#pageDetail'); break;
    case 'recap': targetElement = dom.get('#pageRecap'); break;
  }

  if (targetElement) {
    targetElement.hidden = false;
    targetElement.classList.add('active');
    state.currentPage = pageName;

    // Restore scroll position
    const savedScroll = state.scrollPositions[pageName];
    if (savedScroll !== undefined) {
      targetElement.scrollTop = savedScroll;
    } else {
      targetElement.scrollTo(0, 0);
    }

    // Update hash routing
    updateHash(pageName);

    // Update header
    renderHeader();
    updateFloatingWhatsApp();

    // Page-specific actions
    switch (pageName) {
      case 'catalog':
        renderCatalog();
        break;
      case 'detail':
        // Detail page is rendered on demand
        break;
      case 'recap':
        renderCart();
        break;
    }
  }
}

// Update browser hash
function updateHash(pageName) {
  let hash = '/';
  switch (pageName) {
    case 'intro': hash = '/'; break;
    case 'catalog': hash = '#/katalog'; break;
    case 'detail':
      hash = state.detail.productSkuId
        ? `#/produk/${encodeURIComponent(state.detail.productSkuId)}`
        : (window.location.hash.startsWith('#/produk/') ? window.location.hash : '#/produk');
      break;
    case 'recap': hash = '#/rekap'; break;
  }
  window.location.hash = hash;
}

// Setup hash routing on page load and hash change
function setupHashRouting() {
  // Check initial hash on page load
  function checkHash() {
    const hash = window.location.hash || '/';
    let pageName;

    if (hash === '' || hash === '/') {
      pageName = 'intro';
    } else if (hash === '#/katalog') {
      pageName = 'catalog';
    } else if (hash === '#/rekap') {
      pageName = 'recap';
    } else if (hash === '#/produk' || hash.startsWith('#/produk/')) {
      const skuId = hash.startsWith('#/produk/') ? decodeURIComponent(hash.slice('#/produk/'.length)) : '';
      if (skuId && skuId !== state.detail.productSkuId && getProductById(skuId)) {
        showProductDetail(skuId);
        return;
      }
      pageName = 'detail';
    } else {
      pageName = 'intro'; // Default to intro for unknown hashes
    }

    showPage(pageName);
  }

  // Initial check
  checkHash();

  // Listen for hash changes
  window.addEventListener('hashchange', checkHash);
}

// Render header
function renderHeader() {
  const headerActions = dom.get('#headerActions');
  if (!headerActions) return;

  const isIntro = state.currentPage === 'intro';

  if (isIntro) {
    headerActions.innerHTML = '';
  } else {
    const cartCount = Object.values(state.cart).reduce((a, b) => a + b, 0);
    headerActions.innerHTML = `
      <button class="icon-btn cart-icon-btn" onclick="showPage('recap')" aria-label="Buka keranjang">
        <svg class="cart-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M6.5 8.5h11l1 11h-13l1-11Z"></path>
          <path d="M9 8.5V7a3 3 0 0 1 6 0v1.5"></path>
        </svg>
        ${cartCount > 0 ? `<span class="cart-count">${cartCount}</span>` : ''}
      </button>`;
  }
}

// Render catalog
function renderCatalog() {
  const productGrid = dom.get('#productGrid');
  const sectionTitle = dom.get('#sectionTitle');
  const productCount = dom.get('#productCount');
  const emptyState = dom.get('#emptyState');

  if (!productGrid || !sectionTitle || !productCount) return;

  const errorState = dom.get('#errorState');
  const loadingState = dom.get('#loadingState');
  if (errorState) errorState.hidden = true;
  if (loadingState) loadingState.hidden = true;

  // Update section title
  sectionTitle.textContent = state.activeCategory === 'Semua' ? 'Semua Produk' : state.activeCategory;
  dom.all('.category-chip').forEach(chip => {
    const isActive = chip.dataset.category === state.activeCategory;
    chip.classList.toggle('active', isActive);
    chip.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });

  const searchClear = dom.get('#searchClear');
  if (searchClear) searchClear.hidden = !state.searchQuery.trim();

  // Filter products
  const filteredProducts = getFilteredProducts();

  // Update count
  productCount.textContent = filteredProducts.length + ' produk';

  // Show/hide empty state
  if (filteredProducts.length === 0) {
    emptyState.hidden = false;
    productGrid.innerHTML = '';
    return;
  } else {
    emptyState.hidden = true;
  }

  // Render products
  productGrid.innerHTML = filteredProducts.map(product => renderProductCard(product)).join('');
  hydrateProductImages(productGrid);
}

// Get filtered products based on search and category
function getFilteredProducts() {
  const query = state.searchQuery.trim().toLowerCase();
  return state.products.filter(product => {
    const matchesCategory = state.activeCategory === 'Semua' || product.category === state.activeCategory;
    const matchesSearch = !query ||
      product.product_name.toLowerCase().includes(query) ||
      product.store_name.toLowerCase().includes(query);

    return matchesCategory && matchesSearch;
  });
}

// Render product card
function renderProductCard(product) {
  const hasStock = product.availableStock > 0;
  const isOutOfStock = product.allOutOfStock;

  // Determine price display
  let priceHtml = '';
  if (product.hasMultipleVariants) {
    // Multiple variants - show "Mulai dari"
    priceHtml = `<div class="price price-from"><span class="from-label">Mulai dari</span><span class="new">${formatRupiah(product.displayPrice)}</span></div>`;
  } else {
    // Single variant
    if (product.discountPercent > 0) {
      priceHtml = `<div class="price"><span class="old">${formatRupiah(product.originalPrice)}</span><span class="new">${formatRupiah(product.displayPrice)}</span></div>`;
    } else {
      priceHtml = `<div class="price"><span class="new">${formatRupiah(product.displayPrice)}</span></div>`;
    }
  }

  // Add out of stock badge
  let badgeHtml = '';
  if (isOutOfStock) {
    badgeHtml = `<div class="badge">Habis</div>`;
  } else if (product.discountPercent > 0) {
    badgeHtml = `<div class="badge">Diskon ${product.discountPercent}%</div>`;
  }

  return `
    <article class="card" role="listitem" onclick="showProductDetail('${product.product_id}')">
      <div class="photo">
        ${badgeHtml}
        ${renderProductImage(product, product.variants.find(variant => variant.stock > 0) || product.variants[0])}
      </div>
      <div class="card-body">
        <div class="name" title="${product.product_name}">${product.product_name}</div>
        <div class="store">⌂ ${product.store_name}</div>
        <div class="small">${product.short_note || ''}</div>
        ${priceHtml}
        <button class="add" onclick="event.stopPropagation(); addToCart('${product.sku_id}')" ${!hasStock ? 'disabled' : ''} ${isOutOfStock ? 'disabled' : ''}>+</button>
      </div>
    </article>
  `;
}

// Show product detail
function showProductDetail(productId, selectedSkuId = '', preserveQuantity = false) {
  const product = getProductById(productId) || getProductForSku(productId);
  if (!product) return;

  // Save current state for back navigation
  state.detailScrollPosition = window.scrollY;
  state.detailCategory = state.activeCategory;
  state.detailSearchQuery = state.searchQuery;

  // Render detail content
  const detailContainer = dom.get('#detailContainer');
  if (!detailContainer) return;

  const variants = product.variants;
  // HANYA tampilkan pilihan varian jika ada lebih dari 1 varian DAN namanya bukan "No Variant" / kosong
  const hasMultipleVariants = variants.length > 1 && variants.some(v => {
    const name = String(v.variant || '').trim().toLowerCase();
    return name !== '' && name !== 'no variant' && name !== 'standar';
  });

  const selectedVariant = (preserveQuantity && variants.find(variant => variant.sku_id === selectedSkuId)) ||
    variants.find(variant => variant.stock > 0) || variants[0];
  const availableQty = getDetailAvailableQuantity(selectedVariant);
  const previousQuantity = preserveQuantity && state.detail.selectedSkuId === selectedVariant.sku_id
    ? state.detail.quantity
    : 1;
  const quantity = availableQty ? Math.min(Math.max(1, previousQuantity), availableQty) : 1;

  state.detail = {
    productSkuId: product.product_id,
    selectedSkuId: selectedVariant.sku_id,
    quantity
  };

  // Build variant selector
  let variantSelectorHtml = '';
  if (hasMultipleVariants) {
    variantSelectorHtml = `
      <div class="variant-selector">
        <label>Pilih Varian</label>
        <div class="variant-chips">
          ${variants.map(variant => {
            const isSelected = variant.sku_id === selectedVariant.sku_id;
            const isOutOfStock = variant.stock === 0;
            return `
              <button class="variant-chip ${isSelected ? 'selected' : ''} ${isOutOfStock ? 'disabled' : ''}"
                      onclick="selectVariant('${product.product_id}', '${variant.sku_id}')"
                      ${isOutOfStock ? 'disabled' : ''}>
                <span>${variant.variant || ''}</span>
                <span class="stock-label">${variant.stock > 0 ? `Sisa ${variant.stock}` : 'Habis'}</span>
              </button>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  // Build price display
  let priceHtml = '';
  if (selectedVariant.original_price > selectedVariant.final_price) {
    const discountPercent = Math.round((selectedVariant.original_price - selectedVariant.final_price) / selectedVariant.original_price * 100);
    priceHtml = `
      <div class="price">
        <span class="old">${formatRupiah(selectedVariant.original_price)}</span>
        <span class="new">${formatRupiah(selectedVariant.final_price)}</span>
      </div>
      <div class="badge">Diskon ${discountPercent}%</div>
    `;
  } else {
    priceHtml = `
      <div class="price">
        <span class="new">${formatRupiah(selectedVariant.final_price)}</span>
      </div>
    `;
  }

  detailContainer.innerHTML = `
    <button class="detail-back" onclick="goBackToCatalog()">← Kembali</button>
    <div class="detail-photo">
      ${renderProductImage(product, selectedVariant)}
    </div>
    <h1>${product.product_name}</h1>
    <div class="detail-category">${product.category}</div>
    <div class="store-lg">⌂ ${product.store_name}</div>
    ${priceHtml}
    <p class="desc">${product.description || ''}</p>
    <div class="facts">
      <div class="fact">
        <span>Bahan</span>
        <b>${product.material || ''}</b>
      </div>
      <div class="fact">
        <span>Berat</span>
        <b>${product.weight ? `${String(product.weight).trim().replace(/\s*g$/i, '')} g` : ''}</b>
      </div>
      <div class="fact">
        <span>Kemasan</span>
        <b>${product.packaging || ''}</b>
      </div>
    </div>
    ${variantSelectorHtml}
    <div class="stock-status" id="stockStatus">
      ${selectedVariant.stock > 0 ? '' : '<span class="stock-out">Habis</span>'}
    </div>
    <div class="detail-quantity" aria-label="Jumlah produk">
      <span>Jumlah</span>
      <div class="detail-quantity-controls">
        <button type="button" onclick="changeDetailQuantity(-1)" ${availableQty === 0 || quantity <= 1 ? 'disabled' : ''} aria-label="Kurangi jumlah">−</button>
        <input type="number" value="${quantity}" min="1" max="${availableQty}" inputmode="numeric" ${availableQty === 0 ? 'disabled' : ''} onchange="setDetailQuantity(this.value)" aria-label="Jumlah">
        <button type="button" onclick="changeDetailQuantity(1)" ${availableQty === 0 || quantity >= availableQty ? 'disabled' : ''} aria-label="Tambah jumlah">+</button>
      </div>
    </div>
    <button class="btn btn-primary btn-full"
            onclick="addDetailToCart()"
            id="addToCartBtn"
            ${availableQty === 0 ? 'disabled' : ''}>
      Tambah ke Keranjang
    </button>
  `;

  hydrateProductImages(detailContainer);

  showPage('detail');

  if (!preserveQuantity) refreshProductDetail(product.product_id, selectedVariant.sku_id);
}

async function refreshProductDetail(productId, selectedSkuId) {
  try {
    const data = await fetchApi('product', { product_id: productId });
    if (!data.found || !Array.isArray(data.skus) || !data.skus.length) return;
    const variants = data.skus.filter(row => row.active !== false && String(row.active).toLowerCase() !== 'false').map(row => ({
      ...row,
      original_price: Number(row.original_price) || 0,
      final_price: Number(row.final_price),
      stock: Math.max(0, Number(row.stock) || 0)
    }));
    if (!variants.length) return;
    const index = state.products.findIndex(product => product.product_id === productId);
    if (index === -1) return;
    const first = variants[0];
    const availableVariants = variants.filter(variant => variant.stock > 0);
    const displayVariant = availableVariants.reduce((lowest, variant) => !lowest || variant.final_price < lowest.final_price ? variant : lowest, null) || first;
    state.products[index] = {
      ...state.products[index], ...first, variants,
      displayPrice: displayVariant.final_price,
      originalPrice: displayVariant.original_price,
      availableStock: availableVariants.reduce((sum, variant) => sum + variant.stock, 0),
      allOutOfStock: variants.every(variant => variant.stock === 0)
    };
    if (state.currentPage === 'detail' && state.detail.productSkuId === productId) {
      showProductDetail(productId, selectedSkuId, true);
    }
  } catch (error) {
    console.warn('Unable to refresh product variants:', error);
  }
}

// Go back to catalog
function goBackToCatalog() {
  // Restore state
  if (state.detailCategory) state.activeCategory = state.detailCategory;
  if (state.detailSearchQuery) state.searchQuery = state.detailSearchQuery;

  // Restore scroll position
  if (state.detailScrollPosition) {
    window.scrollTo(0, state.detailScrollPosition);
  }

  showPage('catalog');
}

// Select variant in detail
function selectVariant(productId, variantSkuId) {
  const product = getProductById(productId);
  if (!product) return;

  const variant = product.variants.find(v => v.sku_id === variantSkuId);
  if (!variant) return;

  // Update detail view
  showProductDetail(productId, variantSkuId, true);
}

// Add to cart
function addToCart(skuId, addSelectedVariant = false, quantity = 1) {
  const product = getProductForSku(skuId);
  if (!product) return;

  const variant = product.variants.find(v => v.sku_id === skuId);
  if (!variant) return;

  // Check if product has multiple variants
  const hasMultipleVariants = product.variants.length > 1;

  if (hasMultipleVariants && !addSelectedVariant) {
    // Multiple variants - open detail to select
    showProductDetail(skuId);
  } else {
    const requestedQty = Math.max(1, Math.floor(Number(quantity) || 1));
    const currentQty = state.cart[skuId] || 0;
    if (variant.stock - currentQty >= requestedQty) {
      state.cart[skuId] = currentQty + requestedQty;
      saveCart();
      renderHeader();
      renderCart();
      return true;
    }
  }

  return false;
}

function getDetailAvailableQuantity(variant) {
  return Math.max(0, Number(variant.stock) - Number(state.cart[variant.sku_id] || 0));
}

function changeDetailQuantity(delta) {
  setDetailQuantity(state.detail.quantity + delta);
}

function setDetailQuantity(value) {
  const product = getProductById(state.detail.productSkuId);
  const variant = product?.variants.find(item => item.sku_id === state.detail.selectedSkuId);
  if (!product || !variant) return;

  const max = getDetailAvailableQuantity(variant);
  const requested = Math.floor(Number(value));
  state.detail.quantity = max ? Math.min(Math.max(1, Number.isFinite(requested) ? requested : 1), max) : 1;
  showProductDetail(product.product_id, variant.sku_id, true);
}

function addDetailToCart() {
  const { productSkuId, selectedSkuId, quantity } = state.detail;
  if (!productSkuId || !selectedSkuId) return;

  if (addToCart(selectedSkuId, true, quantity)) {
    showProductDetail(productSkuId, selectedSkuId, true);
  }
}

// Render cart (recap page)
function renderCart() {
  const cartList = dom.get('#cartList');
  const emptyCart = dom.get('#emptyCart');
  const summaryCard = dom.get('#summaryCard');
  const customerInputs = dom.get('#customerInputs');
  const generateOrderBtn = dom.get('#btnGenerateOrder');

  if (!cartList) return;

  const cartItems = Object.entries(state.cart);

  if (cartItems.length === 0) {
    cartList.innerHTML = '';
    emptyCart.hidden = false;
    summaryCard.hidden = true;
    customerInputs.hidden = true;
    generateOrderBtn.disabled = true;
    return;
  } else {
    emptyCart.hidden = true;
    summaryCard.hidden = false;
    customerInputs.hidden = false;
    generateOrderBtn.disabled = false;
  }

  // Render cart items
  cartList.innerHTML = cartItems.map(([skuId, qty]) => {
    const product = getProductForSku(skuId);
    if (!product) return '';

    const variant = product.variants.find(v => v.sku_id === skuId);
    if (!variant) return '';

    const price = variant.final_price;
    const total = price * qty;

    return `
      <div class="item" data-sku-id="${skuId}">
        <div class="thumb">
          ${renderProductImage(product, variant)}
        </div>
        <div class="item-main">
          <div class="name">${product.product_name}</div>
          <div class="store">⌂ ${product.store_name}</div>
          <div class="variant" id="variant-${skuId}">${variant.variant ? `(${variant.variant})` : ''}</div>
          <div class="item-unit-price">${formatRupiah(price)} / item</div>
        </div>
        <div class="item-price"><span>Subtotal</span><strong>${formatRupiah(total)}</strong></div>
        <div class="qty">
          <button onclick="changeQty('${skuId}', -1)">-</button>
          <span>${qty}</span>
          <button onclick="changeQty('${skuId}', 1)" ${variant.stock <= qty ? 'disabled' : ''}>+</button>
        </div>
        <button class="icon-btn" onclick="removeFromCart('${skuId}')" aria-label="Hapus item">🗑️</button>
      </div>
    `;
  }).join('');
  hydrateProductImages(cartList);

  // Render summary
  renderSummary();
}

// Change quantity in cart
function changeQty(skuId, delta) {
  const product = getProductForSku(skuId);
  if (!product) return;

  const variant = product.variants.find(v => v.sku_id === skuId);
  if (!variant) return;

  const currentQty = state.cart[skuId] || 0;
  const newQty = currentQty + delta;

  if (newQty <= 0) {
    removeFromCart(skuId);
  } else if (newQty <= variant.stock) {
    state.cart[skuId] = newQty;
    saveCart();
    renderCart();
    renderHeader();
  }
}

// Remove from cart
function removeFromCart(skuId) {
  delete state.cart[skuId];
  saveCart();
  renderCart();
  renderHeader();
}

// Clear cart
function clearCart() {
  state.cart = {};
  saveCart();
  renderCart();
  renderHeader();
}

// Render summary calculations
function renderSummary() {
  const summaryRows = dom.get('#summaryRows');
  const summaryTotal = dom.get('#summaryTotal');

  if (!summaryRows || !summaryTotal) return;

  const cartItems = Object.entries(state.cart);
  if (cartItems.length === 0) {
    summaryRows.innerHTML = '';
    summaryTotal.innerHTML = '';
    return;
  }

  const totals = calculateTotals();

  // Render summary rows
  summaryRows.innerHTML = `
    <div class="row">
      <span>Nominal pembelian<small>Harga sebelum diskon</small></span>
      <b>${formatRupiah(totals.nominalPembelian)}</b>
    </div>
    <div class="row">
      <span>Total Belanja<small>Harga setelah diskon</small></span>
      <b>${formatRupiah(totals.totalBelanja)}</b>
    </div>
    <div class="row">
      <span>Jumlah Toko</span>
      <b>${totals.jumlahToko}</b>
    </div>
    <div class="row">
      <span>Fee Jastip<small>Rp 15.000/toko<br>tambahan biaya Rp 3.000 mulai dari item ke-4</small></span>
      <b>${formatRupiah(totals.feeJastip)}</b>
    </div>
    <div class="row">
      <span>Ongkir & Kemasan<small>Biaya per item dari katalog</small></span>
      <b>${formatRupiah(totals.ongkirKemasan)}</b>
    </div>
  `;

  // Render total
  summaryTotal.innerHTML = `
    <span>Total</span>
    <span>${formatRupiah(totals.grandTotal)}</span>
  `;

  // Enable/disable generate button
  const generateOrderBtn = dom.get('#btnGenerateOrder');
  if (generateOrderBtn) {
    generateOrderBtn.disabled = cartItems.length === 0;
  }
  const copyOrderBtn = dom.get('#btnCopyOrder');
  if (copyOrderBtn) copyOrderBtn.disabled = cartItems.length === 0;
}

// Normalize store name (for counting unique stores)
function normalizeStore(storeName) {
  return storeName.toLowerCase().trim().replace(/\s+/g, ' ');
}

// Format currency
function formatRupiah(amount) {
  return 'Rp' + Number(amount).toLocaleString('id-ID');
}

function currentOrderMessage() {
  const cartItems = Object.entries(state.cart);
  const totals = calculateTotals();
  const items = cartItems.map(([skuId, qty]) => {
    const product = getProductForSku(skuId);
    const variant = product?.variants.find(v => v.sku_id === skuId);
    return {
      sku_id: skuId, qty,
      product_name: product?.product_name || '',
      store_name: product?.store_name || '',
      variant: variant?.variant || null,
      final_price: variant?.final_price || 0
    };
  });
  return buildWaMessage({
    orderId: generateOrderId(),
    customerName: dom.get('#customerName')?.value.trim() || '',
    address: dom.get('#customerAddress')?.value.trim() || '',
    note: dom.get('#customerNote')?.value.trim() || '',
    items, totalBelanja: totals.totalBelanja, jumlahToko: totals.jumlahToko,
    feeJastip: totals.feeJastip, ongkirKemasan: totals.ongkirKemasan,
    grandTotal: totals.grandTotal
  });
}

async function copyOrder() {
  const info = dom.get('#generateInfo');
  const name = dom.get('#customerName')?.value.trim();
  const address = dom.get('#customerAddress')?.value.trim();
  if (!name || !address || !Object.keys(state.cart).length) {
    if (info) { info.hidden = false; info.textContent = 'Isi Nama dan Alamat terlebih dahulu.'; }
    return;
  }
  await navigator.clipboard.writeText(currentOrderMessage());
  if (info) { info.hidden = false; info.textContent = 'Rekap order sudah disalin.'; }
}

function generateOrder() {
  const name = dom.get('#customerName')?.value.trim();
  const address = dom.get('#customerAddress')?.value.trim();
  const info = dom.get('#generateInfo');
  if (!name || !address) {
    if (info) { info.hidden = false; info.textContent = 'Isi Nama dan Alamat terlebih dahulu.'; }
    return;
  }
  window.open('https://wa.link/1lz4wo', '_blank', 'noopener,noreferrer');
}

// Validate stock
async function validateStock() {
  try {
    const response = await fetch(`${config.DEV_MOCK ? config.DEV_SERVER_URL : config.APPS_SCRIPT_URL}?action=stock`);
    const data = await response.json();

    if (data.ok) {
      // Check cart items against server stock
      const problems = [];
      Object.entries(state.cart).forEach(([skuId, qty]) => {
        const available = data.stock[skuId] || 0;
        if (available < qty) {
          problems.push({ sku_id: skuId, available });
        }
      });

      return { ok: problems.length === 0, problems };
    } else {
      return { ok: false, problems: [] };
    }
  } catch (error) {
    console.error('Error validating stock:', error);
    return { ok: false, problems: [] };
  }
}

// Calculate totals (frontend calculation)
function calculateTotals() {
  const cartItems = Object.entries(state.cart);
  let nominalPembelian = 0;
  let totalBelanja = 0;
  const storeSet = new Set();
  let extraQty = 0;
  let ongkirKemasan = 0;

  cartItems.forEach(([skuId, qty]) => {
    const product = getProductForSku(skuId);
    if (!product) return;

    const variant = product.variants.find(v => v.sku_id === skuId);
    if (!variant) return;

    nominalPembelian += variant.original_price * qty;
    totalBelanja += variant.final_price * qty;
    storeSet.add(normalizeStore(product.store_name));
    extraQty += Math.max(0, Number(qty) - 3);
    ongkirKemasan += variant.shipping_packaging_cost * qty;
  });

  const jumlahToko = storeSet.size;
  const feeJastip = jumlahToko * (state.config?.fee_per_store || 15000) +
    extraQty * (state.config?.extra_item_fee || 3000);

  return {
    nominalPembelian,
    totalBelanja,
    jumlahToko,
    feeJastip,
    ongkirKemasan,
    grandTotal: totalBelanja + feeJastip + ongkirKemasan
  };
}

// Generate order ID
function generateOrderId() {
  const date = new Date();
  const year = date.getFullYear().toString().slice(-2);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let orderId = 'JP-' + year + month + day + '-';

  for (let i = 0; i < 4; i++) {
    orderId += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return orderId;
}

// Build WhatsApp message
function buildWaMessage(order) {
  const rp = n => 'Rp' + Number(n).toLocaleString('id-ID');
  const lines = [
    'Hallo araa, ini rekap order aku yaa',
    '',
    '*REKAP ORDER JASTIP*',
    `Order ID: ${order.orderId}`
  ];

  if (order.customerName) lines.push(`Nama: ${order.customerName}`);
  if (order.address) lines.push(`Alamat: ${order.address}`);
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

  const message = lines.join('\n');

  // Truncate if too long
  if (message.length > 1500) {
    const truncatedLines = [
      'Hallo araa, ini rekap order aku yaa',
      '',
      '*REKAP ORDER JASTIP*',
      `Order ID: ${order.orderId}`
    ];

    if (order.customerName) truncatedLines.push(`Nama: ${order.customerName}`);
    if (order.address) truncatedLines.push(`Alamat: ${order.address}`);
    truncatedLines.push('');

    order.items.forEach((it, i) => {
      const v = it.variant ? ` (${it.variant})` : '';
      truncatedLines.push(`${i + 1}. ${it.product_name}${v} x ${it.qty}`);
    });

    truncatedLines.push(
      '',
      `Total: ${rp(order.grandTotal)}`
    );

    if (order.note) truncatedLines.push('', `Catatan: ${order.note}`);
    truncatedLines.push('', 'Mohon dicek & dikonfirmasi yaa. Terima kasih!');

    return truncatedLines.join('\n');
  }

  return message;
}

// Open WhatsApp with message
function openWhatsApp(message) {
  const url = 'https://wa.link/1lz4wo';

  // Try to open WhatsApp
  window.location.href = url;

  // Fallback button after delay
  setTimeout(() => {
    const fabWa = dom.get('#fabWa');
    if (fabWa) {
      fabWa.style.display = 'flex';
      fabWa.onclick = () => {
        window.location.href = url;
      };
    }
  }, 1000);
}

// Setup floating WhatsApp button
function setupFloatingWhatsApp() {
  const fabWa = dom.get('#fabWa');
  if (!fabWa) return;

  // Page 1 inquiry CTA. Production/order messaging is intentionally separate.
  fabWa.addEventListener('click', () => {
    window.open('https://wa.link/arpqd8', '_blank', 'noopener,noreferrer');
  });

  // Update number in button
  updateFloatingWhatsApp();

  // Hide if on recap page
  if (state.currentPage === 'recap') {
    fabWa.style.display = 'none';
  }
}

// Update floating WhatsApp button number
function updateFloatingWhatsApp() {
  const fabWa = dom.get('#fabWa');
  if (!fabWa) return;

  const waNumber = state.config?.wa_number || config.WA_NUMBER_FALLBACK || '6281234567890';

  // Show button with appropriate message
  if (state.currentPage === 'intro' || state.currentPage === 'catalog') {
    fabWa.style.display = 'flex';
    fabWa.title = 'Ask Araa';
  } else {
    fabWa.style.display = 'none';
  }
}

// Render loading state
function renderLoadingState() {
  const skeletonGrid = dom.get('#skeletonGrid');
  const loadingState = dom.get('#loadingState');
  const errorState = dom.get('#errorState');
  const emptyState = dom.get('#emptyState');
  const productGrid = dom.get('#productGrid');
  if (!skeletonGrid) return;

  if (loadingState) loadingState.hidden = false;
  if (errorState) errorState.hidden = true;
  if (emptyState) emptyState.hidden = true;
  if (productGrid) productGrid.innerHTML = '';
  skeletonGrid.innerHTML = Array(6).fill(0).map(() => `
    <div class="skeleton-item"></div>
  `).join('');
}

// Render error state
function renderErrorState() {
  const errorState = dom.get('#errorState');
  const loadingState = dom.get('#loadingState');
  const productGrid = dom.get('#productGrid');
  if (!errorState) return;

  if (loadingState) loadingState.hidden = true;
  if (productGrid) productGrid.innerHTML = '';
  errorState.hidden = false;
  errorState.scrollIntoView({ behavior: 'smooth' });
}

// Expose functions to global scope for inline event handlers
window.showProductDetail = showProductDetail;
window.goBackToCatalog = goBackToCatalog;
window.selectVariant = selectVariant;
window.addToCart = addToCart;
window.changeQty = changeQty;
window.removeFromCart = removeFromCart;
window.clearCart = clearCart;
window.generateOrder = generateOrder;
window.changeDetailQuantity = changeDetailQuantity;
window.setDetailQuantity = setDetailQuantity;
window.addDetailToCart = addDetailToCart;

// Start the application
document.addEventListener('DOMContentLoaded', init);
