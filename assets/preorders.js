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

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let preorders = [];
  let bound = false;
  let loadedOnce = false;
  let lastSyncedAt = 0;

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
    return new Intl.NumberFormat(undefined, { style: "currency", currency: "TTD", currencyDisplay: "narrowSymbol" }).format(n);
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

  function resetForm() {
    $("preorderForm")?.reset();
    if ($("preorderStatus")) $("preorderStatus").value = "To order";
    if ($("preorderId")) $("preorderId").value = "";
    const msg = $("preorderMessage");
    if (msg) { msg.textContent = ""; msg.hidden = true; }
    if ($("preorderFormTitle")) $("preorderFormTitle").textContent = "New preorder";
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
  }

  function bindOnce() {
    if (bound) return;
    bound = true;

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
      preorders = [];
      setStatus("stale", "Save the team PIN in Settings before loading preorders.");
      render();
      return;
    }
    if (loadedOnce && !force) {
      render();
      return;
    }
    if (!quiet || !loadedOnce) setStatus("stale", "Loading preorders…");
    try {
      const data = await api({ action: "listPreorders" });
      preorders = Array.isArray(data.preorders) ? data.preorders : [];
      loadedOnce = true;
      lastSyncedAt = Date.now();
      setStatus("live", syncedLabel());
      render();
    } catch (err) {
      setStatus("error", "Couldn't load preorders: " + err.message);
      render();
    }
  }

  function formPayload() {
    return {
      id: $("preorderId")?.value || "",
      customerName: ($("preorderName")?.value || "").trim(),
      phone: ($("preorderPhone")?.value || "").trim(),
      ring: ($("preorderRing")?.value || "").trim(),
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
      const data = await api(Object.assign({ action: isNew ? "addPreorder" : "updatePreorder" }, payload));
      merge(data.preorder);
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
    list.innerHTML = visible.length
      ? visible.map(cardHtml).join("")
      : `<p class="ops-empty">No preorders match the current filters.</p>`;
  }

  function cardHtml(p) {
    const phone = p.phone
      ? `<a class="ticket-phone" href="tel:${esc(p.phone)}"><svg class="icon ticket-phone-icon"><use href="#i-phone"></use></svg>${esc(p.phone)}</a>`
      : `<span class="ticket-phone no-phone">No phone</span>`;
    const balance = balanceOf(p);
    const balanceText = balance == null ? "Price not set" : balance > 0 ? `Balance ${money(balance)}` : "Paid in full";
    return `<article class="lead-card preorder-card ${statusClass(p.status)}" data-preorder-id="${esc(p.id)}">
      <div class="lead-avatar" aria-hidden="true">
        <svg class="icon"><use href="#i-ring"></use></svg>
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
      await api({ action: "deletePreorder", id });
      preorders = preorders.filter((item) => item.id !== id);
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
      const data = await api({ action: "updatePreorder", id: select.dataset.preorderStatus, status: select.value });
      merge(data.preorder);
      render();
      setStatus("live", syncedLabel());
    } catch (err) {
      setStatus("error", "Couldn't update preorder: " + err.message);
      render();
    }
  }

  window.addEventListener("rpc-enter-preorders", () => loadPreorders({ force: true, quiet: true }));
  const visible = () => !document.hidden && !$("view-preorders")?.hidden && !!getPin();
  setInterval(() => {
    if (visible()) loadPreorders({ force: true, quiet: true });
  }, AUTO_REFRESH_MS);
  document.addEventListener("visibilitychange", () => {
    if (visible() && Date.now() - lastSyncedAt > 15000) loadPreorders({ force: true, quiet: true });
  });
})();
