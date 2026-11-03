"""Busca aos poucos: decide quais buscas fazer em cada rodada e acompanha o progresso.

- Pedidos sob demanda (feitos no app) têm prioridade: cada um é coberto uma vez.
- Rotas monitoradas são cobertas em *varreduras*: uma passada completa por todas as
  buscas (programa × trecho × data). Quando termina, a varredura é marcada como
  completa e uma nova começa, para manter os preços atualizados.
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
    route: Route

    @property
    def key(self) -> str:
        return task_key(self.program, self.origin, self.destination, self.day.isoformat())


def task_key(program: str, origin: str, destination: str, day: str) -> str:
    return f"{program}|{origin}|{destination}|{day}"


def all_tasks(routes: list[Route], programs: tuple[str, ...], today: date) -> list[Task]:
    """Todas as buscas, ignorando datas passadas. Ordem: datas mais próximas primeiro,
    alternando trechos, para os resultados parciais já cobrirem todas as combinações."""
    seen, tasks = set(), []
    for r in routes:
        progs = [p for p in programs if p in r.programs]
        day = max(r.date_from, today)
        while day <= r.date_to:
            for origin, destination in r.pairs():
                for program in progs:
                    t = Task(program, origin, destination, day, r)
                    if t.key not in seen:
                        seen.add(t.key)
                        tasks.append(t)
            day += timedelta(days=1)
    return tasks


def pending(tasks: list[Task], checked: dict[str, str], since: str) -> list[Task]:
    """Buscas não feitas desde `since`; as nunca feitas primeiro, depois as mais antigas."""
    out = [t for t in tasks if checked.get(t.key, "") < since]
    out.sort(key=lambda t: checked.get(t.key, ""))  # sort estável mantém a ordem por data
    return out
