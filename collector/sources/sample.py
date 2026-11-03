from __future__ import annotations

import random
from datetime import timedelta

from ..models import Award, Route
from .base import Source

# Faixas plausíveis de milhas (por trecho, por passageiro) — só para demonstração.
_BASE = {
    "smiles": {"economy": (25_000, 95_000), "business": (90_000, 280_000)},
    "latam": {"economy": (30_000, 110_000), "business": (110_000, 320_000)},
    "azul": {"economy": (28_000, 120_000), "business": (100_000, 300_000)},
}
_CARRIERS = {"smiles": ["G3", "AF", "KL", "TP"], "latam": ["LA", "IB", "DL"], "azul": ["AD", "TP", "UA"]}
_LONG_HAUL = {"LIS", "MAD", "CDG", "FCO", "LHR", "MIA", "MCO", "JFK"}


class SampleSource(Source):
    """Gera dados fictícios, determinísticos, para testar o app sem coletores reais."""

    name = "sample"
    is_sample = True

    def fetch(self, route: Route) -> list[Award]:
        awards: list[Award] = []
        for origin, destination in route.pairs():
            awards += self._pair(route, origin, destination)
        return awards

    def _pair(self, route: Route, origin: str, destination: str) -> list[Award]:
        awards: list[Award] = []
        long_haul = destination in _LONG_HAUL or origin in _LONG_HAUL
        scale = 1.0 if long_haul else 0.35
        day = route.date_from
        while day <= route.date_to:
            for program, cabins in _BASE.items():
                for cabin in route.cabins:
                    if cabin not in cabins:
                        continue
                    rng = random.Random(f"{origin}{destination}|{day}|{program}|{cabin}")
                    if rng.random() < (0.6 if cabin == "economy" else 0.85):
                        continue  # sem disponibilidade neste dia
                    lo, hi = cabins[cabin]
                    # distribuição enviesada para valores altos, com algumas pechinchas
                    miles = int((lo + (hi - lo) * rng.random() ** 0.6) * scale / 500) * 500
                    stops = rng.choice([0, 0, 1]) if long_haul else rng.choice([0, 1])
                    dep_h = rng.randint(6, 23)
                    dur = int((600 if long_haul else 240) * (1 + 0.45 * stops) + rng.randint(-30, 60))
                    arr_total = dep_h * 60 + dur
                    arrive = f"{(arr_total // 60) % 24:02d}:{arr_total % 60:02d}"
                    if arr_total >= 24 * 60:
                        arrive += " +1"
                    carrier = rng.choice(_CARRIERS[program])
                    awards.append(
                        Award(
                            route_id=route.id,
                            program=program,
                            origin=origin,
                            destination=destination,
                            date=day.isoformat(),
                            cabin=cabin,
                            miles=max(miles, 5_000),
                            taxes_brl=round(rng.uniform(80, 650 if long_haul else 250), 2),
                            seats=rng.randint(1, 9),
                            carrier=carrier,
                            flights=[f"{carrier}{rng.randint(100, 9999)}" for _ in range(stops + 1)],
                            stops=stops,
                            depart=f"{dep_h:02d}:{rng.choice([0, 15, 30, 45]):02d}",
                            arrive=arrive,
                            duration_min=dur,
                        )
                    )
            day += timedelta(days=1)
        return awards
