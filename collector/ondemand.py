"""Comandos vindos do app (via GitHub Actions) — sempre validados, pois são dados externos.

Tipos de comando:
- search:   programa, origem, destino (vazio = destinos populares), data (± flex) e volta opcional.
- calendar: programa, origem, destino e mês (AAAA-MM) — busca todos os dias do mês.
- monitor_add / monitor_remove: rotas monitoradas continuamente, com regra de alerta.

Buscas (search/calendar) viram rotas temporárias cobertas aos poucos, com prioridade
sobre as rotas monitoradas.
"""
from __future__ import annotations

import calendar
import hashlib
import json
import re
from datetime import date, datetime, timedelta, timezone

from .models import CABINS, PROGRAMS, Route

IATA = re.compile(r"^[A-Z]{3}$")
MAX_REQUESTS = 15  # mantém só os pedidos mais recentes
MAX_MONITORS = 20
REUSE_HOURS = 12  # buscas feitas há menos que isso são reaproveitadas
DEFAULT_CABINS = ("economy", "business")
MAX_FLEX = 3
MAX_MONITOR_DAYS = 366


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _groups(config: dict) -> dict[str, list[str]]:
    return {k.upper(): v for k, v in config.get("airport_groups", {}).items()}


def parse_airports(value, groups: dict[str, list[str]]) -> list[str]:
    """'GRU', 'gru, vcp' ou um grupo do config ('SAO') → ['GRU', 'VCP']."""
    out: list[str] = []
    for part in re.split(r"[\s,;/]+", str(value or "").upper()):
        if not part:
            continue
        for c in groups.get(part, [part]):
            if not IATA.match(c):
                raise ValueError(f"Aeroporto inválido: '{c}' (use o código de 3 letras, ex.: GRU)")
            if c not in out:
                out.append(c)
    return out


def _program(raw: dict) -> str:
    program = str(raw.get("program") or "all").lower()
    if program != "all" and program not in PROGRAMS:
        raise ValueError(f"Programa inválido: '{program}'")
    return program


def _date(value, label: str) -> date:
    try:
        return date.fromisoformat(str(value or ""))
    except ValueError:
        raise ValueError(f"{label} inválida") from None


def _short_id(prefix: str, payload) -> str:
    return prefix + hashlib.sha1(json.dumps(payload, sort_keys=True).encode()).hexdigest()[:10]


# ---------------------------------------------------------------- buscas
def normalize_search(raw: dict, config: dict, today: date) -> dict:
    groups = _groups(config)
    kind = raw.get("type", "search")
    program = _program(raw)
    origins = parse_airports(raw.get("origin"), groups)
    if not origins:
        raise ValueError("Informe a origem")
    destinations = parse_airports(raw.get("destination"), groups)
    any_destination = not destinations
    if any_destination:
        if kind == "calendar":
            raise ValueError("No calendário, informe o destino")
        destinations = [d for d in config.get("popular_destinations", []) if d not in origins]

    legs: list[dict] = []
    display: dict = {}
    if kind == "calendar":
        m = re.fullmatch(r"(\d{4})-(\d{2})", str(raw.get("month") or ""))
        if not m:
            raise ValueError("Mês inválido (use AAAA-MM)")
        y, mo = int(m[1]), int(m[2])
        first, last = date(y, mo, 1), date(y, mo, calendar.monthrange(y, mo)[1])
        if last < today:
            raise ValueError("Esse mês já passou")
        legs.append({"origins": origins, "destinations": destinations, "from": max(first, today).isoformat(), "to": last.isoformat()})
        display = {"month": f"{y:04d}-{mo:02d}"}
    else:
        day = _date(raw.get("date"), "Data de ida")
        if day < today:
            raise ValueError("A data de ida já passou")
        flex = int(raw.get("flex") or 0)
        if not 0 <= flex <= MAX_FLEX:
            raise ValueError(f"Flexibilidade deve ser de 0 a {MAX_FLEX} dias")
        legs.append({"origins": origins, "destinations": destinations,
                     "from": max(day - timedelta(days=flex), today).isoformat(), "to": (day + timedelta(days=flex)).isoformat()})
        display = {"date": day.isoformat(), "flex": flex, "return_date": None}
        if raw.get("return_date"):
            back = _date(raw.get("return_date"), "Data de volta")
            if back < day:
                raise ValueError("A volta deve ser depois da ida")
            legs.append({"origins": destinations, "destinations": origins,
                         "from": max(back - timedelta(days=flex), today).isoformat(), "to": (back + timedelta(days=flex)).isoformat()})
            display["return_date"] = back.isoformat()

    req = {
        "type": kind,
        "program": program,
        "origins": origins,
        "destinations": destinations,
        "any_destination": any_destination,
        "legs": legs,
        **display,
    }
    req["id"] = _short_id("req-", [kind, program, origins, "*" if any_destination else destinations, legs])
    return req


def to_routes(req: dict, today: date) -> list[Route]:
    routes = []
    for i, leg in enumerate(req["legs"]):
        routes.append(Route(
            id=f"{req['id']}-{i}",
            origins=tuple(leg["origins"]),
            destinations=tuple(leg["destinations"]),
            date_from=max(date.fromisoformat(leg["from"]), today),
            date_to=date.fromisoformat(leg["to"]),
            cabins=DEFAULT_CABINS,
            programs=PROGRAMS if req["program"] == "all" else (req["program"],),
        ))
    return routes


def add_request(state: dict, req: dict, now: datetime) -> dict:
    """Registra (ou renova) o pedido; o mais recente vai para o topo."""
    reqs = [r for r in state.get("requests", []) if r["id"] != req["id"]]
    entry = {
        **req,
        "created_at": now.isoformat(timespec="microseconds"),
        "fresh_after": (now - timedelta(hours=REUSE_HOURS)).isoformat(timespec="microseconds"),
        "completed_at": None,
    }
    state["requests"] = [entry] + reqs[: MAX_REQUESTS - 1]
    return entry


def request_last_day(req: dict) -> str:
    return max(leg["to"] for leg in req.get("legs", [])) if req.get("legs") else req.get("date", "")


# ---------------------------------------------------------------- monitoradas
def normalize_monitor(raw: dict, config: dict, today: date) -> dict:
    """Rota monitorada criada no app → dicionário no formato de rota do config."""
    groups = _groups(config)
    origins = parse_airports(raw.get("origin"), groups)
    destinations = parse_airports(raw.get("destination"), groups)
    if not origins or not destinations:
        raise ValueError("Informe origem e destino da rota monitorada")
    d_from = _date(raw.get("date_from"), "Data inicial")
    d_to = _date(raw.get("date_to"), "Data final")
    if d_to < d_from:
        raise ValueError("A data final deve ser depois da inicial")
    if d_to < today:
        raise ValueError("O período já passou")
    if (d_to - max(d_from, today)).days > MAX_MONITOR_DAYS:
        raise ValueError("Período máximo de 1 ano")
    program = _program(raw)
    cabins = raw.get("cabins") or ["economy"]
    if isinstance(cabins, str):
        cabins = [cabins]
    for c in cabins:
        if c not in CABINS:
            raise ValueError(f"Cabine inválida: '{c}'")
    passengers = int(raw.get("passengers") or 1)
    if not 1 <= passengers <= 9:
        raise ValueError("Passageiros: de 1 a 9")

    alert: dict = {}
    a = raw.get("alert") or {}
    if a.get("cabin"):
        if a["cabin"] not in cabins:
            raise ValueError("A cabine do alerta precisa estar entre as cabines monitoradas")
        alert["cabin"] = a["cabin"]
    if a.get("max_miles") not in (None, ""):
        alert["max_miles"] = int(a["max_miles"])
        if alert["max_miles"] <= 0:
            raise ValueError("Limite de milhas inválido")
    if a.get("max_cost_brl") not in (None, ""):
        alert["max_cost_brl"] = float(a["max_cost_brl"])
        if alert["max_cost_brl"] <= 0:
            raise ValueError("Limite em R$ inválido")
    if program != "all":
        alert["program"] = program

    name = str(raw.get("name") or "").strip()[:60] or f"{'/'.join(origins)} → {'/'.join(destinations)}"
    route = {
        "name": name,
        "origin": origins,
        "destination": destinations,
        "date_from": d_from.isoformat(),
        "date_to": d_to.isoformat(),
        "cabins": list(dict.fromkeys(cabins)),
        "passengers": passengers,
        "programs": program,
        "alerts": [alert] if ("max_miles" in alert or "max_cost_brl" in alert) else [],
    }
    route["id"] = _short_id("m-", route)
    Route.from_dict(route)  # validação final
    return route


def apply_monitor_command(monitors: list[dict], cmd: dict, config: dict, today: date) -> str:
    if cmd.get("type") == "monitor_add":
        route = normalize_monitor(cmd, config, today)
        if len(monitors) >= MAX_MONITORS:
            raise ValueError(f"Máximo de {MAX_MONITORS} rotas monitoradas")
        monitors[:] = [m for m in monitors if m["id"] != route["id"]] + [route]
        return f"Rota monitorada adicionada: {route['name']} ({route['id']})"
    target = str(cmd.get("id") or "")
    before = len(monitors)
    monitors[:] = [m for m in monitors if m["id"] != target]
    if len(monitors) == before:
        raise ValueError(f"Rota monitorada não encontrada: '{target}'")
    return f"Rota monitorada removida: {target}"
