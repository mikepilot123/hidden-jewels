/* Loads the Hidden Jewels product catalog (a static snapshot pulled from
   Shopify) so Appointments/Leads can search exact products and variants.
   Refresh assets/products.json manually when the catalog changes — there's
   no live Shopify API call from this static site. */
(function () {
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (cents) => {
    const n = Number(cents || 0) / 100;
    if (!n) return "";
    return new Intl.NumberFormat(undefined, { style: "currency", currency: "TTD", currencyDisplay: "narrowSymbol" }).format(n);
  };

  function productLabel(product, variant) {
    if (!product) return "";
    const title = variant?.publicTitle || variant?.title || "";
    if (!title || title === "Default Title") return product.name || "";
    return `${product.name} - ${title}`;
  }

  function normalizeProduct(item) {
    const variants = Array.isArray(item.variants) && item.variants.length
      ? item.variants
      : [{
          id: item.id || item.name,
          title: "Default Title",
          publicTitle: "Default Title",
          options: [],
          price: item.price || 0,
          available: item.available !== false,
          image: item.image || "",
        }];
    const prices = variants.map((v) => Number(v.price || 0)).filter(Boolean);
    return Object.assign({}, item, {
      variants,
      price: item.price || variants[0]?.price || 0,
      priceMin: item.priceMin || (prices.length ? Math.min(...prices) : 0),
      priceMax: item.priceMax || (prices.length ? Math.max(...prices) : 0),
      available: item.available != null ? item.available : variants.some((v) => v.available),
    });
  }

  function ensurePicker() {
    let modal = document.getElementById("productPickerModal");
    if (modal) return modal;
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div id="productPickerModal" class="modal-backdrop product-picker-backdrop" hidden>
        <div class="modal-panel product-picker-panel" role="dialog" aria-modal="true" aria-labelledby="productPickerTitle">
          <div class="modal-header product-picker-header">
            <h3 id="productPickerTitle">Select product</h3>
            <button type="button" id="closeProductPicker" class="modal-close" aria-label="Close"><svg class="icon"><use href="#i-xmark"></use></svg></button>
          </div>
          <div class="product-picker-tools">
            <div class="product-picker-search">
              <svg class="icon"><use href="#i-search"></use></svg>
              <input id="productPickerSearch" autocomplete="off" placeholder="Search products" />
            </div>
            <select id="productPickerType" class="text-input select-input" aria-label="Search by product type"></select>
          </div>
          <div class="product-picker-table-head">
            <span>Product</span>
            <span>Available</span>
            <span>Price</span>
          </div>
          <div id="productPickerList" class="product-picker-list"></div>
          <div class="modal-footer product-picker-footer">
            <span id="productPickerSelectedCount" class="product-picker-count">0/1 variant selected</span>
            <div class="product-picker-actions">
              <button type="button" id="productPickerCancel" class="ghost-btn">Cancel</button>
              <button type="button" id="productPickerAdd" class="primary-btn" disabled>Add</button>
            </div>
          </div>
        </div>
      </div>`;
    document.body.appendChild(wrap.firstElementChild);
    return document.getElementById("productPickerModal");
  }

  function createProductPicker() {
    let onSelect = null;
    let selected = null;
    let typeFilter = "All";
    let query = "";

    const modal = ensurePicker();
    const title = modal.querySelector("#productPickerTitle");
    const search = modal.querySelector("#productPickerSearch");
    const type = modal.querySelector("#productPickerType");
    const list = modal.querySelector("#productPickerList");
    const add = modal.querySelector("#productPickerAdd");
    const count = modal.querySelector("#productPickerSelectedCount");

    function products() {
      return window.RPC_PRODUCTS || [];
    }

    function variantCount(product) {
      return product.variants?.length || 0;
    }

    function productMatches(product) {
      const q = query.trim().toLowerCase();
      if (typeFilter !== "All" && (product.type || "Uncategorized") !== typeFilter) return false;
      if (!q) return true;
      return [
        product.name,
        product.type,
        product.handle,
        ...(product.variants || []).flatMap((variant) => [variant.title, variant.publicTitle, variant.sku]),
      ].some((value) => String(value || "").toLowerCase().includes(q));
    }

    function renderTypes() {
      const types = Array.from(new Set(products().map((p) => p.type || "Uncategorized"))).sort();
      type.innerHTML = [`<option value="All">Search by All</option>`]
        .concat(types.map((name) => `<option value="${esc(name)}">${esc(name)}</option>`))
        .join("");
      type.value = typeFilter;
    }

    function render() {
      const filtered = products().filter(productMatches);
      add.disabled = !selected;
      count.textContent = selected ? "1/1 variant selected" : "0/1 variant selected";
      list.innerHTML = filtered.length ? filtered.map((product, productIndex) => {
        const productKey = `p${productIndex}`;
        const image = product.image
          ? `<img src="${esc(product.image)}" alt="" loading="lazy" />`
          : `<span class="product-picker-image-fallback"><svg class="icon"><use href="#i-tag"></use></svg></span>`;
        const priceText = product.priceMin && product.priceMax && product.priceMin !== product.priceMax
          ? `${money(product.priceMin)} - ${money(product.priceMax)}`
          : money(product.price || product.priceMin || product.variants?.[0]?.price);
        return `
          <div class="product-picker-product-row">
            <span class="product-picker-checkbox-spacer"></span>
            <span class="product-picker-image">${image}</span>
            <span class="product-picker-product-copy">
              <strong>${esc(product.name)}</strong>
              <small>${variantCount(product)} variant${variantCount(product) === 1 ? "" : "s"}${product.type ? " · " + esc(product.type) : ""}</small>
            </span>
            <span class="product-picker-available">${product.available ? "In stock" : "0"}</span>
            <span class="product-picker-price">${esc(priceText)}</span>
          </div>
          ${(product.variants || []).map((variant, variantIndex) => {
            const active = selected?.id === variant.id;
            return `
              <button type="button" class="product-picker-variant-row ${active ? "is-selected" : ""}" data-product-index="${productIndex}" data-variant-index="${variantIndex}">
                <span class="product-picker-check" aria-hidden="true">${active ? "✓" : ""}</span>
                <span class="product-picker-variant-title">${esc(variant.publicTitle || variant.title || "Default Title")}</span>
                <span class="product-picker-available">${variant.available ? "1" : "0"}</span>
                <span class="product-picker-price">${esc(money(variant.price))}</span>
              </button>`;
          }).join("")}`;
      }).join("") : `<p class="device-dropdown-empty product-picker-empty">No matching products.</p>`;
    }

    function close() {
      modal.hidden = true;
      document.body.classList.remove("modal-open");
    }

    function choose(product, variant) {
      selected = {
        id: variant.id,
        product,
        variant,
        label: productLabel(product, variant),
        price: Number(variant.price || product.price || 0),
      };
      render();
    }

    list.addEventListener("click", (event) => {
      const row = event.target.closest("[data-product-index][data-variant-index]");
      if (!row) return;
      const visible = products().filter(productMatches);
      const product = visible[Number(row.dataset.productIndex)];
      const variant = product?.variants?.[Number(row.dataset.variantIndex)];
      if (product && variant) choose(product, variant);
    });
    search.addEventListener("input", () => { query = search.value; selected = null; render(); });
    type.addEventListener("change", () => { typeFilter = type.value; selected = null; render(); });
    modal.querySelector("#closeProductPicker").addEventListener("click", close);
    modal.querySelector("#productPickerCancel").addEventListener("click", close);
    modal.addEventListener("click", (event) => { if (event.target === modal) close(); });
    add.addEventListener("click", () => {
      if (!selected) return;
      onSelect?.(selected);
      close();
    });

    return {
      open(options = {}) {
        onSelect = options.onSelect || null;
        selected = null;
        query = options.initialQuery || "";
        typeFilter = options.type || "All";
        if (title) title.textContent = options.title || "Select product";
        search.value = query;
        renderTypes();
        render();
        modal.hidden = false;
        document.body.classList.add("modal-open");
        setTimeout(() => search.focus(), 30);
      },
    };
  }

  fetch("assets/products.json", { cache: "no-store" })
    .then((res) => res.json())
    .then((items) => {
      window.RPC_PRODUCTS = items.map(normalizeProduct);
      window.RPC_MODEL_NAMES = window.RPC_PRODUCTS.map((p) => p.name);
      window.HJProductPicker = createProductPicker();
      window.dispatchEvent(new Event("rpc-models"));
    })
    .catch((err) => {
      console.warn("Couldn't load product catalog:", err);
      window.RPC_PRODUCTS = [];
      window.RPC_MODEL_NAMES = [];
    });
})();
