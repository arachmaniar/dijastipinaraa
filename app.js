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
  detailSearchQuery: null
};

// DOM elements cache
const dom = {
  get: (selector) => document.querySelector(selector),
  all: (selector) => document.querySelectorAll(selector)
};

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
  
  // Check if we should show intro or go directly to catalog
  if (config.DEV_MOCK) {
    // In dev mode, skip intro and go directly to catalog
    showPage('catalog');
  }
}

// Load configuration
function loadConfig() {
  // Use the config object from config.js
  state.config = config;
  
  // If using mock, set up mock server
  if (config.DEV_MOCK) {
    setupMockServer();
  }
}

// Setup mock server for development
function setupMockServer() {
  // Override fetch to use mock data for catalog endpoint
  const originalFetch = window.fetch;
  window.fetch = function(url, options) {
    if (typeof url === 'string' && url.includes('action=catalog')) {
      return fetch(config.DEV_SERVER_URL + '/dev-mock/catalog.json')
        .then(response => response.json())
        .then(data => ({
          ok: true,
          json: () => Promise.resolve(data)
        }));
    }
    if (typeof url === 'string' && url.includes('action=stock')) {
      // Mock stock endpoint - return current stock from products
      const stockMap = {};
      state.products.forEach(p => {
        p.variants.forEach(v => {
          stockMap[v.sku_id] = v.stock;
        });
      });
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ok: true, stock: stockMap })
      });
    }
    return originalFetch(url, options);
  };
}

// Load products from API or mock
async function loadProducts() {
  if (state.loading) return;
  
  state.loading = true;
  renderLoadingState();
  
  try {
    const response = await fetch(`${config.DEV_MOCK ? config.DEV_SERVER_URL : config.APPS_SCRIPT_URL}?action=catalog`);
    const data = await response.json();
    
    if (data.ok) {
      // Validate required fields
      const validProducts = (data.products || []).filter(p => {
        const hasRequired = p.sku_id && p.product_id && p.category && p.product_name && p.store_name && p.final_price !== undefined && p.stock !== undefined;
        if (!hasRequired) {
          console.warn('Product missing required fields:', p);
        }
        return hasRequired;
      });
      
      // Group by product_id
      const grouped = groupBy(validProducts, 'product_id');
      
      // Convert to flat array for easier filtering
      const flatProducts = [];
      Object.values(grouped).forEach(productGroup => {
        const first = productGroup[0];
        const variants = productGroup.filter(p => p.variant);
        const hasMultipleVariants = variants.length > 0;
        
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
      state.config = data.config;
      
      // Save to localStorage for offline access
      localStorage.setItem('dijastipinaraa_products', JSON.stringify({
        products: state.products,
        timestamp: Date.now(),
        config: state.config
      }));
      
      // Render catalog
      renderCatalog();
      
      // Update floating WhatsApp number
      updateFloatingWhatsApp();
    } else {
      throw new Error(data.error || 'Failed to load catalog');
    }
  } catch (error) {
    console.error('Error loading products:', error);
    state.error = error.message;
    renderErrorState();
    
    // Try to load from localStorage as fallback
    const cached = localStorage.getItem('dijastipinaraa_products');
    if (cached) {
      const parsed = JSON.parse(cached);
      const age = Date.now() - parsed.timestamp;
      if (age < 3600000) { // 1 hour
        state.products = parsed.products;
        state.config = parsed.config;
        renderCatalog();
        updateFloatingWhatsApp();
      }
    }
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
  
  // Validate cart items against current products
  validateCart();
}

// Validate cart items (remove invalid ones)
function validateCart() {
  const validSkuIds = state.products.map(p => p.sku_id);
  const newCart = {};
  
  Object.entries(state.cart).forEach(([skuId, qty]) => {
    if (validSkuIds.includes(skuId)) {
      const product = state.products.find(p => p.sku_id === skuId);
      if (product && qty > 0) {
        // Check stock
        const variant = product.variants.find(v => v.sku_id === skuId);
        if (variant && variant.stock >= qty) {
          newCart[skuId] = qty;
        } else if (variant && variant.stock === 0) {
          // Item out of stock, don't add to cart
          console.log(`Item ${skuId} is out of stock`);
        } else {
          // Stock changed, adjust qty
          newCart[skuId] = Math.min(qty, variant.stock);
        }
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
  // Page navigation
  dom.all('.page button').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const page = e.target.closest('.page');
      if (page) {
        const targetPage = page.getAttribute('data-page');
        if (targetPage) {
          showPage(targetPage);
        }
      }
    });
  });
  
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
  
  // Customer inputs
  const customerNameInput = dom.get('#customerName');
  const customerNoteInput = dom.get('#customerNote');
  if (customerNameInput) {
    customerNameInput.addEventListener('input', () => {
      renderSummary();
    });
  }
  if (customerNoteInput) {
    customerNoteInput.addEventListener('input', () => {
      renderSummary();
    });
  }
  
  // Window resize for responsive behavior
  let resizeTimeout;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      renderCatalog();
    }, 250);
  });
}

// Show a page
function showPage(pageName) {
  // Save scroll position for current page
  if (state.currentPage) {
    const currentElement = dom.get(`#${pageName === 'intro' ? 'pageIntro' : pageName === 'catalog' ? 'pageCatalog' : pageName === 'detail' ? 'pageDetail' : 'pageRecap'}`);
    if (currentElement) {
      state.scrollPositions[state.currentPage] = currentElement.scrollTop;
    }
  }
  
  // Hide all pages
  dom.all('.page').forEach(p => p.classList.remove('active'));
  
  // Show target page
  let targetElement;
  switch (pageName) {
    case 'intro': targetElement = dom.get('#pageIntro'); break;
    case 'catalog': targetElement = dom.get('#pageCatalog'); break;
    case 'detail': targetElement = dom.get('#pageDetail'); break;
    case 'recap': targetElement = dom.get('#pageRecap'); break;
  }
  
  if (targetElement) {
    targetElement.classList.add('active');
    state.currentPage = pageName;
    
    // Restore scroll position
    const savedScroll = state.scrollPositions[pageName];
    if (savedScroll !== undefined) {
      targetElement.scrollTop = savedScroll;
    } else {
      targetElement.scrollTo(0, 0);
    }
    
    // Update header
    renderHeader();
    
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

// Render header
function renderHeader() {
  const headerActions = dom.get('#headerActions');
  if (!headerActions) return;
  
  const isIntro = state.currentPage === 'intro';
  const isCatalog = state.currentPage === 'catalog';
  const isDetail = state.currentPage === 'detail';
  
  if (isIntro) {
    headerActions.innerHTML = '';
  } else {
    let html = '';
    
    if (isCatalog || isDetail) {
      html += `<button class="icon-btn" onclick="showPage('catalog')">Katalog</button>`;
    }
    
    html += `<button class="icon-btn" onclick="showPage('recap')">🛒 <span class="cart-count">${Object.values(state.cart).reduce((a, b) => a + b, 0)}</span></button>`;
    
    headerActions.innerHTML = html;
  }
}

// Render catalog
function renderCatalog() {
  const productGrid = dom.get('#productGrid');
  const sectionTitle = dom.get('#sectionTitle');
  const productCount = dom.get('#productCount');
  const emptyState = dom.get('#emptyState');
  
  if (!productGrid || !sectionTitle || !productCount) return;
  
  // Update section title
  sectionTitle.textContent = state.activeCategory === 'Semua' ? 'Semua Produk' : state.activeCategory;
  
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
}

// Get filtered products based on search and category
function getFilteredProducts() {
  return state.products.filter(product => {
    const matchesCategory = state.activeCategory === 'Semua' || product.category === state.activeCategory;
    
    const matchesSearch = !state.searchQuery ||
      product.product_name.toLowerCase().includes(state.searchQuery.toLowerCase()) ||
      product.store_name.toLowerCase().includes(state.searchQuery.toLowerCase());
    
    return matchesCategory && matchesSearch;
  });
}

// Render product card
function renderProductCard(product) {
  const hasStock = product.availableStock > 0;
  const isOutOfStock = product.allOutOfStock;
  
  // Determine price display
  let priceHtml = '';
  if (product.variants.length > 1) {
    // Multiple variants - show "Mulai dari"
    priceHtml = `<div class="price"><span class="new">Mulai dari ${formatRupiah(product.displayPrice)}</span></div>`;
  } else {
    // Single variant
    if (product.discountPercent > 0) {
      priceHtml = `<div class="price"><span class="old">${formatRupiah(product.originalPrice)}</span><span class="new">${formatRupiah(product.displayPrice)}</span></div><div class="badge">Diskon ${product.discountPercent}%</div>`;
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
  
  // Card image
  const imageUrl = product.image_url_card || `https://picsum.photos/seed/${product.sku_id}/400/400.jpg`;
  
  return `
    <article class="card" role="listitem">
      <div class="photo" onclick="showProductDetail('${product.sku_id}')">
        ${badgeHtml}
        <img src="${imageUrl}" alt="${product.product_name}" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.style.display='grid';">
        <div class="placeholder" style="display:none;">${product.icon || '📦'}</div>
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
function showProductDetail(skuId) {
  const product = state.products.find(p => p.sku_id === skuId);
  if (!product) return;
  
  // Save current state for back navigation
  state.detailScrollPosition = window.scrollY;
  state.detailCategory = state.activeCategory;
  state.detailSearchQuery = state.searchQuery;
  
  // Render detail content
  const detailContainer = dom.get('#detailContent');
  if (!detailContainer) return;
  
  const variants = product.variants;
  const hasMultipleVariants = variants.length > 1;
  const selectedVariant = variants[0];
  
  // Build variant selector
  let variantSelectorHtml = '';
  if (hasMultipleVariants) {
    variantSelectorHtml = `
      <div class="variant-selector">
        <label>Varian:</label>
        <div class="variant-chips">
          ${variants.map(variant => {
            const isSelected = variant.sku_id === selectedVariant.sku_id;
            const isOutOfStock = variant.stock === 0;
            return `
              <button class="variant-chip ${isSelected ? 'selected' : ''} ${isOutOfStock ? 'disabled' : ''}"
                      onclick="selectVariant('${product.sku_id}', '${variant.sku_id}')"
                      ${isOutOfStock ? 'disabled' : ''}>
                <span>${variant.variant || 'Standar'}</span>
                <span class="stock-label">${variant.stock > 0 ? `Tersedia${variant.stock <= 5 ? ` (${variant.stock})` : ''}` : 'Habis'}</span>
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
  
  // Build image URL
  const imageUrl = selectedVariant.image_url_detail || `https://picsum.photos/seed/${selectedVariant.sku_id}/800/800.jpg`;
  
  detailContainer.innerHTML = `
    <button class="icon-btn" onclick="goBackToCatalog()">← Kembali</button>
    <div class="detail-photo">
      <img src="${imageUrl}" alt="${product.product_name}" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.style.display='grid';">
      <div class="placeholder" style="display:none;">${product.icon || '📦'}</div>
    </div>
    <h1>${product.product_name}</h1>
    <div class="store-lg">⌂ ${product.store_name}</div>
    <p class="desc">${product.description || ''}</p>
    <div class="facts">
      <div class="fact">
        <span>Bahan</span>
        <b>${product.material || ''}</b>
      </div>
      <div class="fact">
        <span>Berat</span>
        <b>${product.weight || ''}</b>
      </div>
      <div class="fact">
        <span>Kemasan</span>
        <b>${product.packaging || ''}</b>
      </div>
    </div>
    ${variantSelectorHtml}
    <div class="stock-status" id="stockStatus">
      ${selectedVariant.stock > 0 ? `
        <span class="stock-available">Tersedia</span>
        ${selectedVariant.stock <= 5 ? `<span class="stock-count">Sisa ${selectedVariant.stock}</span>` : ''}
      ` : '\n        <span class="stock-out">Habis</span>\n      '}
    </div>
    <button class="btn btn-primary btn-full"
            onclick="addToCart('${selectedVariant.sku_id}')"
            id="addToCartBtn"
            ${selectedVariant.stock === 0 ? 'disabled' : ''}>
      Tambah ke Keranjang
    </button>
  `;
  
  showPage('detail');
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
  const product = state.products.find(p => p.sku_id === productId);
  if (!product) return;
  
  const variant = product.variants.find(v => v.sku_id === variantSkuId);
  if (!variant) return;
  
  // Update detail view
  showProductDetail(variantSkuId);
}

// Add to cart
function addToCart(skuId) {
  const product = state.products.find(p => p.sku_id === skuId);
  if (!product) return;
  
  const variant = product.variants.find(v => v.sku_id === skuId);
  if (!variant) return;
  
  // Check if product has multiple variants
  const hasMultipleVariants = product.variants.length > 1;
  
  if (hasMultipleVariants) {
    // Multiple variants - open detail to select
    showProductDetail(skuId);
  } else {
    // Single variant - add directly to cart
    if (variant.stock > 0) {
      state.cart[skuId] = (state.cart[skuId] || 0) + 1;
      saveCart();
      renderHeader();
      renderCart();
    }
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
    const product = state.products.find(p => p.sku_id === skuId);
    if (!product) return '';
    
    const variant = product.variants.find(v => v.sku_id === skuId);
    if (!variant) return '';
    
    const imageUrl = variant.image_url_detail || `https://picsum.photos/seed/${skuId}/58/58.jpg`;
    const price = variant.final_price;
    const total = price * qty;
    
    return `
      <div class="item" data-sku-id="${skuId}">
        <div class="thumb">
          <img src="${imageUrl}" alt="${product.product_name}" onerror="this.style.display='none'; this.nextElementSibling.style.display='grid';">
          <div class="placeholder" style="display:none;">${product.icon || '📦'}</div>
        </div>
        <div class="item-main">
          <div class="name">${product.product_name}</div>
          <div class="store">⌂ ${product.store_name}</div>
          <div class="variant" id="variant-${skuId}">${variant.variant ? `(${variant.variant})` : ''}</div>
        </div>
        <div class="item-price">${formatRupiah(total)}</div>
        <div class="qty">
          <button onclick="changeQty('${skuId}', -1)">-</button>
          <span>${qty}</span>
          <button onclick="changeQty('${skuId}', 1)" ${variant.stock <= qty ? 'disabled' : ''}>+</button>
        </div>
        <button class="icon-btn" onclick="removeFromCart('${skuId}')" aria-label="Hapus item">🗑️</button>
      </div>
    `;
  }).join('');
  
  // Render summary
  renderSummary();
}

// Change quantity in cart
function changeQty(skuId, delta) {
  const product = state.products.find(p => p.sku_id === skuId);
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
  
  // Calculate totals
  const items = [];
  let nominalPembelian = 0;
  let totalBelanja = 0;
  const storeSet = new Set();
  let totalQty = 0;
  let ongkirKemasan = 0;
  
  cartItems.forEach(([skuId, qty]) => {
    const product = state.products.find(p => p.sku_id === skuId);
    if (!product) return;
    
    const variant = product.variants.find(v => v.sku_id === skuId);
    if (!variant) return;
    
    const item = {
      sku_id: skuId,
      product_name: product.product_name,
      store_name: product.store_name,
      variant: variant.variant || null,
      original_price: variant.original_price || variant.final_price,
      final_price: variant.final_price,
      qty: qty,
      shipping_packaging_cost: variant.shipping_packaging_cost || 0
    };
    
    items.push(item);
    nominalPembelian += item.original_price * item.qty;
    totalBelanja += item.final_price * item.qty;
    storeSet.add(normalizeStore(item.store_name));
    totalQty += item.qty;
    ongkirKemasan += item.shipping_packaging_cost * item.qty;
  });
  
  // Calculate fee
  const jumlahToko = storeSet.size;
  const feeJastip = jumlahToko * (state.config?.fee_per_store || 15000) +
    Math.max(0, totalQty - (state.config?.free_item_qty || 3)) * (state.config?.extra_item_fee || 3000);
  
  const grandTotal = totalBelanja + feeJastip + ongkirKemasan;
  
  // Render summary rows
  summaryRows.innerHTML = `
    <div class="row">
      <span>Nominal pembelian<small>Harga sebelum diskon</small></span>
      <b>${formatRupiah(nominalPembelian)}</b>
    </div>
    <div class="row">
      <span>Total Belanja<small>Harga setelah diskon</small></span>
      <b>${formatRupiah(totalBelanja)}</b>
    </div>
    <div class="row">
      <span>Jumlah Toko</span>
      <b>${jumlahToko}</b>
    </div>
    <div class="row">
      <span>Fee Jastip<small>Rp${(state.config?.fee_per_store || 15000).toLocaleString('id-ID')}/toko + Rp${(state.config?.extra_item_fee || 3000).toLocaleString('id-ID')}/item ke-${(state.config?.free_item_qty || 3) + 1}</small></span>
      <b>${formatRupiah(feeJastip)}</b>
    </div>
    <div class="row">
      <span>Ongkir & Kemasan<small>Ambil dari Google Sheet</small></span>
      <b>${formatRupiah(ongkirKemasan)}</b>
    </div>
  `;
  
  // Render total
  summaryTotal.innerHTML = `
    <span>Total</span>
    <span>${formatRupiah(grandTotal)}</span>
  `;
  
  // Update customer inputs state
  const customerName = dom.get('#customerName');
  const customerNote = dom.get('#customerNote');
  if (customerName) customerName.value = '';
  if (customerNote) customerNote.value = '';
  
  // Enable/disable generate button
  const generateOrderBtn = dom.get('#btnGenerateOrder');
  if (generateOrderBtn) {
    generateOrderBtn.disabled = cartItems.length === 0;
  }
}

// Normalize store name (for counting unique stores)
function normalizeStore(storeName) {
  return storeName.toLowerCase().trim().replace(/\s+/g, ' ');
}

// Format currency
function formatRupiah(amount) {
  return 'Rp' + Number(amount).toLocaleString('id-ID');
}

// Generate order
async function generateOrder() {
  const generateOrderBtn = dom.get('#btnGenerateOrder');
  const generateInfo = dom.get('#generateInfo');
  
  if (!generateOrderBtn || !generateInfo) return;
  
  // Disable button to prevent double submit
  generateOrderBtn.disabled = true;
  generateOrderBtn.textContent = 'Memproses...';
  
  try {
    // Validate cart not empty
    const cartItems = Object.entries(state.cart);
    if (cartItems.length === 0) {
      throw new Error('Keranjang kosong');
    }
    
    // Validate stock
    const stockValidation = await validateStock();
    if (!stockValidation.ok) {
      alert('Stok tidak cukup untuk beberapa item:\n' +
        stockValidation.problems.map(p => `\n${p.sku_id}: tersedia ${p.available}`).join(''));
      generateOrderBtn.disabled = false;
      generateOrderBtn.textContent = 'Generate Order';
      return;
    }
    
    // Calculate totals
    const totals = calculateTotals();
    
    // Generate order ID
    const orderId = generateOrderId();
    
    // Prepare order data
    const customer = {
      name: dom.get('#customerName')?.value || '',
      note: dom.get('#customerNote')?.value || ''
    };
    
    const items = cartItems.map(([skuId, qty]) => {
      const product = state.products.find(p => p.sku_id === skuId);
      const variant = product?.variants.find(v => v.sku_id === skuId);
      return { sku_id: skuId, qty };
    });
    
    // Submit to server
    const response = await fetch(config.APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'order',
        orderId,
        customer,
        items
      })
    });
    
    const data = await response.json();
    
    if (data.ok) {
      // Success - open WhatsApp
      const waMessage = buildWaMessage({
        orderId,
        customerName: customer.name,
        note: customer.note,
        items: items.map(item => {
          const product = state.products.find(p => p.sku_id === item.sku_id);
          const variant = product?.variants.find(v => v.sku_id === item.sku_id);
          return {
            ...item,
            product_name: product?.product_name || '',
            store_name: product?.store_name || '',
            variant: variant?.variant || null,
            final_price: variant?.final_price || 0
          };
        }),
        totalBelanja: totals.totalBelanja,
        jumlahToko: totals.jumlahToko,
        feeJastip: totals.feeJastip,
        ongkirKemasan: totals.ongkirKemasan,
        grandTotal: totals.grandTotal
      });
      
      openWhatsApp(waMessage);
      
      // Clear cart
      clearCart();
      
      // Show success info
      generateInfo.hidden = false;
      generateInfo.textContent = 'Order belum tercatat di sistem, tetap kirim pesan WhatsApp';
      
      // Re-enable button after delay
      setTimeout(() => {
        generateOrderBtn.disabled = false;
        generateOrderBtn.textContent = 'Generate Order';
        generateInfo.hidden = true;
      }, 3000);
    } else {
      if (data.error === 'STOCK') {
        // Stock error - don't open WhatsApp
        alert('Stok tidak cukup untuk beberapa item:\n' +
          data.problems.map(p => `\n${p.sku_id}: tersedia ${p.available}`).join(''));
      } else {
        // Other error - still open WhatsApp with frontend totals
        const waMessage = buildWaMessage({
          orderId,
          customerName: customer.name,
          note: customer.note,
          items: items.map(item => {
            const product = state.products.find(p => p.sku_id === item.sku_id);
            const variant = product?.variants.find(v => v.sku_id === item.sku_id);
            return {
              ...item,
              product_name: product?.product_name || '',
              store_name: product?.store_name || '',
              variant: variant?.variant || null,
              final_price: variant?.final_price || 0
            };
          }),
          totalBelanja: totals.totalBelanja,
          jumlahToko: totals.jumlahToko,
          feeJastip: totals.feeJastip,
          ongkirKemasan: totals.ongkirKemasan,
          grandTotal: totals.grandTotal
        });
        
        openWhatsApp(waMessage);
        
        generateInfo.hidden = false;
        generateInfo.textContent = 'Order belum tercatat di sistem, tetap kirim pesan WhatsApp';
      }
      
      generateOrderBtn.disabled = false;
      generateOrderBtn.textContent = 'Generate Order';
    }
  } catch (error) {
    console.error('Error generating order:', error);
    
    // Still open WhatsApp with frontend totals
    const cartItems = Object.entries(state.cart);
    const totals = calculateTotals();
    const orderId = generateOrderId();
    
    const customer = {
      name: dom.get('#customerName')?.value || '',
      note: dom.get('#customerNote')?.value || ''
    };
    
    const items = cartItems.map(([skuId, qty]) => {
      const product = state.products.find(p => p.sku_id === skuId);
      const variant = product?.variants.find(v => v.sku_id === skuId);
      return {
        sku_id: skuId,
        qty,
        product_name: product?.product_name || '',
        store_name: product?.store_name || '',
        variant: variant?.variant || null,
        final_price: variant?.final_price || 0
      };
    });
    
    const waMessage = buildWaMessage({
      orderId,
      customerName: customer.name,
      note: customer.note,
      items,
      totalBelanja: totals.totalBelanja,
      jumlahToko: totals.jumlahToko,
      feeJastip: totals.feeJastip,
      ongkirKemasan: totals.ongkirKemasan,
      grandTotal: totals.grandTotal
    });
    
    openWhatsApp(waMessage);
    
    generateInfo.hidden = false;
    generateInfo.textContent = 'Order belum tercatat di sistem, tetap kirim pesan WhatsApp';
    
    generateOrderBtn.disabled = false;
    generateOrderBtn.textContent = 'Generate Order';
  }
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
  let totalQty = 0;
  let ongkirKemasan = 0;
  
  cartItems.forEach(([skuId, qty]) => {
    const product = state.products.find(p => p.sku_id === skuId);
    if (!product) return;
    
    const variant = product.variants.find(v => v.sku_id === skuId);
    if (!variant) return;
    
    nominalPembelian += variant.original_price * qty;
    totalBelanja += variant.final_price * qty;
    storeSet.add(normalizeStore(product.store_name));
    totalQty += qty;
    ongkirKemasan += variant.shipping_packaging_cost * qty;
  });
  
  const jumlahToko = storeSet.size;
  const feeJastip = jumlahToko * (state.config?.fee_per_store || 15000) +
    Math.max(0, totalQty - (state.config?.free_item_qty || 3)) * (state.config?.extra_item_fee || 3000);
  
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
  const waNumber = state.config?.wa_number || config.WA_NUMBER_FALLBACK || '6281234567890';
  const encodedMessage = encodeURIComponent(message);
  const url = `https://wa.me/${waNumber}?text=${encodedMessage}`;
  
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
    fabWa.title = 'Tanya Order';
  } else {
    fabWa.style.display = 'none';
  }
}

// Render loading state
function renderLoadingState() {
  const skeletonGrid = dom.get('#skeletonGrid');
  if (!skeletonGrid) return;
  
  skeletonGrid.innerHTML = Array(6).fill(0).map(() => `
    <div class="skeleton-item"></div>
  `).join('');
}

// Render error state
function renderErrorState() {
  const errorState = dom.get('#errorState');
  if (!errorState) return;
  
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

// Start the application
document.addEventListener('DOMContentLoaded', init);
