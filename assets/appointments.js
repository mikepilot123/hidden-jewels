/* ============================================================
   Appointments — Cal.com-style booking, a 3-step wizard:
   1) pick a day + time on a month calendar, 2) pick the item
   (synced with the Shopify product catalog snapshot in
   assets/products.json) and a staff member (Fresha-style chip
   picker, shared staff list), 3) add the client's details to
   confirm. Stored locally (no backend for the booking itself);
   booked slots are excluded from the picker so two clients can't
   be double-booked into the same time.
   ============================================================ */

(function () {
  const APPOINTMENTS_KEY = "rpc_hj_appointments";
  const OPEN_HOUR = 9; // 9:00 AM
  const CLOSE_HOUR = 17; // 5:00 PM
  const SLOT_MINUTES = 30;
  const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  const SCRIPT_URL = "https://hidden-jewels.vercel.app/api/leads";
  const LS_PIN = "rpc_hj_pin";
  const DEFAULT_TECHNICIANS = [];

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

  let viewMonth = startOfMonth(new Date());
  let selectedDate = null; // "YYYY-MM-DD"
  let selectedTime = null; // "HH:MM"
  let selectedTechnician = ""; // "" = Any staff
  let technicians = [];
  let currentStep = 1;
  let bound = false;
  let closeAppointmentItemDropdown = null;

  function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
  function todayISO() { return toISODate(new Date()); }
  function toISODate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function pad2(n) { return String(n).padStart(2, "0"); }
  function minutesToLabel(mins) {
    const h24 = Math.floor(mins / 60);
    const m = mins % 60;
    const period = h24 >= 12 ? "PM" : "AM";
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    return `${h12}:${pad2(m)} ${period}`;
  }
  function minutesToValue(mins) { return `${pad2(Math.floor(mins / 60))}:${pad2(mins % 60)}`; }

  function readAppointments() {
    try { return JSON.parse(localStorage.getItem(APPOINTMENTS_KEY) || "[]"); }
    catch (_) { return []; }
  }
  function writeAppointments(list) {
    try { localStorage.setItem(APPOINTMENTS_KEY, JSON.stringify(list)); } catch (_) { /* storage unavailable */ }
  }

  function isClosedDay(date) { return date.getDay() === 0; } // Sunday
  function isPastDay(date) {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return date < t;
  }

  function bookedTimesFor(dateStr) {
    return new Set(
      readAppointments()
        .filter((a) => a.date === dateStr && a.status !== "cancelled")
        .map((a) => a.time)
    );
  }

  function slotsFor(dateStr) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    if (isClosedDay(date) || isPastDay(date)) return [];
    const booked = bookedTimesFor(dateStr);
    const isToday = dateStr === todayISO();
    const now = new Date();
    const nowMins = now.getHours() * 60 + now.getMinutes();
    const slots = [];
    for (let mins = OPEN_HOUR * 60; mins + SLOT_MINUTES <= CLOSE_HOUR * 60; mins += SLOT_MINUTES) {
      const value = minutesToValue(mins);
      if (booked.has(value)) continue;
      if (isToday && mins <= nowMins) continue;
      slots.push(value);
    }
    return slots;
  }

  function renderCalendar() {
    const label = $("bookingMonthLabel");
    const grid = $("bookingCalendarGrid");
    if (!label || !grid) return;
    label.textContent = `${MONTH_NAMES[viewMonth.getMonth()]} ${viewMonth.getFullYear()}`;

    const firstWeekday = viewMonth.getDay();
    const daysInMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0).getDate();
    const today = todayISO();

    let html = "";
    for (let i = 0; i < firstWeekday; i++) html += `<span class="booking-day is-empty"></span>`;
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), day);
      const dateStr = toISODate(date);
      const disabled = isClosedDay(date) || isPastDay(date);
      const classes = ["booking-day"];
      if (dateStr === today) classes.push("is-today");
      if (dateStr === selectedDate) classes.push("is-selected");
      html += `<button type="button" class="${classes.join(" ")}" data-date="${dateStr}" ${disabled ? "disabled" : ""}>${day}</button>`;
    }
    grid.innerHTML = html;

    grid.querySelectorAll(".booking-day:not(.is-empty):not(:disabled)").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedDate = btn.dataset.date;
        selectedTime = null;
        renderCalendar();
        renderSlots();
      });
    });

    const prevBtn = $("bookingPrevMonth");
    if (prevBtn) prevBtn.disabled = viewMonth <= startOfMonth(new Date());
  }

  // What's already on the books for a day, oldest first — shown read-only
  // so staff can see the day's load at a glance.
  function bookedAppointmentsFor(dateStr) {
    return readAppointments()
      .filter((a) => a.date === dateStr && a.status !== "cancelled")
      .sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));
  }

  function bookedAppointmentRowHtml(item) {
    return `<div class="booking-existing-row">
      <span class="booking-existing-time">${esc(minutesToLabel(timeToMinutes(item.time)))}</span>
      <span class="booking-existing-details">${esc(item.client)}${item.item ? " · " + esc(item.item) : ""}${item.technician ? " · " + esc(item.technician) : ""}</span>
    </div>`;
  }

  function renderSlots() {
    const label = $("bookingSlotsLabel");
    const list = $("bookingSlotsList");
    if (!label || !list) return;
    if (!selectedDate) {
      label.textContent = "Pick a day to see times";
      list.innerHTML = "";
      return;
    }
    const [y, m, d] = selectedDate.split("-").map(Number);
    const dateLabel = new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
    label.textContent = dateLabel;

    // Who's coming in that day — shown for every selected date, not just
    // fully-booked ones, so staff can see the day's schedule at a glance.
    const existing = bookedAppointmentsFor(selectedDate);
    let html = existing.length
      ? `<div class="booking-existing-list">
          <p class="booking-existing-heading">Scheduled that day</p>
          ${existing.map(bookedAppointmentRowHtml).join("")}
        </div>`
      : "";

    const slots = slotsFor(selectedDate);
    html += slots.length
      ? slots.map((value) => `<button type="button" class="booking-slot-btn ${value === selectedTime ? "is-selected" : ""}" data-time="${value}">${minutesToLabel(timeToMinutes(value))}</button>`).join("")
      : `<p class="booking-slots-empty">No open times this day.</p>`;
    list.innerHTML = html;
    list.querySelectorAll(".booking-slot-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedTime = btn.dataset.time;
        renderSlots();
        if (selectedDate && selectedTime) setTimeout(() => setStep(2), 250);
      });
    });
  }

  function timeToMinutes(value) {
    const [h, m] = value.split(":").map(Number);
    return h * 60 + m;
  }

  // ---------- step wizard ----------

  function setStep(n) {
    currentStep = n;
    document.querySelectorAll(".form-step[data-appt-step]").forEach((section) => {
      section.hidden = Number(section.dataset.apptStep) !== n;
    });
    document.querySelectorAll(".form-progress-step[data-appt-progress-step]").forEach((chip) => {
      const stepNum = Number(chip.dataset.apptProgressStep);
      chip.classList.toggle("active", stepNum === n);
      chip.classList.toggle("complete", stepNum < n);
    });
    document.querySelectorAll(".form-progress-line").forEach((line, idx) => {
      line.classList.toggle("complete", idx + 1 < n);
    });

    const isComplete = n === 4;
    const prevBtn = $("apptPrevStep");
    const nextBtn = $("apptNextStep");
    const confirmBtn = $("apptConfirmBtn");
    const createAnotherBtn = $("apptCreateAnother");
    const goToViewBtn = $("apptGoToView");
    if (prevBtn) prevBtn.hidden = n === 1 || isComplete;
    if (nextBtn) nextBtn.hidden = n !== 2;
    if (confirmBtn) confirmBtn.hidden = n !== 3;
    if (createAnotherBtn) createAnotherBtn.hidden = !isComplete;
    if (goToViewBtn) goToViewBtn.hidden = !isComplete;

    if (n === 3) renderSummary();
  }

  function renderSummary() {
    const summary = $("bookingSelectedSummary");
    if (!summary || !selectedDate || !selectedTime) return;
    const [y, m, d] = selectedDate.split("-").map(Number);
    const dateLabel = new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
    const item = ($("appointmentItem")?.value || "").trim();
    const techLabel = selectedTechnician || "Any staff";
    summary.textContent = `${dateLabel} at ${minutesToLabel(timeToMinutes(selectedTime))} · ${item || "Item"} · ${techLabel}`;
  }

  function resetSelection() {
    selectedDate = null;
    selectedTime = null;
    selectedTechnician = "";
    const form = $("appointmentForm");
    if (form) form.reset();
    const itemInput = $("appointmentItem");
    if (itemInput) itemInput.value = "";
    const step2Msg = $("apptStep2Message");
    if (step2Msg) step2Msg.hidden = true;
    renderTechnicianPicker();
    renderCalendar();
    renderSlots();
    setStep(1);
  }

  // ---------- staff (Fresha-style chip picker) ----------

  async function fetchTechnicians() {
    try {
      const pin = localStorage.getItem(LS_PIN) || "";
      const res = await fetch(SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "listTechnicians", pin }),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Rejected");
      const names = (data.technicians || []).map((t) => (typeof t === "string" ? t : t.name)).filter(Boolean);
      technicians = names.length ? names : DEFAULT_TECHNICIANS.slice();
    } catch (_) {
      technicians = DEFAULT_TECHNICIANS.slice();
    }
    renderTechnicianPicker();
  }

  function initials(name) {
    const parts = String(name).trim().split(/\s+/);
    return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || "?";
  }

  function renderTechnicianPicker() {
    const wrap = $("technicianPicker");
    if (!wrap) return;
    const chips = [{ name: "Any staff", value: "" }].concat(
      technicians.map((name) => ({ name, value: name }))
    );
    wrap.innerHTML = chips.map((chip) => `
      <button type="button" class="technician-chip ${chip.value === selectedTechnician ? "is-selected" : ""}" data-technician="${esc(chip.value)}">
        <span class="technician-chip-avatar">${chip.value ? esc(initials(chip.name)) : "<svg class=\"icon\"><use href=\"#i-user\"></use></svg>"}</span>
        <span class="technician-chip-name">${esc(chip.name)}</span>
      </button>
    `).join("");
    wrap.querySelectorAll(".technician-chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedTechnician = btn.dataset.technician || "";
        renderTechnicianPicker();
      });
    });
  }

  // ---------- item combobox (Shopify catalog snapshot) ----------

  function setupItemCombobox({ comboboxId, inputId, dropdownId, toggleId, onChoose }) {
    const combobox = $(comboboxId);
    const input = $(inputId);
    const dropdown = $(dropdownId);
    const toggle = $(toggleId);
    if (!combobox || !input || !dropdown) return null;

    function itemOptions(showAll) {
      const names = window.RPC_MODEL_NAMES || [];
      const query = showAll ? "" : input.value.trim().toLowerCase();
      return query ? names.filter((name) => name.toLowerCase().includes(query)) : names;
    }

    function render(showAll) {
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
      render(showAll);
      dropdown.hidden = false;
      input.setAttribute("aria-expanded", "true");
      combobox.classList.add("open");
    }

    function close() {
      dropdown.hidden = true;
      input.setAttribute("aria-expanded", "false");
      combobox.classList.remove("open");
    }

    function choose(name) {
      input.value = name;
      close();
      if (onChoose) onChoose(name);
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
        if (onChoose) onChoose(input.value.trim());
      }
    });
    dropdown.addEventListener("keydown", (e) => {
      const options = [...dropdown.querySelectorAll(".device-option")];
      const i = options.indexOf(document.activeElement);
      if (e.key === "ArrowDown") {
        e.preventDefault();
        (options[i + 1] || options[0])?.focus();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        (options[i - 1] || options[options.length - 1])?.focus();
      } else if (e.key === "Escape") {
        close();
        input.focus();
      }
    });
    toggle?.addEventListener("click", () => {
      if (dropdown.hidden) open(true);
      else close();
      input.focus();
    });
    document.addEventListener("click", (e) => {
      if (combobox.contains(e.target)) return;
      close();
    });

    return close;
  }

  // ---------- appointment list ----------

  function appointmentRowHtml(item) {
    return `
      <article class="booking-row ${item.status === "completed" ? "is-completed" : ""}">
        <div class="booking-row-main">
          <strong>${esc(item.client)}</strong>
          <p>${esc(item.item)}${item.technician ? " · Assigned to " + esc(item.technician) : ""}</p>
          <small>${esc(formatDateTime(item.date, item.time))}${item.phone ? " · " + esc(item.phone) : ""}</small>
        </div>
        <div class="booking-row-actions">
          <button type="button" data-complete="${esc(item.id)}">${item.status === "completed" ? "Reopen" : "Done"}</button>
          <button type="button" class="danger-text" data-delete="${esc(item.id)}">Delete</button>
        </div>
      </article>
    `;
  }

  function bindRowActions(list) {
    list.querySelectorAll("[data-complete]").forEach((btn) => {
      btn.addEventListener("click", () => {
        writeAppointments(readAppointments().map((item) =>
          item.id === btn.dataset.complete
            ? Object.assign({}, item, { status: item.status === "completed" ? "scheduled" : "completed" })
            : item
        ));
        renderList();
      });
    });
    list.querySelectorAll("[data-delete]").forEach((btn) => {
      btn.addEventListener("click", () => {
        writeAppointments(readAppointments().filter((item) => item.id !== btn.dataset.delete));
        renderList();
        renderSlots();
      });
    });
  }

  function renderList() {
    const list = $("appointmentList");
    if (!list) return;
    const appointments = readAppointments().sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
    list.innerHTML = appointments.length
      ? appointments.map(appointmentRowHtml).join("")
      : `<p class="booking-empty">No appointments scheduled yet.</p>`;
    bindRowActions(list);
  }

  function formatDateTime(dateStr, timeStr) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const dateLabel = new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return `${dateLabel} at ${minutesToLabel(timeToMinutes(timeStr))}`;
  }

  function setPanel(panel) {
    document.querySelectorAll(".appt-panel[data-appt-panel-section]").forEach((section) => {
      section.hidden = section.dataset.apptPanelSection !== panel;
    });
    document.querySelectorAll(".appt-subnav-btn[data-appt-panel]").forEach((btn) => {
      const active = btn.dataset.apptPanel === panel;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    });
  }

  function bindOnce() {
    if (bound) return;
    bound = true;

    document.querySelectorAll(".appt-subnav-btn[data-appt-panel]").forEach((btn) => {
      btn.addEventListener("click", () => setPanel(btn.dataset.apptPanel));
    });

    $("bookingPrevMonth")?.addEventListener("click", () => {
      const prev = new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1);
      if (prev >= startOfMonth(new Date())) {
        viewMonth = prev;
        renderCalendar();
      }
    });
    $("bookingNextMonth")?.addEventListener("click", () => {
      viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1);
      renderCalendar();
    });
    closeAppointmentItemDropdown = setupItemCombobox({
      comboboxId: "appointmentItemCombobox",
      inputId: "appointmentItem",
      dropdownId: "appointmentItemDropdown",
      toggleId: "openApptItemDropdown",
    });

    $("apptPrevStep")?.addEventListener("click", () => {
      if (currentStep > 1) setStep(currentStep - 1);
    });
    $("apptNextStep")?.addEventListener("click", () => {
      closeAppointmentItemDropdown?.();
      const msg = $("apptStep2Message");
      const item = ($("appointmentItem")?.value || "").trim();
      if (!item) {
        if (msg) { msg.textContent = "Add the item or order."; msg.hidden = false; }
        return;
      }
      if (msg) msg.hidden = true;
      setStep(3);
    });

    const form = $("appointmentForm");
    if (form) {
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const msg = $("appointmentMessage");
        const client = ($("appointmentClient")?.value || "").trim();
        const item = ($("appointmentItem")?.value || "").trim();
        if (!client || !item || !selectedDate || !selectedTime) {
          if (msg) { msg.textContent = "Add the client name and item."; msg.hidden = false; }
          return;
        }
        const appointment = {
          id: uid(),
          client,
          phone: ($("appointmentPhone")?.value || "").trim(),
          item,
          technician: selectedTechnician || "",
          date: selectedDate,
          time: selectedTime,
          notes: ($("appointmentNotes")?.value || "").trim(),
          status: "scheduled",
          created: new Date().toISOString(),
        };
        writeAppointments([appointment].concat(readAppointments()));
        if (msg) msg.hidden = true;
        renderList();
        const [y, m, d] = appointment.date.split("-").map(Number);
        const dateLabel = new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
        const successMsg = $("apptSuccessMessage");
        if (successMsg) {
          successMsg.textContent = `${client}'s appointment is booked for ${dateLabel} at ${minutesToLabel(timeToMinutes(appointment.time))}.`;
        }
        setStep(4);
      });
    }

    $("apptCreateAnother")?.addEventListener("click", () => resetSelection());
    $("apptGoToView")?.addEventListener("click", () => {
      resetSelection();
      setPanel("view");
    });
  }

  function init() {
    bindOnce();
    viewMonth = startOfMonth(new Date());
    // Nothing is selected until staff actually click a day — the slots
    // panel (and that day's scheduled appointments) only appear then.
    selectedDate = null;
    selectedTime = null;
    renderCalendar();
    renderSlots();
    renderList();
    renderTechnicianPicker();
    fetchTechnicians();
    setStep(1);
    setPanel("create");
  }

  window.addEventListener("rpc-enter-appointments", init);
  // Appointments is the default landing view — shell.js's initial
  // navigateTo("appointments") call fires before this listener exists
  // (script load order), so self-initialize once here too.
  init();
})();
