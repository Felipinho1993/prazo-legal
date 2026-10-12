(() => {
  "use strict";

  const CONFIG = window.PRAZO_LEGAL_CONFIG || {};
  const API_ENABLED = CONFIG.mode === "api";
  const API_BASE = String(CONFIG.apiBaseUrl || "").replace(/\/$/, "");
  const RESET_TOKEN = new URLSearchParams(location.search).get("reset");
  if (RESET_TOKEN) {
    const cleanUrl = new URL(location.href);
    cleanUrl.searchParams.delete("reset");
    history.replaceState(null, "", `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
  }

  const TYPE_LABELS = { prazo: "Prazo", audiencia: "Audiência", reuniao: "Reunião" };
  const TYPE_COLORS = { prazo: "var(--danger)", audiencia: "var(--blue)", reuniao: "var(--purple)" };
  const PAGE_META = {
    dashboard: { eyebrow: "PAINEL", title: "Visão geral" },
    agenda: { eyebrow: "AGENDA", title: "Todos os compromissos", type: "all" },
    prazos: { eyebrow: "CONTROLE DE PRAZOS", title: "Prazos processuais", type: "prazo" },
    audiencias: { eyebrow: "AGENDA JURÍDICA", title: "Audiências", type: "audiencia" },
    reunioes: { eyebrow: "RELACIONAMENTO", title: "Reuniões", type: "reuniao" },
    relatorios: { eyebrow: "GESTÃO", title: "Relatórios" },
  };

  const state = {
    authMode: "login",
    currentPage: "dashboard",
    user: null,
    events: [],
    calendarDate: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    editingId: null,
    deletingId: null,
    customDate: null,
    loading: false,
    useRemote: API_ENABLED,
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const byId = (id) => document.getElementById(id);

  const els = {
    authView: byId("authView"), appView: byId("appView"), authForm: byId("authForm"),
    authName: byId("authName"), authEmail: byId("authEmail"), authPassword: byId("authPassword"),
    authSubmit: byId("authSubmit"), authAlert: byId("authAlert"), nameField: byId("nameField"),
    forgotPassword: byId("forgotPassword"), demoAccess: byId("demoAccess"),
    pageTitle: byId("pageTitle"), pageEyebrow: byId("pageEyebrow"),
    listTitle: byId("listTitle"), listEyebrow: byId("listEyebrow"),
    eventDialog: byId("eventDialog"), eventForm: byId("eventForm"),
    fullEventList: byId("fullEventList"), upcomingList: byId("upcomingList"),
    calendarGrid: byId("calendarGrid"), eventSearch: byId("eventSearch"),
    statusFilter: byId("statusFilter"), periodFilter: byId("periodFilter"),
    notificationDialog: byId("notificationDialog"), reminderList: byId("reminderList"),
    toastRegion: byId("toastRegion"), sidebar: byId("sidebar"), sidebarScrim: byId("sidebarScrim"),
  };

  function escapeHtml(value = "") {
    return String(value).replace(/[&<>'"]/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
    })[char]);
  }

  function dateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function fromDateKey(key, time = "00:00") {
    return new Date(`${key}T${time || "00:00"}:00`);
  }

  function shiftDate(days, origin = new Date()) {
    const next = new Date(origin.getFullYear(), origin.getMonth(), origin.getDate() + days);
    return dateKey(next);
  }

  function dayDifference(key, origin = new Date()) {
    const a = new Date(origin.getFullYear(), origin.getMonth(), origin.getDate(), 12);
    const d = fromDateKey(key, "12:00");
    return Math.round((d - a) / 86400000);
  }

  function formatDate(key, options = { day: "2-digit", month: "short" }) {
    if (!key) return "Sem data";
    return new Intl.DateTimeFormat("pt-BR", options).format(fromDateKey(key, "12:00"));
  }

  function formatLongDate(key) {
    return formatDate(key, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  }

  function capitalize(value) {
    return value ? value.charAt(0).toUpperCase() + value.slice(1) : "";
  }

  function initials(name = "Usuário") {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join("").toUpperCase();
  }

  function eventStatus(event) {
    if (event.status === "completed") return "completed";
    return event.date < dateKey() ? "overdue" : "pending";
  }

  function uid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"));
    return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
  }

  async function apiFetch(path, options = {}) {
    let response;
    try {
      response = await fetch(`${API_BASE}/api${path}`, {
        ...options,
        credentials: "include",
        headers: {
          ...(options.body ? { "Content-Type": "application/json" } : {}),
          ...(options.headers || {}),
        },
      });
    } catch {
      throw new Error("Não foi possível conectar ao servidor. Verifique se a API está ativa.");
    }
    const body = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(body?.error || "Não foi possível concluir a operação.");
      error.status = response.status;
      throw error;
    }
    return body;
  }

  function showToast(title, message = "", kind = "success") {
    const toast = document.createElement("div");
    toast.className = `toast${kind === "error" ? " is-error" : ""}`;
    toast.innerHTML = `<div><strong>${escapeHtml(title)}</strong>${message ? `<small>${escapeHtml(message)}</small>` : ""}</div>`;
    els.toastRegion.appendChild(toast);
    setTimeout(() => toast.remove(), 4200);
  }

  function setLoading(button, loading, label) {
    button.disabled = loading;
    const text = $("span", button) || button;
    if (!button.dataset.originalLabel) button.dataset.originalLabel = text.textContent;
    text.textContent = loading ? label : button.dataset.originalLabel;
  }

  function showAuthAlert(message, type = "error") {
    els.authAlert.textContent = message;
    els.authAlert.hidden = false;
    els.authAlert.style.borderColor = type === "success" ? "#b9d9d0" : "";
    els.authAlert.style.color = type === "success" ? "#1f5f56" : "";
    els.authAlert.style.background = type === "success" ? "#f0f8f5" : "";
  }

  function clearAuthAlert() {
    els.authAlert.hidden = true;
    els.authAlert.removeAttribute("style");
  }

  const demoAuth = {
    sessionKey: "prazoLegal_session_v1",
    getSession() {
      const stored = localStorage.getItem(this.sessionKey) || sessionStorage.getItem(this.sessionKey);
      return stored ? JSON.parse(stored) : null;
    },
    setSession(user, remember = true) {
      const storage = remember ? localStorage : sessionStorage;
      localStorage.removeItem(this.sessionKey);
      sessionStorage.removeItem(this.sessionKey);
      storage.setItem(this.sessionKey, JSON.stringify(user));
    },
    signIn(remember = true) {
      const user = { id: "demo-user", name: "Marina Alves", email: "advogado@demo.com" };
      this.setSession(user, remember);
      return user;
    },
    signOut() {
      localStorage.removeItem(this.sessionKey);
      sessionStorage.removeItem(this.sessionKey);
    },
  };

  async function getInitialUser() {
    if (CONFIG.allowDemoMode) {
      const demoUser = demoAuth.getSession();
      if (demoUser) return { user: demoUser, useRemote: false };
    }
    if (!API_ENABLED) return null;
    try {
      const data = await apiFetch("/auth/me");
      return { user: data.user, useRemote: true };
    } catch (error) {
      if (error.status === 401) return null;
      throw error;
    }
  }

  async function authenticate(mode, { name, email, password, remember }) {
    if (!API_ENABLED) throw new Error("A API ainda não foi configurada.");
    const data = await apiFetch(mode === "login" ? "/auth/login" : "/auth/signup", {
      method: "POST",
      body: JSON.stringify(mode === "login" ? { email, password, remember } : { name, email, password }),
    });
    return data.user;
  }

  function localEventsKey() {
    return `prazoLegal_events_v1_${state.user?.id || "anonymous"}`;
  }

  async function loadEvents() {
    if (state.useRemote) {
      const data = await apiFetch("/events");
      state.events = data.events || [];
      return;
    }
    const stored = localStorage.getItem(localEventsKey());
    state.events = stored ? JSON.parse(stored) : [];
    if (!stored && state.user.email === "advogado@demo.com") {
      state.events = createDemoEvents();
      saveLocalEvents();
    }
  }

  function saveLocalEvents() {
    localStorage.setItem(localEventsKey(), JSON.stringify(state.events));
  }

  function createDemoEvents() {
    const now = new Date().toISOString();
    return [
      { id: uid(), title: "Audiência de conciliação", type: "audiencia", date: shiftDate(0), time: "14:30", processNumber: "1008421-55.2026.8.26.0100", client: "Almeida & Souza", court: "2ª Vara Cível — sala 4", responsible: "Marina Alves", reminder: 60, notes: "Levar proposta de acordo atualizada.", status: "pending", priority: true, createdAt: now, updatedAt: now },
      { id: uid(), title: "Apresentar contestação", type: "prazo", date: shiftDate(1), time: "18:00", processNumber: "0029418-71.2026.5.02.0038", client: "Grupo Horizonte", court: "38ª Vara do Trabalho", responsible: "Ricardo Costa", reminder: 1440, notes: "Revisar documentos do contrato.", status: "pending", priority: true, createdAt: now, updatedAt: now },
      { id: uid(), title: "Reunião de alinhamento", type: "reuniao", date: shiftDate(3), time: "10:00", processNumber: "", client: "Fernanda Lima", court: "Google Meet", responsible: "Marina Alves", reminder: 30, notes: "Atualização mensal da carteira de processos.", status: "pending", priority: false, createdAt: now, updatedAt: now },
      { id: uid(), title: "Interpor recurso ordinário", type: "prazo", date: shiftDate(-1), time: "17:00", processNumber: "1001277-03.2025.5.15.0092", client: "Mercado São Bento", court: "TRT 15ª Região", responsible: "Ricardo Costa", reminder: 4320, notes: "Prazo urgente — verificar protocolo.", status: "pending", priority: true, createdAt: now, updatedAt: now },
      { id: uid(), title: "Audiência de instrução", type: "audiencia", date: shiftDate(7), time: "09:15", processNumber: "5012900-38.2026.4.03.6100", client: "Júlia Nascimento", court: "Fórum Federal — sala 12", responsible: "Marina Alves", reminder: 10080, notes: "Confirmar presença das testemunhas.", status: "pending", priority: false, createdAt: now, updatedAt: now },
      { id: uid(), title: "Enviar manifestação", type: "prazo", date: shiftDate(-5), time: "16:00", processNumber: "1019820-11.2025.8.26.0002", client: "Carlos Moreira", court: "5ª Vara Cível", responsible: "Marina Alves", reminder: 1440, notes: "", status: "completed", priority: false, createdAt: now, updatedAt: now },
    ];
  }

  async function upsertEvent(event) {
    if (state.useRemote) {
      const data = await apiFetch(`/events/${encodeURIComponent(event.id)}`, {
        method: "PUT",
        body: JSON.stringify(event),
      });
      return data.event;
    }
    const existingIndex = state.events.findIndex((item) => item.id === event.id);
    if (existingIndex >= 0) state.events[existingIndex] = event;
    else state.events.push(event);
    saveLocalEvents();
    return event;
  }

  async function removeEvent(id) {
    if (state.useRemote) {
      await apiFetch(`/events/${encodeURIComponent(id)}`, { method: "DELETE" });
    } else {
      state.events = state.events.filter((event) => event.id !== id);
      saveLocalEvents();
    }
  }

  function setAuthMode(mode) {
    state.authMode = mode;
    clearAuthAlert();
    $$("[data-auth-tab]").forEach((button) => {
      const active = button.dataset.authTab === mode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
    });
    els.nameField.hidden = mode !== "signup";
    els.authName.required = mode === "signup";
    els.forgotPassword.hidden = mode === "signup";
    byId("rememberField").hidden = mode === "signup";
    byId("authTitle").textContent = mode === "login" ? "Acesse seu escritório" : "Crie seu acesso";
    byId("authSubtitle").textContent = mode === "login"
      ? "Entre para acompanhar seus próximos compromissos."
      : "Comece a organizar sua rotina jurídica agora.";
    $("span", els.authSubmit).textContent = mode === "login" ? "Entrar na plataforma" : "Criar minha conta";
    els.authPassword.autocomplete = mode === "login" ? "current-password" : "new-password";
  }

  async function enterApp(user, useRemote = API_ENABLED) {
    state.user = user;
    state.useRemote = Boolean(useRemote && API_ENABLED);
    els.authView.hidden = true;
    els.appView.hidden = false;
    const firstName = user.name.split(/\s+/)[0] || "Usuário";
    byId("userName").textContent = user.name;
    byId("userEmail").textContent = user.email;
    byId("userInitials").textContent = initials(user.name);
    byId("workspaceInitials").textContent = initials(user.name);
    byId("workspaceName").textContent = CONFIG.workspaceName || `${firstName} Advocacia`;
    $("span", byId("welcomeMessage")).textContent = firstName;
    const syncStatus = byId("syncStatus");
    syncStatus.classList.toggle("is-online", state.useRemote);
    byId("syncStatusText").textContent = state.useRemote ? "Sincronizado" : "Modo local";
    try {
      await loadEvents();
      renderAll();
      navigate(location.hash.slice(1) || "dashboard", false);
      checkNotifications();
    } catch (error) {
      showToast("Erro ao carregar agenda", error.message, "error");
      if (state.useRemote) showToast("Servidor indisponível", "Confirme a conexão com o PostgreSQL.", "error");
    }
  }

  async function leaveApp() {
    if (state.useRemote) await apiFetch("/auth/logout", { method: "POST" }).catch(() => {});
    else demoAuth.signOut();
    state.user = null;
    state.events = [];
    els.appView.hidden = true;
    els.authView.hidden = false;
    els.authForm.reset();
    byId("rememberMe").checked = true;
    setAuthMode("login");
    history.replaceState(null, "", location.pathname);
  }

  function navigate(page, updateHash = true) {
    if (!PAGE_META[page]) page = "dashboard";
    state.currentPage = page;
    state.customDate = null;
    const meta = PAGE_META[page];
    els.pageTitle.textContent = meta.title;
    els.pageEyebrow.textContent = meta.eyebrow;
    $$(".nav-item").forEach((item) => item.classList.toggle("is-active", item.dataset.page === page));
    $$(".page").forEach((panel) => panel.classList.remove("is-active"));
    if (page === "dashboard") byId("dashboardPage").classList.add("is-active");
    else if (page === "relatorios") {
      byId("reportsPage").classList.add("is-active");
      renderReports();
    } else {
      byId("listPage").classList.add("is-active");
      els.listTitle.textContent = meta.title;
      els.listEyebrow.textContent = meta.eyebrow;
      renderFullList();
    }
    if (updateHash) history.pushState(null, "", `#${page}`);
    closeSidebar();
  }

  function renderAll() {
    renderHeader();
    renderStats();
    renderUpcoming();
    renderCalendar();
    renderFullList();
    renderReports();
    renderReminders();
  }

  function renderHeader() {
    const now = new Date();
    const hour = now.getHours();
    const greeting = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
    byId("welcomeMessage").childNodes[0].nodeValue = `${greeting}, `;
    byId("todayLabel").textContent = capitalize(new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "long" }).format(now));
    $$("[data-current-year]").forEach((item) => { item.textContent = String(now.getFullYear()); });
    byId("deadlineNavCount").textContent = String(state.events.filter((event) => event.type === "prazo" && eventStatus(event) !== "completed").length);
  }

  function renderStats() {
    const today = dateKey();
    const monthPrefix = today.slice(0, 7);
    const overdue = state.events.filter((event) => eventStatus(event) === "overdue").length;
    const dueToday = state.events.filter((event) => event.date === today && eventStatus(event) !== "completed").length;
    const week = state.events.filter((event) => {
      const diff = dayDifference(event.date);
      return diff >= 0 && diff <= 7 && eventStatus(event) !== "completed";
    }).length;
    const completed = state.events.filter((event) => event.status === "completed" && event.date.startsWith(monthPrefix)).length;
    byId("overdueCount").textContent = overdue;
    byId("todayCount").textContent = dueToday;
    byId("weekCount").textContent = week;
    byId("completedCount").textContent = completed;
    byId("overdueCaption").textContent = overdue ? `${overdue} ${overdue === 1 ? "item exige" : "itens exigem"} atenção` : "Nenhum item pendente";
    byId("todayCaption").textContent = dueToday ? "Confira sua agenda" : "Agenda tranquila";
    byId("dailySummary").textContent = overdue
      ? `Você tem ${overdue} ${overdue === 1 ? "compromisso atrasado" : "compromissos atrasados"} e ${dueToday} para hoje.`
      : dueToday ? `Você tem ${dueToday} ${dueToday === 1 ? "compromisso" : "compromissos"} para hoje.` : "Sua agenda está em dia. Veja o que vem a seguir.";
    byId("notificationDot").hidden = !(overdue || dueToday);
  }

  function sortEvents(events) {
    return [...events].sort((a, b) => {
      if (a.status === "completed" && b.status !== "completed") return 1;
      if (a.status !== "completed" && b.status === "completed") return -1;
      const byDate = fromDateKey(a.date, a.time || "23:59") - fromDateKey(b.date, b.time || "23:59");
      if (byDate !== 0) return byDate;
      return Number(b.priority) - Number(a.priority);
    });
  }

  function renderUpcoming() {
    const upcoming = sortEvents(state.events.filter((event) => eventStatus(event) !== "completed"))
      .filter((event) => dayDifference(event.date) >= -14)
      .slice(0, 5);
    els.upcomingList.innerHTML = upcoming.length
      ? upcoming.map((event) => eventRowTemplate(event, true)).join("")
      : emptyStateTemplate("Sua agenda está livre", "Cadastre um prazo, audiência ou reunião para começar.");
  }

  function eventRowTemplate(event, compact = false) {
    const date = fromDateKey(event.date, "12:00");
    const day = String(date.getDate()).padStart(2, "0");
    const month = new Intl.DateTimeFormat("pt-BR", { month: "short" }).format(date).replace(".", "").toUpperCase();
    const status = eventStatus(event);
    const process = event.processNumber ? `<span>${icon("file")} ${escapeHtml(event.processNumber)}</span>` : "";
    const client = event.client ? `<span>${icon("user")} ${escapeHtml(event.client)}</span>` : "";
    const place = event.court ? `<span>${icon("pin")} ${escapeHtml(event.court)}</span>` : "";
    const time = event.time ? `<span>${icon("clock")} ${escapeHtml(event.time)}</span>` : "";
    return `
      <article class="event-row event-row--${event.type} ${status === "completed" ? "is-complete" : ""}" data-event-id="${event.id}">
        <div class="event-date-badge"><strong>${day}</strong><span>${month}</span></div>
        <div class="event-main">
          <div class="event-tags"><span class="event-type">${TYPE_LABELS[event.type]}</span>${event.priority ? '<span class="event-priority">★ PRIORIDADE</span>' : ""}${status === "overdue" ? '<span class="event-priority">ATRASADO</span>' : ""}</div>
          <h4 title="${escapeHtml(event.title)}">${escapeHtml(event.title)}</h4>
          <div class="event-meta">${time}${process}${client}${place}</div>
        </div>
        <div class="event-actions">
          <button class="icon-button complete-button ${status === "completed" ? "is-complete" : ""}" type="button" data-action="complete" title="${status === "completed" ? "Reabrir" : "Concluir"}" aria-label="${status === "completed" ? "Reabrir" : "Concluir"}">${icon("check")}</button>
          <button class="icon-button edit-button" type="button" data-action="edit" title="Editar" aria-label="Editar">${icon("edit")}</button>
          <button class="icon-button delete-button" type="button" data-action="delete" title="Excluir" aria-label="Excluir">${icon("trash")}</button>
          ${compact ? "" : `<button class="icon-button calendar-button" type="button" data-action="calendar" title="Baixar evento" aria-label="Baixar evento">${icon("download")}</button>`}
        </div>
      </article>`;
  }

  function icon(name) {
    const icons = {
      check: '<svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg>',
      edit: '<svg viewBox="0 0 24 24"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4L16.5 3.5Z"/></svg>',
      trash: '<svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M19 6l-1 15H6L5 6M10 11v5M14 11v5"/></svg>',
      download: '<svg viewBox="0 0 24 24"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>',
      clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
      file: '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16h12V8l-6-6Z"/><path d="M14 2v6h6"/></svg>',
      user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
      pin: '<svg viewBox="0 0 24 24"><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2"/></svg>',
    };
    return icons[name] || "";
  }

  function emptyStateTemplate(title, copy) {
    return `<div class="empty-state"><svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18M8 15h8"/></svg><h4>${escapeHtml(title)}</h4><p>${escapeHtml(copy)}</p><button class="button button--outline" type="button" data-action="add">Novo compromisso</button></div>`;
  }

  function renderFullList() {
    if (["dashboard", "relatorios"].includes(state.currentPage)) return;
    const meta = PAGE_META[state.currentPage] || PAGE_META.agenda;
    const search = els.eventSearch.value.trim().toLowerCase();
    const status = els.statusFilter.value;
    const period = els.periodFilter.value;
    let filtered = state.events.filter((event) => meta.type === "all" || event.type === meta.type);
    if (search) {
      filtered = filtered.filter((event) => [event.title, event.processNumber, event.client, event.court, event.responsible]
        .some((value) => String(value || "").toLowerCase().includes(search)));
    }
    if (status !== "all") filtered = filtered.filter((event) => eventStatus(event) === status);
    if (state.customDate) filtered = filtered.filter((event) => event.date === state.customDate);
    else if (period !== "all") {
      filtered = filtered.filter((event) => {
        const diff = dayDifference(event.date);
        if (period === "today") return diff === 0;
        if (period === "week") return diff >= 0 && diff <= 7;
        if (period === "month") return event.date.startsWith(dateKey().slice(0, 7));
        return true;
      });
    }
    filtered = sortEvents(filtered);
    els.listTitle.textContent = state.customDate ? `Compromissos de ${formatDate(state.customDate, { day: "numeric", month: "long" })}` : meta.title;
    byId("resultCount").textContent = `${filtered.length} ${filtered.length === 1 ? "item" : "itens"}`;
    els.fullEventList.innerHTML = filtered.length
      ? filtered.map((event) => eventRowTemplate(event)).join("")
      : emptyStateTemplate("Nenhum compromisso encontrado", "Ajuste os filtros ou cadastre um novo item.");
  }

  function renderCalendar() {
    const view = state.calendarDate;
    byId("calendarMonth").textContent = capitalize(new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(view));
    const first = new Date(view.getFullYear(), view.getMonth(), 1);
    const start = new Date(view.getFullYear(), view.getMonth(), 1 - first.getDay());
    const days = [];
    for (let i = 0; i < 42; i += 1) {
      const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const key = dateKey(day);
      const hasEvents = state.events.some((event) => event.date === key && event.status !== "completed");
      const classes = ["calendar-day"];
      if (day.getMonth() !== view.getMonth()) classes.push("is-outside");
      if (key === dateKey()) classes.push("is-today");
      if (hasEvents) classes.push("has-events");
      days.push(`<button class="${classes.join(" ")}" type="button" data-calendar-date="${key}" aria-label="${formatLongDate(key)}${hasEvents ? ", com compromissos" : ""}">${day.getDate()}</button>`);
    }
    els.calendarGrid.innerHTML = days.join("");
  }

  function renderReports() {
    const counts = {
      prazo: state.events.filter((event) => event.type === "prazo").length,
      audiencia: state.events.filter((event) => event.type === "audiencia").length,
      reuniao: state.events.filter((event) => event.type === "reuniao").length,
    };
    const total = state.events.length;
    const deadlinePct = total ? (counts.prazo / total) * 100 : 0;
    const hearingPct = total ? deadlinePct + (counts.audiencia / total) * 100 : 0;
    byId("reportTotal").textContent = total;
    byId("donutTotal").textContent = total;
    byId("reportDonut").style.setProperty("--deadline-pct", `${deadlinePct}%`);
    byId("reportDonut").style.setProperty("--hearing-pct", `${hearingPct}%`);
    byId("donutLegend").innerHTML = Object.entries(counts).map(([type, count]) =>
      `<div class="legend-row"><i class="dot dot--${type === "prazo" ? "deadline" : type === "audiencia" ? "hearing" : "meeting"}"></i><span>${TYPE_LABELS[type]}</span><strong>${count}</strong></div>`
    ).join("");
    const month = dateKey().slice(0, 7);
    const monthEvents = state.events.filter((event) => event.date.startsWith(month));
    const completed = monthEvents.filter((event) => event.status === "completed").length;
    const completion = monthEvents.length ? Math.round((completed / monthEvents.length) * 100) : 0;
    const onTime = state.events.filter((event) => eventStatus(event) !== "overdue").length;
    const onTimePct = total ? Math.round((onTime / total) * 100) : 100;
    const priorities = state.events.filter((event) => event.priority && eventStatus(event) !== "completed").length;
    byId("progressGrid").innerHTML = [
      ["Conclusão no mês", `${completion}%`, completion],
      ["Agenda em dia", `${onTimePct}%`, onTimePct],
      ["Prioridades abertas", String(priorities), Math.min(100, priorities * 20)],
    ].map(([label, value, pct]) => `<div class="progress-item"><div class="progress-title"><span>${label}</span><strong>${value}</strong></div><div class="progress-track"><span style="width:${pct}%"></span></div></div>`).join("");
  }

  function renderReminders() {
    const upcoming = sortEvents(state.events.filter((event) => eventStatus(event) !== "completed" && dayDifference(event.date) >= -7 && dayDifference(event.date) <= 7)).slice(0, 6);
    els.reminderList.innerHTML = upcoming.length ? upcoming.map((event) => {
      const diff = dayDifference(event.date);
      const relative = diff < 0 ? `${Math.abs(diff)}d atrasado` : diff === 0 ? "Hoje" : diff === 1 ? "Amanhã" : `Em ${diff} dias`;
      return `<div class="reminder-item"><span style="background:${TYPE_COLORS[event.type]}"></span><div><strong>${escapeHtml(event.title)}</strong><small>${TYPE_LABELS[event.type]}${event.time ? ` • ${event.time}` : ""}</small></div><span>${relative}</span></div>`;
    }).join("") : '<div class="empty-state"><h4>Nenhum lembrete próximo</h4><p>Sua agenda dos próximos sete dias está livre.</p></div>';
    updateNotificationPermission();
  }

  function openEventDialog(id = null, presetType = null) {
    state.editingId = id;
    const event = id ? state.events.find((item) => item.id === id) : null;
    els.eventForm.reset();
    byId("eventId").value = event?.id || "";
    byId("modalEyebrow").textContent = event ? "EDITAR ITEM" : "NOVO ITEM";
    byId("modalTitle").textContent = event ? "Editar compromisso" : "Novo compromisso";
    byId("saveEventButton").querySelector("span").textContent = event ? "Salvar alterações" : "Salvar compromisso";
    const type = event?.type || presetType || (PAGE_META[state.currentPage]?.type !== "all" ? PAGE_META[state.currentPage]?.type : "prazo") || "prazo";
    const radio = $(`input[name="eventType"][value="${type}"]`);
    if (radio) radio.checked = true;
    byId("eventTitle").value = event?.title || "";
    byId("eventDate").value = event?.date || state.customDate || dateKey();
    byId("eventTime").value = event?.time || "";
    byId("eventProcess").value = event?.processNumber || "";
    byId("eventClient").value = event?.client || "";
    byId("eventCourt").value = event?.court || "";
    byId("eventResponsible").value = event?.responsible || state.user?.name || "";
    byId("eventReminder").value = String(event?.reminder ?? 1440);
    byId("eventPriority").checked = Boolean(event?.priority);
    byId("eventNotes").value = event?.notes || "";
    els.eventDialog.showModal();
    setTimeout(() => byId("eventTitle").focus(), 40);
  }

  async function saveEventFromForm() {
    if (!els.eventForm.reportValidity()) return;
    const existing = state.events.find((item) => item.id === state.editingId);
    const now = new Date().toISOString();
    const event = {
      id: existing?.id || uid(),
      title: byId("eventTitle").value.trim(),
      type: $("input[name='eventType']:checked").value,
      date: byId("eventDate").value,
      time: byId("eventTime").value,
      processNumber: byId("eventProcess").value.trim(),
      client: byId("eventClient").value.trim(),
      court: byId("eventCourt").value.trim(),
      responsible: byId("eventResponsible").value.trim(),
      reminder: Number(byId("eventReminder").value),
      priority: byId("eventPriority").checked,
      notes: byId("eventNotes").value.trim(),
      status: existing?.status || "pending",
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    const saveButton = byId("saveEventButton");
    setLoading(saveButton, true, "Salvando…");
    try {
      const saved = await upsertEvent(event);
      const index = state.events.findIndex((item) => item.id === saved.id);
      if (index >= 0) state.events[index] = saved; else state.events.push(saved);
      els.eventDialog.close();
      renderAll();
      showToast(existing ? "Compromisso atualizado" : "Compromisso criado", `${TYPE_LABELS[event.type]} salvo na agenda.`);
    } catch (error) {
      showToast("Não foi possível salvar", error.message, "error");
    } finally {
      setLoading(saveButton, false);
    }
  }

  async function toggleComplete(id) {
    const current = state.events.find((event) => event.id === id);
    if (!current) return;
    const updated = { ...current, status: current.status === "completed" ? "pending" : "completed", updatedAt: new Date().toISOString() };
    try {
      const saved = await upsertEvent(updated);
      state.events[state.events.findIndex((event) => event.id === id)] = saved;
      renderAll();
      showToast(saved.status === "completed" ? "Compromisso concluído" : "Compromisso reaberto");
    } catch (error) {
      showToast("Não foi possível atualizar", error.message, "error");
    }
  }

  async function confirmDelete() {
    if (!state.deletingId) return;
    const button = byId("confirmDelete");
    setLoading(button, true, "Excluindo…");
    try {
      await removeEvent(state.deletingId);
      state.events = state.events.filter((event) => event.id !== state.deletingId);
      byId("confirmDialog").close();
      state.deletingId = null;
      renderAll();
      showToast("Compromisso excluído");
    } catch (error) {
      showToast("Não foi possível excluir", error.message, "error");
    } finally {
      setLoading(button, false);
    }
  }

  function handleEventAction(event) {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    if (action === "add") return openEventDialog();
    const row = button.closest("[data-event-id]");
    const id = row?.dataset.eventId;
    if (action === "complete") toggleComplete(id);
    if (action === "edit") openEventDialog(id);
    if (action === "delete") {
      state.deletingId = id;
      byId("confirmDialog").showModal();
    }
    if (action === "calendar") downloadIcs([state.events.find((item) => item.id === id)]);
  }

  function toIcsDate(event) {
    const time = (event.time || "09:00").replace(":", "") + "00";
    return `${event.date.replaceAll("-", "")}T${time}`;
  }

  function icsEscape(value = "") {
    return String(value).replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
  }

  function downloadIcs(events) {
    const valid = events.filter(Boolean);
    if (!valid.length) return showToast("Nenhum item para exportar", "Ajuste os filtros e tente novamente.", "error");
    const now = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const entries = valid.map((event) => {
      const start = fromDateKey(event.date, event.time || "09:00");
      const end = new Date(start.getTime() + 60 * 60000);
      const endDate = `${dateKey(end).replaceAll("-", "")}T${String(end.getHours()).padStart(2, "0")}${String(end.getMinutes()).padStart(2, "0")}00`;
      const description = [TYPE_LABELS[event.type], event.processNumber && `Processo: ${event.processNumber}`, event.client && `Cliente: ${event.client}`, event.notes].filter(Boolean).join("\\n");
      return ["BEGIN:VEVENT", `UID:${event.id}@prazo-legal`, `DTSTAMP:${now}Z`, `DTSTART:${toIcsDate(event)}`, `DTEND:${endDate}`, `SUMMARY:${icsEscape(event.title)}`, `DESCRIPTION:${icsEscape(description)}`, event.court ? `LOCATION:${icsEscape(event.court)}` : "", "END:VEVENT"].filter(Boolean).join("\r\n");
    }).join("\r\n");
    downloadBlob(`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Prazo Legal//PT-BR\r\nCALSCALE:GREGORIAN\r\n${entries}\r\nEND:VCALENDAR`, "text/calendar;charset=utf-8", valid.length === 1 ? `${slugify(valid[0].title)}.ics` : "agenda-prazo-legal.ics");
    showToast("Calendário exportado", "Abra o arquivo .ics para adicionar os eventos à sua agenda.");
  }

  function csvValue(value) {
    return `"${String(value ?? "").replaceAll('"', '""')}"`;
  }

  function exportCsv() {
    const headers = ["Tipo", "Título", "Data", "Horário", "Status", "Processo", "Cliente", "Local/Vara", "Responsável", "Prioridade", "Observações"];
    const rows = sortEvents(state.events).map((event) => [TYPE_LABELS[event.type], event.title, event.date, event.time, eventStatus(event), event.processNumber, event.client, event.court, event.responsible, event.priority ? "Sim" : "Não", event.notes]);
    const csv = [headers, ...rows].map((row) => row.map(csvValue).join(";")).join("\r\n");
    downloadBlob(`\uFEFF${csv}`, "text/csv;charset=utf-8", `relatorio-prazo-legal-${dateKey()}.csv`);
    showToast("Relatório exportado", `${rows.length} ${rows.length === 1 ? "registro incluído" : "registros incluídos"}.`);
  }

  function backupJson() {
    const backup = { app: "Prazo Legal", version: 1, exportedAt: new Date().toISOString(), events: state.events };
    downloadBlob(JSON.stringify(backup, null, 2), "application/json", `backup-prazo-legal-${dateKey()}.json`);
    showToast("Backup criado", "Guarde o arquivo em um local seguro.");
  }

  async function importJson(file) {
    try {
      const parsed = JSON.parse(await file.text());
      const events = Array.isArray(parsed) ? parsed : parsed.events;
      if (!Array.isArray(events)) throw new Error("Formato de backup inválido.");
      let imported = 0;
      for (const item of events) {
        if (!item.title || !item.date || !TYPE_LABELS[item.type]) continue;
        const event = { ...item, id: uid(), status: item.status === "completed" ? "completed" : "pending", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        const saved = await upsertEvent(event);
      if (state.useRemote) state.events.push(saved);
        imported += 1;
      }
      if (!state.useRemote) state.events = JSON.parse(localStorage.getItem(localEventsKey()) || "[]");
      renderAll();
      showToast("Backup restaurado", `${imported} ${imported === 1 ? "item importado" : "itens importados"}.`);
    } catch (error) {
      showToast("Não foi possível importar", error.message, "error");
    }
  }

  function downloadBlob(content, type, filename) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  function slugify(value) {
    return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  }

  function updateNotificationPermission() {
    const area = byId("notificationPermission");
    const button = byId("enableNotifications");
    if (!("Notification" in window)) {
      area.querySelector("strong").textContent = "Notificações indisponíveis";
      area.querySelector("p").textContent = "Este navegador não oferece alertas do sistema.";
      button.hidden = true;
      return;
    }
    if (Notification.permission === "granted") {
      area.querySelector("strong").textContent = "Alertas ativados";
      area.querySelector("p").textContent = "O navegador pode avisar enquanto o site estiver aberto.";
      button.textContent = "Ativo";
      button.disabled = true;
    } else if (Notification.permission === "denied") {
      area.querySelector("strong").textContent = "Alertas bloqueados";
      area.querySelector("p").textContent = "Libere a permissão nas configurações do navegador.";
      button.hidden = true;
    }
  }

  async function enableNotifications() {
    if (!("Notification" in window)) return;
    const permission = await Notification.requestPermission();
    updateNotificationPermission();
    if (permission === "granted") {
      new Notification("Prazo Legal", { body: "Lembretes ativados com sucesso.", icon: "assets/favicon.svg" });
      showToast("Notificações ativadas");
    }
  }

  function checkNotifications() {
    renderReminders();
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const now = Date.now();
    state.events.filter((event) => event.status !== "completed").forEach((event) => {
      const scheduled = fromDateKey(event.date, event.time || "09:00").getTime() - Number(event.reminder || 0) * 60000;
      const notifiedKey = `prazoLegal_notified_${event.id}_${event.updatedAt}`;
      if (scheduled <= now && now - scheduled < 10 * 60000 && !localStorage.getItem(notifiedKey)) {
        new Notification(`${TYPE_LABELS[event.type]}: ${event.title}`, {
          body: `${formatDate(event.date, { day: "2-digit", month: "long" })}${event.time ? ` às ${event.time}` : ""}${event.client ? ` • ${event.client}` : ""}`,
          icon: "assets/favicon.svg", tag: event.id,
        });
        localStorage.setItem(notifiedKey, "1");
      }
    });
  }

  function openSidebar() {
    els.sidebar.classList.add("is-open");
    els.sidebarScrim.classList.add("is-open");
  }

  function closeSidebar() {
    els.sidebar.classList.remove("is-open");
    els.sidebarScrim.classList.remove("is-open");
  }

  function bindEvents() {
    $$("[data-auth-tab]").forEach((button) => button.addEventListener("click", () => setAuthMode(button.dataset.authTab)));
    byId("togglePassword").addEventListener("click", () => {
      const isPassword = els.authPassword.type === "password";
      els.authPassword.type = isPassword ? "text" : "password";
      byId("togglePassword").setAttribute("aria-label", isPassword ? "Ocultar senha" : "Mostrar senha");
    });
    els.authForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      clearAuthAlert();
      if (!els.authForm.reportValidity()) return;
      const payload = {
        name: els.authName.value, email: els.authEmail.value.trim().toLowerCase(),
        password: els.authPassword.value, remember: byId("rememberMe").checked,
      };
      setLoading(els.authSubmit, true, state.authMode === "login" ? "Entrando…" : "Criando…");
      try {
        const user = await authenticate(state.authMode, payload);
        await enterApp(user, true);
      } catch (error) {
        showAuthAlert(error.message);
      } finally {
        setLoading(els.authSubmit, false);
      }
    });
    byId("demoLogin").addEventListener("click", async () => {
      els.authEmail.value = "advogado@demo.com";
      els.authPassword.value = "123456";
      const user = demoAuth.signIn(true);
      await enterApp(user, false);
    });
    els.forgotPassword.addEventListener("click", async () => {
      const email = els.authEmail.value.trim();
      if (!email) return showAuthAlert("Informe seu e-mail para receber o link de recuperação.");
      try {
        const data = await apiFetch("/auth/request-password-reset", {
          method: "POST",
          body: JSON.stringify({ email }),
        });
        showAuthAlert(data.message, "success");
      } catch (error) {
        showAuthAlert(error.message);
      }
    });
    byId("resetPasswordForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const password = byId("newPassword").value;
      const confirmation = byId("confirmNewPassword").value;
      const alert = byId("resetPasswordAlert");
      alert.hidden = true;
      if (password !== confirmation) {
        alert.textContent = "As senhas não coincidem.";
        alert.hidden = false;
        return;
      }
      if (!RESET_TOKEN) return;
      const button = byId("resetPasswordSubmit");
      setLoading(button, true, "Atualizando…");
      try {
        const data = await apiFetch("/auth/reset-password", {
          method: "POST",
          body: JSON.stringify({ token: RESET_TOKEN, password }),
        });
        byId("resetPasswordDialog").close();
        setAuthMode("login");
        showAuthAlert(data.message, "success");
      } catch (error) {
        alert.textContent = error.message;
        alert.hidden = false;
      } finally {
        setLoading(button, false);
      }
    });
    byId("logoutButton").addEventListener("click", leaveApp);
    $$(".nav-item").forEach((item) => item.addEventListener("click", () => navigate(item.dataset.page)));
    $$('[data-go-page]').forEach((item) => item.addEventListener("click", () => navigate(item.dataset.goPage)));
    byId("addEventTop").addEventListener("click", () => openEventDialog());
    els.eventForm.addEventListener("submit", (event) => { event.preventDefault(); saveEventFromForm(); });
    [els.upcomingList, els.fullEventList].forEach((list) => list.addEventListener("click", handleEventAction));
    byId("confirmDelete").addEventListener("click", confirmDelete);
    $$('[data-close-dialog]').forEach((button) => button.addEventListener("click", () => byId(button.dataset.closeDialog).close()));
    [els.eventSearch, els.statusFilter, els.periodFilter].forEach((control) => control.addEventListener("input", () => {
      state.customDate = null;
      renderFullList();
    }));
    byId("prevMonth").addEventListener("click", () => {
      state.calendarDate = new Date(state.calendarDate.getFullYear(), state.calendarDate.getMonth() - 1, 1);
      renderCalendar();
    });
    byId("nextMonth").addEventListener("click", () => {
      state.calendarDate = new Date(state.calendarDate.getFullYear(), state.calendarDate.getMonth() + 1, 1);
      renderCalendar();
    });
    els.calendarGrid.addEventListener("click", (event) => {
      const day = event.target.closest("[data-calendar-date]");
      if (!day) return;
      navigate("agenda");
      state.customDate = day.dataset.calendarDate;
      renderFullList();
    });
    byId("exportCalendar").addEventListener("click", () => {
      const visibleIds = $$("[data-event-id]", els.fullEventList).map((row) => row.dataset.eventId);
      downloadIcs(visibleIds.map((id) => state.events.find((event) => event.id === id)));
    });
    byId("exportCsv").addEventListener("click", exportCsv);
    byId("backupJson").addEventListener("click", backupJson);
    byId("importJson").addEventListener("change", (event) => {
      if (event.target.files?.[0]) importJson(event.target.files[0]);
      event.target.value = "";
    });
    byId("notificationButton").addEventListener("click", () => { renderReminders(); els.notificationDialog.showModal(); });
    byId("enableNotifications").addEventListener("click", enableNotifications);
    byId("helpButton").addEventListener("click", () => byId("helpDialog").showModal());
    byId("openSidebar").addEventListener("click", openSidebar);
    byId("closeSidebar").addEventListener("click", closeSidebar);
    els.sidebarScrim.addEventListener("click", closeSidebar);
    window.addEventListener("popstate", () => state.user && navigate(location.hash.slice(1) || "dashboard", false));
  }

  async function init() {
    bindEvents();
    $$("[data-current-year]").forEach((item) => { item.textContent = String(new Date().getFullYear()); });
    els.demoAccess.hidden = CONFIG.allowDemoMode !== true;
    try {
      const identity = await getInitialUser();
      if (identity) await enterApp(identity.user, identity.useRemote);
    } catch (error) {
      showAuthAlert(`Não foi possível restaurar sua sessão: ${error.message}`);
    }
    if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
      navigator.serviceWorker.register("service-worker.js").catch(() => {});
    }
    if (RESET_TOKEN) {
      byId("resetPasswordDialog").showModal();
      setTimeout(() => byId("newPassword").focus(), 50);
    }
    setInterval(checkNotifications, 60000);
  }

  init();
})();
