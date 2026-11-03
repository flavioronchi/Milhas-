"use strict";

// ====== Configuração ======
const REPO = "flavioronchi/Milhas-";
const DISPATCH_URL = `https://api.github.com/repos/${REPO}/actions/workflows/collect.yml/dispatches`;
const TOKEN_URL = "https://github.com/settings/personal-access-tokens/new";
const PROGRAMS = {
  smiles: { label: "Smiles", color: "var(--smiles)" },
  latam: { label: "LATAM Pass", color: "var(--latam)" },
  azul: { label: "Azul", color: "var(--azul)" },
};
const PROGRAM_ITEMS = [["all", "Todos"], ["smiles", "Smiles"], ["latam", "LATAM"], ["azul", "Azul"]];
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
const nextMonth = () => { const d = new Date(); d.setMonth(d.getMonth() + 1, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
const state = {
  data: null,
  tab: "search",
  msgs: {}, // mensagens de envio por formulário: { key: {ok, text} }
  sending: {},
  // buscador
  q: { program: "all", origin: "SAO", destination: "", date: "", return_date: "", flex: 0 },
  qRan: false, qCabin: "all", qDest: null, qLeg: 0, qLimit: PAGE,
  // monitoradas
  route: "all", cabin: "all", programs: new Set(Object.keys(PROGRAMS)), limit: PAGE,
  // calendário
  cal: { program: "all", origin: "SAO", destination: "MIA", cabin: "economy", month: nextMonth() },
  calDay: null,
  // alertas (formulário de nova rota)
  mon: { name: "", origin: "SAO", destination: "", date_from: "", date_to: "", program: "all", cabin: "economy", limit: "", unit: "miles" },
  // ajustes
  milheiro: {}, token: "", tokenMsg: null,
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
const num = (v) => Number(v).toLocaleString("pt-BR");
const kfmt = (v) => (v >= 1000 ? (v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: v >= 10000 ? 0 : 1 }) + "k" : String(Math.round(v)));
const parseDate = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };
const isoOf = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
const todayIso = () => isoOf(new Date());
const addDays = (iso, n) => { const d = parseDate(iso); d.setDate(d.getDate() + n); return isoOf(d); };
const fmtDate = (iso) => parseDate(iso).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "short" });
const fmtShort = (iso) => parseDate(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
const fmtDur = (m) => (m == null ? "" : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`);
const fmtWhen = (iso) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const monthName = (ym) => { const [y, m] = ym.split("-").map(Number); const n = new Date(y, m - 1, 1).toLocaleDateString("pt-BR", { month: "long" }); return `${n[0].toUpperCase()}${n.slice(1)} ${y}`; };
const routeOf = (id) => state.data.routes.find((r) => r.id === id);
const routeLabel = (r) => r.name || `${r.origins.join("/")} → ${r.destinations.join("/")}`;
const progLabel = (p) => PROGRAMS[p]?.label ?? p;
const akey = (a) => `${a.program}|${a.origin}|${a.destination}|${a.date}`;
const inRoute = (a, r) =>
  r.origins.includes(a.origin) && r.destinations.includes(a.destination) &&
  a.date >= r.date_from && a.date <= r.date_to && r.cabins.includes(a.cabin) &&
  (!r.programs || r.programs.includes(a.program));
const allPrograms = () => (state.data.programs?.length ? state.data.programs : Object.keys(PROGRAMS));
const progsOf = (p) => (p === "all" ? allPrograms() : [p]);

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

function expandAirports(text) {
  const groups = Object.fromEntries(Object.entries(state.data.airport_groups || {}).map(([k, v]) => [k.toUpperCase(), v]));
  const out = [];
  for (const part of String(text || "").toUpperCase().split(/[\s,;/]+/)) {
    if (!part) continue;
    for (const c of groups[part] || [part]) if (/^[A-Z]{3}$/.test(c) && !out.includes(c)) out.push(c);
  }
  return out;
}
const validAirports = (text) => String(text || "").trim() === "" || expandAirports(text).length > 0 &&
  String(text).toUpperCase().split(/[\s,;/]+/).filter(Boolean).every((p) => (state.data.airport_groups || {})[p] || /^[A-Z]{3}$/.test(p));

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
function awardCard(a, pax = 1, label = "") {
  const hot = hotThresholds();
  const isHot = a.cost <= hot[`${a.origin}-${a.destination}|${a.cabin}`];
  const stops = a.stops === 0 ? "direto" : `${a.stops} parada${a.stops > 1 ? "s" : ""}`;
  const url = bookingUrl(a, pax);
  const tag = url ? "a" : "article";
  const attrs = url ? ` href="${esc(url)}" target="_blank" rel="noopener noreferrer" aria-label="Abrir no site da ${esc(progLabel(a.program))}: ${esc(a.origin)} para ${esc(a.destination)}, ${esc(fmtDate(a.date))}"` : "";
  return `
    <${tag} class="card"${attrs}>
      <div class="card-head">
        <div class="card-route">${label ? `<span class="leg">${esc(label)}</span> ` : ""}${esc(a.origin)} → ${esc(a.destination)}</div>
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
const cabinItems = (cabins, withAll) => (withAll ? [["all", "Todas"]] : []).concat(cabins.map((c) => [c, CABINS[c] ?? c]));
const airportInput = (id, value, placeholder) =>
  `<input id="${id}" class="input" list="airports" value="${esc(value)}" placeholder="${esc(placeholder)}" autocapitalize="characters" autocorrect="off" spellcheck="false">`;
const datalist = () => `<datalist id="airports">${Object.entries(AIRPORT_HINTS).map(([c, n]) => `<option value="${c}">${esc(n)}</option>`).join("")}</datalist>`;

function programChips() {
  return `<div class="chips" id="programs">${Object.entries(PROGRAMS).map(([k, p]) =>
    `<button type="button" class="chip ${state.programs.has(k) ? "" : "off"}" data-p="${k}"><span class="dot" style="background:${p.color}"></span>${p.label}</button>`).join("")}</div>`;
}

function bar(done, total) {
  const pct = total ? Math.floor((100 * done) / total) : 0;
  return `<div class="bar"><i style="width:${pct}%"></i></div>`;
}

function msgLine(key) {
  const m = state.msgs[key];
  return m ? `<p class="note ${m.ok ? "okc" : "errc"}">${esc(m.text)}</p>` : "";
}

function needToken() {
  return `<p class="note">Para pedir ao robô, cadastre a chave do GitHub em <a href="#" data-goto="settings">Ajustes</a> (uma vez só).</p>`;
}

function robotButton(key, label) {
  if (!state.token) return needToken();
  if (state.msgs[key]?.ok) return "";
  return `<button class="btn" type="button" data-send="${key}" ${state.sending[key] ? "disabled" : ""}>${state.sending[key] ? "Enviando…" : esc(label)}</button>`;
}

// Envia um comando ao robô (workflow "Buscar resgates").
async function sendCommand(key, cmd, okText) {
  state.sending[key] = true; delete state.msgs[key]; render();
  try {
    const res = await fetch(DISPATCH_URL, {
      method: "POST",
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${state.token}`, "X-GitHub-Api-Version": "2022-11-28" },
      body: JSON.stringify({ ref: "main", inputs: { command: JSON.stringify(cmd) } }),
    });
    if (res.status === 204) state.msgs[key] = { ok: true, text: okText };
    else if ([401, 403, 404].includes(res.status)) state.msgs[key] = { ok: false, text: `O GitHub recusou a chave (erro ${res.status}). Confira em Ajustes se ela tem a permissão "Actions: Read and write" para o repositório Milhas-.` };
    else state.msgs[key] = { ok: false, text: `Não deu certo (erro ${res.status}). Tente de novo em instantes.` };
  } catch (e) {
    state.msgs[key] = { ok: false, text: `Sem conexão com o GitHub (${e.message}).` };
  }
  state.sending[key] = false;
  render();
}

// Cobertura: quantas das buscas necessárias o robô já fez.
function coverage(keys) {
  const checked = state.data.checked || {};
  const done = keys.filter((k) => checked[k]).length;
  return { done, total: keys.length };
}

function etaText(missing, programs) {
  if (state.data.sample) return "com dados de exemplo sai em ~1 min";
  const perProgram = missing / Math.max(1, programs.length);
  const hours = Math.ceil(perProgram / 40) * 2; // ~40 buscas a cada 2 h por programa (ver "pacing")
  return hours <= 2 ? "deve sair na próxima rodada" : `leva cerca de ${hours} h`;
}

// ====== Buscar ======
function datesAround(iso, flex) {
  const out = [];
  for (let i = -flex; i <= flex; i++) { const d = addDays(iso, i); if (d >= todayIso()) out.push(d); }
  return out;
}

function buildQuery(q) {
  const origins = expandAirports(q.origin);
  let destinations = expandAirports(q.destination);
  const anyDest = destinations.length === 0;
  if (anyDest) destinations = (state.data.popular_destinations || []).filter((d) => !origins.includes(d));
  const programs = progsOf(q.program);
  const legs = [{ label: "Ida", origins, destinations, dates: q.date ? datesAround(q.date, q.flex) : [] }];
  if (q.return_date) legs.push({ label: "Volta", origins: destinations, destinations: origins, dates: datesAround(q.return_date, q.flex) });
  const keys = [];
  for (const leg of legs) for (const p of programs) for (const o of leg.origins) for (const d of leg.destinations) if (o !== d) for (const dt of leg.dates) keys.push(`${p}|${o}|${d}|${dt}`);
  for (const leg of legs) leg.keys = new Set(keys.filter((k) => { const [, o, d, dt] = k.split("|"); return leg.origins.includes(o) && leg.destinations.includes(d) && leg.dates.includes(dt); }));
  return { origins, destinations, anyDest, programs, legs, keys };
}

function validateQuery(q, b) {
  if (!b.origins.length || !validAirports(q.origin)) return "Informe a origem com o código de 3 letras (ex.: GRU ou SAO).";
  if (!validAirports(q.destination)) return "Destino inválido: use o código de 3 letras (ex.: MIA).";
  if (!q.date) return "Escolha a data de ida.";
  if (!b.legs[0].dates.length) return "A data de ida já passou.";
  if (q.return_date && q.return_date < q.date) return "A volta deve ser depois da ida.";
  return null;
}

function viewSearch() {
  const q = state.q;
  const form = `
    <form id="search-form" class="panel" autocomplete="off" novalidate>
      <label class="field"><span>Programa</span>${seg("q-program", q.program, PROGRAM_ITEMS)}</label>
      <div class="row2">
        <label class="field"><span>Origem</span>${airportInput("q-origin", q.origin, "GRU ou SAO")}</label>
        <label class="field"><span>Destino <em>(opcional)</em></span>${airportInput("q-destination", q.destination, "Todos")}</label>
      </div>
      <div class="row2">
        <label class="field"><span>Ida</span><input id="q-date" class="input" type="date" min="${todayIso()}" value="${esc(q.date)}"></label>
        <label class="field"><span>Volta <em>(opcional)</em></span><input id="q-return" class="input" type="date" min="${esc(q.date || todayIso())}" value="${esc(q.return_date)}"></label>
      </div>
      ${q.return_date ? '<button type="button" class="link-btn" id="q-clear-return">Remover volta (só ida)</button>' : ""}
      <label class="field"><span>Datas</span>${seg("q-flex", q.flex, [[0, "Data exata"], [2, "± 2 dias"]])}</label>
      ${datalist()}
      <button class="btn" type="submit">Buscar</button>
      <p class="note">Destino em branco = ${num((state.data.popular_destinations || []).length)} destinos internacionais populares.</p>
    </form>`;
  return form + (state.qRan ? searchResults() : "") + myRequests();
}

function bestBy(list, keyFn) {
  const best = {};
  for (const a of list) { const k = keyFn(a); if (!best[k] || a.cost < best[k].cost) best[k] = a; }
  return best;
}

function searchResults() {
  const q = state.q;
  const b = buildQuery(q);
  const err = validateQuery(q, b);
  if (err) return `<div class="empty">${esc(err)}</div>`;
  const roundTrip = b.legs.length === 2;
  const { done, total } = coverage(b.keys);
  const cabinOk = (a) => state.qCabin === "all" || a.cabin === state.qCabin;
  const legAwards = b.legs.map((leg) => withCost(state.data.awards.filter((a) => leg.keys.has(akey(a)) && cabinOk(a))));

  const sameReq = (state.data.requests || []).find((r) => r.type === "search" &&
    r.program === q.program && r.date === q.date && Number(r.flex) === Number(q.flex) && (r.return_date || "") === (q.return_date || "") &&
    r.origins.join() === b.origins.join() && (r.any_destination ? b.anyDest : r.destinations.join() === b.destinations.join()));

  let status;
  if (done === total) {
    status = `<div class="status ok-box">✓ Busca completa · ${num(total)} buscas</div>`;
  } else {
    const reqLine = sameReq && !sameReq.completed_at
      ? `<p class="note">Pedido enviado ${esc(fmtWhen(sameReq.created_at))} · o robô está buscando: <b>${num(sameReq.done ?? 0)} de ${num(sameReq.total ?? total)}</b>.</p>${bar(sameReq.done ?? 0, sameReq.total ?? total)}`
      : "";
    status = `<div class="status">
      <p class="status-line"><b>${num(done)} de ${num(total)}</b> buscas já feitas${done ? " · mostrando o que já existe" : ""}.
      Faltam ${num(total - done)} (${esc(etaText(total - done, b.programs))}).</p>
      ${bar(done, total)}${reqLine}${msgLine("search")}
      ${robotButton("search", sameReq ? "Pedir de novo ao robô" : "Pedir ao robô para buscar")}</div>`;
  }

  // Ranking por destino (destino em branco): ida, ou ida + volta somadas.
  let ranking = "";
  if (b.anyDest) {
    const bestOut = bestBy(legAwards[0], (a) => a.destination);
    const bestBack = roundTrip ? bestBy(legAwards[1], (a) => a.origin) : {};
    const rows = Object.keys(bestOut).filter((d) => !roundTrip || bestBack[d])
      .map((d) => ({ d, cost: bestOut[d].cost + (roundTrip ? bestBack[d].cost : 0) })).sort((x, y) => x.cost - y.cost);
    if (rows.length) {
      ranking = `<h2>Melhor preço por destino${roundTrip ? " (ida + volta)" : ""}</h2><div class="chips dest-chips">${rows.map((r) =>
        `<button type="button" class="chip ${state.qDest === r.d ? "sel" : ""}" data-dest="${esc(r.d)}" title="${esc(AIRPORT_HINTS[r.d] ?? "")}"><b>${esc(r.d)}</b> ${brl(r.cost)}</button>`).join("")}
        ${state.qDest ? '<button type="button" class="chip" data-dest="">ver todos</button>' : ""}</div>`;
    }
  }

  // Melhor combinação ida + volta (para o destino escolhido ou filtrado).
  const destFilter = (a, leg) => !state.qDest || (leg === 0 ? a.destination === state.qDest : a.origin === state.qDest);
  const lists = legAwards.map((l, i) => l.filter((a) => destFilter(a, i)));
  let combo = "";
  if (roundTrip && (!b.anyDest || state.qDest) && lists[0].length && lists[1].length) {
    const out = lists[0][0], back = lists[1][0];
    combo = `<h2>Melhor ida e volta</h2>
      <div class="combo"><div class="combo-total">Total por pessoa: <b>${brl(out.cost + back.cost)}</b>
        <span class="note">${num(out.miles + back.miles)} milhas + ${brl(out.taxes_brl + back.taxes_brl)} de taxas</span></div>
        <div class="list">${awardCard(out, 1, "Ida")}${awardCard(back, 1, "Volta")}</div></div>`;
  }

  const leg = roundTrip ? state.qLeg : 0;
  const list = lists[leg];
  const shown = list.slice(0, state.qLimit);
  return `
    <section id="search-results">
      ${status}${ranking}${combo}
      <h2>Resultados</h2>
      <div class="stack">
        ${roundTrip ? seg("q-leg", leg, [[0, `Ida · ${fmtShort(q.date)}`], [1, `Volta · ${fmtShort(q.return_date)}`]]) : ""}
        ${seg("q-cabin", state.qCabin, cabinItems(["economy", "business"], true))}
      </div>
      <p class="muted small" style="margin-top:8px">${num(list.length)} resgates · por pessoa, só ${leg ? "volta" : "ida"} · menor custo em R$ primeiro</p>
      <div class="list" style="margin-top:8px">${shown.length ? shown.map((a) => awardCard(a)).join("") :
        `<div class="empty">${done ? "Nenhum resgate encontrado nas buscas feitas." : "Ainda não há buscas para este pedido."}</div>`}</div>
      ${list.length > shown.length ? `<button class="more" id="q-more" type="button">Mostrar mais (${num(list.length - shown.length)})</button>` : ""}
    </section>`;
}

function myRequests() {
  const reqs = (state.data.requests || []).filter((r) => r.type === "search");
  if (!reqs.length) return "";
  return `<h2>Buscas pedidas ao robô</h2><div class="form-group">${reqs.map((r) => {
    const dest = r.any_destination ? "todos os destinos" : r.destinations.join(", ");
    const st = r.completed_at ? '<span class="okc">✓ completa</span>' : `${num(r.done ?? 0)} de ${num(r.total ?? 0)}`;
    const dates = `${fmtShort(r.date)}${r.return_date ? ` – ${fmtShort(r.return_date)}` : " (só ida)"}${Number(r.flex) ? ` ± ${r.flex} dias` : ""}`;
    return `<button type="button" class="form-row req-row" data-req="${esc(r.id)}">
      <span><b>${esc(r.origins.join("/"))} → ${esc(dest)}</b>
        <span class="note">${esc(dates)} · ${esc(r.program === "all" ? "todos os programas" : progLabel(r.program))}</span></span>
      <span class="note">${st}</span></button>`;
  }).join("")}</div>`;
}

// ====== Calendário ======
function calModel() {
  const c = state.cal;
  const origins = expandAirports(c.origin), destinations = expandAirports(c.destination);
  const programs = progsOf(c.program);
  const [y, m] = c.month.split("-").map(Number);
  const days = [];
  for (let d = 1; d <= new Date(y, m, 0).getDate(); d++) days.push(isoOf(new Date(y, m - 1, d)));
  const future = days.filter((d) => d >= todayIso());
  const keysByDay = {};
  for (const dt of future) {
    keysByDay[dt] = [];
    for (const p of programs) for (const o of origins) for (const de of destinations) if (o !== de) keysByDay[dt].push(`${p}|${o}|${de}|${dt}`);
  }
  return { origins, destinations, programs, days, future, keysByDay };
}

function viewCalendar() {
  const c = state.cal;
  const shortcuts = state.data.routes.map((r) =>
    `<button type="button" class="chip" data-calroute="${esc(r.id)}">${esc(routeLabel(r))}</button>`).join("");
  const form = `
    <section class="panel">
      <label class="field"><span>Programa</span>${seg("c-program", c.program, PROGRAM_ITEMS)}</label>
      <div class="row2 swap-row">
        <label class="field"><span>Origem</span>${airportInput("c-origin", c.origin, "GRU ou SAO")}</label>
        <button type="button" class="swap" id="c-swap" aria-label="Inverter origem e destino">⇄</button>
        <label class="field"><span>Destino</span>${airportInput("c-destination", c.destination, "MIA")}</label>
      </div>
      <label class="field"><span>Cabine</span>${seg("c-cabin", c.cabin, cabinItems(["economy", "business"], false))}</label>
      <div class="month-nav">
        <button type="button" class="icon-btn" data-month="-1" aria-label="Mês anterior">‹</button>
        <input id="c-month" class="input" type="month" min="${todayIso().slice(0, 7)}" value="${esc(c.month)}">
        <button type="button" class="icon-btn" data-month="1" aria-label="Próximo mês">›</button>
      </div>
      ${datalist()}
      ${shortcuts ? `<div class="chips small-chips"><span class="note">Atalhos:</span>${shortcuts}</div>` : ""}
    </section>`;

  const md = calModel();
  if (!md.origins.length || !md.destinations.length || !validAirports(c.origin) || !validAirports(c.destination)) {
    return form + '<div class="empty">Informe origem e destino (código de 3 letras, ex.: GRU → MIA).</div>';
  }
  const keySet = new Set(Object.values(md.keysByDay).flat());
  const awards = withCost(state.data.awards.filter((a) => keySet.has(akey(a)) && a.cabin === c.cabin));
  const best = bestBy(awards, (a) => a.date);
  const allKeys = Object.values(md.keysByDay).flat();
  const cov = coverage(allKeys);
  const checked = state.data.checked || {};

  const costs = Object.values(best).map((a) => a.cost).sort((a, b) => a - b);
  const qt = (p) => costs[Math.min(costs.length - 1, Math.floor(costs.length * p))];
  const cuts = costs.length ? [qt(0.2), qt(0.4), qt(0.6), qt(0.8)] : [];
  const heat = (v) => { let i = 0; while (i < cuts.length && v > cuts[i]) i++; return `h${i}`; };

  const [y, m] = c.month.split("-").map(Number);
  const pad = (new Date(y, m - 1, 1).getDay() + 6) % 7; // semana começa na segunda
  let cells = "";
  for (let i = 0; i < pad; i++) cells += '<div class="cal-day pad"></div>';
  for (const dt of md.days) {
    const n = Number(dt.slice(8));
    const a = best[dt];
    if (dt < todayIso()) cells += `<div class="cal-day none past"><span class="n">${n}</span></div>`;
    else if (a) cells += `<button type="button" class="cal-day ${heat(a.cost)} ${state.calDay === dt ? "sel" : ""}" data-day="${dt}" aria-label="${esc(fmtDate(dt))}: ${brl(a.cost)}"><span class="n">${n}</span><span class="v">${kfmt(a.cost)}</span></button>`;
    else {
      const searched = md.keysByDay[dt].some((k) => checked[k]);
      cells += `<div class="cal-day none ${searched ? "" : "unknown"}" title="${searched ? "sem disponibilidade" : "ainda não buscado"}"><span class="n">${n}</span><span class="v">${searched ? "–" : "?"}</span></div>`;
    }
  }

  const sameReq = (state.data.requests || []).find((r) => r.type === "calendar" && r.month === c.month &&
    r.program === c.program && r.origins.join() === md.origins.join() && r.destinations.join() === md.destinations.join());
  const status = cov.done === cov.total
    ? `<div class="status ok-box">✓ Mês completo · ${num(cov.total)} buscas</div>`
    : `<div class="status"><p class="status-line"><b>${num(cov.done)} de ${num(cov.total)}</b> buscas deste mês já feitas.
        Faltam ${num(cov.total - cov.done)} (${esc(etaText(cov.total - cov.done, md.programs))}).</p>${bar(cov.done, cov.total)}
        ${sameReq && !sameReq.completed_at ? `<p class="note">Pedido enviado ${esc(fmtWhen(sameReq.created_at))} · ${num(sameReq.done ?? 0)} de ${num(sameReq.total ?? 0)} feitas.</p>` : ""}
        ${msgLine("calendar")}${robotButton("calendar", "Pedir ao robô para buscar este mês")}</div>`;

  const dayList = state.calDay ? awards.filter((a) => a.date === state.calDay) : [];
  return `${form}
    ${status}
    <div class="cal-month"><div class="cal-title">${esc(monthName(c.month))} · ${esc(md.origins.join("/"))} → ${esc(md.destinations.join("/"))}</div>
      <div class="cal-grid">${["seg", "ter", "qua", "qui", "sex", "sáb", "dom"].map((w) => `<div class="cal-dow">${w}</div>`).join("")}${cells}</div></div>
    <div class="legend">barato <i class="h0"></i><i class="h1"></i><i class="h2"></i><i class="h3"></i><i class="h4"></i> caro · <b>–</b> sem vaga · <b>?</b> não buscado</div>
    <div id="day-detail">
      ${state.calDay ? `<h2>${esc(fmtDate(state.calDay))}</h2><div class="list">${dayList.map((a) => awardCard(a)).join("") || '<div class="empty">Sem resgates.</div>'}</div>` : '<p class="note">Toque num dia para ver os voos e emitir.</p>'}
    </div>`;
}

// ====== Alertas (rotas monitoradas) ======
function describeRule(rule) {
  const parts = [];
  if (rule.max_miles != null) parts.push(`até ${num(rule.max_miles)} milhas`);
  if (rule.max_cost_brl != null) parts.push(`até ${brl(rule.max_cost_brl)}`);
  if (rule.cabin) parts.push(`na ${CABINS[rule.cabin] ?? rule.cabin}`);
  if (rule.program) parts.push(`(${progLabel(rule.program)})`);
  return parts.length ? `Avisar quando custar ${parts.join(" ")}` : "sem alerta";
}

function viewAlerts() {
  const m = state.mon;
  const lc = state.data.last_command;
  const lastCmd = lc && lc.type?.startsWith("monitor") && Date.now() - new Date(lc.at) < 864e5
    ? `<p class="note ${lc.ok ? "okc" : "errc"}">Último pedido ao robô (${esc(fmtWhen(lc.at))}): ${esc(lc.message)}</p>` : "";
  const hitsByRoute = {};
  for (const h of state.data.alerts || []) (hitsByRoute[h.route_id] ||= []).push(h.award);

  const routes = state.data.routes.map((r) => {
    const hits = hitsByRoute[r.id] || [];
    const progs = !r.programs || r.programs.length === 3 ? "todos os programas" : r.programs.map(progLabel).join(", ");
    return `<div class="mon-card">
      <div class="card-head"><b>${esc(routeLabel(r))}</b>
        ${hits.length ? `<span class="tag hot">${num(hits.length)} no alvo</span>` : '<span class="tag">nenhum no alvo</span>'}</div>
      <div class="note">${esc(r.origins.join(", "))} → ${esc(r.destinations.join(", "))} · ${esc(fmtShort(r.date_from))} a ${esc(fmtShort(r.date_to))}</div>
      <div class="note">${esc(r.cabins.map((c) => CABINS[c] ?? c).join(" e "))} · ${esc(progs)} · ${r.passengers} pax</div>
      ${(r.alerts || []).map((a) => `<div class="note">🔔 ${esc(describeRule(a))}</div>`).join("") || '<div class="note">🔕 sem alerta configurado</div>'}
      <div class="mon-actions">
        <button type="button" class="link-btn" data-showroute="${esc(r.id)}">Ver resultados</button>
        ${r.managed_by === "app" ? (state.token ? `<button type="button" class="link-btn danger" data-remove="${esc(r.id)}" ${state.sending["rm-" + r.id] ? "disabled" : ""}>${state.sending["rm-" + r.id] ? "Removendo…" : "Remover"}</button>` : "") : '<span class="note">definida no config</span>'}
      </div>
      ${msgLine("rm-" + r.id)}
    </div>`;
  }).join("");

  const hits = withCost(Object.values(Object.fromEntries((state.data.alerts || []).map((h) => [akey(h.award) + h.award.cabin, h.award]))))
    .filter((a) => state.programs.has(a.program));
  const unitLabel = m.unit === "miles" ? "milhas" : "R$";
  const form = `
    <form id="mon-form" class="panel" autocomplete="off" novalidate>
      <div class="row2">
        <label class="field"><span>Origem</span>${airportInput("m-origin", m.origin, "GRU ou SAO")}</label>
        <label class="field"><span>Destino</span>${airportInput("m-destination", m.destination, "MIA ou FLORIDA")}</label>
      </div>
      <div class="row2">
        <label class="field"><span>De</span><input id="m-from" class="input" type="date" min="${todayIso()}" value="${esc(m.date_from)}"></label>
        <label class="field"><span>Até</span><input id="m-to" class="input" type="date" min="${esc(m.date_from || todayIso())}" value="${esc(m.date_to)}"></label>
      </div>
      <label class="field"><span>Programa</span>${seg("m-program", m.program, PROGRAM_ITEMS)}</label>
      <label class="field"><span>Cabine</span>${seg("m-cabin", m.cabin, [["economy", "Econômica"], ["business", "Executiva"], ["both", "As duas"]])}</label>
      <label class="field"><span>Me avise quando custar até</span>
        <div class="row2 limit-row">
          <input id="m-limit" class="input" type="number" inputmode="decimal" min="0" step="any" placeholder="${m.unit === "miles" ? "ex.: 35000" : "ex.: 1500"}" value="${esc(m.limit)}">
          ${seg("m-unit", m.unit, [["miles", "milhas"], ["brl", "R$"]])}
        </div></label>
      <label class="field"><span>Nome <em>(opcional)</em></span><input id="m-name" class="input" maxlength="60" placeholder="ex.: Férias Flórida" value="${esc(m.name)}"></label>
      ${datalist()}
      <p class="note">O limite vale por pessoa, só ida${m.cabin === "both" ? ", em qualquer cabine" : ""} — em ${unitLabel}${m.unit === "brl" ? " (milhas × milheiro + taxas)" : ""}.</p>
      ${msgLine("monitor")}
      ${state.token ? `<button class="btn" type="submit" ${state.sending.monitor ? "disabled" : ""}>${state.sending.monitor ? "Enviando…" : "Monitorar esta rota"}</button>` : needToken()}
    </form>`;

  return `
    ${lastCmd}
    <h2 style="margin-top:4px">Rotas monitoradas</h2>
    <p class="note">O robô rebusca estas rotas continuamente e avisa quando o preço fica abaixo do seu limite.</p>
    <div class="stack" style="margin-top:8px">${routes || '<div class="empty">Nenhuma rota monitorada ainda.</div>'}</div>
    <h2>Nova rota monitorada</h2>
    ${form}
    <h2>Resgates que bateram seus alertas</h2>
    <div class="list">${hits.length ? hits.slice(0, 50).map((a) => awardCard(a)).join("") : '<div class="empty">Nenhum resgate abaixo dos seus limites por enquanto.</div>'}</div>
    <p class="note" style="margin-top:12px">Os avisos pelo Telegram chegam numa próxima etapa.</p>`;
}

function readMonForm() {
  const v = (id) => $(id)?.value;
  if (!$("#mon-form")) return;
  Object.assign(state.mon, {
    origin: (v("#m-origin") ?? "").trim().toUpperCase(), destination: (v("#m-destination") ?? "").trim().toUpperCase(),
    date_from: v("#m-from") ?? "", date_to: v("#m-to") ?? "", limit: v("#m-limit") ?? "", name: v("#m-name") ?? "",
  });
}

function submitMonitor() {
  readMonForm();
  const m = state.mon;
  const err =
    !expandAirports(m.origin).length || !validAirports(m.origin) ? "Informe a origem (ex.: GRU ou SAO)." :
    !expandAirports(m.destination).length || !validAirports(m.destination) ? "Informe o destino (ex.: MIA)." :
    !m.date_from || !m.date_to ? "Escolha o período (de / até)." :
    m.date_to < m.date_from ? "A data final deve ser depois da inicial." :
    m.date_to < todayIso() ? "Esse período já passou." :
    (parseDate(m.date_to) - parseDate(m.date_from)) / 864e5 > 366 ? "Período máximo de 1 ano." :
    !(Number(m.limit) > 0) ? "Informe o valor-limite do alerta." : null;
  if (err) { state.msgs.monitor = { ok: false, text: err }; render(); return; }
  const cabins = m.cabin === "both" ? ["economy", "business"] : [m.cabin];
  const alert = m.cabin === "both" ? {} : { cabin: m.cabin };
  if (m.unit === "miles") alert.max_miles = Math.round(Number(m.limit)); else alert.max_cost_brl = Number(m.limit);
  sendCommand("monitor", {
    type: "monitor_add", name: m.name.trim(), origin: m.origin, destination: m.destination,
    date_from: m.date_from, date_to: m.date_to, program: m.program, cabins, alert,
  }, "Pedido enviado! Em ~2 minutos a rota aparece na lista acima (toque em ↻). A primeira busca completa leva algumas rodadas.");
}

// ====== Monitoradas (resultados) ======
function viewBest() {
  const routes = state.data.routes;
  if (!routes.length) return '<div class="empty">Nenhuma rota monitorada. Crie uma na aba <a href="#" data-goto="alerts">Alertas</a>.</div>';
  if (state.route !== "all" && !routeOf(state.route)) state.route = "all";
  const r = state.route === "all" ? null : routeOf(state.route);
  const list = withCost(state.data.awards.filter((a) =>
    (r ? inRoute(a, r) : routes.some((x) => inRoute(a, x))) && (state.cabin === "all" || a.cabin === state.cabin) && state.programs.has(a.program)));
  const shown = list.slice(0, state.limit);
  const pax = r?.passengers > 1 ? r.passengers : 1;
  const sel = `<select id="f-route" class="select" aria-label="Rota monitorada">
    <option value="all" ${state.route === "all" ? "selected" : ""}>Todas as rotas monitoradas</option>
    ${routes.map((x) => `<option value="${esc(x.id)}" ${x.id === state.route ? "selected" : ""}>${esc(routeLabel(x))}</option>`).join("")}</select>`;
  return `
    <section class="filters">
      ${sel}
      ${seg("f-cabin", state.cabin, cabinItems(["economy", "business"], true))}
      ${programChips()}
    </section>
    ${r ? `<p class="note">${esc(r.origins.join(", "))} → ${esc(r.destinations.join(", "))} · ${esc(fmtShort(r.date_from))} a ${esc(fmtShort(r.date_to))}${(r.alerts || []).length ? " · 🔔 " + esc(r.alerts.map(describeRule).join("; ")) : ""}</p>` : ""}
    <p class="muted small">${num(list.length)} resgates${isPartial() ? " (parcial)" : ""} · ordenados pelo custo em R$ (milhas × milheiro + taxas), por pessoa, só ida</p>
    <div class="list" style="margin-top:8px">
      ${shown.length ? shown.map((a) => awardCard(a, pax)).join("") : '<div class="empty">Nenhum resgate com esses filtros (ainda).</div>'}
    </div>
    ${list.length > shown.length ? `<button class="more" id="more" type="button">Mostrar mais (${num(list.length - shown.length)})</button>` : ""}`;
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
    <h2 style="margin-top:4px">Chave do GitHub (para pedir ao robô)</h2>
    ${state.token ? `<p class="note okc">✓ Chave cadastrada neste aparelho.</p>` : `<p class="note">Sem chave, o app só mostra o que já foi buscado e não consegue criar rotas monitoradas.</p>`}
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
      state.tokenMsg = { ok: true, text: "Chave salva e funcionando." };
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
  if (!p || !p.total || !["best", "alerts"].includes(state.tab)) { el.hidden = true; return; }
  const pct = Math.floor((100 * p.done) / p.total);
  let html;
  if (p.just_completed || pct >= 100) html = `<span class="ok">✓ Busca completa</span> · ${num(p.total)} buscas · ranking final`;
  else if (p.last_completed_at) html = `<span class="ok">✓ Ranking completo</span> (busca de ${esc(fmtWhen(p.last_completed_at))}) · atualizando preços: <b>${pct}%</b>${bar(p.done, p.total)}`;
  else html = `Buscando aos poucos: <b>${pct}%</b> (${num(p.done)} de ${num(p.total)} buscas) · resultados parciais${bar(p.done, p.total)}`;
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
    q: state.q, qRan: state.qRan, qCabin: state.qCabin, cal: state.cal, mon: { ...state.mon, limit: state.mon.limit },
  });
}

function readForms() {
  const v = (id) => $(id)?.value;
  if ($("#search-form")) {
    state.q.origin = (v("#q-origin") ?? "").trim().toUpperCase();
    state.q.destination = (v("#q-destination") ?? "").trim().toUpperCase();
    state.q.date = v("#q-date") ?? "";
    state.q.return_date = v("#q-return") ?? "";
  }
  if ($("#c-origin")) {
    state.cal.origin = (v("#c-origin") ?? "").trim().toUpperCase();
    state.cal.destination = (v("#c-destination") ?? "").trim().toUpperCase();
    if (/^\d{4}-\d{2}$/.test(v("#c-month") || "")) state.cal.month = v("#c-month");
  }
  readMonForm();
}

const rerender = () => { savePrefs(); render(); };

document.addEventListener("submit", (e) => {
  e.preventDefault();
  readForms();
  if (e.target.id === "search-form") {
    Object.assign(state, { qRan: true, qDest: null, qLeg: 0, qLimit: PAGE });
    delete state.msgs.search;
    document.activeElement?.blur?.();
    rerender();
    $("#search-results")?.scrollIntoView({ behavior: "smooth", block: "start" });
  } else if (e.target.id === "mon-form") {
    savePrefs();
    submitMonitor();
  }
});

document.addEventListener("click", (e) => {
  const link = e.target.closest("[data-goto]");
  if (link) { e.preventDefault(); readForms(); state.tab = link.dataset.goto; rerender(); window.scrollTo(0, 0); return; }
  const t = e.target.closest("button");
  if (!t) return;
  readForms();
  const inSeg = (id) => t.closest(`#${id}`);
  if (t.dataset.tab) { state.tab = t.dataset.tab; window.scrollTo(0, 0); }
  // Buscar
  else if (inSeg("q-program")) { state.q.program = t.dataset.v; delete state.msgs.search; }
  else if (inSeg("q-flex")) { state.q.flex = Number(t.dataset.v); delete state.msgs.search; }
  else if (inSeg("q-cabin")) { state.qCabin = t.dataset.v; state.qLimit = PAGE; }
  else if (inSeg("q-leg")) { state.qLeg = Number(t.dataset.v); state.qLimit = PAGE; }
  else if (t.id === "q-clear-return") { state.q.return_date = ""; state.qLeg = 0; delete state.msgs.search; }
  else if (t.dataset.dest !== undefined) { state.qDest = t.dataset.dest || null; state.qLimit = PAGE; }
  else if (t.id === "q-more") state.qLimit += PAGE;
  else if (t.dataset.req) {
    const r = state.data.requests.find((x) => x.id === t.dataset.req);
    if (!r) return;
    state.q = { program: r.program, origin: r.origins.join(","), destination: r.any_destination ? "" : r.destinations.join(","), date: r.date, return_date: r.return_date || "", flex: Number(r.flex) || 0 };
    Object.assign(state, { qRan: true, qDest: null, qLeg: 0, qLimit: PAGE });
    delete state.msgs.search;
    rerender();
    $("#search-results")?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  else if (t.dataset.send === "search") {
    const q = state.q;
    sendCommand("search", { type: "search", program: q.program, origin: q.origin, destination: q.destination, date: q.date, flex: q.flex, return_date: q.return_date || null },
      "Pedido enviado! O robô começa em ~1 minuto. Volte aqui e toque em ↻ para ver o progresso.");
    return;
  }
  // Calendário
  else if (inSeg("c-program")) { state.cal.program = t.dataset.v; delete state.msgs.calendar; }
  else if (inSeg("c-cabin")) { state.cal.cabin = t.dataset.v; state.calDay = null; }
  else if (t.id === "c-swap") { [state.cal.origin, state.cal.destination] = [state.cal.destination, state.cal.origin]; state.calDay = null; delete state.msgs.calendar; }
  else if (t.dataset.month) {
    const [y, m] = state.cal.month.split("-").map(Number);
    const d = new Date(y, m - 1 + Number(t.dataset.month), 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (ym >= todayIso().slice(0, 7)) { state.cal.month = ym; state.calDay = null; delete state.msgs.calendar; }
  }
  else if (t.dataset.calroute) {
    const r = routeOf(t.dataset.calroute);
    Object.assign(state.cal, { origin: r.origins.join(","), destination: r.destinations.join(","), cabin: r.cabins.includes(state.cal.cabin) ? state.cal.cabin : r.cabins[0] });
    if (state.cal.month < r.date_from.slice(0, 7) || state.cal.month > r.date_to.slice(0, 7)) state.cal.month = (r.date_from > todayIso() ? r.date_from : todayIso()).slice(0, 7);
    state.calDay = null; delete state.msgs.calendar;
  }
  else if (t.dataset.send === "calendar") {
    const c = state.cal;
    sendCommand("calendar", { type: "calendar", program: c.program, origin: c.origin, destination: c.destination, month: c.month },
      "Pedido enviado! O robô vai buscar o mês aos poucos. Toque em ↻ para acompanhar.");
    return;
  }
  else if (t.dataset.day) {
    state.calDay = state.calDay === t.dataset.day ? null : t.dataset.day;
    render();
    if (state.calDay) $("#day-detail")?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  // Alertas
  else if (inSeg("m-program")) state.mon.program = t.dataset.v;
  else if (inSeg("m-cabin")) state.mon.cabin = t.dataset.v;
  else if (inSeg("m-unit")) { state.mon.unit = t.dataset.v; state.mon.limit = ""; }
  else if (t.dataset.remove) {
    const r = routeOf(t.dataset.remove);
    if (!confirm(`Parar de monitorar "${routeLabel(r)}"?`)) return;
    sendCommand("rm-" + r.id, { type: "monitor_remove", id: r.id }, "Pedido enviado! Em ~2 minutos a rota some da lista (toque em ↻).");
    return;
  }
  else if (t.dataset.showroute) { state.route = t.dataset.showroute; state.tab = "best"; state.limit = PAGE; window.scrollTo(0, 0); }
  // Monitoradas
  else if (inSeg("f-cabin")) { state.cabin = t.dataset.v; state.limit = PAGE; }
  else if (t.dataset.p) {
    const p = t.dataset.p;
    if (state.programs.has(p) && state.programs.size > 1) state.programs.delete(p); else state.programs.add(p);
    state.limit = PAGE;
  }
  else if (t.id === "more") state.limit += PAGE;
  // Ajustes
  else if (t.id === "reset-m") { state.milheiro = {}; store.set("milheiro", {}); hotCache = null; }
  else if (t.id === "save-token") { saveToken(); return; }
  else if (t.id === "clear-token") { state.token = ""; store.set("token", ""); state.tokenMsg = { ok: true, text: "Chave removida deste aparelho." }; }
  else if (t.id === "refresh") { load(true); return; }
  else return;
  rerender();
});

document.addEventListener("change", (e) => {
  const t = e.target;
  if (t.id === "f-route") { state.route = t.value; state.limit = PAGE; rerender(); return; }
  if (t.dataset.m) {
    const v = parseFloat(String(t.value).replace(",", "."));
    if (Number.isFinite(v) && v >= 0) state.milheiro[t.dataset.m] = v; else delete state.milheiro[t.dataset.m];
    store.set("milheiro", state.milheiro);
    hotCache = null;
    return; // não re-renderiza enquanto digita
  }
  readForms();
  if (["c-origin", "c-destination", "c-month"].includes(t.id)) { state.calDay = null; delete state.msgs.calendar; rerender(); return; }
  if (t.id === "q-date" && state.q.return_date && state.q.return_date < state.q.date) { state.q.return_date = ""; rerender(); return; }
  if (t.id === "q-return" || t.id === "q-date" || t.id === "m-from") { rerender(); return; }
  savePrefs();
});

async function load(force) {
  $("#updated").textContent = "Carregando…";
  try {
    const res = await fetch("data/results.json" + (force ? `?t=${Date.now()}` : ""), { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.data = await res.json();
    state.data.awards ||= [];
    state.data.routes ||= [];
    hotCache = null;
    if (force) for (const k of Object.keys(state.msgs)) if (state.msgs[k].ok) delete state.msgs[k];
    $("#updated").textContent = `Atualizado ${fmtWhen(state.data.generated_at)}`;
    $("#sample-banner").hidden = !state.data.sample;
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
  if (p.q && typeof p.q === "object") state.q = { ...state.q, ...p.q, flex: Number(p.q.flex) || 0 };
  state.qRan = !!p.qRan;
  if (p.qCabin) state.qCabin = p.qCabin;
  if (p.cal && typeof p.cal === "object") state.cal = { ...state.cal, ...p.cal };
  if (state.cal.month < todayIso().slice(0, 7)) state.cal.month = todayIso().slice(0, 7);
  if (p.mon && typeof p.mon === "object") state.mon = { ...state.mon, ...p.mon };
  state.milheiro = store.get("milheiro", {}) || {};
  state.token = store.get("token", "") || "";
  render();
  load(false);
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
