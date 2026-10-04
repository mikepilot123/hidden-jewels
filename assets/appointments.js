/* ============================================================
   Appointments — a single-page booking form: pick a day + time on
   a month calendar, pick a staff member (Fresha-style chip picker,
   shared staff list), then add the client's details — all visible
   at once, no step navigation.
   Bookings sync through the shared Vercel/Postgres API (same team PIN
   as Leads) so every device sees the same schedule, refreshing every
   minute and whenever the app comes back to the foreground. A
   localStorage copy of the last server list keeps the page usable
   offline, and bookings made before syncing existed are uploaded once.
   Booked slots are excluded from the picker, and the server rejects a
   slot another device took in the meantime.
   ============================================================ */

(function () {
  // Pre-sync store (appointments used to live only on this device) — read
  // once for migration, then kept as a _backup key, never written again.
  const LEGACY_APPOINTMENTS_KEY = "rpc_hj_appointments";
  // Offline fallback: the last list the server returned.
  const CACHE_KEY = "rpc_hj_appointments_cache";
  const AUTO_REFRESH_MS = 60000;
  const OPEN_HOUR = 9; // 9:00 AM
  const CLOSE_HOUR = 17; // 5:00 PM
  const SLOT_MINUTES = 30;
  const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  const SCRIPT_URL = "https://hidden-jewels.vercel.app/api/leads";
  const LS_PIN = "rpc_hj_pin";
  const DEFAULT_TECHNICIANS = [];

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let viewMonth = startOfMonth(new Date());
  let selectedDate = null; // "YYYY-MM-DD"
  let selectedTime = null; // "HH:MM"
  let selectedTechnician = ""; // "" = Any staff
  let technicians = [];
  let bound = false;
  let editingAppointmentId = null; // set while editing an existing appointment
  let editingOriginal = null; // { date, time } the edited appointment started at
  let saving = false;
  let lastSyncedAt = 0;

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

  // In-memory list, refreshed from the server. Kept synchronous for the
  // many read call sites (slots, day lists, renders).
  let APPOINTMENTS = readCache();

  function readAppointments() {
    return APPOINTMENTS.slice();
  }
  function setAppointments(list) {
    APPOINTMENTS = Array.isArray(list) ? list : [];
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(APPOINTMENTS)); } catch (_) { /* storage unavailable */ }
  }
  function mergeAppointment(appointment) {
    if (!appointment || !appointment.id) return;
    const rest = APPOINTMENTS.filter((a) => a.id !== appointment.id);
    setAppointments(rest.concat(appointment));
  }
  function readCache() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "[]"); }
    catch (_) { return []; }
  }

  function getPin() {
    try { return localStorage.getItem(LS_PIN) || ""; }
    catch (_) { return ""; }
  }

  async function api(payload) {
    // text/plain avoids a CORS preflight, matching the rest of the app.
    const res = await fetch(SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(Object.assign({ pin: getPin() }, payload)),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Rejected");
    return data;
  }

  function setSyncStatus(state, text) {
    const dot = $("apptStatusDot");
    const label = $("apptUpdated");
    if (dot) {
      dot.classList.remove("live", "stale", "error");
      dot.classList.add(state);
    }
    if (label) label.textContent = text;
  }
  function syncedLabel() {
    return `Appointments synced ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  }

  let loadInFlight = null;
  function loadAppointments() {
    if (!getPin()) {
      setSyncStatus("stale", "Save the team PIN in Settings to sync appointments across devices.");
      return Promise.resolve();
    }
    if (loadInFlight) return loadInFlight;
    loadInFlight = (async () => {
      try {
        const data = await api({ action: "listAppointments" });
        setAppointments(data.appointments || []);
        await migrateLegacyAppointments();
        lastSyncedAt = Date.now();
        setSyncStatus("live", syncedLabel());
        renderList();
        renderSlots();
      } catch (err) {
        setSyncStatus("error", "Couldn't sync appointments (" + err.message + ") — showing this device's last saved copy.");
      } finally {
        loadInFlight = null;
      }
    })();
    return loadInFlight;
  }

  // One-time upload of bookings made before appointments synced through the
  // server. The original ids are kept (the server ignores ids it already
  // has), so re-running after a partial failure can't duplicate.
  async function migrateLegacyAppointments() {
    let raw = "";
    try { raw = localStorage.getItem(LEGACY_APPOINTMENTS_KEY) || ""; } catch (_) { return; }
    if (!raw) return;
    let legacy = [];
    try { legacy = JSON.parse(raw) || []; } catch (_) { legacy = []; }
    const known = new Set(APPOINTMENTS.map((a) => a.id));
    let uploaded = 0;
    for (const item of legacy) {
      if (!item || !item.id || known.has(item.id) || !item.date || !item.time || !item.client) continue;
      await api(Object.assign({ action: "addAppointment", legacy: true }, item));
      uploaded++;
    }
    if (uploaded) {
      const data = await api({ action: "listAppointments" });
      setAppointments(data.appointments || []);
    }
    try {
      localStorage.setItem(LEGACY_APPOINTMENTS_KEY + "_backup", raw);
      localStorage.removeItem(LEGACY_APPOINTMENTS_KEY);
    } catch (_) { /* storage unavailable */ }
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
        .filter((a) => a.date === dateStr && a.status !== "cancelled" && a.id !== editingAppointmentId)
        .map((a) => a.time)
    );
  }

  function slotsFor(dateStr) {
    // While editing, the appointment's current time always stays pickable —
    // even if it's already passed — so notes or staff can be changed
    // without being forced to reschedule.
    const keep = editingOriginal && editingOriginal.date === dateStr ? editingOriginal.time : null;
    const slots = openSlotsFor(dateStr);
    if (keep && !slots.includes(keep)) slots.push(keep);
    return slots.sort((a, b) => timeToMinutes(a) - timeToMinutes(b));
  }

  function openSlotsFor(dateStr) {
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
      .filter((a) => a.date === dateStr && a.status !== "cancelled" && a.id !== editingAppointmentId)
      .sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));
  }

  function bookedAppointmentRowHtml(item) {
    return `<div class="booking-existing-row">
      <span class="booking-existing-time">${esc(minutesToLabel(timeToMinutes(item.time)))}</span>
      <span class="booking-existing-details">${esc(item.client)}${item.technician ? " · " + esc(item.technician) : ""}</span>
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
    // A background sync can reveal that another device took the time picked
    // here — drop it rather than letting the booking fail on submit.
    if (selectedTime && !slots.includes(selectedTime)) selectedTime = null;
    html += slots.length
      ? slots.map((value) => `<button type="button" class="booking-slot-btn ${value === selectedTime ? "is-selected" : ""}" data-time="${value}">${minutesToLabel(timeToMinutes(value))}</button>`).join("")
      : `<p class="booking-slots-empty">No open times this day.</p>`;
    list.innerHTML = html;
    list.querySelectorAll(".booking-slot-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedTime = btn.dataset.time;
        renderSlots();
        // Everything's on one page now — once a time is picked, carry the
        // client down to the next thing they need to fill in.
        document.getElementById("apptStaffSection")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  }

  function timeToMinutes(value) {
    const [h, m] = value.split(":").map(Number);
    return h * 60 + m;
  }

  // ---------- single-page form / success toggle ----------

  // The booking form (When + Staff + Details) is one continuous page,
  // not a multi-step wizard — this just swaps the whole form out for the
  // confirmation view and back, and updates the submit button's label.
  function setFormVisible(showForm) {
    const form = $("appointmentForm");
    const success = document.querySelector('.form-step[data-appt-step="4"]');
    if (form) form.hidden = !showForm;
    if (success) success.hidden = showForm;
    const confirmBtn = $("apptConfirmBtn");
    const createAnotherBtn = $("apptCreateAnother");
    const goToViewBtn = $("apptGoToView");
    if (confirmBtn) {
      confirmBtn.hidden = !showForm;
      confirmBtn.disabled = saving;
      confirmBtn.textContent = saving ? "Saving…" : editingAppointmentId ? "Save changes" : "Book appointment";
    }
    const cancelEditBtn = $("apptCancelEdit");
    if (cancelEditBtn) cancelEditBtn.hidden = !showForm || !editingAppointmentId;
    const editBanner = $("apptEditBanner");
    if (editBanner) {
      const editing = editingAppointmentId && APPOINTMENTS.find((a) => a.id === editingAppointmentId);
      editBanner.hidden = !showForm || !editing;
      if (editing) editBanner.textContent = `Editing ${editing.client}'s appointment (${formatDateTime(editing.date, editing.time)}). Save changes to update it, or cancel to book a new one instead.`;
    }
    if (createAnotherBtn) createAnotherBtn.hidden = showForm;
    if (goToViewBtn) goToViewBtn.hidden = showForm;
  }

  function resetSelection() {
    selectedDate = null;
    selectedTime = null;
    selectedTechnician = "";
    editingAppointmentId = null;
    editingOriginal = null;
    const form = $("appointmentForm");
    if (form) form.reset();
    const msg = $("appointmentMessage");
    if (msg) msg.hidden = true;
    renderTechnicianPicker();
    renderCalendar();
    renderSlots();
    setFormVisible(true);
  }

  // ---------- staff (Fresha-style chip picker) ----------

  async function fetchTechnicians() {
    try {
      const data = await api({ action: "listTechnicians" });
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

  // ---------- appointment list ----------

  function appointmentRowHtml(item) {
    return `
      <article class="booking-row ${item.status === "completed" ? "is-completed" : ""} ${item.id === editingAppointmentId ? "is-editing" : ""}">
        <div class="booking-row-main">
          <strong>${esc(item.client)}</strong>
          <p>${item.technician ? "Assigned to " + esc(item.technician) : "Any staff"}</p>
          <small>${esc(formatDateTime(item.date, item.time))}${item.phone ? " · " + esc(item.phone) : ""}</small>
        </div>
        <div class="booking-row-actions">
          <button type="button" data-edit="${esc(item.id)}">Edit</button>
          <button type="button" data-complete="${esc(item.id)}">${item.status === "completed" ? "Reopen" : "Done"}</button>
          <button type="button" class="danger-text" data-delete="${esc(item.id)}">Delete</button>
        </div>
      </article>
    `;
  }

  function bindRowActions(list) {
    list.querySelectorAll("[data-edit]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const appointment = readAppointments().find((item) => item.id === btn.dataset.edit);
        if (appointment) editAppointment(appointment);
      });
    });
    list.querySelectorAll("[data-complete]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const item = APPOINTMENTS.find((a) => a.id === btn.dataset.complete);
        if (!item) return;
        btn.disabled = true;
        try {
          const data = await api({ action: "updateAppointment", id: item.id, status: item.status === "completed" ? "scheduled" : "completed" });
          mergeAppointment(data.appointment);
          setSyncStatus("live", syncedLabel());
        } catch (err) {
          setSyncStatus("error", "Couldn't update appointment: " + err.message);
        }
        renderList();
        renderSlots();
      });
    });
    list.querySelectorAll("[data-delete]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const item = APPOINTMENTS.find((a) => a.id === btn.dataset.delete);
        if (!item || !window.confirm(`Delete ${item.client}'s appointment on ${formatDateTime(item.date, item.time)}?`)) return;
        btn.disabled = true;
        try {
          await api({ action: "deleteAppointment", id: item.id });
          setAppointments(APPOINTMENTS.filter((a) => a.id !== item.id));
          if (editingAppointmentId === item.id) resetSelection();
          setSyncStatus("live", syncedLabel());
        } catch (err) {
          setSyncStatus("error", "Couldn't delete appointment: " + err.message);
        }
        renderList();
        renderSlots();
      });
    });
  }

  // Loads an existing appointment into the form for editing. Date/time
  // stay changeable (its own slot is excluded from "booked" while editing —
  // see bookedTimesFor/bookedAppointmentsFor). Everything is on one page,
  // so this just fills in the fields in place.
  function editAppointment(appointment) {
    editingAppointmentId = appointment.id;
    editingOriginal = { date: appointment.date, time: appointment.time };
    // Form first: setPanel("create") resets a hidden (post-booking) form,
    // which would otherwise wipe the edit that's just been started.
    setFormVisible(true);
    setPanel("create");
    const [y, m, d] = appointment.date.split("-").map(Number);
    viewMonth = startOfMonth(new Date(y, m - 1, d));
    selectedDate = appointment.date;
    selectedTime = appointment.time;
    selectedTechnician = appointment.technician || "";
    renderCalendar();
    renderSlots();
    renderTechnicianPicker();
    const clientInput = $("appointmentClient");
    if (clientInput) clientInput.value = appointment.client || "";
    const phoneInput = $("appointmentPhone");
    if (phoneInput) phoneInput.value = appointment.phone || "";
    const notesInput = $("appointmentNotes");
    if (notesInput) notesInput.value = appointment.notes || "";
    const msg = $("appointmentMessage");
    if (msg) msg.hidden = true;
    $("appointmentForm")?.scrollIntoView({ block: "start" });
  }

  function renderList() {
    const list = $("appointmentList");
    if (!list) return;
    const today = todayISO();
    const byTime = (a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`);
    const all = readAppointments().filter((a) => a.status !== "cancelled");
    const upcoming = all.filter((a) => a.date >= today && a.status !== "completed").sort(byTime);
    const past = all.filter((a) => a.date < today || a.status === "completed").sort((a, b) => byTime(b, a));
    let html = upcoming.length
      ? upcoming.map(appointmentRowHtml).join("")
      : `<p class="booking-empty">No upcoming appointments.</p>`;
    if (past.length) {
      html += `<h3 class="booking-list-subtitle">Past &amp; completed</h3>` + past.map(appointmentRowHtml).join("");
    }
    list.innerHTML = html;
    bindRowActions(list);
  }

  function formatDateTime(dateStr, timeStr) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const dateLabel = new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return `${dateLabel} at ${minutesToLabel(timeToMinutes(timeStr))}`;
  }

  function setPanel(panel) {
    // Leaving the form mid-edit abandons the edit, and coming back to Create
    // after a booking starts a fresh form. Otherwise the next "new" booking
    // silently overwrote the appointment that had been opened for editing
    // (showing "Appointment updated" and making the original vanish), or the
    // old confirmation screen reappeared instead of an empty form.
    const form = $("appointmentForm");
    if (panel === "view" && editingAppointmentId) resetSelection();
    if (panel === "create" && form && form.hidden) resetSelection();
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
      btn.addEventListener("click", () => {
        setPanel(btn.dataset.apptPanel);
        if (btn.dataset.apptPanel === "view") loadAppointments();
      });
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
    const form = $("appointmentForm");
    if (form) {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (saving) return;
        const msg = $("appointmentMessage");
        const showMsg = (text) => { if (msg) { msg.textContent = text; msg.hidden = false; } };
        const client = ($("appointmentClient")?.value || "").trim();
        if (!selectedDate || !selectedTime) {
          showMsg("Pick a day and time.");
          return;
        }
        if (!client) {
          showMsg("Add the client's name.");
          return;
        }
        if (!getPin()) {
          showMsg("Save the team PIN in Settings before booking — appointments are shared with every device.");
          return;
        }
        const isEdit = !!editingAppointmentId;
        const payload = {
          action: isEdit ? "updateAppointment" : "addAppointment",
          client,
          phone: ($("appointmentPhone")?.value || "").trim(),
          technician: selectedTechnician || "",
          date: selectedDate,
          time: selectedTime,
          notes: ($("appointmentNotes")?.value || "").trim(),
        };
        if (isEdit) payload.id = editingAppointmentId;
        if (msg) msg.hidden = true;
        saving = true;
        setFormVisible(true);
        let appointment;
        try {
          const data = await api(payload);
          appointment = data.appointment;
          mergeAppointment(appointment);
          setSyncStatus("live", syncedLabel());
        } catch (err) {
          showMsg(`Couldn't ${isEdit ? "save changes" : "book the appointment"}: ${err.message}`);
          // A slot clash means our copy is stale — refresh so the picker
          // shows what's actually free.
          loadAppointments();
          return;
        } finally {
          saving = false;
          setFormVisible(true);
        }
        editingAppointmentId = null;
        editingOriginal = null;
        renderList();
        const [y, m, d] = appointment.date.split("-").map(Number);
        const dateLabel = new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
        const successLabel = $("apptSuccessLabel");
        const successTitle = $("apptSuccessTitle");
        const successMsg = $("apptSuccessMessage");
        if (successLabel) successLabel.textContent = isEdit ? "Changes saved" : "Booking complete";
        if (successTitle) successTitle.textContent = isEdit ? "Appointment updated" : "Appointment confirmed";
        if (successMsg) {
          successMsg.textContent = isEdit
            ? `${client}'s appointment is now ${dateLabel} at ${minutesToLabel(timeToMinutes(appointment.time))}.`
            : `${client}'s appointment is booked for ${dateLabel} at ${minutesToLabel(timeToMinutes(appointment.time))}.`;
        }
        setFormVisible(false);
        $("view-appointments")?.scrollIntoView({ block: "start" });
      });
    }

    $("apptCreateAnother")?.addEventListener("click", () => resetSelection());
    $("apptGoToView")?.addEventListener("click", () => {
      resetSelection();
      setPanel("view");
    });
    $("apptCancelEdit")?.addEventListener("click", () => resetSelection());
    $("apptRefresh")?.addEventListener("click", () => loadAppointments());

    // Keep every device in step: refresh once a minute while the app is
    // open and visible, and straight away when it comes back to the
    // foreground (e.g. a phone unlocked after someone booked on the iPad).
    setInterval(() => {
      if (!document.hidden) loadAppointments();
    }, AUTO_REFRESH_MS);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && Date.now() - lastSyncedAt > 15000) loadAppointments();
    });
    window.addEventListener("focus", () => {
      if (Date.now() - lastSyncedAt > 15000) loadAppointments();
    });
  }

  function init() {
    bindOnce();
    viewMonth = startOfMonth(new Date());
    // Nothing is selected until staff actually click a day — the slots
    // panel (and that day's scheduled appointments) only appear then.
    selectedDate = null;
    selectedTime = null;
    selectedTechnician = "";
    // Re-entering the Appointments tab always starts a fresh flow — an
    // in-progress edit left behind by navigating away is abandoned, not
    // silently resumed against whatever gets picked next.
    editingAppointmentId = null;
    editingOriginal = null;
    const form = $("appointmentForm");
    if (form) form.reset();
    const msg = $("appointmentMessage");
    if (msg) msg.hidden = true;
    renderCalendar();
    renderSlots();
    renderList();
    renderTechnicianPicker();
    fetchTechnicians();
    setFormVisible(true);
    setPanel("create");
    loadAppointments();
  }

  window.addEventListener("rpc-enter-appointments", init);
  // Appointments is the default landing view — shell.js's initial
  // navigateTo("appointments") call fires before this listener exists
  // (script load order), so self-initialize once here too.
  init();
})();
