from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import date

from ..models import Award, Route


class Source(ABC):
    """Uma fonte de disponibilidade. Cada programa de milhas é uma fonte isolada,
    para que a quebra de uma não afete as outras.

    A unidade de trabalho é uma *busca*: um programa, um trecho (origem → destino)
    e uma data. O agendador chama `search` algumas vezes por rodada (aos poucos),
    até cobrir todas as datas das rotas.
    """

    name: str
    programs: tuple[str, ...]  # programas cobertos por esta fonte
    is_sample: bool = False
    per_run: int = 40  # buscas por rodada (padrão; pode ser trocado no config)
    delay_seconds: float = 5.0  # pausa entre buscas, para não sobrecarregar o site

    @abstractmethod
    def search(self, program: str, origin: str, destination: str, day: date, route: Route) -> list[Award]:
        """Resgates disponíveis nessa data (todas as cabines da rota). Lista vazia = sem disponibilidade.
        Deve levantar exceção se a busca falhar (bloqueio, erro de rede etc.)."""

    def close(self) -> None:
        """Libera recursos (navegador, sessão HTTP) ao fim da rodada."""
