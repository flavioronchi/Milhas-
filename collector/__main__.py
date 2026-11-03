"""Executa todas as fontes configuradas e grava web/data/results.json.

Uso:  python -m collector [--config config/config.json] [--out web/data/results.json]
"""
from __future__ import annotations

import argparse
import json
import sys
import traceback
from datetime import datetime, timezone
from pathlib import Path

from .models import Route
from .pricing import cost_brl, matching_alerts
from .sources import get_source

ROOT = Path(__file__).resolve().parent.parent


def run(config_path: Path, out_path: Path) -> int:
    config = json.loads(config_path.read_text(encoding="utf-8"))
    milheiro = config["milheiro_brl"]
    routes = [Route.from_dict(r) for r in config["routes"]]
    sources = [get_source(n) for n in config.get("sources", [])]

    awards, errors, alerts = [], [], []
    for source in sources:
        for route in routes:
            try:
                found = source.fetch(route)
            except Exception as exc:  # uma fonte quebrada não derruba as outras
                traceback.print_exc()
                errors.append({"source": source.name, "route_id": route.id, "error": str(exc)})
                continue
            for a in found:
                a.cost_brl = cost_brl(a, milheiro)
                for rule in matching_alerts(a, route.alerts):
                    alerts.append({"rule": rule, "award": a.to_dict()})
                awards.append(a.to_dict())
            print(f"[{source.name}] {route.id}: {len(found)} resgates")

    awards.sort(key=lambda a: (a["cost_brl"], a["date"]))
    result = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "sample": any(s.is_sample for s in sources),
        "milheiro_brl": milheiro,
        "routes": [r.to_dict() for r in routes],
        "awards": awards,
        "alerts": alerts,
        "errors": errors,
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(awards)} resgates, {len(alerts)} alertas, {len(errors)} erros → {out_path}")
    return 1 if errors and not awards else 0


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--config", type=Path, default=ROOT / "config" / "config.json")
    p.add_argument("--out", type=Path, default=ROOT / "web" / "data" / "results.json")
    args = p.parse_args()
    sys.exit(run(args.config, args.out))


if __name__ == "__main__":
    main()
