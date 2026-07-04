/* ============================================================
   Leads — sales prospect pipeline for Hidden Jewels Co.
   Uses the same team PIN saved in Settings and the same Vercel API shape:
   { action, pin, ...fields } -> { ok, ... }.
   ============================================================ */

(function () {
  const LEADS_URL = "https://hidden-jewels.vercel.app/api/leads";
  const LS_PIN = "rpc_hj_pin";
  const STATUSES = ["New", "Contacted", "Quoted", "Follow-up", "Won", "Lost"];

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let leads = [];
  let bound = false;
  let loadedOnce = false;
  let currentStep = 1;
  let closeLeadItemDropdown = null;

  function getPin() {
    try { return localStorage.getItem(LS_PIN) || ""; }
    catch (_) { return ""; }
  }

  async function api(payload) {
    const res = await fetch(LEADS_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(Object.assign({ pin: getPin() }, payload)),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Request failed");
    return data;
  }

  function setStatus(state, text) {
    const dot = $("leadsStatusDot");
    const updated = $("leadsUpdated");
    if (dot) {
      dot.classList.remove("live", "stale", "error");
      dot.classList.add(state);
    }
    if (updated) updated.textContent = text;
  }

  function money(value) {
    const n = Number(value || 0);
    if (!n) return "";
    return new Intl.NumberFormat(undefined, { style: "currency", currency: "TTD", currencyDisplay: "narrowSymbol" }).format(n);
  }

  function formatDate(date) {
    if (!date) return "";
    const parsed = new Date(date + "T00:00:00");
    return isNaN(parsed) ? date : parsed.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  }

  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function isDue(date) {
    return !!date && date <= todayISO();
  }

  function statusClass(status) {
    return "lead-status-" + String(status || "New").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  }

  function statusOptions(selected, includeAll) {
    const options = includeAll ? ['<option value="all">All statuses</option>'] : [];
    return options.concat(STATUSES.map((status) =>
      `<option value="${esc(status)}" ${status === selected ? "selected" : ""}>${esc(status)}</option>`
    )).join("");
  }

  // ---------- item combobox (Shopify catalog snapshot) ----------

  function setupItemCombobox() {
    const combobox = $("leadItemCombobox");
    const input = $("leadItem");
    const dropdown = $("leadItemDropdown");
    const toggle = $("openLeadItemDropdown");
    if (!combobox || !input || !dropdown) return;

    function itemOptions(showAll) {
      const names = window.RPC_MODEL_NAMES || [];
      const query = showAll ? "" : input.value.trim().toLowerCase();
      return query ? names.filter((n) => n.toLowerCase().includes(query)) : names;
    }

    function renderDropdown(showAll) {
      const options = itemOptions(showAll);
      dropdown.innerHTML = options.length
        ? options.map((name) => `<button type="button" class="device-option ${name === input.value ? "active" : ""}" role="option" data-item="${esc(name)}">${esc(name)}</button>`).join("")
        : `<p class="device-dropdown-empty">No matching items.</p>`;
      dropdown.querySelectorAll("[data-item]").forEach((btn) => {
        btn.addEventListener("mousedown", (e) => e.preventDefault());
        btn.addEventListener("click", () => choose(btn.dataset.item));
      });
    }

    function open(showAll) {
      renderDropdown(showAll);
      dropdown.hidden = false;
      input.setAttribute("aria-expanded", "true");
      combobox.classList.add("open");
    }

    function close() {
      dropdown.hidden = true;
      input.setAttribute("aria-expanded", "false");
      combobox.classList.remove("open");
    }
    closeLeadItemDropdown = close;

    function choose(name) {
      input.value = name;
      close();
    }

    input.addEventListener("focus", () => open(true));
    input.addEventListener("click", () => open(true));
    input.addEventListener("input", () => open(false));
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        open(true);
        dropdown.querySelector(".device-option")?.focus();
      } else if (e.key === "Escape") {
        close();
      } else if (e.key === "Enter") {
        e.preventDefault();
        close();
      }
    });
    dropdown.addEventListener("keydown", (e) => {
      const options = [...dropdown.querySelectorAll(".device-option")];
      const i = options.indexOf(document.activeElement);
      if (e.key === "ArrowDown") { e.preventDefault(); (options[i + 1] || options[0])?.focus(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); (options[i - 1] || options[options.length - 1])?.focus(); }
      else if (e.key === "Escape") { close(); input.focus(); }
    });
    toggle?.addEventListener("click", () => {
      if (dropdown.hidden) open(true); else close();
      input.focus();
    });
    document.addEventListener("click", (e) => {
      if (combobox && !combobox.contains(e.target)) close();
    });
  }

  // ---------- modal / step management ----------

  function openModal() {
    const modal = $("leadFormModal");
    if (modal) modal.hidden = false;
    document.body.classList.add("modal-open");
  }

  function closeModal() {
    const modal = $("leadFormModal");
    if (modal) modal.hidden = true;
    document.body.classList.remove("modal-open");
  }

  function setLeadStep(n) {
    currentStep = n;
    document.querySelectorAll("[data-lead-step]").forEach((section) => {
      section.hidden = String(section.dataset.leadStep) !== String(n);
    });
    document.querySelectorAll("[data-lead-progress-step]").forEach((el) => {
      const stepNum = parseInt(el.dataset.leadProgressStep, 10);
      el.classList.toggle("active", stepNum === n);
      el.classList.toggle("done", stepNum < n);
    });
    const isSuccess = n === 4;
    const prev = $("leadPrevStep");
    const next = $("leadNextStep");
    const save = $("leadSubmit");
    const done = $("leadDoneBtn");
    const cancel = $("leadCancelBtn");
    if (prev) prev.hidden = n <= 1 || isSuccess;
    if (next) next.hidden = n >= 3 || isSuccess;
    if (save) save.hidden = n !== 3;
    if (done) done.hidden = !isSuccess;
    if (cancel) cancel.hidden = isSuccess;
  }

  function validateStep1() {
    const name = ($("leadName")?.value || "").trim();
    const phone = ($("leadPhone")?.value || "").trim();
    const err = $("leadStep1Error");
    if (!name && !phone) {
      if (err) { err.textContent = "Add a name or phone number to continue."; err.hidden = false; }
      return false;
    }
    if (err) err.hidden = true;
    return true;
  }

  function closeAndReset() {
    closeModal();
    $("leadForm")?.reset();
    if ($("leadStatus")) $("leadStatus").value = "New";
    if ($("leadId")) $("leadId").value = "";
    const msg = $("leadMessage");
    if (msg) { msg.textContent = ""; msg.hidden = true; }
    const err = $("leadStep1Error");
    if (err) err.hidden = true;
    if ($("leadFormTitle")) $("leadFormTitle").textContent = "New lead";
    closeLeadItemDropdown?.();
    setLeadStep(1);
  }

  function openNewLeadForm() {
    closeAndReset();
    openModal();
    $("leadName")?.focus();
  }

  function editLead(lead) {
    if (!lead) return;
    closeAndReset();
    if ($("leadFormTitle")) $("leadFormTitle").textContent = "Edit lead";
    $("leadId").value = lead.id || "";
    $("leadName").value = lead.customerName || "";
    $("leadPhone").value = lead.phone || "";
    $("leadEmail").value = lead.email || "";
    $("leadSource").value = lead.source || "";
    $("leadItem").value = lead.item || "";
    $("leadQuotedAmount").value = lead.quotedAmount || "";
    $("leadStatus").value = STATUSES.includes(lead.status) ? lead.status : "New";
    $("leadFollowUpDate").value = lead.followUpDate || "";
    $("leadNotes").value = lead.notes || "";
    openModal();
    $("leadName")?.focus();
  }

  function bindOnce() {
    if (bound) return;
    bound = true;

    $("leadSubmit")?.addEventListener("click", saveLead);
    $("leadNewBtn")?.addEventListener("click", openNewLeadForm);
    $("closeLeadFormModal")?.addEventListener("click", closeAndReset);
    $("leadCancelBtn")?.addEventListener("click", closeAndReset);
    $("leadDoneBtn")?.addEventListener("click", closeAndReset);

    $("leadPrevStep")?.addEventListener("click", () => {
      closeLeadItemDropdown?.();
      setLeadStep(currentStep - 1);
    });
    $("leadNextStep")?.addEventListener("click", () => {
      if (currentStep === 1 && !validateStep1()) return;
      closeLeadItemDropdown?.();
      setLeadStep(currentStep + 1);
    });

    $("leadFormModal")?.addEventListener("click", (e) => {
      if (e.target === $("leadFormModal")) closeAndReset();
    });

    $("leadRefresh")?.addEventListener("click", () => loadLeads({ force: true }));
    $("leadStatusFilter")?.addEventListener("change", render);
    $("leadFollowUpFilter")?.addEventListener("change", render);
    $("leadSearch")?.addEventListener("input", () => {
      const clear = $("clearLeadSearch");
      if (clear) clear.hidden = !$("leadSearch").value;
      render();
    });
    $("clearLeadSearch")?.addEventListener("click", () => {
      $("leadSearch").value = "";
      $("clearLeadSearch").hidden = true;
      render();
    });
    $("leadList")?.addEventListener("click", handleListClick);
    $("leadList")?.addEventListener("change", handleListChange);

    setupItemCombobox();
  }

  function populateControls() {
    const status = $("leadStatus");
    const filter = $("leadStatusFilter");
    if (status && !status.innerHTML) status.innerHTML = statusOptions("New", false);
    if (filter && !filter.innerHTML) filter.innerHTML = statusOptions("", true);
  }

  async function loadLeads({ force = false } = {}) {
    bindOnce();
    populateControls();
    if (!getPin()) {
      leads = [];
      setStatus("stale", "Save the team PIN in Settings before loading leads.");
      render();
      return;
    }
    if (loadedOnce && !force) {
      render();
      return;
    }
    setStatus("stale", "Loading leads…");
    try {
      const data = await api({ action: "list" });
      leads = Array.isArray(data.leads) ? data.leads : [];
      loadedOnce = true;
      setStatus("live", `Leads synced ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`);
      render();
    } catch (err) {
      setStatus("error", "Couldn't load leads: " + err.message);
      render();
    }
  }

  function formPayload() {
    return {
      id: $("leadId")?.value || "",
      customerName: ($("leadName")?.value || "").trim(),
      phone: ($("leadPhone")?.value || "").trim(),
      email: ($("leadEmail")?.value || "").trim(),
      item: ($("leadItem")?.value || "").trim(),
      quotedAmount: ($("leadQuotedAmount")?.value || "").trim(),
      source: ($("leadSource")?.value || "").trim(),
      status: $("leadStatus")?.value || "New",
      followUpDate: $("leadFollowUpDate")?.value || "",
      notes: ($("leadNotes")?.value || "").trim(),
    };
  }

  async function saveLead(event) {
    event.preventDefault();
    const msg = $("leadMessage");
    const submit = $("leadSubmit");
    const payload = formPayload();
    if (!payload.customerName && !payload.phone) {
      if (msg) { msg.textContent = "Add a name or phone number."; msg.hidden = false; }
      return;
    }
    if (!getPin()) {
      if (msg) { msg.textContent = "Save the team PIN in Settings before adding leads."; msg.hidden = false; }
      return;
    }
    if (submit) submit.disabled = true;
    if (msg) msg.hidden = true;
    try {
      const action = payload.id ? "update" : "add";
      const isNew = !payload.id;
      const data = await api(Object.assign({ action }, payload));
      mergeLead(data.lead);
      setStatus("live", `Leads synced ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`);
      render();
      const title = $("leadSuccessTitle");
      const successMsg = $("leadSuccessMessage");
      if (title) title.textContent = isNew ? "Lead added to pipeline" : "Lead updated";
      if (successMsg) successMsg.textContent = `${data.lead?.customerName || "Lead"} has been ${isNew ? "added" : "updated"} successfully.`;
      setLeadStep(4);
    } catch (err) {
      if (msg) { msg.textContent = err.message; msg.hidden = false; }
      setStatus("error", "Lead sync failed");
    } finally {
      if (submit) submit.disabled = false;
    }
  }

  function mergeLead(lead) {
    if (!lead || !lead.id) return;
    const index = leads.findIndex((item) => item.id === lead.id);
    if (index === -1) leads.unshift(lead);
    else leads[index] = lead;
  }

  function filteredLeads() {
    const status = $("leadStatusFilter")?.value || "all";
    const follow = $("leadFollowUpFilter")?.value || "all";
    const query = ($("leadSearch")?.value || "").trim().toLowerCase();
    return leads.filter((lead) => {
      if (status !== "all" && lead.status !== status) return false;
      if (follow === "due" && !isDue(lead.followUpDate)) return false;
      if (follow === "today" && lead.followUpDate !== todayISO()) return false;
      if (follow === "upcoming" && (!lead.followUpDate || lead.followUpDate <= todayISO())) return false;
      if (follow === "none" && lead.followUpDate) return false;
      if (!query) return true;
      return [lead.customerName, lead.phone, lead.email, lead.item, lead.source, lead.notes]
        .some((value) => String(value || "").toLowerCase().includes(query));
    });
  }

  function render() {
    populateControls();
    const list = $("leadList");
    const count = $("leadCount");
    if (!list) return;
    const visible = filteredLeads();
    if (count) {
      const total = leads.length;
      count.textContent = total ? `${visible.length} of ${total} lead${total === 1 ? "" : "s"}` : "No leads yet";
    }
    list.innerHTML = visible.length
      ? visible.map(leadCardHtml).join("")
      : `<p class="ops-empty">No leads match the current filters.</p>`;
  }

  function leadCardHtml(lead) {
    const phone = lead.phone
      ? `<a class="ticket-phone" href="tel:${esc(lead.phone)}"><svg class="icon ticket-phone-icon"><use href="#i-phone"></use></svg>${esc(lead.phone)}</a>`
      : `<span class="ticket-phone no-phone">No phone</span>`;
    const quote = money(lead.quotedAmount);
    const dueClass = isDue(lead.followUpDate) && !["Won", "Lost"].includes(lead.status) ? " is-due" : "";
    const itemText = lead.item || "No item yet";
    return `<article class="lead-card ${statusClass(lead.status)}" data-lead-id="${esc(lead.id)}">
      <div class="lead-avatar" aria-hidden="true">
        <svg class="icon"><use href="#i-user"></use></svg>
      </div>
      <div class="lead-card-main">
        <div class="lead-card-top">
          <div class="lead-card-title">${esc(lead.customerName || "Unnamed lead")}</div>
          <span class="lead-status-pill">${esc(lead.status || "New")}</span>
        </div>
        <div class="lead-card-sub">${esc(itemText)}</div>
        <div class="lead-phone-wrap">${phone}</div>
        <div class="lead-detail-grid">
          <div class="lead-detail${dueClass}">
            <svg class="icon"><use href="#i-calendar"></use></svg>
            <span>${lead.followUpDate ? `Follow up ${esc(formatDate(lead.followUpDate))}` : "No follow-up date"}</span>
          </div>
          ${quote ? `<div class="lead-detail"><svg class="icon"><use href="#i-cash"></use></svg><span>Quote ${esc(quote)}</span></div>` : ""}
          ${lead.email ? `<div class="lead-detail"><svg class="icon"><use href="#i-mail"></use></svg><span>${esc(lead.email)}</span></div>` : ""}
          ${lead.source ? `<div class="lead-detail"><svg class="icon"><use href="#i-tag"></use></svg><span>${esc(lead.source)}</span></div>` : ""}
        </div>
        ${lead.notes ? `<div class="lead-notes"><svg class="icon"><use href="#i-note"></use></svg><span>${esc(lead.notes)}</span></div>` : ""}
      </div>
      <div class="lead-card-side">
        <div class="lead-card-actions">
          <button type="button" data-lead-edit="${esc(lead.id)}">Edit</button>
          <button type="button" class="danger-text" data-lead-delete="${esc(lead.id)}">Delete</button>
        </div>
        <select class="text-input select-input lead-card-status" data-lead-status="${esc(lead.id)}" aria-label="Lead status">${statusOptions(lead.status, false)}</select>
      </div>
    </article>`;
  }

  async function handleListClick(event) {
    const editBtn = event.target.closest("[data-lead-edit]");
    const deleteBtn = event.target.closest("[data-lead-delete]");
    if (editBtn) {
      editLead(leads.find((lead) => lead.id === editBtn.dataset.leadEdit));
      return;
    }
    if (!deleteBtn) return;
    const id = deleteBtn.dataset.leadDelete;
    const lead = leads.find((item) => item.id === id);
    if (!lead || !window.confirm(`Delete lead for ${lead.customerName || lead.phone || "this customer"}?`)) return;
    try {
      await api({ action: "delete", id });
      leads = leads.filter((item) => item.id !== id);
      render();
      setStatus("live", `Leads synced ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`);
    } catch (err) {
      setStatus("error", "Couldn't delete lead: " + err.message);
    }
  }

  async function handleListChange(event) {
    const select = event.target.closest("[data-lead-status]");
    if (!select) return;
    const id = select.dataset.leadStatus;
    try {
      const data = await api({ action: "update", id, status: select.value });
      mergeLead(data.lead);
      render();
      setStatus("live", `Leads synced ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`);
    } catch (err) {
      setStatus("error", "Couldn't update lead: " + err.message);
      render();
    }
  }

  window.addEventListener("rpc-enter-leads", () => loadLeads());
})();
