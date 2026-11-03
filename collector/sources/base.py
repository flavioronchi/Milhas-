from __future__ import annotations

from abc import ABC, abstractmethod

from ..models import Award, Route


class Source(ABC):
    """Uma fonte de disponibilidade. Cada programa de milhas é uma fonte isolada,
    para que a quebra de uma não afete as outras."""

    name: str
    is_sample: bool = False

    @abstractmethod
    def fetch(self, route: Route) -> list[Award]:
        """Retorna os resgates disponíveis para a rota (todas as datas e cabines)."""
