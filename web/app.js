"use strict";

// ====== Configuração ======
const REPO = "flavioronchi/Milhas-";
const CONFIG_EDIT_URL = `https://github.com/${REPO}/edit/main/config/config.json`;
const PROGRAMS = {
  smiles: { label: "Smiles", color: "var(--smiles)" },
  latam: { label: "LATAM Pass", color: "var(--latam)" },
  azul: { label: "Azul", color: "var(--azul)" },
};
const CABINS = { economy: "Econômica", premium: "Premium", business: "Executiva", first: "Primeira" };
const PAGE = 30;

// ====== Estado ======
const state = {
  data: null,
  tab: "best",
  route: "all",
  cabin: "all",
  programs: new Set(Object.keys(PROGRAMS)),
  limit: PAGE,
  calRoute: null,
  calCabin: null,
  calDay: null,
  milheiro: {},
};

// localStorage é só conveniência: tudo funciona sem ele.
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
};

// ====== Utilidades ======
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const brl = (v) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const num = (v) => v.toLocaleString("pt-BR");
const kfmt = (v) => (v >= 1000 ? (v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: v >= 10000 ? 0 : 1 }) + "k" : String(Math.round(v)));
const parseDate = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };
const fmtDate = (iso) => parseDate(iso).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "short" });
const fmtDur = (m) => (m == null ? "" : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`);
const routeOf = (id) => state.data.routes.find((r) => r.id === id);
const routeLabel = (r) => r.name || `${r.origins.join("/")} → ${r.destinations.join("/")}`;

function costOf(a) {
  const rate = state.milheiro[a.program] ?? state.data.milheiro_brl[a.program] ?? 0;
  return (a.miles / 1000) * rate + a.taxes_brl;
}

function filtered({ route = state.route, cabin = state.cabin } = {}) {
  return state.data.awards
    .filter((a) => (route === "all" || a.route_id === route) && (cabin === "all" || a.cabin === cabin) && state.programs.has(a.program))
    .map((a) => ({ ...a, cost: costOf(a) }))
    .sort((x, y) => x.cost - y.cost || x.date.localeCompare(y.date));
}

// Resgate "bom": entre os 10% mais baratos da mesma rota+cabine.
function hotThresholds() {
  const groups = {};
  for (const a of state.data.awards) (groups[`${a.route_id}|${a.cabin}`] ||= []).push(costOf(a));
  const t = {};
  for (const [k, arr] of Object.entries(groups)) { arr.sort((a, b) => a - b); t[k] = arr[Math.floor(arr.length * 0.1)] ?? 0; }
  return t;
}

// ====== Links de compra ======
// Abre a busca do programa já preenchida. Se um coletor real trouxer o link exato
// (a.booking_url), ele tem prioridade.
const pad2 = (n) => String(n).padStart(2, "0");
const BOOKING = {
  smiles(a, pax) {
    const [y, m, d] = a.date.split("-").map(Number);
    const q = new URLSearchParams({
      adults: pax, children: 0, infants: 0, cabin: "ALL", tripType: 2, segments: 1,
      departureDate: Date.UTC(y, m - 1, d, 12), returnDate: "", searchType: "g3",
      isFlexibleDateChecked: false, isElegible: false,
      originAirport: a.origin, destinationAirport: a.destination,
      originAirportIsAny: false, destinationAirportIsAny: false, "novo-resultado-voos": true,
    });
    return `https://www.smiles.com.br/mfe/emissao-passagem/?${q}`;
  },
  latam(a, pax) {
    const q = new URLSearchParams({
      origin: a.origin, destination: a.destination, outbound: `${a.date}T12:00:00.000Z`, inbound: "null",
      adt: pax, chd: 0, inf: 0, trip: "OW", cabin: a.cabin === "economy" ? "Economy" : "Business",
      redemption: true, sort: "RECOMMENDED",
    });
    return `https://www.latamairlines.com/br/pt/oferta-voos?${q}`;
  },
  azul(a, pax) {
    // Mesmo formato que o site da Azul gera (colchetes e barras sem codificar).
    const [y, m, d] = a.date.split("-");
    const o = encodeURIComponent(a.origin), de = encodeURIComponent(a.destination);
    return `https://www.voeazul.com.br/br/pt/home/selecao-voo?c[0].ds=${o}&c[0].std=${m}/${d}/${y}&c[0].as=${de}` +
      `&p[0].t=ADT&p[0].c=${Number(pax) || 1}&p[0].cp=false&f.dl=3&f.dr=3&cc=PTS`;
  },
};
function bookingUrl(a, pax) {
  if (a.booking_url) return a.booking_url;
  return BOOKING[a.program]?.(a, pax) ?? null;
}

// ====== Componentes ======
function awardCard(a, hot) {
  const r = routeOf(a.route_id);
  const pax = r?.passengers > 1 ? r.passengers : 1;
  const isHot = hot && a.cost <= hot[`${a.route_id}|${a.cabin}`];
  const stops = a.stops === 0 ? "direto" : `${a.stops} parada${a.stops > 1 ? "s" : ""}`;
  const url = bookingUrl(a, pax);
  const tag = url ? "a" : "article";
  const attrs = url ? ` href="${esc(url)}" target="_blank" rel="noopener noreferrer" aria-label="Abrir no site da ${esc(PROGRAMS[a.program]?.label ?? a.program)}: ${esc(a.origin)} para ${esc(a.destination)}, ${esc(fmtDate(a.date))}"` : "";
  return `
    <${tag} class="card"${attrs}>
      <div class="card-head">
        <div class="card-route">${esc(a.origin)} → ${esc(a.destination)}</div>
        <div class="card-cost">${brl(a.cost)}</div>
      </div>
      <div class="card-sub">
        <span><span class="badge ${esc(a.program)}">${esc(PROGRAMS[a.program]?.label ?? a.program)}</span>
          ${esc(CABINS[a.cabin] ?? a.cabin)} · ${esc(fmtDate(a.date))}</span>
        <span><span class="card-miles">${num(a.miles)} milhas</span> + ${brl(a.taxes_brl)}</span>
      </div>
      <div class="card-sub">
        <span>${esc(a.depart ?? "")}${a.arrive ? " → " + esc(a.arrive) : ""} · ${esc(fmtDur(a.duration_min))} · ${stops}${a.flights?.length ? " · " + esc(a.flights.join(" + ")) : ""}</span>
        <span>
          ${isHot ? '<span class="tag hot">ótimo preço</span>' : ""}
          ${a.seats != null ? `<span class="tag">${a.seats} assento${a.seats > 1 ? "s" : ""}</span>` : ""}
          ${pax > 1 ? `<span class="tag">${pax} pax: ${brl(a.cost * pax)}</span>` : ""}
        </span>
      </div>
      ${url ? `<div class="card-cta">Emitir na ${esc(PROGRAMS[a.program]?.label ?? a.program)} ↗</div>` : ""}
    </${tag}>`;
}

function routeSelect(id, value, withAll) {
  const opts = state.data.routes.map((r) => `<option value="${esc(r.id)}" ${r.id === value ? "selected" : ""}>${esc(routeLabel(r))}</option>`);
  if (withAll) opts.unshift(`<option value="all" ${value === "all" ? "selected" : ""}>Todas as rotas</option>`);
  return `<select id="${id}" class="select" aria-label="Rota">${opts.join("")}</select>`;
}

function cabinSeg(id, value, cabins, withAll) {
  const items = (withAll ? ["all"] : []).concat(cabins);
  return `<div class="seg" id="${id}">${items.map((c) => `<button data-v="${c}" class="${c === value ? "on" : ""}">${c === "all" ? "Todas" : esc(CABINS[c] ?? c)}</button>`).join("")}</div>`;
}

function programChips() {
  return `<div class="chips" id="programs">${Object.entries(PROGRAMS).map(([k, p]) =>
    `<button class="chip ${state.programs.has(k) ? "" : "off"}" data-p="${k}"><span class="dot" style="background:${p.color}"></span>${p.label}</button>`).join("")}</div>`;
}

const allCabins = () => [...new Set(state.data.routes.flatMap((r) => r.cabins))];

// ====== Telas ======
function viewBest() {
  const list = filtered();
  const hot = hotThresholds();
  const shown = list.slice(0, state.limit);
  return `
    <section class="filters">
      ${routeSelect("f-route", state.route, true)}
      ${cabinSeg("f-cabin", state.cabin, allCabins(), true)}
      ${programChips()}
    </section>
    <p class="muted small">${num(list.length)} resgates${isPartial() ? " (parcial)" : ""} · ordenados pelo custo em R$ (milhas × milheiro + taxas), por pessoa, só ida</p>
    <div class="list" style="margin-top:8px">
      ${shown.length ? shown.map((a) => awardCard(a, hot)).join("") : '<div class="empty">Nenhum resgate com esses filtros.</div>'}
    </div>
    ${list.length > shown.length ? `<button class="more" id="more">Mostrar mais (${num(list.length - shown.length)})</button>` : ""}`;
}

function viewCalendar() {
  const routes = state.data.routes;
  if (!routes.length) return '<div class="empty">Nenhuma rota configurada.</div>';
  state.calRoute = routeOf(state.calRoute) ? state.calRoute : routes[0].id;
  const r = routeOf(state.calRoute);
  if (!r.cabins.includes(state.calCabin)) state.calCabin = r.cabins[0];
  const awards = filtered({ route: r.id, cabin: state.calCabin });

  const best = {};
  for (const a of awards) if (!best[a.date] || a.cost < best[a.date].cost) best[a.date] = a;
  const costs = Object.values(best).map((a) => a.cost).sort((a, b) => a - b);
  const q = (p) => costs[Math.min(costs.length - 1, Math.floor(costs.length * p))];
  const cuts = costs.length ? [q(0.2), q(0.4), q(0.6), q(0.8)] : [];
  const heat = (c) => { let i = 0; while (i < cuts.length && c > cuts[i]) i++; return `h${i}`; };

  const months = [];
  const start = parseDate(r.date_from), end = parseDate(r.date_to);
  for (let d = new Date(start.getFullYear(), start.getMonth(), 1); d <= end; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    const y = d.getFullYear(), m = d.getMonth();
    const days = new Date(y, m + 1, 0).getDate();
    const pad = (new Date(y, m, 1).getDay() + 6) % 7; // semana começa na segunda
    let cells = "";
    for (let i = 0; i < pad; i++) cells += '<div class="cal-day pad"></div>';
    for (let day = 1; day <= days; day++) {
      const iso = `${y}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const cur = new Date(y, m, day);
      const a = best[iso];
      if (cur < start || cur > end || !a) {
        cells += `<div class="cal-day none"><span class="n">${day}</span><span class="v">–</span></div>`;
      } else {
        cells += `<button class="cal-day ${heat(a.cost)} ${state.calDay === iso ? "sel" : ""}" data-day="${iso}" aria-label="${esc(fmtDate(iso))}: ${brl(a.cost)}"><span class="n">${day}</span><span class="v">${kfmt(a.cost)}</span></button>`;
      }
    }
    const mname = d.toLocaleDateString("pt-BR", { month: "long" });
    const title = `${mname[0].toUpperCase()}${mname.slice(1)} ${y}`;
    months.push(`<div class="cal-month"><div class="cal-title">${esc(title)}</div><div class="cal-grid">
      ${["seg", "ter", "qua", "qui", "sex", "sáb", "dom"].map((w) => `<div class="cal-dow">${w}</div>`).join("")}${cells}</div></div>`);
  }

  const dayList = state.calDay ? awards.filter((a) => a.date === state.calDay) : [];
  const hot = hotThresholds();
  return `
    <section class="filters">
      ${routeSelect("c-route", r.id, false)}
      ${cabinSeg("c-cabin", state.calCabin, r.cabins, false)}
      ${programChips()}
    </section>
    <div class="legend">barato <i class="h0"></i><i class="h1"></i><i class="h2"></i><i class="h3"></i><i class="h4"></i> caro <span>· menor custo do dia, em R$</span></div>
    ${months.join("")}
    <div id="day-detail">
      ${state.calDay ? `<h2>${esc(fmtDate(state.calDay))}</h2><div class="list">${dayList.map((a) => awardCard(a, hot)).join("") || '<div class="empty">Sem resgates.</div>'}</div>` : '<p class="note">Toque num dia para ver os voos.</p>'}
    </div>`;
}

function describeRule(rule) {
  const parts = [];
  if (rule.program) parts.push(PROGRAMS[rule.program]?.label ?? rule.program);
  if (rule.cabin) parts.push(CABINS[rule.cabin] ?? rule.cabin);
  if (rule.max_miles != null) parts.push(`até ${num(rule.max_miles)} milhas`);
  if (rule.max_cost_brl != null) parts.push(`até ${brl(rule.max_cost_brl)}`);
  return parts.join(" · ");
}

function viewAlerts() {
  const hot = hotThresholds();
  const hits = (state.data.alerts || []).map((h) => ({ ...h.award, cost: costOf(h.award), _rule: h.rule }))
    .filter((a) => state.programs.has(a.program))
    .sort((x, y) => x.cost - y.cost);
  const rules = state.data.routes.map((r) => `
    <div class="form-row"><div><b>${esc(routeLabel(r))}</b>
      <div class="note">${esc(r.origins.join(", "))} → ${esc(r.destinations.join(", "))}</div>
      <div class="note">${esc(fmtDate(r.date_from))} a ${esc(fmtDate(r.date_to))} · ${r.passengers} pax</div>
      ${(r.alerts || []).map((a) => `<div class="note">🔔 ${esc(describeRule(a))}</div>`).join("") || '<div class="note">sem alertas</div>'}
    </div></div>`).join("");
  return `
    <h2 style="margin-top:4px">Resgates que bateram seus alertas</h2>
    <div class="list">${hits.length ? hits.map((a) => awardCard(a, hot)).join("") : '<div class="empty">Nenhum alerta disparado na última busca.</div>'}</div>
    <h2>Rotas e regras</h2>
    <div class="form-group">${rules}</div>
    <div class="stack" style="margin-top:12px">
      <a class="btn" href="${CONFIG_EDIT_URL}" target="_blank" rel="noopener">Editar rotas e alertas no GitHub</a>
      <p class="note">As rotas ficam em <code>config/config.json</code>. Depois de salvar, a próxima busca já usa as novas rotas.
      Os avisos pelo Telegram chegam numa próxima etapa.</p>
    </div>`;
}

function viewSettings() {
  const rows = Object.entries(PROGRAMS).map(([k, p]) => {
    const def = state.data.milheiro_brl[k];
    const val = state.milheiro[k] ?? def;
    return `<label class="form-row"><span><span class="badge ${k}">${p.label}</span>
      <span class="note"> padrão R$ ${def}</span></span>
      <span>R$ <input type="number" inputmode="decimal" min="0" step="0.5" data-m="${k}" value="${esc(val)}"></span></label>`;
  }).join("");
  return `
    <h2 style="margin-top:4px">Valor do milheiro (R$ por 1.000 milhas)</h2>
    <p class="note">Usado para comparar programas diferentes num só número. Coloque quanto você paga (ou recebe) por milheiro.</p>
    <div class="form-group">${rows}</div>
    <div class="stack" style="margin-top:12px">
      <button class="btn secondary" id="reset-m">Voltar aos valores padrão</button>
    </div>
    <h2>Instalar no iPhone</h2>
    <p class="note">No Safari, toque em <b>Compartilhar</b> → <b>Adicionar à Tela de Início</b>. O app abre em tela cheia, como um app normal.</p>
    <h2>Sobre os dados</h2>
    <p class="note">Última busca: ${esc(new Date(state.data.generated_at).toLocaleString("pt-BR"))}.
      ${state.data.errors?.length ? `<br>Falhas na última busca: ${state.data.errors.map((e) => esc(`${e.source} (${e.route_id})`)).join(", ")}` : ""}
      Preços por pessoa, só ida, e podem mudar a qualquer momento — confirme no site do programa antes de emitir.</p>`;
}

// ====== Progresso da busca (aos poucos) ======
function renderProgress() {
  const el = $("#progress");
  const p = state.data.progress;
  if (!p || !p.total) { el.hidden = true; return; }
  const pct = Math.floor((100 * p.done) / p.total);
  const day = (iso) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  let html;
  if (p.just_completed || pct >= 100) {
    html = `<span class="ok">✓ Busca completa</span> · ${num(p.total)} buscas · ranking final`;
  } else if (p.last_completed_at) {
    html = `<span class="ok">✓ Ranking completo</span> (busca de ${esc(day(p.last_completed_at))}) · atualizando preços: <b>${pct}%</b>
      <div class="bar"><i style="width:${pct}%"></i></div>`;
  } else {
    html = `Buscando aos poucos: <b>${pct}%</b> (${num(p.done)} de ${num(p.total)} buscas) · resultados parciais
      <div class="bar"><i style="width:${pct}%"></i></div>`;
  }
  el.innerHTML = html;
  el.hidden = false;
}

const isPartial = () => { const p = state.data?.progress; return p && !p.last_completed_at && !p.just_completed; };

// ====== Render e eventos ======
const VIEWS = { best: ["Melhores resgates", viewBest], calendar: ["Calendário", viewCalendar], alerts: ["Alertas", viewAlerts], settings: ["Ajustes", viewSettings] };

function render() {
  const [title, fn] = VIEWS[state.tab];
  $("#title").textContent = title;
  document.querySelectorAll(".tabbar button").forEach((b) => b.classList.toggle("active", b.dataset.tab === state.tab));
  if (!state.data) return;
  $("#view").innerHTML = fn();
}

function savePrefs() {
  store.set("prefs", { tab: state.tab, route: state.route, cabin: state.cabin, programs: [...state.programs], calRoute: state.calRoute, calCabin: state.calCabin });
}

document.addEventListener("click", (e) => {
  const t = e.target.closest("button");
  if (!t) return;
  if (t.dataset.tab) { state.tab = t.dataset.tab; window.scrollTo(0, 0); }
  else if (t.closest("#f-cabin")) { state.cabin = t.dataset.v; state.limit = PAGE; }
  else if (t.closest("#c-cabin")) { state.calCabin = t.dataset.v; state.calDay = null; }
  else if (t.dataset.p) {
    const p = t.dataset.p;
    if (state.programs.has(p) && state.programs.size > 1) state.programs.delete(p); else state.programs.add(p);
    state.limit = PAGE;
  }
  else if (t.id === "more") state.limit += PAGE;
  else if (t.dataset.day) {
    state.calDay = state.calDay === t.dataset.day ? null : t.dataset.day;
    render();
    if (state.calDay) $("#day-detail")?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  else if (t.id === "reset-m") { state.milheiro = {}; store.set("milheiro", {}); }
  else if (t.id === "refresh") { load(true); return; }
  else return;
  savePrefs();
  render();
});

document.addEventListener("change", (e) => {
  const t = e.target;
  if (t.id === "f-route") { state.route = t.value; state.limit = PAGE; }
  else if (t.id === "c-route") { state.calRoute = t.value; state.calDay = null; }
  else if (t.dataset.m) {
    const v = parseFloat(String(t.value).replace(",", "."));
    if (Number.isFinite(v) && v >= 0) state.milheiro[t.dataset.m] = v; else delete state.milheiro[t.dataset.m];
    store.set("milheiro", state.milheiro);
    return; // não re-renderiza enquanto digita
  }
  else return;
  savePrefs();
  render();
});

async function load(force) {
  $("#updated").textContent = "Carregando…";
  try {
    const res = await fetch("data/results.json" + (force ? `?t=${Date.now()}` : ""), { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.data = await res.json();
    const when = new Date(state.data.generated_at);
    $("#updated").textContent = `Atualizado ${when.toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}`;
    $("#sample-banner").hidden = !state.data.sample;
    renderProgress();
    if (state.route !== "all" && !routeOf(state.route)) state.route = "all";
    render();
  } catch (err) {
    $("#updated").textContent = "";
    $("#view").innerHTML = `<div class="empty">Não foi possível carregar os dados (${esc(err.message)}).<br>Verifique a conexão e toque em ↻.</div>`;
  }
}

// ====== Início ======
(function init() {
  const p = store.get("prefs", {});
  if (VIEWS[p.tab]) state.tab = p.tab;
  if (p.route) state.route = p.route;
  if (p.cabin) state.cabin = p.cabin;
  if (Array.isArray(p.programs) && p.programs.length) state.programs = new Set(p.programs.filter((x) => PROGRAMS[x]));
  if (!state.programs.size) state.programs = new Set(Object.keys(PROGRAMS));
  state.calRoute = p.calRoute ?? null;
  state.calCabin = p.calCabin ?? null;
  state.milheiro = store.get("milheiro", {}) || {};
  render();
  load(false);
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
