/* App shell: nav switching, mobile drawer, and the Settings screen (team PIN
   + staff roster). assets/appointments.js and assets/leads.js are separate
   self-contained modules that each read the PIN from localStorage — this
   file owns the "connect" flow they depend on but never imports them. */
(function () {
  const SCRIPT_URL = "https://hidden-jewels.vercel.app/api/leads";
  const LS_PIN = "rpc_intake_pin";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let TECHNICIANS = [];

  // ---- View navigation -------------------------------------------------
  const navBtns = document.querySelectorAll(".nav-btn[data-target]");
  const settingsNavBtn = $("settingsNavBtn");
  const views = {
    appointments: $("view-appointments"),
    leads: $("view-leads"),
    settings: $("view-settings"),
  };
  function setActiveNav(target) {
    navBtns.forEach((b) => {
      const active = b.dataset.target === target;
      b.classList.toggle("active", active);
      b.setAttribute("aria-selected", active ? "true" : "false");
    });
    if (settingsNavBtn) settingsNavBtn.classList.toggle("active", target === "settings");
  }
  function showView(target) {
    Object.entries(views).forEach(([k, v]) => { if (v) v.hidden = k !== target; });
  }
  function navigateTo(target) {
    setActiveNav(target);
    showView(target);
    if (target === "leads") window.dispatchEvent(new Event("rpc-enter-leads"));
    if (target === "appointments") window.dispatchEvent(new Event("rpc-enter-appointments"));
    if (target === "settings") enterSettings();
  }
  window.RPC_SHOW_VIEW = navigateTo;
  navBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      navigateTo(btn.dataset.target);
      closeNavDrawer();
    });
  });
  settingsNavBtn?.addEventListener("click", () => {
    navigateTo("settings");
    closeNavDrawer();
  });

  // ---- Mobile nav drawer -------------------------------------------------
  const navMenuToggle = $("navMenuToggle");
  const navBackdrop = $("navBackdrop");
  const navDrawerClose = $("navDrawerClose");
  function openNavDrawer() {
    document.body.classList.add("nav-open");
    if (navBackdrop) navBackdrop.hidden = false;
    navMenuToggle?.setAttribute("aria-expanded", "true");
  }
  function closeNavDrawer() {
    document.body.classList.remove("nav-open");
    navMenuToggle?.setAttribute("aria-expanded", "false");
    if (navBackdrop) setTimeout(() => navBackdrop.hidden = true, 250);
  }
  navMenuToggle?.addEventListener("click", () => {
    document.body.classList.contains("nav-open") ? closeNavDrawer() : openNavDrawer();
  });
  navBackdrop?.addEventListener("click", closeNavDrawer);
  navDrawerClose?.addEventListener("click", closeNavDrawer);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeNavDrawer();
  });

  // ---- Config / API ------------------------------------------------------
  const getCfg = () => ({ url: SCRIPT_URL, pin: localStorage.getItem(LS_PIN) || "" });
  const isConfigured = () => !!getCfg().pin;

  async function api(payload, override) {
    const cfg = override || getCfg();
    const body = Object.assign({ pin: cfg.pin }, payload);
    let res;
    if (payload.action === "list" || payload.action === "listTechnicians") {
      const q = new URLSearchParams({ action: payload.action, pin: cfg.pin, _: Date.now() });
      res = await fetch(cfg.url + "?" + q.toString(), { method: "GET" });
    } else {
      res = await fetch(cfg.url, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(body),
      });
    }
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }
  window.RPC_API = api;
  window.RPC_GET_CFG = getCfg;

  function showSetup() {
    $("settingsSetup").hidden = false;
    $("settingsMain").hidden = true;
  }
  function showMain() {
    $("settingsSetup").hidden = true;
    $("settingsMain").hidden = false;
    loadTechnicians();
  }
  function enterSettings() {
    if (!isConfigured()) { showSetup(); return; }
    $("cfgPin").value = getCfg().pin;
    showMain();
  }

  $("cfgSave").addEventListener("click", async () => {
    const pin = $("cfgPin").value.trim();
    const err = $("cfgError");
    err.hidden = true;
    if (!pin) {
      err.textContent = "Enter the team PIN.";
      err.hidden = false;
      return;
    }
    const btn = $("cfgSave");
    btn.disabled = true;
    btn.textContent = "Connecting…";
    try {
      const res = await api({ action: "list" }, { url: SCRIPT_URL, pin });
      if (!res.ok) throw new Error(res.error || "Rejected");
      localStorage.setItem(LS_PIN, pin);
      showMain();
      window.dispatchEvent(new Event("rpc-enter-leads"));
      window.dispatchEvent(new Event("rpc-enter-appointments"));
    } catch (e) {
      err.textContent = "Couldn't connect: " + e.message + ". Check the PIN.";
      err.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = "Save & connect";
    }
  });

  $("disconnectSettings").addEventListener("click", () => {
    if (!window.confirm("Disconnect this device? You'll need the team PIN to reconnect.")) return;
    localStorage.removeItem(LS_PIN);
    showSetup();
  });

  // ---- Staff roster -------------------------------------------------------
  function normalizeTechnicians(list) {
    return (list || [])
      .map((t) => ({ id: t.id || t.name, name: String(t.name || "").trim() }))
      .filter((t) => t.name)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async function loadTechnicians() {
    try {
      const res = await api({ action: "listTechnicians" });
      if (!res.ok) throw new Error(res.error || "Rejected");
      TECHNICIANS = normalizeTechnicians(res.technicians);
      renderTechnicianSettings();
      return TECHNICIANS;
    } catch (e) {
      renderTechnicianSettings("Couldn't load staff: " + e.message);
      return TECHNICIANS;
    }
  }

  function renderTechnicianSettings(message = "") {
    const box = $("technicianSettingsList");
    if (!box) return;
    const err = $("technicianSettingsError");
    err.hidden = !message;
    if (message) err.textContent = message;
    if (!TECHNICIANS.length) {
      box.innerHTML = `<p class="empty-sub">No staff added yet.</p>`;
      return;
    }
    box.innerHTML = TECHNICIANS.map((tech) => `
      <div class="technician-row">
        <span><svg class="icon"><use href="#i-user"></use></svg>${esc(tech.name)}</span>
        <button type="button" class="ghost-btn technician-delete" data-tech="${esc(tech.name)}" aria-label="Delete ${esc(tech.name)}"><svg class="icon"><use href="#i-trash"></use></svg></button>
      </div>
    `).join("");
    box.querySelectorAll(".technician-delete").forEach((btn) => {
      btn.addEventListener("click", () => deleteTechnician(btn.dataset.tech || ""));
    });
  }

  async function addTechnicianFromSettings() {
    const input = $("newTechnicianName");
    const name = input.value.trim();
    const err = $("technicianSettingsError");
    err.hidden = true;
    if (!name) {
      err.textContent = "Enter a staff name.";
      err.hidden = false;
      return;
    }
    const btn = $("addTechnician");
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = "Adding…";
    try {
      const res = await api({ action: "addTechnician", name: name.replace(/\s+/g, " ") });
      if (!res.ok) throw new Error(res.error || "Rejected");
      TECHNICIANS = normalizeTechnicians(res.technicians);
      renderTechnicianSettings();
      input.value = "";
    } catch (e) {
      err.textContent = "Couldn't add staff: " + e.message;
      err.hidden = false;
    } finally {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  }

  async function deleteTechnician(name) {
    if (!name) return;
    if (!window.confirm(`Remove "${name}" from the staff roster? Existing appointments keep their assignment.`)) return;
    const err = $("technicianSettingsError");
    err.hidden = true;
    try {
      const res = await api({ action: "deleteTechnician", name });
      if (!res.ok) throw new Error(res.error || "Rejected");
      TECHNICIANS = normalizeTechnicians(res.technicians);
      renderTechnicianSettings();
    } catch (e) {
      err.textContent = "Couldn't remove staff: " + e.message;
      err.hidden = false;
    }
  }

  $("addTechnician").addEventListener("click", addTechnicianFromSettings);
  $("newTechnicianName").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addTechnicianFromSettings();
    }
  });

  // ---- Sticky header height (matches pricechecker's app.js) --------------
  (function () {
    const header = document.querySelector(".app-header");
    if (!header) return;
    const setH = () => {
      const sideNav = window.matchMedia("(min-width: 900px)").matches;
      document.documentElement.style.setProperty("--header-h", sideNav ? "0px" : header.offsetHeight + "px");
    };
    setH();
    if ("ResizeObserver" in window) new ResizeObserver(setH).observe(header);
    window.addEventListener("resize", setH);
  })();

  // ---- Go ------------------------------------------------------------------
  navigateTo("appointments");
})();
