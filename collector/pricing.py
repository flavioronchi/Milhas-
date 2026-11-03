from __future__ import annotations

from .models import Award


def cost_brl(award: Award, milheiro_brl: dict[str, float]) -> float:
    """Custo equivalente em R$: milhas valoradas pelo milheiro do programa + taxas."""
    rate = milheiro_brl.get(award.program)
    if rate is None:
        raise KeyError(f"Sem valor de milheiro para o programa '{award.program}'")
    return round(award.miles / 1000 * rate + award.taxes_brl, 2)


def matching_alerts(award: Award, alerts) -> list[dict]:
    """Regras de alerta (da rota) satisfeitas por este resgate."""
    hits = []
    for rule in alerts:
        if rule.get("cabin") and rule["cabin"] != award.cabin:
            continue
        if rule.get("program") and rule["program"] != award.program:
            continue
        if "max_miles" in rule and award.miles > rule["max_miles"]:
            continue
        if "max_cost_brl" in rule and (award.cost_brl or 0) > rule["max_cost_brl"]:
            continue
        hits.append(rule)
    return hits
