from __future__ import annotations

from dataclasses import dataclass, asdict, field
from datetime import date


CABINS = ("economy", "premium", "business", "first")
PROGRAMS = ("smiles", "latam", "azul")


def _airports(d: dict, key: str) -> tuple[str, ...]:
    """Aceita "GRU" ou ["GRU", "VCP"] no config."""
    v = d[key]
    codes = [v] if isinstance(v, str) else list(v)
    if not codes:
        raise ValueError(f"Rota {d.get('id')}: '{key}' vazio")
    return tuple(c.strip().upper() for c in codes)


def _programs(d: dict) -> tuple[str, ...]:
    """"programs" opcional: lista, "all" ou ausente (= todos)."""
    v = d.get("programs") or "all"
    if v == "all":
        return PROGRAMS
    progs = (v,) if isinstance(v, str) else tuple(v)
    for p in progs:
        if p not in PROGRAMS:
            raise ValueError(f"Rota {d.get('id')}: programa inválido '{p}'")
    return progs


@dataclass(frozen=True)
class Route:
    id: str
    origins: tuple[str, ...]
    destinations: tuple[str, ...]
    date_from: date
    date_to: date
    cabins: tuple[str, ...]
    passengers: int = 1
    alerts: tuple[dict, ...] = ()
    name: str | None = None
    programs: tuple[str, ...] = PROGRAMS

    @classmethod
    def from_dict(cls, d: dict) -> "Route":
        cabins = tuple(d.get("cabins") or ["economy"])
        for c in cabins:
            if c not in CABINS:
                raise ValueError(f"Rota {d.get('id')}: cabine inválida '{c}'")
        return cls(
            id=d["id"],
            origins=_airports(d, "origin"),
            destinations=_airports(d, "destination"),
            date_from=date.fromisoformat(d["date_from"]),
            date_to=date.fromisoformat(d["date_to"]),
            cabins=cabins,
            passengers=int(d.get("passengers", 1)),
            alerts=tuple(d.get("alerts") or ()),
            name=d.get("name"),
            programs=_programs(d),
        )

    def contains(self, origin: str, destination: str, day: str, program: str, cabin: str) -> bool:
        return (
            origin in self.origins
            and destination in self.destinations
            and self.date_from.isoformat() <= day <= self.date_to.isoformat()
            and program in self.programs
            and cabin in self.cabins
        )

    def pairs(self) -> list[tuple[str, str]]:
        """Todas as combinações origem → destino da rota."""
        return [(o, de) for o in self.origins for de in self.destinations if o != de]

    def to_dict(self) -> dict:
        d = asdict(self)
        d["date_from"] = self.date_from.isoformat()
        d["date_to"] = self.date_to.isoformat()
        d["cabins"] = list(self.cabins)
        d["origins"] = list(self.origins)
        d["destinations"] = list(self.destinations)
        d["alerts"] = list(self.alerts)
        d["programs"] = list(self.programs)
        return d


@dataclass
class Award:
    """Um resgate disponível (preço por passageiro, só ida)."""

    program: str
    origin: str
    destination: str
    date: str  # AAAA-MM-DD
    cabin: str
    miles: int
    taxes_brl: float
    seats: int | None = None
    carrier: str | None = None
    flights: list[str] = field(default_factory=list)
    stops: int = 0
    depart: str | None = None  # HH:MM local
    arrive: str | None = None  # HH:MM local (+1 se dia seguinte)
    duration_min: int | None = None
    cost_brl: float | None = None  # calculado por pricing.py
    route_id: str | None = None  # (legado) não é mais usado

    def to_dict(self) -> dict:
        return asdict(self)
