"use strict";

// ====== Configuração ======
const REPO = "flavioronchi/Milhas-";
const CONFIG_EDIT_URL = `https://github.com/${REPO}/edit/main/config/config.json`;
const DISPATCH_URL = `https://api.github.com/repos/${REPO}/actions/workflows/collect.yml/dispatches`;
const TOKEN_URL = "https://github.com/settings/personal-access-tokens/new";
const PROGRAMS = {
  smiles: { label: "Smiles", color: "var(--smiles)" },
  latam: { label: "LATAM Pass", color: "var(--latam)" },
  azul: { label: "Azul", color: "var(--azul)" },
};
const CABINS = { economy: "Econômica", premium: "Premium", business: "Executiva", first: "Primeira" };
const PAGE = 30;
// Sugestões para os campos de aeroporto (dá para digitar qualquer código de 3 letras).
const AIRPORT_HINTS = {
  SAO: "São Paulo (GRU + Viracopos)", GRU: "São Paulo – Guarulhos", VCP: "Campinas – Viracopos", CGH: "São Paulo – Congonhas",
  GIG: "Rio de Janeiro – Galeão", SDU: "Rio – Santos Dumont", BSB: "Brasília", CNF: "Belo Horizonte – Confins",
  POA: "Porto Alegre", CWB: "Curitiba", FLN: "Florianópolis", REC: "Recife", SSA: "Salvador", FOR: "Fortaleza",
  NAT: "Natal", BEL: "Belém", MAO: "Manaus", FLORIDA: "Flórida (MIA + MCO + FLL)", NYC: "Nova York (JFK + EWR)",
  MIA: "Miami", MCO: "Orlando", FLL: "Fort Lauderdale", JFK: "Nova York – JFK", EWR: "Nova York – Newark", BOS: "Boston",
  IAD: "Washington", ATL: "Atlanta", LAX: "Los Angeles", LAS: "Las Vegas", YYZ: "Toronto", CUN: "Cancún",
  PUJ: "Punta Cana", PTY: "Cidade do Panamá", EZE: "Buenos Aires", SCL: "Santiago", LIM: "Lima", BOG: "Bogotá",
  MVD: "Montevidéu", BRC: "Bariloche", LIS: "Lisboa", OPO: "Porto", MAD: "Madri", BCN: "Barcelona", CDG: "Paris",
  FCO: "Roma", MXP: "Milão", LHR: "Londres", AMS: "Amsterdã", FRA: "Frankfurt", ZRH: "Zurique", DXB: "Dubai", DOH: "Doha",
};

// ====== Estado ======
const state = {
  data: null,
  tab: "search",
  // buscador
  q: { program: "all", origin: "SAO", destination: "", date: "", flex: 0 },
  qRan: false,
  qCabin: "all",
  qDest: null, // filtro local por destino (quando a busca é para todos)
  qLimit: PAGE,
  sending: false,
  sendMsg: null,
  // melhores
  route: "all",
  cabin: "all",
  programs: new Set(Object.keys(PROGRAMS)),
  limit: PAGE,
  // calendário
  calRoute: null,
  calCabin: null,
  calDay: null,
  // ajustes
  milheiro: {},
  token: "",
  tokenMsg: null,
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
const isoOf = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
const todayIso = () => isoOf(new Date());
const fmtDate = (iso) => parseDate(iso).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "short" });
const fmtDur = (m) => (m == null ? "" : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`);
const fmtWhen = (iso) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const routeOf = (id) => state.data.routes.find((r) => r.id === id);
const routeLabel = (r) => r.name || `${r.origins.join("/")} → ${r.destinations.join("/")}`;
const progLabel = (p) => PROGRAMS[p]?.label ?? p;
const inRoute = (a, r) =>
  r.origins.includes(a.origin) && r.destinations.includes(a.destination) &&
  a.date >= r.date_from && a.date <= r.date_to && r.cabins.includes(a.cabin) &&
  (!r.programs || r.programs.includes(a.program));

function costOf(a) {
  const rate = state.milheiro[a.program] ?? state.data.milheiro_brl[a.program] ?? 0;
  return (a.miles / 1000) * rate + a.taxes_brl;
}
const withCost = (list) => list.map((a) => ({ ...a, cost: costOf(a) })).sort((x, y) => x.cost - y.cost || x.date.localeCompare(y.date));

// Resgate "bom": entre os 10% mais baratos do mesmo trecho + cabine.
let hotCache = null;
function hotThresholds() {
  if (hotCache) return hotCache;
  const groups = {};
  for (const a of state.data.awards) (groups[`${a.origin}-${a.destination}|${a.cabin}`] ||= []).push(costOf(a));
  const t = {};
  for (const [k, arr] of Object.entries(groups)) { arr.sort((a, b) => a - b); t[k] = arr[Math.floor(arr.length * 0.1)] ?? 0; }
  return (hotCache = t);
}

// ====== Links de compra ======
// Abre a busca do programa já preenchida. Se um coletor real trouxer o link exato
// (a.booking_url), ele tem prioridade.
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
function awardCard(a, pax = 1) {
  const hot = hotThresholds();
  const isHot = a.cost <= hot[`${a.origin}-${a.destination}|${a.cabin}`];
  const stops = a.stops === 0 ? "direto" : `${a.stops} parada${a.stops > 1 ? "s" : ""}`;
  const url = bookingUrl(a, pax);
  const tag = url ? "a" : "article";
  const attrs = url ? ` href="${esc(url)}" target="_blank" rel="noopener noreferrer" aria-label="Abrir no site da ${esc(progLabel(a.program))}: ${esc(a.origin)} para ${esc(a.destination)}, ${esc(fmtDate(a.date))}"` : "";
  return `
    <${tag} class="card"${attrs}>
      <div class="card-head">
        <div class="card-route">${esc(a.origin)} → ${esc(a.destination)}</div>
        <div class="card-cost">${brl(a.cost)}</div>
      </div>
      <div class="card-sub">
        <span><span class="badge ${esc(a.program)}">${esc(progLabel(a.program))}</span>
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
      ${url ? `<div class="card-cta">Emitir na ${esc(progLabel(a.program))} ↗</div>` : ""}
    </${tag}>`;
}

function seg(id, value, items) {
  return `<div class="seg" id="${id}">${items.map(([v, label]) =>
    `<button type="button" data-v="${esc(v)}" class="${String(v) === String(value) ? "on" : ""}">${esc(label)}</button>`).join("")}</div>`;
}

function routeSelect(id, value, withAll) {
  const opts = state.data.routes.map((r) => `<option value="${esc(r.id)}" ${r.id === value ? "selected" : ""}>${esc(routeLabel(r))}</option>`);
  if (withAll) opts.unshift(`<option value="all" ${value === "all" ? "selected" : ""}>Todos os resultados</option>`);
  return `<select id="${id}" class="select" aria-label="Rota">${opts.join("")}</select>`;
}

function programChips() {
  return `<div class="chips" id="programs">${Object.entries(PROGRAMS).map(([k, p]) =>
    `<button type="button" class="chip ${state.programs.has(k) ? "" : "off"}" data-p="${k}"><span class="dot" style="background:${p.color}"></span>${p.label}</button>`).join("")}</div>`;
}

const allCabins = () => [...new Set(state.data.routes.flatMap((r) => r.cabins).concat(["economy", "business"]))];
const cabinItems = (cabins, withAll) => (withAll ? [["all", "Todas"]] : []).concat(cabins.map((c) => [c, CABINS[c] ?? c]));

function bar(done, total) {
  const pct = total ? Math.floor((100 * done) / total) : 0;
  return `<div class="bar"><i style="width:${pct}%"></i></div>`;
}

// ====== Buscador ======
function expandAirports(text) {
  const groups = Object.fromEntries(Object.entries(state.data.airport_groups || {}).map(([k, v]) => [k.toUpperCase(), v]));
  const out = [];
  for (const part of String(text || "").toUpperCase().split(/[\s,;/]+/)) {
    if (!part) continue;
    for (const c of groups[part] || [part]) if (/^[A-Z]{3}$/.test(c) && !out.includes(c)) out.push(c);
  }
  return out;
}

// Traduz o formulário em buscas concretas (mesma regra do coletor).
function buildQuery(q) {
  const origins = expandAirports(q.origin);
  let destinations = expandAirports(q.destination);
  const anyDest = destinations.length === 0;
  if (anyDest) destinations = (state.data.popular_destinations || []).filter((d) => !origins.includes(d));
  const programs = q.program === "all" ? (state.data.programs?.length ? state.data.programs : Object.keys(PROGRAMS)) : [q.program];
  const dates = [];
  if (q.date) {
    const base = parseDate(q.date);
    for (let i = -q.flex; i <= q.flex; i++) {
      const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i);
      if (isoOf(d) >= todayIso()) dates.push(isoOf(d));
    }
  }
  const keys = [];
  for (const p of programs) for (const o of origins) for (const d of destinations) if (o !== d) for (const dt of dates) keys.push(`${p}|${o}|${d}|${dt}`);
  return { origins, destinations, anyDest, programs, dates, keys };
}

function validateQuery(q, built) {
  if (!built.origins.length) return "Informe a origem (ex.: GRU ou SAO).";
  if (String(q.destination).trim() && !expandAirports(q.destination).length) return "Destino inválido: use o código de 3 letras (ex.: MIA).";
  if (!q.date) return "Escolha a data.";
  if (!built.dates.length) return "Essa data já passou.";
  return null;
}

function viewSearch() {
  const q = state.q;
  const hints = Object.entries(AIRPORT_HINTS).map(([c, n]) => `<option value="${c}">${esc(n)}</option>`).join("");
  const form = `
    <form id="search-form" class="search" autocomplete="off">
      <label class="field"><span>Programa</span>
        ${seg("q-program", q.program, [["all", "Todos"], ["smiles", "Smiles"], ["latam", "LATAM"], ["azul", "Azul"]])}</label>
      <div class="row2">
        <label class="field"><span>Origem</span>
          <input id="q-origin" class="input" list="airports" value="${esc(q.origin)}" placeholder="GRU ou SAO" autocapitalize="characters" spellcheck="false"></label>
        <label class="field"><span>Destino <em>(opcional)</em></span>
          <input id="q-destination" class="input" list="airports" value="${esc(q.destination)}" placeholder="Todos" autocapitalize="characters" spellcheck="false"></label>
      </div>
      <div class="row2">
        <label class="field"><span>Data</span>
          <input id="q-date" class="input" type="date" min="${todayIso()}" value="${esc(q.date)}"></label>
        <label class="field"><span>Datas</span>
          ${seg("q-flex", q.flex, [[0, "Exata"], [2, "± 2 dias"]])}</label>
      </div>
      <datalist id="airports">${hints}</datalist>
      <button class="btn" type="submit">Buscar</button>
      <p class="note">Destino em branco = ${num((state.data.popular_destinations || []).length)} destinos internacionais populares.</p>
    </form>`;
  return form + (state.qRan ? searchResults() : "") + myRequests();
}

function searchResults() {
  const q = state.q;
  const built = buildQuery(q);
  const err = validateQuery(q, built);
  if (err) return `<div class="empty">${esc(err)}</div>`;

  const keySet = new Set(built.keys);
  const checked = state.data.checked || {};
  const done = built.keys.filter((k) => checked[k]).length;
  const total = built.keys.length;
  const matches = withCost(state.data.awards.filter((a) =>
    keySet.has(`${a.program}|${a.origin}|${a.destination}|${a.date}`) && (state.qCabin === "all" || a.cabin === state.qCabin)));

  // Pedido equivalente já enviado ao robô?
  const sameReq = (state.data.requests || []).find((r) =>
    r.program === q.program && r.date === q.date && Number(r.flex) === Number(q.flex) &&
    r.origins.join() === built.origins.join() && (r.any_destination ? built.anyDest : r.destinations.join() === built.destinations.join()));

  let status;
  if (done === total) {
    status = `<div class="status ok-box">✓ Busca completa · ${num(total)} buscas${oldest(built.keys, checked)}</div>`;
  } else {
    const missing = total - done;
    const eta = etaText(missing, q.program);
    const reqLine = sameReq && !sameReq.completed_at
      ? `<p class="note">Pedido enviado ${esc(fmtWhen(sameReq.created_at))} · o robô está buscando: <b>${num(sameReq.done ?? 0)} de ${num(sameReq.total ?? total)}</b>.</p>${bar(sameReq.done ?? 0, sameReq.total ?? total)}`
      : "";
    const btn = state.token
      ? (state.sendMsg?.ok
        ? ""
        : `<button class="btn" id="dispatch" type="button" ${state.sending ? "disabled" : ""}>${state.sending ? "Enviando…" : sameReq ? "Pedir de novo ao robô" : "Pedir ao robô para buscar"}</button>`)
      : `<p class="note">Para pedir buscas ao robô, cadastre a chave do GitHub em <a href="#" data-goto="settings">Ajustes</a> (uma vez só).</p>`;
    status = `<div class="status">
      <p class="status-line"><b>${num(done)} de ${num(total)}</b> buscas já feitas${done ? " · mostrando o que já existe" : ""}.
      Faltam ${num(missing)} (${esc(eta)}).</p>
      ${bar(done, total)}${reqLine}
      ${state.sendMsg ? `<p class="note ${state.sendMsg.ok ? "okc" : "errc"}">${esc(state.sendMsg.text)}</p>` : ""}
      ${btn}</div>`;
  }

  // Ranking por destino quando a busca é para todos os destinos.
  let byDest = "";
  if (built.anyDest && matches.length) {
    const best = {};
    for (const a of matches) if (!best[a.destination] || a.cost < best[a.destination].cost) best[a.destination] = a;
    const rows = Object.values(best).sort((x, y) => x.cost - y.cost);
    byDest = `<h2>Melhor preço por destino</h2><div class="chips dest-chips">${rows.map((a) =>
      `<button type="button" class="chip ${state.qDest === a.destination ? "sel" : ""}" data-dest="${esc(a.destination)}" title="${esc(AIRPORT_HINTS[a.destination] ?? "")}"><b>${esc(a.destination)}</b> ${brl(a.cost)}</button>`).join("")}
      ${state.qDest ? '<button type="button" class="chip" data-dest="">ver todos</button>' : ""}</div>`;
  }
  const list = state.qDest ? matches.filter((a) => a.destination === state.qDest) : matches;
  const shown = list.slice(0, state.qLimit);
  return `
    <section id="search-results">
      ${status}
      ${byDest}
      <h2>Resultados</h2>
      ${seg("q-cabin", state.qCabin, cabinItems(["economy", "business"], true))}
      <p class="muted small" style="margin-top:8px">${num(list.length)} resgates · por pessoa, só ida · menor custo em R$ primeiro</p>
      <div class="list" style="margin-top:8px">${shown.length ? shown.map((a) => awardCard(a)).join("") :
        `<div class="empty">${done ? "Nenhum resgate encontrado nas buscas feitas." : "Ainda não há buscas para este pedido."}</div>`}</div>
      ${list.length > shown.length ? `<button class="more" id="q-more" type="button">Mostrar mais (${num(list.length - shown.length)})</button>` : ""}
    </section>`;
}

function oldest(keys, checked) {
  const ts = keys.map((k) => checked[k]).filter(Boolean).sort()[0];
  return ts ? ` · dados desde ${fmtWhen(ts + ":00Z")}` : "";
}

function etaText(missing, program) {
  // Ritmo aproximado do robô (ver "pacing" no config): ~40 buscas a cada 2 h por programa.
  if (state.data.sample) return "com dados de exemplo sai em ~1 min";
  const perProgram = program === "all" ? missing / Math.max(1, (state.data.programs || []).length) : missing;
  const hours = Math.ceil(perProgram / 40) * 2;
  return hours <= 2 ? "deve sair na próxima rodada" : `leva cerca de ${hours} h`;
}

function myRequests() {
  const reqs = state.data.requests || [];
  if (!reqs.length) return "";
  return `<h2>Buscas pedidas ao robô</h2><div class="form-group">${reqs.map((r, i) => {
    const dest = r.any_destination ? "todos os destinos" : r.destinations.join(", ");
    const st = r.completed_at ? '<span class="okc">✓ completa</span>' : `${num(r.done ?? 0)} de ${num(r.total ?? 0)}`;
    return `<button type="button" class="form-row req-row" data-req="${i}">
      <span><b>${esc(r.origins.join("/"))} → ${esc(dest)}</b>
        <span class="note">${esc(fmtDate(r.date))}${Number(r.flex) ? ` ± ${r.flex} dias` : ""} · ${esc(r.program === "all" ? "todos os programas" : progLabel(r.program))}</span></span>
      <span class="note">${st}</span></button>`;
  }).join("")}</div>`;
}

async function dispatchSearch() {
  const q = state.q;
  const built = buildQuery(q);
  if (validateQuery(q, built)) return;
  state.sending = true; state.sendMsg = null; render();
  try {
    const res = await fetch(DISPATCH_URL, {
      method: "POST",
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${state.token}`, "X-GitHub-Api-Version": "2022-11-28" },
      body: JSON.stringify({ ref: "main", inputs: {
        program: q.program, origin: q.origin.trim(), destination: q.destination.trim(), date: q.date, flex: String(q.flex),
      } }),
    });
    if (res.status === 204) {
      state.sendMsg = { ok: true, text: "Pedido enviado! O robô começa em ~1 minuto. Volte aqui e toque em ↻ para ver o progresso." };
    } else if (res.status === 401 || res.status === 403 || res.status === 404) {
      state.sendMsg = { ok: false, text: `O GitHub recusou a chave (erro ${res.status}). Confira em Ajustes se ela tem a permissão "Actions: Read and write" para o repositório Milhas-.` };
    } else {
      state.sendMsg = { ok: false, text: `Não deu certo (erro ${res.status}). Tente de novo em instantes.` };
    }
  } catch (e) {
    state.sendMsg = { ok: false, text: `Sem conexão com o GitHub (${e.message}).` };
  }
  state.sending = false;
  render();
}

// ====== Melhores ======
function viewBest() {
  const r = state.route === "all" ? null : routeOf(state.route);
  const list = withCost(state.data.awards.filter((a) =>
    (!r || inRoute(a, r)) && (state.cabin === "all" || a.cabin === state.cabin) && state.programs.has(a.program)));
  const shown = list.slice(0, state.limit);
  const pax = r?.passengers > 1 ? r.passengers : 1;
  return `
    <section class="filters">
      ${routeSelect("f-route", state.route, true)}
      ${seg("f-cabin", state.cabin, cabinItems(allCabins(), true))}
      ${programChips()}
    </section>
    <p class="muted small">${num(list.length)} resgates${isPartial() ? " (parcial)" : ""} · ordenados pelo custo em R$ (milhas × milheiro + taxas), por pessoa, só ida</p>
    <div class="list" style="margin-top:8px">
      ${shown.length ? shown.map((a) => awardCard(a, pax)).join("") : '<div class="empty">Nenhum resgate com esses filtros.</div>'}
    </div>
    ${list.length > shown.length ? `<button class="more" id="more" type="button">Mostrar mais (${num(list.length - shown.length)})</button>` : ""}`;
}

// ====== Calendário ======
function viewCalendar() {
  const routes = state.data.routes;
  if (!routes.length) return '<div class="empty">Nenhuma rota monitorada.</div>';
  state.calRoute = routeOf(state.calRoute) ? state.calRoute : routes[0].id;
  const r = routeOf(state.calRoute);
  if (!r.cabins.includes(state.calCabin)) state.calCabin = r.cabins[0];
  const awards = withCost(state.data.awards.filter((a) => inRoute(a, r) && a.cabin === state.calCabin && state.programs.has(a.program)));

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
      const iso = isoOf(new Date(y, m, day));
      const cur = new Date(y, m, day);
      const a = best[iso];
      if (cur < start || cur > end || !a) {
        cells += `<div class="cal-day none"><span class="n">${day}</span><span class="v">–</span></div>`;
      } else {
        cells += `<button type="button" class="cal-day ${heat(a.cost)} ${state.calDay === iso ? "sel" : ""}" data-day="${iso}" aria-label="${esc(fmtDate(iso))}: ${brl(a.cost)}"><span class="n">${day}</span><span class="v">${kfmt(a.cost)}</span></button>`;
      }
    }
    const mname = d.toLocaleDateString("pt-BR", { month: "long" });
    months.push(`<div class="cal-month"><div class="cal-title">${esc(mname[0].toUpperCase() + mname.slice(1))} ${y}</div><div class="cal-grid">
      ${["seg", "ter", "qua", "qui", "sex", "sáb", "dom"].map((w) => `<div class="cal-dow">${w}</div>`).join("")}${cells}</div></div>`);
  }

  const dayList = state.calDay ? awards.filter((a) => a.date === state.calDay) : [];
  const pax = r.passengers > 1 ? r.passengers : 1;
  return `
    <section class="filters">
      ${routeSelect("c-route", r.id, false)}
      ${seg("c-cabin", state.calCabin, cabinItems(r.cabins, false))}
      ${programChips()}
    </section>
    <div class="legend">barato <i class="h0"></i><i class="h1"></i><i class="h2"></i><i class="h3"></i><i class="h4"></i> caro <span>· menor custo do dia, em R$</span></div>
    ${months.join("")}
    <div id="day-detail">
      ${state.calDay ? `<h2>${esc(fmtDate(state.calDay))}</h2><div class="list">${dayList.map((a) => awardCard(a, pax)).join("") || '<div class="empty">Sem resgates.</div>'}</div>` : '<p class="note">Toque num dia para ver os voos.</p>'}
    </div>`;
}

// ====== Alertas ======
function describeRule(rule) {
  const parts = [];
  if (rule.program) parts.push(progLabel(rule.program));
  if (rule.cabin) parts.push(CABINS[rule.cabin] ?? rule.cabin);
  if (rule.max_miles != null) parts.push(`até ${num(rule.max_miles)} milhas`);
  if (rule.max_cost_brl != null) parts.push(`até ${brl(rule.max_cost_brl)}`);
  return parts.join(" · ");
}

function viewAlerts() {
  const hits = withCost((state.data.alerts || []).map((h) => h.award)).filter((a) => state.programs.has(a.program));
  const rules = state.data.routes.map((r) => `
    <div class="form-row"><div><b>${esc(routeLabel(r))}</b>
      <div class="note">${esc(r.origins.join(", "))} → ${esc(r.destinations.join(", "))}</div>
      <div class="note">${esc(fmtDate(r.date_from))} a ${esc(fmtDate(r.date_to))} · ${r.passengers} pax</div>
      ${(r.alerts || []).map((a) => `<div class="note">🔔 ${esc(describeRule(a))}</div>`).join("") || '<div class="note">sem alertas</div>'}
    </div></div>`).join("");
  return `
    <h2 style="margin-top:4px">Resgates que bateram seus alertas</h2>
    <div class="list">${hits.length ? hits.map((a) => awardCard(a)).join("") : '<div class="empty">Nenhum alerta disparado na última busca.</div>'}</div>
    <h2>Rotas monitoradas e regras</h2>
    <div class="form-group">${rules}</div>
    <div class="stack" style="margin-top:12px">
      <a class="btn" href="${CONFIG_EDIT_URL}" target="_blank" rel="noopener">Editar rotas e alertas no GitHub</a>
      <p class="note">As rotas monitoradas ficam em <code>config/config.json</code> e são rebuscadas continuamente.
      Os avisos pelo Telegram chegam numa próxima etapa.</p>
    </div>`;
}

// ====== Ajustes ======
function viewSettings() {
  const rows = Object.entries(PROGRAMS).map(([k, p]) => {
    const def = state.data.milheiro_brl[k];
    const val = state.milheiro[k] ?? def;
    return `<label class="form-row"><span><span class="badge ${k}">${p.label}</span>
      <span class="note"> padrão R$ ${def}</span></span>
      <span>R$ <input type="number" inputmode="decimal" min="0" step="0.5" data-m="${k}" value="${esc(val)}"></span></label>`;
  }).join("");
  return `
    <h2 style="margin-top:4px">Chave do GitHub (para pedir buscas)</h2>
    ${state.token ? `<p class="note okc">✓ Chave cadastrada neste aparelho.</p>` : `<p class="note">Sem chave, o buscador só mostra o que já foi buscado.</p>`}
    <div class="stack">
      <input id="token" class="input" type="password" placeholder="github_pat_…" value="" autocomplete="off" spellcheck="false">
      <div class="row2">
        <button class="btn" id="save-token" type="button">Salvar e testar</button>
        ${state.token ? '<button class="btn secondary" id="clear-token" type="button">Remover</button>' : ""}
      </div>
      ${state.tokenMsg ? `<p class="note ${state.tokenMsg.ok ? "okc" : "errc"}">${esc(state.tokenMsg.text)}</p>` : ""}
      <details class="howto"><summary>Como criar a chave (2 min)</summary>
        <ol>
          <li>Abra <a href="${TOKEN_URL}" target="_blank" rel="noopener">github.com/settings/personal-access-tokens/new</a> e faça login.</li>
          <li><b>Token name</b>: <code>Milhas app</code>. <b>Expiration</b>: o prazo que quiser (ex.: 1 ano).</li>
          <li><b>Repository access</b>: <i>Only select repositories</i> → escolha <b>Milhas-</b>.</li>
          <li><b>Permissions</b> → <b>Repository permissions</b> → <b>Actions</b>: <i>Read and write</i>.</li>
          <li>Toque em <b>Generate token</b>, copie o código (começa com <code>github_pat_</code>) e cole aqui.</li>
        </ol>
        <p class="note">A chave fica guardada só neste aparelho e só permite disparar o robô deste repositório.</p>
      </details>
    </div>
    <h2>Valor do milheiro (R$ por 1.000 milhas)</h2>
    <p class="note">Usado para comparar programas diferentes num só número. Coloque quanto você paga (ou recebe) por milheiro.</p>
    <div class="form-group">${rows}</div>
    <div class="stack" style="margin-top:12px">
      <button class="btn secondary" id="reset-m" type="button">Voltar aos valores padrão</button>
    </div>
    <h2>Instalar no iPhone</h2>
    <p class="note">No Safari, toque em <b>Compartilhar</b> → <b>Adicionar à Tela de Início</b>. O app abre em tela cheia, como um app normal.</p>
    <h2>Sobre os dados</h2>
    <p class="note">Última atualização: ${esc(new Date(state.data.generated_at).toLocaleString("pt-BR"))}.
      ${state.data.errors?.length ? `<br>Falhas na última rodada: ${state.data.errors.slice(0, 5).map((e) => esc(e.error)).join(" · ")}<br>` : ""}
      Preços por pessoa, só ida, e podem mudar a qualquer momento — confirme no site do programa antes de emitir.</p>`;
}

async function saveToken() {
  const v = ($("#token")?.value || "").trim();
  if (!v) { state.tokenMsg = { ok: false, text: "Cole a chave no campo acima." }; render(); return; }
  state.tokenMsg = { ok: true, text: "Testando…" }; render();
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/collect.yml`, {
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${v}` },
    });
    if (res.ok) {
      state.token = v; store.set("token", v);
      state.tokenMsg = { ok: true, text: "Chave salva e funcionando. Já dá para pedir buscas no Buscar." };
    } else {
      state.tokenMsg = { ok: false, text: `O GitHub recusou a chave (erro ${res.status}). Confira o repositório (Milhas-) e a permissão Actions.` };
    }
  } catch (e) {
    state.tokenMsg = { ok: false, text: `Sem conexão com o GitHub (${e.message}).` };
  }
  render();
}

// ====== Progresso das rotas monitoradas ======
function renderProgress() {
  const el = $("#progress");
  const p = state.data.progress;
  if (!p || !p.total || state.tab === "search" || state.tab === "settings") { el.hidden = true; return; }
  const pct = Math.floor((100 * p.done) / p.total);
  let html;
  if (p.just_completed || pct >= 100) {
    html = `<span class="ok">✓ Busca completa</span> · ${num(p.total)} buscas · ranking final`;
  } else if (p.last_completed_at) {
    html = `<span class="ok">✓ Ranking completo</span> (busca de ${esc(fmtWhen(p.last_completed_at))}) · atualizando preços: <b>${pct}%</b>${bar(p.done, p.total)}`;
  } else {
    html = `Buscando aos poucos: <b>${pct}%</b> (${num(p.done)} de ${num(p.total)} buscas) · resultados parciais${bar(p.done, p.total)}`;
  }
  el.innerHTML = html;
  el.hidden = false;
}
const isPartial = () => { const p = state.data?.progress; return p && !p.last_completed_at && !p.just_completed; };

// ====== Render e eventos ======
const VIEWS = {
  search: ["Buscar", viewSearch],
  best: ["Monitoradas", viewBest],
  calendar: ["Calendário", viewCalendar],
  alerts: ["Alertas", viewAlerts],
  settings: ["Ajustes", viewSettings],
};

function render() {
  const [title, fn] = VIEWS[state.tab];
  $("#title").textContent = title;
  document.querySelectorAll(".tabbar button").forEach((b) => b.classList.toggle("active", b.dataset.tab === state.tab));
  if (!state.data) return;
  renderProgress();
  $("#view").innerHTML = fn();
}

function savePrefs() {
  store.set("prefs", {
    tab: state.tab, route: state.route, cabin: state.cabin, programs: [...state.programs],
    calRoute: state.calRoute, calCabin: state.calCabin, q: state.q, qRan: state.qRan, qCabin: state.qCabin,
  });
}

function readForm() {
  state.q.origin = ($("#q-origin")?.value ?? state.q.origin).trim().toUpperCase();
  state.q.destination = ($("#q-destination")?.value ?? state.q.destination).trim().toUpperCase();
  state.q.date = $("#q-date")?.value ?? state.q.date;
}

document.addEventListener("submit", (e) => {
  if (e.target.id !== "search-form") return;
  e.preventDefault();
  readForm();
  state.qRan = true; state.qDest = null; state.qLimit = PAGE; state.sendMsg = null;
  document.activeElement?.blur?.();
  savePrefs();
  render();
  $("#search-results")?.scrollIntoView({ behavior: "smooth", block: "start" });
});

document.addEventListener("click", (e) => {
  const link = e.target.closest("[data-goto]");
  if (link) { e.preventDefault(); state.tab = link.dataset.goto; savePrefs(); render(); window.scrollTo(0, 0); return; }
  const t = e.target.closest("button");
  if (!t) return;
  if (t.dataset.tab) { readForm(); state.tab = t.dataset.tab; window.scrollTo(0, 0); }
  else if (t.closest("#q-program")) { readForm(); state.q.program = t.dataset.v; state.sendMsg = null; }
  else if (t.closest("#q-flex")) { readForm(); state.q.flex = Number(t.dataset.v); state.sendMsg = null; }
  else if (t.closest("#q-cabin")) { state.qCabin = t.dataset.v; state.qLimit = PAGE; }
  else if (t.dataset.dest !== undefined) { state.qDest = t.dataset.dest || null; state.qLimit = PAGE; }
  else if (t.id === "q-more") state.qLimit += PAGE;
  else if (t.id === "dispatch") { dispatchSearch(); return; }
  else if (t.dataset.req !== undefined) {
    const r = state.data.requests[Number(t.dataset.req)];
    state.q = { program: r.program, origin: r.origins.join(","), destination: r.any_destination ? "" : r.destinations.join(","), date: r.date, flex: Number(r.flex) };
    state.qRan = true; state.qDest = null; state.qLimit = PAGE; state.sendMsg = null;
    savePrefs(); render();
    $("#search-results")?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
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
  else if (t.id === "reset-m") { state.milheiro = {}; store.set("milheiro", {}); hotCache = null; }
  else if (t.id === "save-token") { saveToken(); return; }
  else if (t.id === "clear-token") { state.token = ""; store.set("token", ""); state.tokenMsg = { ok: true, text: "Chave removida deste aparelho." }; }
  else if (t.id === "refresh") { readForm(); load(true); return; }
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
    hotCache = null;
    return; // não re-renderiza enquanto digita
  }
  else if (t.id === "q-origin" || t.id === "q-destination" || t.id === "q-date") { readForm(); savePrefs(); return; }
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
    state.data.awards ||= [];
    hotCache = null;
    $("#updated").textContent = `Atualizado ${fmtWhen(state.data.generated_at)}`;
    $("#sample-banner").hidden = !state.data.sample;
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
  if (p.q && typeof p.q === "object") state.q = { ...state.q, ...p.q, flex: Number(p.q.flex) || 0 };
  state.qRan = !!p.qRan;
  if (p.qCabin) state.qCabin = p.qCabin;
  state.milheiro = store.get("milheiro", {}) || {};
  state.token = store.get("token", "") || "";
  render();
  load(false);
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
