from __future__ import annotations

from dataclasses import dataclass, asdict, field
from datetime import date


CABINS = ("economy", "premium", "business", "first")
PROGRAMS = ("smiles", "latam", "azul")


@dataclass(frozen=True)
class Route:
    id: str
    origin: str
    destination: str
    date_from: date
    date_to: date
    cabins: tuple[str, ...]
    passengers: int = 1
    alerts: tuple[dict, ...] = ()

    @classmethod
    def from_dict(cls, d: dict) -> "Route":
        cabins = tuple(d.get("cabins") or ["economy"])
        for c in cabins:
            if c not in CABINS:
                raise ValueError(f"Rota {d.get('id')}: cabine inválida '{c}'")
        return cls(
            id=d["id"],
            origin=d["origin"].upper(),
            destination=d["destination"].upper(),
            date_from=date.fromisoformat(d["date_from"]),
            date_to=date.fromisoformat(d["date_to"]),
            cabins=cabins,
            passengers=int(d.get("passengers", 1)),
            alerts=tuple(d.get("alerts") or ()),
        )

    def to_dict(self) -> dict:
        d = asdict(self)
        d["date_from"] = self.date_from.isoformat()
        d["date_to"] = self.date_to.isoformat()
        d["cabins"] = list(self.cabins)
        d["alerts"] = list(self.alerts)
        return d


@dataclass
class Award:
    """Um resgate disponível (preço por passageiro, só ida)."""

    route_id: str
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

    def to_dict(self) -> dict:
        return asdict(self)
