/* ============================================================
   Preorders — rings a client has ordered (usually with a deposit)
   that still need ordering from the supplier, are on their way, or
   are waiting for collection. Tracks the ring, size, price, what the
   client has paid so far and the balance still owed.
   Same team PIN and Vercel API shape as Leads:
   { action, pin, ...fields } -> { ok, ... }. Refreshes every minute
   and when the app returns to the foreground, so every device sees
   the same list.
   ============================================================ */

(function () {
  const API_URL = "https://hidden-jewels.vercel.app/api/leads";
  const LS_PIN = "rpc_hj_pin";
  const STATUSES = ["To order", "Ordered", "Arrived", "Collected", "Cancelled"];
  const AUTO_REFRESH_MS = 60000;
  // Last list the server returned, so a failed refresh (or a slow network)
  // never makes saved preorders look like they've vanished.
  const CACHE_KEY = "rpc_hj_preorders_cache";

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let preorders = readCache();
  let bound = false;
  let loadedOnce = false;
  let lastSyncedAt = 0;
  let loadError = "";
  // Bumped on every save/delete. A list request that started before a write
  // finished can come back without it — its result is discarded rather than
  // overwriting the preorder that was just saved.
  let writeSeq = 0;
  let loadInFlight = null;

  function readCache() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "[]") || []; }
    catch (_) { return []; }
  }
  function saveCache() {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(preorders)); } catch (_) { /* storage unavailable */ }
  }

  function getPin() {
    try { return localStorage.getItem(LS_PIN) || ""; }
    catch (_) { return ""; }
  }

  async function api(payload) {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(Object.assign({ pin: getPin() }, payload)),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Request failed");
    return data;
  }

  function setStatus(state, text) {
    const dot = $("preordersStatusDot");
    const updated = $("preordersUpdated");
    if (dot) {
      dot.classList.remove("live", "stale", "error");
      dot.classList.add(state);
    }
    if (updated) updated.textContent = text;
  }
  function syncedLabel() {
    return `Preorders synced ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  }

  function money(value) {
    const n = Number(value || 0);
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency: "TTD", currencyDisplay: "narrowSymbol" }).format(n);
    } catch (_) {
      // Older Safari doesn't support narrowSymbol.
      return "$" + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    }
  }

  function num(value) {
    const n = Number(String(value == null ? "" : value).replace(/,/g, ""));
    return isFinite(n) ? n : 0;
  }

  function balanceOf(p) {
    if (p.totalPrice === "" || p.totalPrice == null) return null;
    return Math.max(0, num(p.totalPrice) - num(p.amountPaid));
  }

  function formatDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return isNaN(d) ? "" : d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  }

  function statusClass(status) {
    return "preorder-status-" + String(status || "To order").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  }

  function statusOptions(selected, includeAll) {
    const options = includeAll ? ['<option value="open">All open</option>', '<option value="all">All statuses</option>'] : [];
    return options.concat(STATUSES.map((status) =>
      `<option value="${esc(status)}" ${status === selected ? "selected" : ""}>${esc(status)}</option>`
    )).join("");
  }

  // ---------- panel / form management ----------

  function setPanel(panel) {
    document.querySelectorAll("[data-preorder-panel-section]").forEach((section) => {
      section.hidden = section.dataset.preorderPanelSection !== panel;
    });
    document.querySelectorAll("[data-preorder-panel]").forEach((btn) => {
      const active = btn.dataset.preorderPanel === panel;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    });
  }

  function setFormVisible(showForm) {
    const form = $("preorderForm");
    const success = document.querySelector('[data-preorder-step="success"]');
    if (form) form.hidden = !showForm;
    if (success) success.hidden = showForm;
    const isEditing = !!($("preorderId")?.value);
    const submit = $("preorderSubmit");
    if (submit) {
      submit.hidden = !showForm;
      submit.textContent = isEditing ? "Save changes" : "Save preorder";
    }
    const cancel = $("preorderCancelBtn");
    if (cancel) cancel.hidden = !showForm || !isEditing;
    const addAnother = $("preorderAddAnother");
    if (addAnother) addAnother.hidden = showForm;
    const goToView = $("preorderGoToView");
    if (goToView) goToView.hidden = showForm;
  }

  function updateBalancePreview() {
    const out = $("preorderBalance");
    if (!out) return;
    const total = ($("preorderTotal")?.value || "").trim();
    const paid = ($("preorderPaid")?.value || "").trim();
    if (!total) {
      out.textContent = "Enter the ring's price to work out the balance.";
      return;
    }
    const balance = Math.max(0, num(total) - num(paid));
    out.textContent = balance > 0 ? `Balance owed: ${money(balance)}` : "Paid in full";
  }


  // ---------- ring picker (live Hidden Jewels Shopify catalog) ----------
  // Products come from the store via the API (lib/shopify.js). Picking one
  // fills in the ring name, its size(s) and the store price for the chosen
  // variant; staff can still type a custom ring that isn't in the store.

  let catalog = [];
  let catalogLoadedAt = 0;
  let catalogPromise = null;
  let selection = null; // { product, variantId }
  let resultItems = [];
  let activeResult = -1;

  const isSizeOption = (name) => /size/i.test(name);
  const isRingish = (p) => /ring|band|wedding|engagement|bridal/i.test(`${p.type} ${p.title}`);

  function setCatalogStatus(text) {
    const el = $("ringCatalogStatus");
    if (el) el.textContent = text;
  }

  function loadCatalog(force = false) {
    if (!getPin()) {
      setCatalogStatus("Save the team PIN in Settings to search the store.");
      return Promise.resolve(catalog);
    }
    if (!force && catalog.length && Date.now() - catalogLoadedAt < 5 * 60 * 1000) return Promise.resolve(catalog);
    if (catalogPromise) return catalogPromise;
    if (!catalog.length) setCatalogStatus("Loading products from the store…");
    catalogPromise = (async () => {
      try {
        const data = await api({ action: "listShopifyProducts" });
        catalog = Array.isArray(data.products) ? data.products : [];
        catalogLoadedAt = Date.now();
        setCatalogStatus(`${catalog.length} products from hiddenjewelsco.com — pick one, or type a custom ring.`);
      } catch (err) {
        setCatalogStatus("Couldn't load the store's products (" + err.message + ") — type the ring instead.");
      } finally {
        catalogPromise = null;
      }
      return catalog;
    })();
    return catalogPromise;
  }

  // Shopify's CDN resizes on the fly; keeps thumbnails light on phones.
  function sized(url, width) {
    if (!url) return "";
    return url + (url.includes("?") ? "&" : "?") + "width=" + width;
  }

  function priceLabel(p) {
    if (!p.priceMin) return "";
    return p.priceMin === p.priceMax ? money(p.priceMin) : `${money(p.priceMin)} – ${money(p.priceMax)}`;
  }

  function searchCatalog(query) {
    const tokens = query.toLowerCase().replace(/['’]/g, "").split(/\s+/).filter(Boolean);
    const scored = [];
    catalog.forEach((p) => {
      const title = p.title.toLowerCase().replace(/['’]/g, "");
      const hay = `${title} ${p.type} ${(p.tags || []).join(" ")}`.toLowerCase();
      if (tokens.length && !tokens.every((t) => hay.includes(t))) return;
      let score = 0;
      if (isRingish(p)) score += 4;
      if (tokens.length && title.includes(tokens.join(" "))) score += 3;
      if (tokens.length && tokens.every((t) => title.includes(t))) score += 2;
      if (p.available) score += 1;
      scored.push({ p, score });
    });
    if (!tokens.length) return scored.filter((x) => isRingish(x.p)).sort((a, b) => a.p.title.localeCompare(b.p.title)).slice(0, 30).map((x) => x.p);
    return scored.sort((a, b) => b.score - a.score || a.p.title.localeCompare(b.p.title)).slice(0, 30).map((x) => x.p);
  }

  function showResults(items) {
    const box = $("ringResults");
    const input = $("preorderRing");
    if (!box) return;
    resultItems = items;
    activeResult = items.length ? 0 : -1;
    if (!items.length) {
      const q = (input?.value || "").trim();
      box.innerHTML = catalog.length && q
        ? `<p class="ring-results-empty">No store products match “${esc(q)}” — it'll be saved as a custom ring.</p>`
        : "";
      box.hidden = !box.innerHTML;
    } else {
      box.innerHTML = items.map((p, i) => `
        <button type="button" class="ring-result${i === activeResult ? " is-active" : ""}" role="option" data-ring-index="${i}">
          ${p.image ? `<img src="${esc(sized(p.image, 96))}" alt="" loading="lazy" />` : `<span class="ring-result-noimg"><svg class="icon"><use href="#i-ring"></use></svg></span>`}
          <span class="ring-result-text">
            <span class="ring-result-title">${esc(p.title)}</span>
            <span class="ring-result-meta">${esc(priceLabel(p))}${p.available ? "" : ' · <em>Sold out online</em>'}</span>
          </span>
        </button>`).join("");
      box.hidden = false;
    }
    input?.setAttribute("aria-expanded", box.hidden ? "false" : "true");
  }

  function hideResults() {
    const box = $("ringResults");
    if (box) box.hidden = true;
    $("preorderRing")?.setAttribute("aria-expanded", "false");
  }

  function highlightResult(index) {
    activeResult = index;
    document.querySelectorAll("#ringResults .ring-result").forEach((el, i) => {
      el.classList.toggle("is-active", i === index);
      if (i === index) el.scrollIntoView({ block: "nearest" });
    });
  }

  function selectedVariant() {
    if (!selection) return null;
    return selection.product.variants.find((v) => v.id === selection.variantId) || null;
  }

  // Ring name saved on the preorder: the product title plus any non-size
  // choices (e.g. stone), since size has its own field.
  function composedRingName() {
    if (!selection) return ($("preorderRing")?.value || "").trim();
    const { product } = selection;
    const variant = selectedVariant();
    const extras = variant
      ? product.options.map((o, i) => (isSizeOption(o.name) ? "" : variant.options[i])).filter(Boolean)
      : [];
    return extras.length ? `${product.title} (${extras.join(", ")})` : product.title;
  }

  function sizeFromVariant(product, variant) {
    if (!variant) return "";
    return product.options.map((o, i) => (isSizeOption(o.name) ? variant.options[i] : "")).filter(Boolean).join(" / ");
  }

  function pickProduct(product, { variantId = "", fill = true } = {}) {
    const variant = product.variants.find((v) => v.id === variantId)
      || product.variants.find((v) => v.available)
      || product.variants[0];
    selection = { product, variantId: variant ? variant.id : "" };
    const input = $("preorderRing");
    if (input) input.value = product.title;
    hideResults();
    renderSelection();
    if (fill) applyVariant();
  }

  function clearSelection() {
    selection = null;
    renderSelection();
  }

  // Copy the chosen variant's size(s) and store price into the form.
  function applyVariant() {
    const variant = selectedVariant();
    if (!selection || !variant) return;
    const size = sizeFromVariant(selection.product, variant);
    if (size && $("preorderSize")) $("preorderSize").value = size;
    if (variant.price && $("preorderTotal")) $("preorderTotal").value = variant.price;
    updateBalancePreview();
  }

  function renderSelection() {
    const box = $("ringSelected");
    if (!box) return;
    if (!selection) {
      box.hidden = true;
      box.innerHTML = "";
      return;
    }
    const { product } = selection;
    const variant = selectedVariant();
    const image = (variant && variant.image) || product.image;
    const selects = product.options.map((o, i) => `
      <label class="ring-option">
        <span class="field-label">${esc(o.name)}</span>
        <select class="text-input select-input" data-ring-option="${i}">
          ${o.values.map((v) => `<option value="${esc(v)}" ${variant && variant.options[i] === v ? "selected" : ""}>${esc(v)}</option>`).join("")}
        </select>
      </label>`).join("");
    const stock = !variant
      ? `<span class="ring-stock is-out">That combination isn't sold in the store</span>`
      : `<span class="ring-stock${variant.available ? "" : " is-out"}">Store price ${esc(money(variant.price))} · ${variant.available ? "In stock online" : "Sold out online"}</span>`;
    box.innerHTML = `
      <div class="ring-selected-head">
        ${image ? `<img src="${esc(sized(image, 160))}" alt="" />` : ""}
        <div class="ring-selected-text">
          <strong>${esc(product.title)}</strong>
          ${stock}
          ${product.url ? `<a href="${esc(product.url)}" target="_blank" rel="noopener">View in store</a>` : ""}
        </div>
        <button type="button" class="ghost-btn ring-clear" id="ringClear">Not this one</button>
      </div>
      ${selects ? `<div class="ring-options">${selects}</div>` : ""}`;
    box.hidden = false;
    box.querySelectorAll("[data-ring-option]").forEach((sel) => {
      sel.addEventListener("change", () => {
        const chosen = [...box.querySelectorAll("[data-ring-option]")].map((el) => el.value);
        const match = product.variants.find((v) => chosen.every((val, i) => v.options[i] === val));
        selection.variantId = match ? match.id : "";
        renderSelection();
        applyVariant();
      });
    });
    $("ringClear")?.addEventListener("click", () => {
      clearSelection();
      const input = $("preorderRing");
      if (input) { input.value = ""; input.focus(); }
    });
  }

  function bindRingPicker() {
    const input = $("preorderRing");
    const box = $("ringResults");
    if (!input || !box) return;
    const refresh = () => loadCatalog().then(() => {
      if (document.activeElement === input) showResults(searchCatalog(input.value));
    });
    input.addEventListener("focus", () => {
      if (!selection) refresh();
    });
    input.addEventListener("input", () => {
      // Typing over a picked product turns it back into a custom ring.
      if (selection && input.value !== selection.product.title) clearSelection();
      if (catalog.length) showResults(searchCatalog(input.value));
      else refresh();
    });
    input.addEventListener("keydown", (e) => {
      if (box.hidden || !resultItems.length) return;
      if (e.key === "ArrowDown") { e.preventDefault(); highlightResult(Math.min(resultItems.length - 1, activeResult + 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); highlightResult(Math.max(0, activeResult - 1)); }
      else if (e.key === "Enter") { e.preventDefault(); if (resultItems[activeResult]) pickProduct(resultItems[activeResult]); }
      else if (e.key === "Escape") { hideResults(); }
    });
    input.addEventListener("blur", () => setTimeout(hideResults, 150));
    // mousedown (not click) so the input's blur doesn't hide the list first.
    box.addEventListener("mousedown", (e) => {
      const item = e.target.closest("[data-ring-index]");
      if (!item) return;
      e.preventDefault();
      const product = resultItems[Number(item.dataset.ringIndex)];
      if (product) pickProduct(product);
    });
  }

  function resetForm() {
    $("preorderForm")?.reset();
    if ($("preorderStatus")) $("preorderStatus").value = "To order";
    if ($("preorderId")) $("preorderId").value = "";
    const msg = $("preorderMessage");
    if (msg) { msg.textContent = ""; msg.hidden = true; }
    if ($("preorderFormTitle")) $("preorderFormTitle").textContent = "New preorder";
    clearSelection();
    hideResults();
    updateBalancePreview();
    setFormVisible(true);
  }

  function openNewForm() {
    resetForm();
    setPanel("add");
    $("preorderName")?.focus();
  }

  function editPreorder(p) {
    if (!p) return;
    resetForm();
    if ($("preorderFormTitle")) $("preorderFormTitle").textContent = "Edit preorder";
    $("preorderId").value = p.id || "";
    $("preorderName").value = p.customerName || "";
    $("preorderPhone").value = p.phone || "";
    $("preorderRing").value = p.ring || "";
    $("preorderSize").value = p.ringSize || "";
    $("preorderTotal").value = p.totalPrice || "";
    $("preorderPaid").value = num(p.amountPaid) ? p.amountPaid : "";
    $("preorderStatus").value = STATUSES.includes(p.status) ? p.status : "To order";
    $("preorderNotes").value = p.notes || "";
    updateBalancePreview();
    setFormVisible(true);
    setPanel("add");
    $("preorderName")?.focus();
    // Re-link the store product it was picked from, keeping the saved price
    // and size (the price may have been agreed differently).
    if (p.shopifyProductId) {
      const editingId = p.id;
      loadCatalog().then(() => {
        if ($("preorderId")?.value !== editingId) return;
        const product = catalog.find((item) => item.id === p.shopifyProductId);
        if (!product) return;
        pickProduct(product, { variantId: p.shopifyVariantId, fill: false });
        $("preorderRing").value = product.title;
      });
    }
  }

  function bindOnce() {
    if (bound) return;
    bound = true;
    bindRingPicker();

    document.querySelectorAll("[data-preorder-panel]").forEach((btn) => {
      btn.addEventListener("click", () => {
        // Leaving the form mid-edit abandons the edit, and coming back to
        // Add after a save starts a fresh form rather than the old one.
        if (btn.dataset.preorderPanel === "view" && $("preorderId")?.value) resetForm();
        if (btn.dataset.preorderPanel === "add" && $("preorderForm")?.hidden) resetForm();
        setPanel(btn.dataset.preorderPanel);
        if (btn.dataset.preorderPanel === "view") loadPreorders({ force: true, quiet: true });
      });
    });

    $("preorderSubmit")?.addEventListener("click", savePreorder);
    $("preorderForm")?.addEventListener("submit", savePreorder);
    $("preorderNewBtn")?.addEventListener("click", openNewForm);
    $("preorderCancelBtn")?.addEventListener("click", resetForm);
    $("preorderAddAnother")?.addEventListener("click", openNewForm);
    $("preorderGoToView")?.addEventListener("click", () => {
      resetForm();
      setPanel("view");
      loadPreorders({ force: true, quiet: true });
    });
    $("preorderTotal")?.addEventListener("input", updateBalancePreview);
    $("preorderPaid")?.addEventListener("input", updateBalancePreview);

    $("preorderRefresh")?.addEventListener("click", () => loadPreorders({ force: true }));
    $("preorderStatusFilter")?.addEventListener("change", render);
    $("preorderSearch")?.addEventListener("input", () => {
      const clear = $("clearPreorderSearch");
      if (clear) clear.hidden = !$("preorderSearch").value;
      render();
    });
    $("clearPreorderSearch")?.addEventListener("click", () => {
      $("preorderSearch").value = "";
      $("clearPreorderSearch").hidden = true;
      render();
    });
    $("preorderList")?.addEventListener("click", handleListClick);
    $("preorderList")?.addEventListener("change", handleListChange);
  }

  function populateControls() {
    const status = $("preorderStatus");
    const filter = $("preorderStatusFilter");
    if (status && !status.innerHTML) status.innerHTML = statusOptions("To order", false);
    if (filter && !filter.innerHTML) filter.innerHTML = statusOptions("", true);
  }

  async function loadPreorders({ force = false, quiet = false } = {}) {
    const firstRun = !bound;
    bindOnce();
    populateControls();
    if (firstRun) {
      updateBalancePreview();
      setFormVisible(true);
    }
    if (!getPin()) {
      loadError = "Save the team PIN in Settings before loading preorders.";
      setStatus("stale", loadError);
      render();
      return;
    }
    if (loadedOnce && !force) {
      render();
      return;
    }
    if (loadInFlight) return loadInFlight;
    if (!quiet || !loadedOnce) setStatus("stale", "Loading preorders…");
    loadInFlight = (async () => {
      const seqAtStart = writeSeq;
      try {
        const data = await api({ action: "listPreorders" });
        if (seqAtStart !== writeSeq) return; // a save landed meanwhile — next refresh will include it
        preorders = Array.isArray(data.preorders) ? data.preorders : [];
        saveCache();
        loadedOnce = true;
        loadError = "";
        lastSyncedAt = Date.now();
        setStatus("live", syncedLabel());
      } catch (err) {
        loadError = "Couldn't load preorders from the server: " + err.message;
        setStatus("error", loadError);
      } finally {
        loadInFlight = null;
        render();
      }
    })();
    return loadInFlight;
  }

  function formPayload() {
    return {
      id: $("preorderId")?.value || "",
      customerName: ($("preorderName")?.value || "").trim(),
      phone: ($("preorderPhone")?.value || "").trim(),
      ring: composedRingName(),
      shopifyProductId: selection ? selection.product.id : "",
      shopifyVariantId: selection ? selection.variantId : "",
      ringImage: selection ? ((selectedVariant() && selectedVariant().image) || selection.product.image || "") : "",
      ringSize: ($("preorderSize")?.value || "").trim(),
      totalPrice: ($("preorderTotal")?.value || "").trim(),
      amountPaid: ($("preorderPaid")?.value || "").trim(),
      status: $("preorderStatus")?.value || "To order",
      notes: ($("preorderNotes")?.value || "").trim(),
    };
  }

  async function savePreorder(event) {
    event?.preventDefault();
    const msg = $("preorderMessage");
    const showMsg = (text) => { if (msg) { msg.textContent = text; msg.hidden = false; } };
    const submit = $("preorderSubmit");
    const payload = formPayload();
    if (!payload.customerName) return showMsg("Add the client's name.");
    if (!payload.ring) return showMsg("Add the ring they ordered.");
    if (payload.totalPrice && payload.amountPaid && num(payload.amountPaid) > num(payload.totalPrice)) {
      return showMsg("The amount paid is more than the ring's price.");
    }
    if (!getPin()) return showMsg("Save the team PIN in Settings before adding preorders.");
    if (submit) { submit.disabled = true; submit.textContent = "Saving…"; }
    if (msg) msg.hidden = true;
    const isNew = !payload.id;
    try {
      writeSeq++;
      const data = await api(Object.assign({ action: isNew ? "addPreorder" : "updatePreorder" }, payload));
      writeSeq++;
      merge(data.preorder);
      revealInList(data.preorder);
      setStatus("live", syncedLabel());
      render();
      const p = data.preorder || {};
      const balance = balanceOf(p);
      if ($("preorderSuccessTitle")) $("preorderSuccessTitle").textContent = isNew ? "Preorder saved" : "Preorder updated";
      if ($("preorderSuccessMessage")) {
        $("preorderSuccessMessage").textContent = `${p.customerName || "Client"} — ${p.ring || "ring"}${p.ringSize ? ", size " + p.ringSize : ""}. Paid ${money(p.amountPaid)}${balance != null ? ", balance " + money(balance) : ""}.`;
      }
      if ($("preorderId")) $("preorderId").value = "";
      setFormVisible(false);
    } catch (err) {
      showMsg(err.message);
      setStatus("error", "Preorder sync failed");
    } finally {
      if (submit) submit.disabled = false;
      setFormVisible(!$("preorderForm") || !$("preorderForm").hidden);
    }
  }

  function merge(p) {
    if (!p || !p.id) return;
    const index = preorders.findIndex((item) => item.id === p.id);
    if (index === -1) preorders.unshift(p);
    else preorders[index] = p;
    saveCache();
  }

  // After a save, make sure the list isn't filtered so the new/edited
  // preorder is hidden (a leftover search, or a status filter it doesn't
  // match).
  function revealInList(p) {
    const search = $("preorderSearch");
    if (search && search.value) {
      search.value = "";
      if ($("clearPreorderSearch")) $("clearPreorderSearch").hidden = true;
    }
    const filter = $("preorderStatusFilter");
    if (filter && p && filter.value !== "all" && filter.value !== "open" && filter.value !== p.status) filter.value = "all";
    if (filter && p && filter.value === "open" && ["Collected", "Cancelled"].includes(p.status)) filter.value = "all";
  }

  function filtered() {
    const status = $("preorderStatusFilter")?.value || "open";
    const query = ($("preorderSearch")?.value || "").trim().toLowerCase();
    return preorders.filter((p) => {
      if (status === "open" && ["Collected", "Cancelled"].includes(p.status)) return false;
      if (status !== "open" && status !== "all" && p.status !== status) return false;
      if (!query) return true;
      return [p.customerName, p.phone, p.ring, p.ringSize, p.notes]
        .some((value) => String(value || "").toLowerCase().includes(query));
    });
  }

  function renderSummary() {
    const box = $("preorderSummary");
    if (!box) return;
    const open = preorders.filter((p) => !["Collected", "Cancelled"].includes(p.status));
    const toOrder = open.filter((p) => p.status === "To order").length;
    const owed = open.reduce((sum, p) => sum + (balanceOf(p) || 0), 0);
    const deposits = open.reduce((sum, p) => sum + num(p.amountPaid), 0);
    box.innerHTML = `
      <div class="preorder-stat${toOrder ? " is-alert" : ""}"><span>Still to order</span><strong>${toOrder}</strong></div>
      <div class="preorder-stat"><span>Open preorders</span><strong>${open.length}</strong></div>
      <div class="preorder-stat"><span>Deposits held</span><strong>${esc(money(deposits))}</strong></div>
      <div class="preorder-stat"><span>Balance owed</span><strong>${esc(money(owed))}</strong></div>`;
  }

  function render() {
    populateControls();
    renderSummary();
    const list = $("preorderList");
    const count = $("preorderCount");
    if (!list) return;
    const visible = filtered();
    if (count) {
      const total = preorders.length;
      count.textContent = total ? `${visible.length} of ${total} preorder${total === 1 ? "" : "s"}` : "No preorders yet";
    }
    let html = loadError ? `<p class="field-error preorder-load-error">${esc(loadError)}${preorders.length ? " Showing this device's last saved copy." : ""}</p>` : "";
    html += visible.length
      ? visible.map(cardHtml).join("")
      : preorders.length
        ? `<p class="ops-empty">No preorders match the current filters.</p>`
        : loadError ? "" : `<p class="ops-empty">No preorders yet.</p>`;
    list.innerHTML = html;
  }

  function cardHtml(p) {
    const phone = p.phone
      ? `<a class="ticket-phone" href="tel:${esc(p.phone)}"><svg class="icon ticket-phone-icon"><use href="#i-phone"></use></svg>${esc(p.phone)}</a>`
      : `<span class="ticket-phone no-phone">No phone</span>`;
    const balance = balanceOf(p);
    const balanceText = balance == null ? "Price not set" : balance > 0 ? `Balance ${money(balance)}` : "Paid in full";
    return `<article class="lead-card preorder-card ${statusClass(p.status)}" data-preorder-id="${esc(p.id)}">
      <div class="lead-avatar${p.ringImage ? " has-image" : ""}" aria-hidden="true">
        ${p.ringImage ? `<img src="${esc(sized(p.ringImage, 120))}" alt="" loading="lazy" />` : `<svg class="icon"><use href="#i-ring"></use></svg>`}
      </div>
      <div class="lead-card-main">
        <div class="lead-card-top">
          <div class="lead-card-title">${esc(p.customerName || "Unnamed client")}</div>
          <span class="lead-status-pill">${esc(p.status || "To order")}</span>
        </div>
        <div class="lead-card-sub">${esc(p.ring)}${p.ringSize ? ` · Size ${esc(p.ringSize)}` : ""}</div>
        <div class="lead-phone-wrap">${phone}</div>
        <div class="lead-detail-grid">
          <div class="lead-detail"><svg class="icon"><use href="#i-cash"></use></svg><span>Paid ${esc(money(p.amountPaid))}${p.totalPrice ? ` of ${esc(money(p.totalPrice))}` : ""}</span></div>
          <div class="lead-detail${balance ? " is-due" : ""}"><svg class="icon"><use href="#i-tag"></use></svg><span>${esc(balanceText)}</span></div>
          <div class="lead-detail"><svg class="icon"><use href="#i-calendar"></use></svg><span>Taken ${esc(formatDate(p.created))}</span></div>
        </div>
        ${p.notes ? `<div class="lead-notes"><svg class="icon"><use href="#i-note"></use></svg><span>${esc(p.notes)}</span></div>` : ""}
      </div>
      <div class="lead-card-side">
        <div class="lead-card-actions">
          ${balance ? `<button type="button" data-preorder-pay="${esc(p.id)}">Add payment</button>` : ""}
          <button type="button" data-preorder-edit="${esc(p.id)}">Edit</button>
          <button type="button" class="danger-text" data-preorder-delete="${esc(p.id)}">Delete</button>
        </div>
        <select class="text-input select-input lead-card-status" data-preorder-status="${esc(p.id)}" aria-label="Preorder status">${statusOptions(p.status, false)}</select>
      </div>
    </article>`;
  }

  async function handleListClick(event) {
    const editBtn = event.target.closest("[data-preorder-edit]");
    const deleteBtn = event.target.closest("[data-preorder-delete]");
    const payBtn = event.target.closest("[data-preorder-pay]");
    if (editBtn) {
      editPreorder(preorders.find((p) => p.id === editBtn.dataset.preorderEdit));
      return;
    }
    if (payBtn) {
      const p = preorders.find((item) => item.id === payBtn.dataset.preorderPay);
      if (!p) return;
      const balance = balanceOf(p);
      const raw = window.prompt(`Payment from ${p.customerName} (balance ${money(balance)}):`, "");
      if (raw == null || !raw.trim()) return;
      const amount = num(raw);
      if (!(amount > 0)) { window.alert("Enter a payment amount greater than zero."); return; }
      if (balance != null && amount > balance + 0.005) { window.alert(`That's more than the ${money(balance)} balance.`); return; }
      try {
        writeSeq++;
        const data = await api({ action: "updatePreorder", id: p.id, amountPaid: (num(p.amountPaid) + amount).toFixed(2) });
        merge(data.preorder);
        render();
        setStatus("live", syncedLabel());
      } catch (err) {
        setStatus("error", "Couldn't record payment: " + err.message);
      }
      return;
    }
    if (!deleteBtn) return;
    const id = deleteBtn.dataset.preorderDelete;
    const p = preorders.find((item) => item.id === id);
    if (!p || !window.confirm(`Delete ${p.customerName}'s preorder for ${p.ring}?`)) return;
    try {
      writeSeq++;
      await api({ action: "deletePreorder", id });
      preorders = preorders.filter((item) => item.id !== id);
      saveCache();
      render();
      setStatus("live", syncedLabel());
    } catch (err) {
      setStatus("error", "Couldn't delete preorder: " + err.message);
    }
  }

  async function handleListChange(event) {
    const select = event.target.closest("[data-preorder-status]");
    if (!select) return;
    try {
      writeSeq++;
      const data = await api({ action: "updatePreorder", id: select.dataset.preorderStatus, status: select.value });
      merge(data.preorder);
      render();
      setStatus("live", syncedLabel());
    } catch (err) {
      setStatus("error", "Couldn't update preorder: " + err.message);
      render();
    }
  }

  window.addEventListener("rpc-enter-preorders", () => {
    loadPreorders({ force: true, quiet: true });
    loadCatalog(); // warm the store list so the ring search is instant
  });
  const visible = () => !document.hidden && !$("view-preorders")?.hidden && !!getPin();
  setInterval(() => {
    if (visible()) loadPreorders({ force: true, quiet: true });
  }, AUTO_REFRESH_MS);
  document.addEventListener("visibilitychange", () => {
    if (visible() && Date.now() - lastSyncedAt > 15000) loadPreorders({ force: true, quiet: true });
  });
})();
