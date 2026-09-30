// Main application logic for diJastipinaraa
// Mobile-first vanilla HTML/CSS/JS

// ============================================================
// GLOBAL STATE
// ============================================================

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
  detail: {
    productSkuId: '',
    selectedSkuId: '',
    quantity: 1
  }
};

const imageRequests = new Map();

// ============================================================
// DOM HELPERS
// ============================================================

const dom = {
  get: (selector) => document.querySelector(selector),
  all: (selector) => document.querySelectorAll(selector)
};

// ============================================================
// LOCAL PRODUCT IMAGES
// ============================================================

const LOCAL_CATALOG_IMAGES = Object.freeze({
  'Ayam Utuh Mbah Karto (2 sambal)': 'card-catalogue/Ayam Utuh Mbah Karto (2 sambal).png',
  'Bakso Alex': 'card-catalogue/Bakso Alex.png',
  'Kusuma Sari Kroket (isi 6)': 'card-catalogue/Kusuma Sari Kroket (isi 6).png',
  'Roti Abon Solo Floss Roll (isi 10)': 'card-catalogue/Roti Abon Solo Floss Roll (isi 10).png',
  'Sarung Katun Prisma H. Santoso': 'card-catalogue/Sarung Katun Prisma H. Santoso.png',
  'Gendongan Cap Anggur Hijau': 'card-catalogue/Gendongan Cap Anggur Hijau.png'
});

// ============================================================
// PRODUCT HELPERS
// ============================================================

function getProductForSku(skuId) {
  return state.products.find(product =>
    product.variants?.some(variant => variant.sku_id === skuId)
  );
}

function getProductById(productId) {
  return state.products.find(product => product.product_id === productId);
}

function getLocalImageUrl(product) {
  return LOCAL_CATALOG_IMAGES[product?.product_name] || '';
}

// ============================================================
// HTML ESCAPE
// ============================================================

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ============================================================
// GOOGLE DRIVE IMAGE URL
// ============================================================

function parseDriveUrl(input) {
  if (!input) return '';

  const str = String(input).trim();

  // Google Drive URL:
  // https://drive.google.com/file/d/FILE_ID/view
  // https://drive.google.com/open?id=FILE_ID
  // or plain File ID
  const match =
    str.match(/\/d\/([a-zA-Z0-9_-]+)/) ||
    str.match(/[?&]id=([a-zA-Z0-9_-]+)/);

  const fileId = match ? match[1] : str;

  if (
    fileId &&
    !fileId.includes('/') &&
    !fileId.includes('http')
  ) {
    return `https://lh3.googleusercontent.com/d/${fileId}`;
  }

  return str;
}

// ============================================================
// RENDER PRODUCT IMAGE
// ============================================================

function renderProductImage(
  product,
  variant = product.variants?.[0],
  className = ''
) {
  const localFallback = getLocalImageUrl(product);

  const rawInput =
    product.image_file_id ||
    product.image_url ||
    variant?.image_file_id ||
    variant?.image_url ||
    '';

  const driveUrl = parseDriveUrl(rawInput);
  const finalSrc = driveUrl || localFallback;

  if (finalSrc) {
    return `
      <img
        src="${escapeHtml(finalSrc)}"
        alt="${escapeHtml(product.product_name || 'Gambar produk')}"
        class="${escapeHtml(className)}"
        loading="lazy"
        onerror="this.style.display='none';"
      >
    `;
  }

  return `
    <div class="${escapeHtml(className)}">
      Gambar produk
    </div>
  `;
}

// ============================================================
// API
// ============================================================

function apiUrl(action, params = {}) {
  const url = new URL(config.APPS_SCRIPT_URL);

  url.searchParams.set('action', action);

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, value);
    }
  });

  return url.toString();
}

async function fetchApi(action, params = {}) {
  const response = await fetch(apiUrl(action, params));

  if (!response.ok) {
    throw new Error(`Permintaan katalog gagal (${response.status})`);
  }

  const data = await response.json();

  if (!data.ok) {
    throw new Error(data.error || 'Permintaan katalog gagal');
  }

  return data;
}

// ============================================================
// IMAGE HYDRATION
// ============================================================

function hydrateProductImages(container = document) {
  // Images are rendered directly by renderProductImage().
  // Function kept for compatibility with existing code.
}

// ============================================================
// INITIALIZE
// ============================================================

function init() {
  loadConfig();
  loadProducts();
  loadCart();
  setupEventListeners();
  renderHeader();
  setupFloatingWhatsApp();
  setupHashRouting();
}

// ============================================================
// CONFIG
// ============================================================

function loadConfig() {
  state.config = config;
}

// ============================================================
// LOAD PRODUCTS
// ============================================================

async function loadProducts() {
  if (state.loading) return;

  state.loading = true;
  renderLoadingState();

  try {
    const data = await fetchApi('catalog');

    // --------------------------------------------------------
    // VALIDATE + NORMALIZE DATA FROM GOOGLE SHEET
    // --------------------------------------------------------

    const validProducts = (data.products || [])
      .filter(p => {
        const hasRequired =
          p.sku_id &&
          p.product_id &&
          p.category &&
          p.product_name &&
          p.store_name &&
          p.final_price !== undefined &&
          p.stock !== undefined;

        if (!hasRequired) {
          console.warn('Product missing required fields:', p);
        }

        return (
          hasRequired &&
          p.active !== false &&
          String(p.active).toLowerCase() !== 'false'
        );
      })
      .map(p => ({
        ...p,

        // Normalize important fields
        sku_id: String(p.sku_id).trim(),
        product_id: String(p.product_id).trim(),
        category: String(p.category || '').trim(),
        product_name: String(p.product_name || '').trim(),
        store_name: String(p.store_name || '').trim(),

        // ====================================================
        // IMPORTANT:
        // sale_label DIRECTLY FROM GOOGLE SHEET
        // ====================================================
        sale_label: String(p.sale_label ?? '').trim(),

        original_price: Number(p.original_price) || 0,
        final_price: Number(p.final_price) || 0,
        stock: Math.max(0, Number(p.stock) || 0)
      }));

    // --------------------------------------------------------
    // GROUP BY PRODUCT ID
    // --------------------------------------------------------

    const grouped = groupBy(validProducts, 'product_id');

    const flatProducts = [];

    Object.values(grouped).forEach(productGroup => {
      const first = productGroup[0];

      const variants = productGroup;

      // ------------------------------------------------------
      // MULTIPLE VARIANT CHECK
      // ------------------------------------------------------

      const hasMultipleVariants =
        variants.length > 1 &&
        variants.some(p => {
          const name = String(p.variant || '').trim().toLowerCase();

          return (
            name &&
            name !== 'no variant' &&
            name !== 'standar'
          );
        });

      // ------------------------------------------------------
      // PRICE DISPLAY
      // ------------------------------------------------------

      let displayPrice = first.final_price;
      let originalPrice = first.original_price;
      let discountPercent = 0;

      if (originalPrice > first.final_price) {
        discountPercent = Math.round(
          ((originalPrice - first.final_price) / originalPrice) * 100
        );
      }

      // ------------------------------------------------------
      // FIND CHEAPEST AVAILABLE VARIANT
      // ------------------------------------------------------

      const availableVariants = productGroup.filter(
        p => p.stock > 0
      );

      if (availableVariants.length > 0) {
        const cheapest = availableVariants.reduce(
          (min, p) =>
            p.final_price < min.final_price ? p : min,
          availableVariants[0]
        );

        displayPrice = cheapest.final_price;
        originalPrice = cheapest.original_price;

        if (originalPrice > cheapest.final_price) {
          discountPercent = Math.round(
            ((originalPrice - cheapest.final_price) / originalPrice) * 100
          );
        }
      } else {
        // All variants out of stock
        displayPrice = productGroup[0].final_price;
        originalPrice = productGroup[0].original_price;

        if (originalPrice > productGroup[0].final_price) {
          discountPercent = Math.round(
            ((originalPrice - productGroup[0].final_price) /
              originalPrice) *
              100
          );
        }
      }

      // ------------------------------------------------------
      // SALE LABEL
      // ------------------------------------------------------
      //
      // If any SKU/row has sale_label, use that label.
      // This prevents the label from disappearing just because
      // the first row of a product has an empty sale_label.
      //
      // Example:
      //
      // SKU001 -> sale_label = "Best Seller"
      // SKU002 -> sale_label = ""
      //
      // Product card will still show "Best Seller".
      // ------------------------------------------------------

      const saleLabelRow = productGroup.find(
        row => String(row.sale_label ?? '').trim() !== ''
      );

      const saleLabel = saleLabelRow
        ? String(saleLabelRow.sale_label).trim()
        : '';

      // ------------------------------------------------------
      // FINAL PRODUCT OBJECT
      // ------------------------------------------------------

      flatProducts.push({
        ...first,

        variants,

        // IMPORTANT
        sale_label: saleLabel,

        hasMultipleVariants,
        displayPrice,
        originalPrice,
        discountPercent,

        availableStock: availableVariants.reduce(
          (sum, p) => sum + p.stock,
          0
        ),

        allOutOfStock: productGroup.every(
          p => p.stock === 0
        )
      });
    });

    state.products = flatProducts;

    state.config = {
      ...config,
      ...(data.config || {})
    };

    // --------------------------------------------------------
    // DEBUG SALE LABEL
    // --------------------------------------------------------
    //
    // Bisa dihapus nanti.
    // Untuk sementara membantu memastikan data dari Sheet
    // benar-benar masuk ke frontend.
    // --------------------------------------------------------

    console.log(
      'Catalog loaded:',
      state.products.map(p => ({
        product_id: p.product_id,
        product_name: p.product_name,
        sale_label: p.sale_label
      }))
    );

    // --------------------------------------------------------
    // VALIDATE CART
    // --------------------------------------------------------

    validateCart();

    // --------------------------------------------------------
    // DIRECT DETAIL URL
    // --------------------------------------------------------

    const detailMatch =
      window.location.hash.match(/^#\/produk\/([^/]+)$/);

    if (
      state.currentPage === 'detail' &&
      !state.detail.productSkuId &&
      detailMatch
    ) {
      showProductDetail(
        decodeURIComponent(detailMatch[1])
      );
    }

    // --------------------------------------------------------
    // RENDER
    // --------------------------------------------------------

    renderCatalog();
    renderHeader();
    updateFloatingWhatsApp();

  } catch (error) {
    console.error('Error loading products:', error);

    state.error = error.message;
    state.products = [];

    renderErrorState();

  } finally {
    state.loading = false;
  }
}

// ============================================================
// GROUP BY
// ============================================================

function groupBy(array, key) {
  return array.reduce((groups, item) => {
    const group = String(item[key] || '');

    groups[group] = groups[group] || [];
    groups[group].push(item);

    return groups;
  }, {});
}

// ============================================================
// CART STORAGE
// ============================================================

function loadCart() {
  const saved = localStorage.getItem(
    'dijastipinaraa_cart'
  );

  if (saved) {
    try {
      state.cart = JSON.parse(saved);
    } catch (error) {
      console.error(
        'Error parsing cart:',
        error
      );

      state.cart = {};
    }
  }
}

function saveCart() {
  localStorage.setItem(
    'dijastipinaraa_cart',
    JSON.stringify(state.cart)
  );
}

// ============================================================
// VALIDATE CART
// ============================================================

function validateCart() {
  if (!state.products.length) return;

  const newCart = {};

  Object.entries(state.cart).forEach(
    ([skuId, qty]) => {
      const product = getProductForSku(skuId);

      const variant = product?.variants.find(
        item => item.sku_id === skuId
      );

      const requestedQty = Math.floor(
        Number(qty)
      );

      if (variant && requestedQty > 0) {
        if (variant.stock >= requestedQty) {
          newCart[skuId] = requestedQty;
        } else if (variant.stock > 0) {
          newCart[skuId] = variant.stock;
        }
      }
    }
  );

  state.cart = newCart;

  saveCart();
}

// ============================================================
// EVENT LISTENERS
// ============================================================

function setupEventListeners() {
  // ----------------------------------------------------------
  // HOME LOGO
  // ----------------------------------------------------------

  const homeLogo = dom.get('#homeLogo');

  if (homeLogo) {
    homeLogo.addEventListener(
      'click',
      () => showPage('intro')
    );

    homeLogo.addEventListener(
      'keydown',
      event => {
        if (
          event.key === 'Enter' ||
          event.key === ' '
        ) {
          event.preventDefault();
          showPage('intro');
        }
      }
    );
  }

  // ----------------------------------------------------------
  // PAGE BUTTONS
  // ----------------------------------------------------------

  dom.all('.page button').forEach(btn => {
    btn.addEventListener('click', event => {
      if (
        event.target.closest('#btnLanjut') ||
        event.target.closest('#cartButton')
      ) {
        return;
      }

      const page =
        event.target.closest('.page');

      if (page) {
        const targetPage =
          page.getAttribute('data-page');

        if (targetPage) {
          showPage(targetPage);
        }
      }
    });
  });

  // ----------------------------------------------------------
  // LANJUT
  // ----------------------------------------------------------

  const lanjutBtn = dom.get('#btnLanjut');

  if (lanjutBtn) {
    lanjutBtn.addEventListener(
      'click',
      () => showPage('catalog')
    );
  }

  // ----------------------------------------------------------
  // SEARCH
  // ----------------------------------------------------------

  const searchInput =
    dom.get('#searchInput');

  if (searchInput) {
    let searchTimeout;

    searchInput.addEventListener(
      'input',
      event => {
        clearTimeout(searchTimeout);

        searchTimeout = setTimeout(() => {
          state.searchQuery =
            event.target.value;

          renderCatalog();
        }, 300);
      }
    );

    const searchClear =
      dom.get('#searchClear');

    if (searchClear) {
      searchClear.addEventListener(
        'click',
        () => {
          searchInput.value = '';
          state.searchQuery = '';
          renderCatalog();
        }
      );
    }
  }

  // ----------------------------------------------------------
  // CATEGORY
  // ----------------------------------------------------------

  const categoryNav =
    dom.get('#categoryNav');

  if (categoryNav) {
    categoryNav.addEventListener(
      'click',
      event => {
        const chip =
          event.target.closest(
            '.category-chip'
          );

        if (
          chip &&
          chip.dataset.category
        ) {
          const category =
            chip.dataset.category;

          if (
            state.activeCategory ===
            category
          ) {
            state.activeCategory = 'Semua';
          } else {
            state.activeCategory =
              category;
          }

          dom.all(
            '.category-chip'
          ).forEach(c => {
            const isActive =
              c.dataset.category ===
              state.activeCategory;

            c.classList.toggle(
              'active',
              isActive
            );

            c.setAttribute(
              'aria-selected',
              isActive
                ? 'true'
                : 'false'
            );
          });

          renderCatalog();
        }
      }
    );
  }

  // ----------------------------------------------------------
  // RETRY
  // ----------------------------------------------------------

  const retryBtn =
    dom.get('#btnRetry');

  if (retryBtn) {
    retryBtn.addEventListener(
      'click',
      loadProducts
    );
  }

  // ----------------------------------------------------------
  // RESET SEARCH
  // ----------------------------------------------------------

  const resetSearchBtn =
    dom.get('#btnResetSearch');

  if (resetSearchBtn) {
    resetSearchBtn.addEventListener(
      'click',
      () => {
        state.searchQuery = '';

        const searchInput =
          dom.get('#searchInput');

        if (searchInput) {
          searchInput.value = '';
        }

        renderCatalog();
      }
    );
  }

  // ----------------------------------------------------------
  // CLEAR CART
  // ----------------------------------------------------------

  const clearCartBtn =
    dom.get('#btnClearAll');

  if (clearCartBtn) {
    clearCartBtn.addEventListener(
      'click',
      () => {
        if (
          confirm(
            'Hapus semua item dari keranjang?'
          )
        ) {
          clearCart();
        }
      }
    );
  }

  // ----------------------------------------------------------
  // GENERATE ORDER
  // ----------------------------------------------------------

  const generateOrderBtn =
    dom.get('#btnGenerateOrder');

  if (generateOrderBtn) {
    generateOrderBtn.addEventListener(
      'click',
      generateOrder
    );
  }

  // ----------------------------------------------------------
  // COPY ORDER
  // ----------------------------------------------------------

  const copyOrderBtn =
    dom.get('#btnCopyOrder');

  if (copyOrderBtn) {
    copyOrderBtn.addEventListener(
      'click',
      copyOrder
    );
  }

  // ----------------------------------------------------------
  // GO CATALOG
  // ----------------------------------------------------------

  const goCatalogBtn =
    dom.get('#btnGoCatalog');

  if (goCatalogBtn) {
    goCatalogBtn.addEventListener(
      'click',
      () => showPage('catalog')
    );
  }

  const goCatalogTopBtn =
    dom.get('#btnGoCatalogTop');

  if (goCatalogTopBtn) {
    goCatalogTopBtn.addEventListener(
      'click',
      () => showPage('catalog')
    );
  }

  // ----------------------------------------------------------
  // RESIZE
  // ----------------------------------------------------------

  let resizeTimeout;

  window.addEventListener(
    'resize',
    () => {
      clearTimeout(resizeTimeout);

      resizeTimeout = setTimeout(() => {
        renderCatalog();
      }, 250);
    }
  );
}

// ============================================================
// PAGE NAVIGATION
// ============================================================

function showPage(pageName) {
  // Save scroll position
  if (state.currentPage) {
    const currentId =
      state.currentPage === 'intro'
        ? 'pageIntro'
        : state.currentPage === 'catalog'
        ? 'pageCatalog'
        : state.currentPage === 'detail'
        ? 'pageDetail'
        : 'pageRecap';

    const currentElement =
      dom.get(`#${currentId}`);

    if (currentElement) {
      state.scrollPositions[
        state.currentPage
      ] = currentElement.scrollTop;
    }
  }

  // Hide all pages
  dom.all('.page').forEach(page => {
    page.hidden = true;
    page.classList.remove('active');
  });

  let targetElement;

  switch (pageName) {
    case 'intro':
      targetElement = dom.get('#pageIntro');
      break;

    case 'catalog':
      targetElement = dom.get('#pageCatalog');
      break;

    case 'detail':
      targetElement = dom.get('#pageDetail');
      break;

    case 'recap':
      targetElement = dom.get('#pageRecap');
      break;
  }

  if (!targetElement) return;

  targetElement.hidden = false;
  targetElement.classList.add('active');

  state.currentPage = pageName;

  const savedScroll =
    state.scrollPositions[pageName];

  if (savedScroll !== undefined) {
    targetElement.scrollTop = savedScroll;
  } else {
    targetElement.scrollTo(0, 0);
  }

  updateHash(pageName);
  renderHeader();
  updateFloatingWhatsApp();

  switch (pageName) {
    case 'catalog':
      renderCatalog();
      break;

    case 'detail':
      break;

    case 'recap':
      renderCart();
      break;
  }
}

// ============================================================
// HASH ROUTING
// ============================================================

function updateHash(pageName) {
  let hash = '#/';

  switch (pageName) {
    case 'intro':
      hash = '#/';
      break;

    case 'catalog':
      hash = '#/katalog';
      break;

    case 'detail':
      hash = state.detail.productSkuId
        ? `#/produk/${encodeURIComponent(
            state.detail.productSkuId
          )}`
        : (
            window.location.hash.startsWith(
              '#/produk/'
            )
              ? window.location.hash
              : '#/produk'
          );
      break;

    case 'recap':
      hash = '#/rekap';
      break;
  }

  if (window.location.hash !== hash) {
    window.location.hash = hash;
  }
}

// ============================================================
// HASH ROUTING SETUP
// ============================================================

function setupHashRouting() {
  function checkHash() {
    const hash =
      window.location.hash || '#/';

    let pageName;

    if (
      hash === '' ||
      hash === '#' ||
      hash === '#/'
    ) {
      pageName = 'intro';

    } else if (
      hash === '#/katalog'
    ) {
      pageName = 'catalog';

    } else if (
      hash === '#/rekap'
    ) {
      pageName = 'recap';

    } else if (
      hash === '#/produk' ||
      hash.startsWith('#/produk/')
    ) {
      const skuId =
        hash.startsWith('#/produk/')
          ? decodeURIComponent(
              hash.slice('#/produk/'.length)
            )
          : '';

      if (
        skuId &&
        skuId !== state.detail.productSkuId &&
        getProductById(skuId)
      ) {
        showProductDetail(skuId);
        return;
      }

      pageName = 'detail';

    } else {
      pageName = 'intro';
    }

    showPage(pageName);
  }

  checkHash();

  window.addEventListener(
    'hashchange',
    checkHash
  );
}

// ============================================================
// HEADER
// ============================================================

function renderHeader() {
  const headerActions =
    dom.get('#headerActions');

  const staticCartButton =
    dom.get('#cartButton');

  const isIntro =
    state.currentPage === 'intro';

  const cartCount =
    Object.values(state.cart).reduce(
      (total, qty) =>
        total + Number(qty || 0),
      0
    );

  // ----------------------------------------------------------
  // If new HTML has static #cartButton,
  // use that button instead of injecting another one.
  // ----------------------------------------------------------

  if (staticCartButton) {
    staticCartButton.hidden = isIntro;

    staticCartButton.onclick = () => {
      showPage('recap');
    };

    const countElement =
      staticCartButton.querySelector(
        '#cartCount'
      );

    if (countElement) {
      countElement.textContent =
        cartCount;

      countElement.hidden =
        cartCount <= 0;
    }

    return;
  }

  // ----------------------------------------------------------
  // Backward compatibility:
  // if #cartButton doesn't exist,
  // create it inside #headerActions.
  // ----------------------------------------------------------

  if (!headerActions) return;

  if (isIntro) {
    headerActions.innerHTML = '';
    return;
  }

  headerActions.innerHTML = `
    <button
      type="button"
      class="icon-btn cart-icon-btn"
      id="cartButton"
      aria-label="Buka keranjang"
    >
      <svg
        class="cart-icon"
        viewBox="0 0 24 24"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M7 8V6.5C7 4.57 8.57 3 10.5 3h3C15.43 3 17 4.57 17 6.5V8"></path>
        <path d="M5 8h14l1 12H4L5 8Z"></path>
        <path d="M9 11v1"></path>
        <path d="M15 11v1"></path>
      </svg>

      <span
        class="cart-count"
        id="cartCount"
        ${cartCount <= 0 ? 'hidden' : ''}
      >
        ${cartCount}
      </span>
    </button>
  `;

  const cartButton =
    dom.get('#cartButton');

  if (cartButton) {
    cartButton.addEventListener(
      'click',
      () => showPage('recap')
    );
  }
}

// ============================================================
// CATALOG
// ============================================================

function renderCatalog() {
  const productGrid =
    dom.get('#productGrid');

  const sectionTitle =
    dom.get('#sectionTitle');

  const productCount =
    dom.get('#productCount');

  const emptyState =
    dom.get('#emptyState');

  if (
    !productGrid ||
    !sectionTitle ||
    !productCount
  ) {
    return;
  }

  const errorState =
    dom.get('#errorState');

  const loadingState =
    dom.get('#loadingState');

  if (errorState) {
    errorState.hidden = true;
  }

  if (loadingState) {
    loadingState.hidden = true;
  }

  sectionTitle.textContent =
    state.activeCategory === 'Semua'
      ? 'Semua Produk'
      : state.activeCategory;

  dom.all(
    '.category-chip'
  ).forEach(chip => {
    const isActive =
      chip.dataset.category ===
      state.activeCategory;

    chip.classList.toggle(
      'active',
      isActive
    );

    chip.setAttribute(
      'aria-selected',
      isActive
        ? 'true'
        : 'false'
    );
  });

  const searchClear =
    dom.get('#searchClear');

  if (searchClear) {
    searchClear.hidden =
      !state.searchQuery.trim();
  }

  const filteredProducts =
    getFilteredProducts();

  productCount.textContent =
    `${filteredProducts.length} produk`;

  if (filteredProducts.length === 0) {
    if (emptyState) {
      emptyState.hidden = false;
    }

    productGrid.innerHTML = '';
    return;
  }

  if (emptyState) {
    emptyState.hidden = true;
  }

  productGrid.innerHTML =
    filteredProducts
      .map(product =>
        renderProductCard(product)
      )
      .join('');

  hydrateProductImages(
    productGrid
  );
}

// ============================================================
// FILTER PRODUCTS
// ============================================================

function getFilteredProducts() {
  const query =
    state.searchQuery
      .trim()
      .toLowerCase();

  return state.products.filter(
    product => {
      const matchesCategory =
        state.activeCategory === 'Semua' ||
        product.category ===
          state.activeCategory;

      const matchesSearch =
        !query ||
        product.product_name
          .toLowerCase()
          .includes(query) ||
        product.store_name
          .toLowerCase()
          .includes(query);

      return (
        matchesCategory &&
        matchesSearch
      );
    }
  );
}

// ============================================================
// PRODUCT CARD
// ============================================================

function renderProductCard(product) {
  const hasStock =
    product.availableStock > 0;

  const isOutOfStock =
    product.allOutOfStock;

  // ----------------------------------------------------------
  // PRICE
  // ----------------------------------------------------------

  let priceHtml = '';

  if (product.hasMultipleVariants) {
    priceHtml = `
      <div class="price price-from">
        <span class="from-label">
          Mulai dari
        </span>

        <span class="new">
          ${formatRupiah(
            product.displayPrice
          )}
        </span>
      </div>
    `;
  } else {
    if (product.discountPercent > 0) {
      priceHtml = `
        <div class="price">
          <span class="old">
            ${formatRupiah(
              product.originalPrice
            )}
          </span>

          <span class="new">
            ${formatRupiah(
              product.displayPrice
            )}
          </span>
        </div>
      `;
    } else {
      priceHtml = `
        <div class="price">
          <span class="new">
            ${formatRupiah(
              product.displayPrice
            )}
          </span>
        </div>
      `;
    }
  }

  // ----------------------------------------------------------
  // SALE LABEL
  // ----------------------------------------------------------

  const saleLabel =
    String(
      product.sale_label ?? ''
    ).trim();

  let badgeHtml = '';

  if (saleLabel) {
    badgeHtml = `
      <div class="product-label">
        ${escapeHtml(saleLabel)}
      </div>
    `;
  } else if (isOutOfStock) {
    badgeHtml = `
      <div class="badge">
        Habis
      </div>
    `;
  } else if (
    product.discountPercent > 0
  ) {
    badgeHtml = `
      <div class="badge">
        Diskon ${product.discountPercent}%
      </div>
    `;
  }

  // ----------------------------------------------------------
  // CARD
  // ----------------------------------------------------------

  const productId =
    escapeHtml(product.product_id);

  const skuId =
    escapeHtml(product.sku_id);

  return `
    <article
      class="card"
      role="listitem"
      onclick="showProductDetail('${productId}')"
    >

      <div class="photo">

        ${badgeHtml}

        ${renderProductImage(
          product,
          product.variants.find(
            variant =>
              variant.stock > 0
          ) ||
          product.variants[0]
        )}

      </div>

      <div class="card-body">

        <div
          class="name"
          title="${escapeHtml(
            product.product_name
          )}"
        >
          ${escapeHtml(
            product.product_name
          )}
        </div>

        <div class="store">
          ⌂ ${escapeHtml(
            product.store_name
          )}
        </div>

        <div class="small">
          ${escapeHtml(
            product.short_note || ''
          )}
        </div>

        ${priceHtml}

        <button
          class="add"
          onclick="event.stopPropagation(); addToCart('${skuId}')"
          ${!hasStock || isOutOfStock
            ? 'disabled'
            : ''}
          aria-label="Tambah ke keranjang"
        >
          +
        </button>

      </div>

    </article>
  `;
}

// ============================================================
// PRODUCT DETAIL
// ============================================================

function showProductDetail(
  productId,
  selectedSkuId = '',
  preserveQuantity = false
) {
  const product =
    getProductById(productId) ||
    getProductForSku(productId);

  if (!product) return;

  state.detailScrollPosition =
    window.scrollY;

  state.detailCategory =
    state.activeCategory;

  state.detailSearchQuery =
    state.searchQuery;

  const detailContainer =
    dom.get('#detailContainer');

  if (!detailContainer) return;

  const variants =
    product.variants;

  const hasMultipleVariants =
    variants.length > 1 &&
    variants.some(v => {
      const name =
        String(v.variant || '')
          .trim()
          .toLowerCase();

      return (
        name !== '' &&
        name !== 'no variant' &&
        name !== 'standar'
      );
    });

  const selectedVariant =
    (
      preserveQuantity &&
      variants.find(
        variant =>
          variant.sku_id ===
          selectedSkuId
      )
    ) ||
    variants.find(
      variant => variant.stock > 0
    ) ||
    variants[0];

  const availableQty =
    getDetailAvailableQuantity(
      selectedVariant
    );

  const previousQuantity =
    preserveQuantity &&
    state.detail.selectedSkuId ===
      selectedVariant.sku_id
      ? state.detail.quantity
      : 1;

  const quantity =
    availableQty
      ? Math.min(
          Math.max(
            1,
            previousQuantity
          ),
          availableQty
        )
      : 1;

  state.detail = {
    productSkuId:
      product.product_id,

    selectedSkuId:
      selectedVariant.sku_id,

    quantity
  };

  // ----------------------------------------------------------
  // VARIANT SELECTOR
  // ----------------------------------------------------------

  let variantSelectorHtml = '';

  if (hasMultipleVariants) {
    variantSelectorHtml = `
      <div class="variant-selector">

        <label>
          Pilih Varian
        </label>

        <div class="variant-chips">

          ${variants.map(
            variant => {
              const isSelected =
                variant.sku_id ===
                selectedVariant.sku_id;

              const isOutOfStock =
                variant.stock === 0;

              return `
                <button
                  class="variant-chip
                    ${isSelected ? 'selected' : ''}
                    ${isOutOfStock ? 'disabled' : ''}"
                  onclick="selectVariant(
                    '${escapeHtml(
                      product.product_id
                    )}',
                    '${escapeHtml(
                      variant.sku_id
                    )}'
                  )"
                  ${isOutOfStock
                    ? 'disabled'
                    : ''}
                >

                  <span>
                    ${escapeHtml(
                      variant.variant || ''
                    )}
                  </span>

                  <span class="stock-label">
                    ${
                      variant.stock > 0
                        ? `Sisa ${variant.stock}`
                        : 'Habis'
                    }
                  </span>

                </button>
              `;
            }
          ).join('')}

        </div>
      </div>
    `;
  }

  // ----------------------------------------------------------
  // DETAIL PRICE
  // ----------------------------------------------------------

  let priceHtml = '';

  if (
    selectedVariant.original_price >
    selectedVariant.final_price
  ) {
    const discountPercent =
      Math.round(
        (
          (
            selectedVariant.original_price -
            selectedVariant.final_price
          ) /
          selectedVariant.original_price
        ) * 100
      );

    priceHtml = `
      <div class="price">

        <span class="old">
          ${formatRupiah(
            selectedVariant.original_price
          )}
        </span>

        <span class="new">
          ${formatRupiah(
            selectedVariant.final_price
          )}
        </span>

      </div>

      <div class="badge">
        Diskon ${discountPercent}%
      </div>
    `;
  } else {
    priceHtml = `
      <div class="price">

        <span class="new">
          ${formatRupiah(
            selectedVariant.final_price
          )}
        </span>

      </div>
    `;
  }

  // ----------------------------------------------------------
  // DETAIL SALE LABEL
  // ----------------------------------------------------------

  const detailSaleLabel =
    String(
      product.sale_label ?? ''
    ).trim();

  const detailLabelHtml =
    detailSaleLabel
      ? `
        <div class="product-label">
          ${escapeHtml(
            detailSaleLabel
          )}
        </div>
      `
      : '';

  // ----------------------------------------------------------
  // DETAIL HTML
  // ----------------------------------------------------------

  detailContainer.innerHTML = `
    <button
      class="detail-back"
      onclick="goBackToCatalog()"
    >
      ← Kembali
    </button>

    <div class="detail-photo">

      ${detailLabelHtml}

      ${renderProductImage(
        product,
        selectedVariant
      )}

    </div>

    <h1>
      ${escapeHtml(
        product.product_name
      )}
    </h1>

    <div class="detail-category">
      ${escapeHtml(
        product.category
      )}
    </div>

    <div class="store-lg">
      ⌂ ${escapeHtml(
        product.store_name
      )}
    </div>

    ${priceHtml}

    <p class="desc">
      ${escapeHtml(
        product.description || ''
      )}
    </p>

    <div class="facts">

      <div class="fact">
        <span>Bahan</span>
        <b>
          ${escapeHtml(
            product.material || ''
          )}
        </b>
      </div>

      <div class="fact">
        <span>Berat</span>
        <b>
          ${
            product.weight
              ? `${String(
                  product.weight
                )
                  .trim()
                  .replace(
                    /\s*g$/i,
                    ''
                  )} g`
              : ''
          }
        </b>
      </div>

      <div class="fact">
        <span>Kemasan</span>
        <b>
          ${escapeHtml(
            product.packaging || ''
          )}
        </b>
      </div>

    </div>

    ${variantSelectorHtml}

    <div
      class="stock-status"
      id="stockStatus"
    >
      ${
        selectedVariant.stock > 0
          ? ''
          : '<span class="stock-out">Habis</span>'
      }
    </div>

    <div
      class="detail-quantity"
      aria-label="Jumlah produk"
    >

      <span>
        Jumlah
      </span>

      <div
        class="detail-quantity-controls"
      >

        <button
          type="button"
          onclick="changeDetailQuantity(-1)"
          ${
            availableQty === 0 ||
            quantity <= 1
              ? 'disabled'
              : ''
          }
          aria-label="Kurangi jumlah"
        >
          −
        </button>

        <input
          type="number"
          value="${quantity}"
          min="1"
          max="${availableQty}"
          inputmode="numeric"
          ${
            availableQty === 0
              ? 'disabled'
              : ''
          }
          onchange="setDetailQuantity(this.value)"
          aria-label="Jumlah"
        >

        <button
          type="button"
          onclick="changeDetailQuantity(1)"
          ${
            availableQty === 0 ||
            quantity >= availableQty
              ? 'disabled'
              : ''
          }
          aria-label="Tambah jumlah"
        >
          +
        </button>

      </div>

    </div>

    <button
      class="btn btn-primary btn-full"
      onclick="addDetailToCart()"
      id="addToCartBtn"
      ${
        availableQty === 0
          ? 'disabled'
          : ''
      }
    >
      Tambah ke Keranjang
    </button>
  `;

  hydrateProductImages(
    detailContainer
  );

  showPage('detail');

  if (!preserveQuantity) {
    refreshProductDetail(
      product.product_id,
      selectedVariant.sku_id
    );
  }
}

// ============================================================
// REFRESH PRODUCT DETAIL
// ============================================================

async function refreshProductDetail(
  productId,
  selectedSkuId
) {
  try {
    const data =
      await fetchApi(
        'product',
        {
          product_id: productId
        }
      );

    if (
      !data.found ||
      !Array.isArray(data.skus) ||
      !data.skus.length
    ) {
      return;
    }

    const variants =
      data.skus
        .filter(row =>
          row.active !== false &&
          String(row.active)
            .toLowerCase() !==
            'false'
        )
        .map(row => ({
          ...row,

          sale_label:
            String(
              row.sale_label ?? ''
            ).trim(),

          original_price:
            Number(
              row.original_price
            ) || 0,

          final_price:
            Number(
              row.final_price
            ) || 0,

          stock: Math.max(
            0,
            Number(row.stock) || 0
          )
        }));

    if (!variants.length) return;

    const index =
      state.products.findIndex(
        product =>
          product.product_id ===
          productId
      );

    if (index === -1) return;

    const first =
      variants[0];

    const availableVariants =
      variants.filter(
        variant => variant.stock > 0
      );

    const displayVariant =
      availableVariants.reduce(
        (
          lowest,
          variant
        ) =>
          !lowest ||
          variant.final_price <
            lowest.final_price
            ? variant
            : lowest,
        null
      ) || first;

    // Find label from any SKU
    const saleLabelRow =
      variants.find(
        variant =>
          String(
            variant.sale_label ?? ''
          ).trim() !== ''
      );

    const saleLabel =
      saleLabelRow
        ? String(
            saleLabelRow.sale_label
          ).trim()
        : String(
            state.products[index]
              .sale_label || ''
          ).trim();

    state.products[index] = {
      ...state.products[index],
      ...first,

      // IMPORTANT:
      sale_label: saleLabel,

      variants,

      displayPrice:
        displayVariant.final_price,

      originalPrice:
        displayVariant.original_price,

      availableStock:
        availableVariants.reduce(
          (sum, variant) =>
            sum + variant.stock,
          0
        ),

      allOutOfStock:
        variants.every(
          variant =>
            variant.stock === 0
        )
    };

    if (
      state.currentPage === 'detail' &&
      state.detail.productSkuId ===
        productId
    ) {
      showProductDetail(
        productId,
        selectedSkuId,
        true
      );
    }

  } catch (error) {
    console.warn(
      'Unable to refresh product variants:',
      error
    );
  }
}

// ============================================================
// BACK TO CATALOG
// ============================================================

function goBackToCatalog() {
  if (state.detailCategory) {
    state.activeCategory =
      state.detailCategory;
  }

  if (
    state.detailSearchQuery !== null &&
    state.detailSearchQuery !== undefined
  ) {
    state.searchQuery =
      state.detailSearchQuery;
  }

  if (state.detailScrollPosition) {
    window.scrollTo(
      0,
      state.detailScrollPosition
    );
  }

  showPage('catalog');
}

// ============================================================
// SELECT VARIANT
// ============================================================

function selectVariant(
  productId,
  variantSkuId
) {
  const product =
    getProductById(productId);

  if (!product) return;

  const variant =
    product.variants.find(
      v => v.sku_id === variantSkuId
    );

  if (!variant) return;

  showProductDetail(
    productId,
    variantSkuId,
    true
  );
}

// ============================================================
// ADD TO CART
// ============================================================

function addToCart(
  skuId,
  addSelectedVariant = false,
  quantity = 1
) {
  const product =
    getProductForSku(skuId);

  if (!product) return false;

  const variant =
    product.variants.find(
      v => v.sku_id === skuId
    );

  if (!variant) return false;

  const hasMultipleVariants =
    product.variants.length > 1;

  if (
    hasMultipleVariants &&
    !addSelectedVariant
  ) {
    showProductDetail(skuId);
    return false;
  }

  const requestedQty =
    Math.max(
      1,
      Math.floor(
        Number(quantity) || 1
      )
    );

  const currentQty =
    Number(state.cart[skuId] || 0);

  if (
    variant.stock - currentQty >=
    requestedQty
  ) {
    state.cart[skuId] =
      currentQty +
      requestedQty;

    saveCart();

    renderHeader();
    renderCart();

    return true;
  }

  return false;
}

// ============================================================
// DETAIL QUANTITY
// ============================================================

function getDetailAvailableQuantity(
  variant
) {
  return Math.max(
    0,
    Number(variant.stock) -
      Number(
        state.cart[
          variant.sku_id
        ] || 0
      )
  );
}

function changeDetailQuantity(
  delta
) {
  setDetailQuantity(
    state.detail.quantity +
      delta
  );
}

function setDetailQuantity(
  value
) {
  const product =
    getProductById(
      state.detail.productSkuId
    );

  const variant =
    product?.variants.find(
      item =>
        item.sku_id ===
        state.detail.selectedSkuId
    );

  if (!product || !variant) return;

  const max =
    getDetailAvailableQuantity(
      variant
    );

  const requested =
    Math.floor(Number(value));

  state.detail.quantity =
    max
      ? Math.min(
          Math.max(
            1,
            Number.isFinite(
              requested
            )
              ? requested
              : 1
          ),
          max
        )
      : 1;

  showProductDetail(
    product.product_id,
    variant.sku_id,
    true
  );
}

function addDetailToCart() {
  const {
    productSkuId,
    selectedSkuId,
    quantity
  } = state.detail;

  if (
    !productSkuId ||
    !selectedSkuId
  ) {
    return;
  }

  if (
    addToCart(
      selectedSkuId,
      true,
      quantity
    )
  ) {
    showProductDetail(
      productSkuId,
      selectedSkuId,
      true
    );
  }
}

// ============================================================
// RENDER CART
// ============================================================

function renderCart() {
  const cartList =
    dom.get('#cartList');

  const emptyCart =
    dom.get('#emptyCart');

  const summaryCard =
    dom.get('#summaryCard');

  const customerInputs =
    dom.get('#customerInputs');

  const generateOrderBtn =
    dom.get('#btnGenerateOrder');

  if (!cartList) return;

  const cartItems =
    Object.entries(state.cart);

  if (cartItems.length === 0) {
    cartList.innerHTML = '';

    if (emptyCart) {
      emptyCart.hidden = false;
    }

    if (summaryCard) {
      summaryCard.hidden = true;
    }

    if (customerInputs) {
      customerInputs.hidden = true;
    }

    if (generateOrderBtn) {
      generateOrderBtn.disabled = true;
    }

    return;
  }

  if (emptyCart) {
    emptyCart.hidden = true;
  }

  if (summaryCard) {
    summaryCard.hidden = false;
  }

  if (customerInputs) {
    customerInputs.hidden = false;
  }

  if (generateOrderBtn) {
    generateOrderBtn.disabled = false;
  }

  cartList.innerHTML =
    cartItems
      .map(
        ([skuId, qty]) => {
          const product =
            getProductForSku(skuId);

          if (!product) return '';

          const variant =
            product.variants.find(
              v =>
                v.sku_id === skuId
            );

          if (!variant) return '';

          const price =
            variant.final_price;

          const total =
            price * qty;

          return `
            <div
              class="item"
              data-sku-id="${escapeHtml(
                skuId
              )}"
            >

              <div class="thumb">
                ${renderProductImage(
                  product,
                  variant
                )}
              </div>

              <div class="item-main">

                <div class="name">
                  ${escapeHtml(
                    product.product_name
                  )}
                </div>

                <div class="store">
                  ⌂ ${escapeHtml(
                    product.store_name
                  )}
                </div>

                <div
                  class="variant"
                  id="variant-${escapeHtml(
                    skuId
                  )}"
                >
                  ${
                    variant.variant
                      ? `(${escapeHtml(
                          variant.variant
                        )})`
                      : ''
                  }
                </div>

                <div class="item-unit-price">
                  ${formatRupiah(
                    price
                  )}
                  / item
                </div>

              </div>

              <div class="item-price">

                <span>
                  Subtotal
                </span>

                <strong>
                  ${formatRupiah(
                    total
                  )}
                </strong>

              </div>

              <div class="qty">

                <button
                  onclick="changeQty('${escapeHtml(
                    skuId
                  )}', -1)"
                >
                  -
                </button>

                <span>
                  ${qty}
                </span>

                <button
                  onclick="changeQty('${escapeHtml(
                    skuId
                  )}', 1)"
                  ${
                    variant.stock <= qty
                      ? 'disabled'
                      : ''
                  }
                >
                  +
                </button>

              </div>

              <button
                class="icon-btn"
                onclick="removeFromCart('${escapeHtml(
                  skuId
                )}')"
                aria-label="Hapus item"
              >
                🗑️
              </button>

            </div>
          `;
        }
      )
      .join('');

  hydrateProductImages(
    cartList
  );

  renderSummary();
}

// ============================================================
// CHANGE CART QUANTITY
// ============================================================

function changeQty(
  skuId,
  delta
) {
  const product =
    getProductForSku(skuId);

  if (!product) return;

  const variant =
    product.variants.find(
      v => v.sku_id === skuId
    );

  if (!variant) return;

  const currentQty =
    Number(state.cart[skuId] || 0);

  const newQty =
    currentQty + delta;

  if (newQty <= 0) {
    removeFromCart(skuId);

  } else if (
    newQty <= variant.stock
  ) {
    state.cart[skuId] =
      newQty;

    saveCart();

    renderCart();
    renderHeader();
  }
}

// ============================================================
// REMOVE CART ITEM
// ============================================================

function removeFromCart(
  skuId
) {
  delete state.cart[skuId];

  saveCart();

  renderCart();
  renderHeader();
}

// ============================================================
// CLEAR CART
// ============================================================

function clearCart() {
  state.cart = {};

  saveCart();

  renderCart();
  renderHeader();
}

// ============================================================
// SUMMARY
// ============================================================

function renderSummary() {
  const summaryRows =
    dom.get('#summaryRows');

  const summaryTotal =
    dom.get('#summaryTotal');

  if (
    !summaryRows ||
    !summaryTotal
  ) {
    return;
  }

  const cartItems =
    Object.entries(state.cart);

  if (cartItems.length === 0) {
    summaryRows.innerHTML = '';
    summaryTotal.innerHTML = '';
    return;
  }

  const totals =
    calculateTotals();

  summaryRows.innerHTML = `
    <div class="row">

      <span>
        Nominal pembelian
        <small>
          Harga sebelum diskon
        </small>
      </span>

      <b>
        ${formatRupiah(
          totals.nominalPembelian
        )}
      </b>

    </div>

    <div class="row">

      <span>
        Total Belanja
        <small>
          Harga setelah diskon
        </small>
      </span>

      <b>
        ${formatRupiah(
          totals.totalBelanja
        )}
      </b>

    </div>

    <div class="row">

      <span>
        Jumlah Toko
      </span>

      <b>
        ${totals.jumlahToko}
      </b>

    </div>

    <div class="row">

      <span>
        Fee Jastip
        <small>
          Rp 15.000/toko<br>
          tambahan biaya Rp 3.000
          mulai dari item ke-4
        </small>
      </span>

      <b>
        ${formatRupiah(
          totals.feeJastip
        )}
      </b>

    </div>

    <div class="row">

      <span>
        Ongkir & Kemasan
        <small>
          Biaya per item dari katalog
        </small>
      </span>

      <b>
        ${formatRupiah(
          totals.ongkirKemasan
        )}
      </b>

    </div>
  `;

  summaryTotal.innerHTML = `
    <span>
      Total
    </span>

    <span>
      ${formatRupiah(
        totals.grandTotal
      )}
    </span>
  `;

  const generateOrderBtn =
    dom.get('#btnGenerateOrder');

  if (generateOrderBtn) {
    generateOrderBtn.disabled =
      cartItems.length === 0;
  }

  const copyOrderBtn =
    dom.get('#btnCopyOrder');

  if (copyOrderBtn) {
    copyOrderBtn.disabled =
      cartItems.length === 0;
  }
}

// ============================================================
// STORE NORMALIZATION
// ============================================================

function normalizeStore(
  storeName
) {
  return String(
    storeName || ''
  )
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

// ============================================================
// CURRENCY
// ============================================================

function formatRupiah(amount) {
  return (
    'Rp' +
    Number(
      amount || 0
    ).toLocaleString('id-ID')
  );
}

// ============================================================
// CURRENT ORDER MESSAGE
// ============================================================

function currentOrderMessage() {
  const cartItems =
    Object.entries(state.cart);

  const totals =
    calculateTotals();

  const items =
    cartItems.map(
      ([skuId, qty]) => {
        const product =
          getProductForSku(
            skuId
          );

        const variant =
          product?.variants.find(
            v =>
              v.sku_id === skuId
          );

        return {
          sku_id: skuId,
          qty,

          product_name:
            product?.product_name ||
            '',

          store_name:
            product?.store_name ||
            '',

          variant:
            variant?.variant ||
            null,

          final_price:
            variant?.final_price ||
            0
        };
      }
    );

  return buildWaMessage({
    orderId:
      generateOrderId(),

    customerName:
      dom.get(
        '#customerName'
      )?.value.trim() || '',

    address:
      dom.get(
        '#customerAddress'
      )?.value.trim() || '',

    note:
      dom.get(
        '#customerNote'
      )?.value.trim() || '',

    items,

    totalBelanja:
      totals.totalBelanja,

    jumlahToko:
      totals.jumlahToko,

    feeJastip:
      totals.feeJastip,

    ongkirKemasan:
      totals.ongkirKemasan,

    grandTotal:
      totals.grandTotal
  });
}

// ============================================================
// COPY ORDER
// ============================================================

async function copyOrder() {
  const info =
    dom.get('#generateInfo');

  const name =
    dom.get(
      '#customerName'
    )?.value.trim();

  const address =
    dom.get(
      '#customerAddress'
    )?.value.trim();

  if (
    !name ||
    !address ||
    !Object.keys(
      state.cart
    ).length
  ) {
    if (info) {
      info.hidden = false;
      info.textContent =
        'Isi Nama dan Alamat terlebih dahulu.';
    }

    return;
  }

  try {
    await navigator.clipboard.writeText(
      currentOrderMessage()
    );

    if (info) {
      info.hidden = false;
      info.textContent =
        'Rekap order sudah disalin.';
    }
  } catch (error) {
    console.error(
      'Clipboard error:',
      error
    );

    if (info) {
      info.hidden = false;
      info.textContent =
        'Gagal menyalin. Silakan coba lagi.';
    }
  }
}

// ============================================================
// GENERATE ORDER
// ============================================================

function generateOrder() {
  const name =
    dom.get(
      '#customerName'
    )?.value.trim();

  const address =
    dom.get(
      '#customerAddress'
    )?.value.trim();

  const info =
    dom.get('#generateInfo');

  if (!name || !address) {
    if (info) {
      info.hidden = false;
      info.textContent =
        'Isi Nama dan Alamat terlebih dahulu.';
    }

    return;
  }

  window.open(
    'https://wa.link/1lz4wo',
    '_blank',
    'noopener,noreferrer'
  );
}

// ============================================================
// STOCK VALIDATION
// ============================================================

async function validateStock() {
  try {
    const baseUrl =
      config.DEV_MOCK
        ? config.DEV_SERVER_URL
        : config.APPS_SCRIPT_URL;

    const response =
      await fetch(
        `${baseUrl}?action=stock`
      );

    const data =
      await response.json();

    if (data.ok) {
      const problems = [];

      Object.entries(
        state.cart
      ).forEach(
        ([skuId, qty]) => {
          const available =
            data.stock[skuId] || 0;

          if (available < qty) {
            problems.push({
              sku_id: skuId,
              available
            });
          }
        }
      );

      return {
        ok:
          problems.length === 0,
        problems
      };
    }

    return {
      ok: false,
      problems: []
    };

  } catch (error) {
    console.error(
      'Error validating stock:',
      error
    );

    return {
      ok: false,
      problems: []
    };
  }
}

// ============================================================
// CALCULATE TOTALS
// ============================================================

function calculateTotals() {
  const cartItems =
    Object.entries(state.cart);

  let nominalPembelian = 0;
  let totalBelanja = 0;
  let extraQty = 0;
  let ongkirKemasan = 0;

  const storeSet =
    new Set();

  cartItems.forEach(
    ([skuId, qty]) => {
      const product =
        getProductForSku(
          skuId
        );

      if (!product) return;

      const variant =
        product.variants.find(
          v =>
            v.sku_id === skuId
        );

      if (!variant) return;

      nominalPembelian +=
        variant.original_price *
        qty;

      totalBelanja +=
        variant.final_price *
        qty;

      storeSet.add(
        normalizeStore(
          product.store_name
        )
      );

      extraQty += Math.max(
        0,
        Number(qty) - 3
      );

      ongkirKemasan +=
        Number(
          variant.shipping_packaging_cost
        ) *
        qty;
    }
  );

  const jumlahToko =
    storeSet.size;

  const feeJastip =
    jumlahToko *
      (
        Number(
          state.config?.fee_per_store
        ) || 15000
      ) +
    extraQty *
      (
        Number(
          state.config?.extra_item_fee
        ) || 3000
      );

  return {
    nominalPembelian,
    totalBelanja,
    jumlahToko,
    feeJastip,
    ongkirKemasan,

    grandTotal:
      totalBelanja +
      feeJastip +
      ongkirKemasan
  };
}

// ============================================================
// ORDER ID
// ============================================================

function generateOrderId() {
  const date =
    new Date();

  const year =
    date
      .getFullYear()
      .toString()
      .slice(-2);

  const month =
    String(
      date.getMonth() + 1
    ).padStart(2, '0');

  const day =
    String(
      date.getDate()
    ).padStart(2, '0');

  const chars =
    'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  let orderId =
    `JP-${year}${month}${day}-`;

  for (
    let i = 0;
    i < 4;
    i++
  ) {
    orderId +=
      chars.charAt(
        Math.floor(
          Math.random() *
            chars.length
        )
      );
  }

  return orderId;
}

// ============================================================
// WHATSAPP MESSAGE
// ============================================================

function buildWaMessage(order) {
  const rp = n =>
    'Rp' +
    Number(
      n || 0
    ).toLocaleString(
      'id-ID'
    );

  const lines = [
    '*REKAP ORDER JASTIP*',
    `Order ID: ${order.orderId}`
  ];

  if (order.customerName) {
    lines.push(
      `Nama: ${order.customerName}`
    );
  }

  if (order.address) {
    lines.push(
      `Alamat: ${order.address}`
    );
  }

  lines.push('');

  order.items.forEach(
    (it, i) => {
      const v =
        it.variant
          ? ` (${it.variant})`
          : '';

      lines.push(
        `${i + 1}. ${it.product_name}${v} - ${it.store_name}`
      );

      lines.push(
        `   ${it.qty} x ${rp(
          it.final_price
        )} = ${rp(
          it.qty *
            it.final_price
        )}`
      );
    }
  );

  lines.push(
    '',
    `Total Belanja: ${rp(
      order.totalBelanja
    )}`,
    `Jumlah Toko: ${order.jumlahToko}`,
    `Fee Jastip: ${rp(
      order.feeJastip
    )}`,
    `Ongkir & Kemasan: ${rp(
      order.ongkirKemasan
    )}`,
    `*Grand Total: ${rp(
      order.grandTotal
    )}*`
  );

  if (order.note) {
    lines.push(
      '',
      `Catatan: ${order.note}`
    );
  }

  lines.push(
    '',
    'Mohon dicek & dikonfirmasi yaa. Terima kasih!'
  );

  const message =
    lines.join('\n');

  // ----------------------------------------------------------
  // TRUNCATE IF TOO LONG
  // ----------------------------------------------------------

  if (message.length > 1500) {
    const truncatedLines = [
      '*REKAP ORDER JASTIP*',
      `Order ID: ${order.orderId}`
    ];

    if (order.customerName) {
      truncatedLines.push(
        `Nama: ${order.customerName}`
      );
    }

    if (order.address) {
      truncatedLines.push(
        `Alamat: ${order.address}`
      );
    }

    truncatedLines.push('');

    order.items.forEach(
      (it, i) => {
        const v =
          it.variant
            ? ` (${it.variant})`
            : '';

        truncatedLines.push(
          `${i + 1}. ${it.product_name}${v} x ${it.qty}`
        );
      }
    );

    truncatedLines.push(
      '',
      `Total: ${rp(
        order.grandTotal
      )}`
    );

    if (order.note) {
      truncatedLines.push(
        '',
        `Catatan: ${order.note}`
      );
    }

    truncatedLines.push(
      '',
      'Mohon dicek & dikonfirmasi yaa. Terima kasih!'
    );

    return truncatedLines.join(
      '\n'
    );
  }

  return message;
}

// ============================================================
// OPEN WHATSAPP
// ============================================================

function openWhatsApp(
  message
) {
  const url =
    'https://wa.link/1lz4wo';

  window.location.href =
    url;

  setTimeout(
    () => {
      const fabWa =
        dom.get('#fabWa');

      if (fabWa) {
        fabWa.style.display =
          'flex';

        fabWa.onclick = () => {
          window.location.href =
            url;
        };
      }
    },
    1000
  );
}

// ============================================================
// FLOATING WHATSAPP
// ============================================================

function setupFloatingWhatsApp() {
  const fabWa =
    dom.get('#fabWa');

  if (!fabWa) return;

  fabWa.addEventListener(
    'click',
    () => {
      window.open(
        'https://wa.link/arpqd8',
        '_blank',
        'noopener,noreferrer'
      );
    }
  );

  updateFloatingWhatsApp();

  if (
    state.currentPage ===
    'recap'
  ) {
    fabWa.style.display =
      'none';
  }
}

function updateFloatingWhatsApp() {
  const fabWa =
    dom.get('#fabWa');

  if (!fabWa) return;

  const waNumber =
    state.config?.wa_number ||
    config.WA_NUMBER_FALLBACK ||
    '6281234567890';

  // Keep variable available for future use.
  void waNumber;

  if (
    state.currentPage ===
      'intro' ||
    state.currentPage ===
      'catalog'
  ) {
    fabWa.style.display =
      'flex';

    fabWa.title =
      'Ask Araa';
  } else {
    fabWa.style.display =
      'none';
  }
}

// ============================================================
// LOADING STATE
// ============================================================

function renderLoadingState() {
  const skeletonGrid =
    dom.get('#skeletonGrid');

  const loadingState =
    dom.get('#loadingState');

  const errorState =
    dom.get('#errorState');

  const emptyState =
    dom.get('#emptyState');

  const productGrid =
    dom.get('#productGrid');

  if (!skeletonGrid) return;

  if (loadingState) {
    loadingState.hidden = false;
  }

  if (errorState) {
    errorState.hidden = true;
  }

  if (emptyState) {
    emptyState.hidden = true;
  }

  if (productGrid) {
    productGrid.innerHTML = '';
  }

  skeletonGrid.innerHTML =
    Array(6)
      .fill(0)
      .map(
        () =>
          `<div class="skeleton-item"></div>`
      )
      .join('');
}

// ============================================================
// ERROR STATE
// ============================================================

function renderErrorState() {
  const errorState =
    dom.get('#errorState');

  const loadingState =
    dom.get('#loadingState');

  const productGrid =
    dom.get('#productGrid');

  if (!errorState) return;

  if (loadingState) {
    loadingState.hidden = true;
  }

  if (productGrid) {
    productGrid.innerHTML = '';
  }

  errorState.hidden = false;

  errorState.scrollIntoView({
    behavior: 'smooth'
  });
}

// ============================================================
// GLOBAL FUNCTIONS FOR INLINE HTML
// ============================================================

window.showProductDetail =
  showProductDetail;

window.goBackToCatalog =
  goBackToCatalog;

window.selectVariant =
  selectVariant;

window.addToCart =
  addToCart;

window.changeQty =
  changeQty;

window.removeFromCart =
  removeFromCart;

window.clearCart =
  clearCart;

window.generateOrder =
  generateOrder;

window.changeDetailQuantity =
  changeDetailQuantity;

window.setDetailQuantity =
  setDetailQuantity;

window.addDetailToCart =
  addDetailToCart;

// ============================================================
// START APPLICATION
// ============================================================

document.addEventListener(
  'DOMContentLoaded',
  init
);