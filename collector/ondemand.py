"""Buscas sob demanda, pedidas pelo app (via GitHub Actions).

Um pedido tem: programa (ou "all"), origem, destino (vazio = destinos populares),
data e flexibilidade (0 = data exata, 2 = ± 2 dias). Ele vira uma rota temporária
que o coletor cobre aos poucos, com prioridade sobre as rotas monitoradas.
"""
from __future__ import annotations

import hashlib
import json
import re
from datetime import date, datetime, timedelta, timezone

from .models import PROGRAMS, Route

IATA = re.compile(r"^[A-Z]{3}$")
MAX_REQUESTS = 15  # mantém só os pedidos mais recentes
REUSE_HOURS = 12  # buscas feitas há menos que isso são reaproveitadas
DEFAULT_CABINS = ("economy", "business")


def parse_airports(value: str | None, groups: dict[str, list[str]]) -> list[str]:
    """'GRU', 'gru, vcp' ou um grupo do config ('SAO') → ['GRU', 'VCP']."""
    out: list[str] = []
    for part in re.split(r"[\s,;/]+", (value or "").upper()):
        if not part:
            continue
        codes = groups.get(part, [part])
        for c in codes:
            if not IATA.match(c):
                raise ValueError(f"Aeroporto inválido: '{c}' (use o código de 3 letras, ex.: GRU)")
            if c not in out:
                out.append(c)
    return out


def normalize(raw: dict, config: dict, today: date) -> dict:
    """Valida o pedido vindo do app (dado externo: valida tudo)."""
    groups = {k.upper(): v for k, v in config.get("airport_groups", {}).items()}
    program = str(raw.get("program") or "all").lower()
    if program != "all" and program not in PROGRAMS:
        raise ValueError(f"Programa inválido: '{program}'")
    origins = parse_airports(raw.get("origin"), groups)
    if not origins:
        raise ValueError("Informe a origem")
    destinations = parse_airports(raw.get("destination"), groups)
    any_destination = not destinations
    if any_destination:
        destinations = [d for d in config.get("popular_destinations", []) if d not in origins]
    day = date.fromisoformat(str(raw.get("date") or ""))
    if day < today:
        raise ValueError("A data já passou")
    flex = int(raw.get("flex") or 0)
    if flex not in (0, 1, 2, 3):
        raise ValueError("Flexibilidade deve ser de 0 a 3 dias")
    key = json.dumps([program, origins, destinations if not any_destination else "*", day.isoformat(), flex])
    return {
        "id": "req-" + hashlib.sha1(key.encode()).hexdigest()[:10],
        "program": program,
        "origins": origins,
        "destinations": destinations,
        "any_destination": any_destination,
        "date": day.isoformat(),
        "flex": flex,
    }


def to_route(req: dict, today: date) -> Route:
    day = date.fromisoformat(req["date"])
    flex = int(req["flex"])
    label_dest = "destinos populares" if req.get("any_destination") else "/".join(req["destinations"])
    return Route(
        id=req["id"],
        origins=tuple(req["origins"]),
        destinations=tuple(req["destinations"]),
        date_from=max(day - timedelta(days=flex), today),
        date_to=day + timedelta(days=flex),
        cabins=DEFAULT_CABINS,
        name=f"{'/'.join(req['origins'])} → {label_dest}",
        programs=PROGRAMS if req["program"] == "all" else (req["program"],),
    )


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


def utcnow() -> datetime:
    return datetime.now(timezone.utc)
