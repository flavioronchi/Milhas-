from .base import Source
from .sample import SampleSource

# Cada programa real (smiles, latam, azul) entra aqui conforme for implementado.
REGISTRY: dict[str, type[Source]] = {
    SampleSource.name: SampleSource,
}


def get_source(name: str) -> Source:
    try:
        return REGISTRY[name]()
    except KeyError:
        raise ValueError(
            f"Fonte desconhecida '{name}'. Disponíveis: {', '.join(sorted(REGISTRY))}"
        ) from None
