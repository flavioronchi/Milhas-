"""Busca aos poucos: decide quais buscas fazer em cada rodada e acompanha a varredura.

Uma *varredura* é uma passada completa por todas as buscas (programa × trecho × data)
das rotas configuradas. Cada rodada faz só um lote; quando todas as buscas da
varredura atual foram feitas, ela é marcada como completa e uma nova começa.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

from .models import Route


@dataclass(frozen=True)
class Task:
    program: str
    origin: str
    destination: str
    day: date
    route_id: str

    @property
    def key(self) -> str:
        return f"{self.program}|{self.origin}|{self.destination}|{self.day.isoformat()}"


def all_tasks(routes: list[Route], programs: tuple[str, ...], today: date) -> list[Task]:
    """Todas as buscas, ignorando datas passadas. Ordem: datas mais próximas primeiro,
    alternando trechos, para os resultados parciais já cobrirem todas as combinações."""
    seen, tasks = set(), []
    for r in routes:
        day = max(r.date_from, today)
        while day <= r.date_to:
            for origin, destination in r.pairs():
                for program in programs:
                    t = Task(program, origin, destination, day, r.id)
                    if t.key not in seen:
                        seen.add(t.key)
                        tasks.append(t)
            day += timedelta(days=1)
    return tasks


def pick_batch(tasks: list[Task], checked: dict[str, str], sweep_started_at: str, limit: int) -> list[Task]:
    """Lote da rodada: primeiro o que ainda não foi buscado nesta varredura,
    começando pelo que nunca foi buscado, depois o mais antigo."""
    pending = [t for t in tasks if checked.get(t.key, "") < sweep_started_at]
    pending.sort(key=lambda t: checked.get(t.key, ""))  # "" (nunca) vem primeiro; sort é estável
    return pending[:limit]
