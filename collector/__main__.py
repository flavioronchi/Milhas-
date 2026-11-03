"""Faz uma rodada de buscas (aos poucos) e grava web/data/results.json.

Cada rodada busca só um lote de datas por fonte e guarda o progresso em
data/state.json. Quando todas as datas de todas as rotas forem buscadas, a
varredura é marcada como completa e o ranking final fica disponível no app.

Uso:  python -m collector [--config ...] [--state ...] [--out ...] [--max N]
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import traceback
from datetime import date, datetime, timezone
from pathlib import Path

from .models import Award, Route
from .planner import all_tasks, pick_batch
from .pricing import cost_brl, matching_alerts
from .sources import get_source

ROOT = Path(__file__).resolve().parent.parent
MAX_CONSECUTIVE_FAILURES = 3  # provável bloqueio: para a fonte nesta rodada


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


def load_state(path: Path) -> dict:
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return {}


def run(config_path: Path, state_path: Path, out_path: Path, max_per_source: int | None) -> int:
    config = json.loads(config_path.read_text(encoding="utf-8"))
    milheiro = config["milheiro_brl"]
    pacing = config.get("pacing", {})
    routes = [Route.from_dict(r) for r in config["routes"]]
    routes_by_id = {r.id: r for r in routes}
    sources = [get_source(n) for n in config.get("sources", [])]
    today = date.today()

    state = load_state(state_path)
    sweep = state.setdefault("sweep", {})
    checked: dict[str, str] = state.setdefault("checked", {})
    stored: dict[str, list] = state.setdefault("awards", {})
    if not sweep.get("started_at"):
        sweep.update(number=1, started_at=now_iso(), last_completed_at=None)

    errors, all_keys = [], set()
    for source in sources:
        tasks = all_tasks(routes, source.programs, today)
        all_keys.update(t.key for t in tasks)
        p = pacing.get(source.name, {})
        limit = max_per_source or int(p.get("per_run", source.per_run))
        delay = float(p.get("delay_seconds", source.delay_seconds))
        batch = pick_batch(tasks, checked, sweep["started_at"], limit)
        ok = fails = 0
        try:
            for i, t in enumerate(batch):
                if i and delay:
                    time.sleep(delay)
                try:
                    found = source.search(t.program, t.origin, t.destination, t.day, routes_by_id[t.route_id])
                except Exception as exc:  # uma busca/fonte quebrada não derruba as outras
                    traceback.print_exc()
                    errors.append({"source": source.name, "search": t.key, "error": f"{type(exc).__name__}: {exc}"[:300]})
                    fails += 1
                    if fails >= MAX_CONSECUTIVE_FAILURES:
                        print(f"[{source.name}] {fails} falhas seguidas — parando esta fonte nesta rodada")
                        break
                    continue
                fails = 0
                ok += 1
                stored[t.key] = [a.to_dict() for a in found]
                checked[t.key] = now_iso()
        finally:
            source.close()
        print(f"[{source.name}] {ok}/{len(batch)} buscas feitas nesta rodada")

    # Esquece buscas que não existem mais (datas passadas, rotas removidas).
    for k in list(checked):
        if k not in all_keys:
            checked.pop(k, None)
            stored.pop(k, None)

    done = sum(1 for k in all_keys if checked.get(k, "") >= sweep["started_at"])
    total = len(all_keys)
    just_completed = total > 0 and done == total
    if just_completed:
        sweep["last_completed_at"] = now_iso()
        sweep["last_started_at"] = sweep["started_at"]
        # A próxima rodada começa uma nova varredura (para manter os preços atualizados).
        sweep["number"] = sweep.get("number", 1) + 1
        sweep["started_at"] = now_iso()

    # Monta os resultados com o que há de mais recente para cada busca.
    awards, alerts = [], []
    for k in all_keys:
        for d in stored.get(k, []):
            a = Award(**d)
            route = routes_by_id.get(a.route_id)
            if route is None or a.cabin not in route.cabins:
                continue
            a.cost_brl = cost_brl(a, milheiro)
            row = a.to_dict()
            row["checked_at"] = checked.get(k)
            awards.append(row)
            for rule in matching_alerts(a, route.alerts):
                alerts.append({"rule": rule, "award": row})
    awards.sort(key=lambda a: (a["cost_brl"], a["date"]))

    progress = {
        "sweep_number": sweep["number"] - (1 if just_completed else 0),
        "done": total if just_completed else done,
        "total": total,
        "started_at": sweep.get("last_started_at") if just_completed else sweep["started_at"],
        "just_completed": just_completed,
        "last_completed_at": sweep.get("last_completed_at"),
    }
    result = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "sample": any(s.is_sample for s in sources),
        "milheiro_brl": milheiro,
        "routes": [r.to_dict() for r in routes],
        "progress": progress,
        "awards": awards,
        "alerts": alerts,
        "errors": errors,
    }
    state_path.parent.mkdir(parents=True, exist_ok=True)
    state_path.write_text(json.dumps(state, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    pct = 100 * progress["done"] / total if total else 0
    status = "VARREDURA COMPLETA" if just_completed else f"varredura {progress['sweep_number']}: {pct:.0f}%"
    print(f"{status} ({progress['done']}/{total} buscas) · {len(awards)} resgates · {len(alerts)} alertas · {len(errors)} erros")
    return 1 if errors and not any(checked.get(k, "") >= progress["started_at"] for k in all_keys) else 0


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--config", type=Path, default=ROOT / "config" / "config.json")
    p.add_argument("--state", type=Path, default=ROOT / "data" / "state.json")
    p.add_argument("--out", type=Path, default=ROOT / "web" / "data" / "results.json")
    p.add_argument("--max", type=int, default=None, help="limite de buscas por fonte nesta rodada")
    args = p.parse_args()
    sys.exit(run(args.config, args.state, args.out, args.max))


if __name__ == "__main__":
    main()
