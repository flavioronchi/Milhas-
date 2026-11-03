"""Faz uma rodada de buscas (aos poucos) e grava web/data/results.json.

Cada rodada busca só um lote por fonte e guarda o progresso em data/state.json:
primeiro os pedidos feitos no app (sob demanda), depois as rotas monitoradas.

Uso:
  python -m collector                       # rodada normal
  python -m collector --request-env REQ     # registra o pedido em $REQ (JSON) e já começa por ele
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import traceback
from datetime import date
from pathlib import Path

from . import ondemand
from .models import Award, Route
from .planner import Task, all_tasks, pending
from .pricing import cost_brl, matching_alerts
from .sources import get_source

ROOT = Path(__file__).resolve().parent.parent
MAX_CONSECUTIVE_FAILURES = 3  # provável bloqueio: para a fonte nesta rodada


def now_iso() -> str:
    return ondemand.utcnow().isoformat(timespec="microseconds")


def run(config_path: Path, state_path: Path, out_path: Path, max_per_source: int | None, request: dict | None) -> int:
    config = json.loads(config_path.read_text(encoding="utf-8"))
    milheiro = config["milheiro_brl"]
    pacing = config.get("pacing", {})
    monitored = [Route.from_dict(r) for r in config["routes"]]
    sources = [get_source(n) for n in config.get("sources", [])]
    today = date.today()

    state = json.loads(state_path.read_text(encoding="utf-8")) if state_path.exists() else {}
    sweep = state.setdefault("sweep", {})
    checked: dict[str, str] = state.setdefault("checked", {})
    stored: dict[str, list] = state.setdefault("awards", {})
    state.setdefault("requests", [])
    if not sweep.get("started_at"):
        sweep.update(number=1, started_at=now_iso(), last_completed_at=None)

    errors: list[dict] = []
    if request is not None:
        try:
            req = ondemand.normalize(request, config, today)
            ondemand.add_request(state, req, ondemand.utcnow())
            print(f"Pedido registrado: {req['id']} {req['origins']} → {len(req['destinations'])} destino(s), {req['date']} ±{req['flex']}")
        except (ValueError, TypeError) as exc:
            errors.append({"source": "pedido", "search": "", "error": f"Pedido inválido: {exc}"})
            print(f"Pedido inválido: {exc}")

    # Pedidos ainda abertos (o mais recente primeiro) viram rotas temporárias.
    requests = [r for r in state["requests"] if r["date"] >= today.isoformat()]
    state["requests"] = requests
    req_routes = {r["id"]: ondemand.to_route(r, today) for r in requests}

    mon_keys, req_keys = set(), {r["id"]: set() for r in requests}
    for source in sources:
        mon_tasks = all_tasks(monitored, source.programs, today)
        mon_keys.update(t.key for t in mon_tasks)
        queue: list[Task] = []
        for r in requests:
            tasks = all_tasks([req_routes[r["id"]]], source.programs, today)
            req_keys[r["id"]].update(t.key for t in tasks)
            if not r.get("completed_at"):
                queue += pending(tasks, checked, r["fresh_after"])
        queue += pending(mon_tasks, checked, sweep["started_at"])

        p = pacing.get(source.name, {})
        limit = max_per_source or int(p.get("per_run", source.per_run))
        delay = float(p.get("delay_seconds", source.delay_seconds))
        batch, seen = [], set()
        for t in queue:
            if t.key not in seen:
                seen.add(t.key)
                batch.append(t)
            if len(batch) >= limit:
                break

        ok = fails = 0
        try:
            for i, t in enumerate(batch):
                if i and delay:
                    time.sleep(delay)
                try:
                    found = source.search(t.program, t.origin, t.destination, t.day, t.route)
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

    # Progresso dos pedidos.
    for r in requests:
        keys = req_keys[r["id"]]
        r["done"] = sum(1 for k in keys if checked.get(k, "") >= r["fresh_after"])
        r["total"] = len(keys)
        if not r.get("completed_at") and r["done"] == r["total"]:
            r["completed_at"] = now_iso()

    # Esquece buscas que não interessam mais (datas passadas, rotas/pedidos removidos).
    all_keys = mon_keys.union(*req_keys.values())
    for k in list(checked):
        if k not in all_keys:
            checked.pop(k, None)
            stored.pop(k, None)

    # Varredura das rotas monitoradas.
    done = sum(1 for k in mon_keys if checked.get(k, "") >= sweep["started_at"])
    total = len(mon_keys)
    just_completed = total > 0 and done == total
    if just_completed:
        sweep["last_completed_at"] = now_iso()
        sweep["last_started_at"] = sweep["started_at"]
        sweep["number"] = sweep.get("number", 1) + 1
        sweep["started_at"] = now_iso()

    # Resultados: o que há de mais recente para cada busca.
    awards = []
    for k in sorted(all_keys):
        for d in stored.get(k, []):
            d = {**d}
            d.pop("route_id", None)
            a = Award(**d)
            a.cost_brl = cost_brl(a, milheiro)
            row = a.to_dict()
            row.pop("route_id", None)
            row["checked_at"] = checked.get(k)
            awards.append(row)
    awards.sort(key=lambda a: (a["cost_brl"], a["date"]))

    alerts = []
    for route in monitored:
        for row in awards:
            if route.contains(row["origin"], row["destination"], row["date"], row["program"], row["cabin"]):
                a = Award(**{k: v for k, v in row.items() if k != "checked_at"})
                for rule in matching_alerts(a, route.alerts):
                    alerts.append({"route_id": route.id, "rule": rule, "award": row})

    progress = {
        "sweep_number": sweep["number"] - (1 if just_completed else 0),
        "done": total if just_completed else done,
        "total": total,
        "started_at": sweep.get("last_started_at") if just_completed else sweep["started_at"],
        "just_completed": just_completed,
        "last_completed_at": sweep.get("last_completed_at"),
    }
    result = {
        "generated_at": ondemand.utcnow().isoformat(timespec="seconds"),
        "sample": any(s.is_sample for s in sources),
        "programs": sorted({p for s in sources for p in s.programs}),
        "milheiro_brl": milheiro,
        "popular_destinations": config.get("popular_destinations", []),
        "airport_groups": config.get("airport_groups", {}),
        "routes": [r.to_dict() for r in monitored],
        "requests": [
            {k: r.get(k) for k in ("id", "program", "origins", "destinations", "any_destination", "date", "flex",
                                   "created_at", "completed_at", "done", "total")}
            for r in requests
        ],
        "progress": progress,
        "checked": {k: checked[k][:16] for k in sorted(all_keys) if k in checked},
        "awards": awards,
        "alerts": alerts,
        "errors": errors,
    }
    state_path.parent.mkdir(parents=True, exist_ok=True)
    state_path.write_text(json.dumps(state, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    for r in requests:
        print(f"pedido {r['id']}: {r['done']}/{r['total']}{' (completo)' if r.get('completed_at') else ''}")
    pct = 100 * progress["done"] / total if total else 0
    status = "VARREDURA COMPLETA" if just_completed else f"varredura {progress['sweep_number']}: {pct:.0f}%"
    print(f"{status} ({progress['done']}/{total} buscas) · {len(awards)} resgates · {len(alerts)} alertas · {len(errors)} erros")
    return 0


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--config", type=Path, default=ROOT / "config" / "config.json")
    p.add_argument("--state", type=Path, default=ROOT / "data" / "state.json")
    p.add_argument("--out", type=Path, default=ROOT / "web" / "data" / "results.json")
    p.add_argument("--max", type=int, default=None, help="limite de buscas por fonte nesta rodada")
    p.add_argument("--request-env", metavar="VAR", help="variável de ambiente com o pedido (JSON) vindo do app")
    args = p.parse_args()
    request = None
    if args.request_env:
        raw = os.environ.get(args.request_env, "").strip()
        if raw:
            try:
                request = json.loads(raw)
            except json.JSONDecodeError:
                request = {}
            # Rodada agendada (null) ou disparo manual sem pedido (campos vazios) = rodada normal.
            if not isinstance(request, dict) or not any(
                str(v).strip() for k, v in request.items() if k != "flex"
            ):
                request = None
    sys.exit(run(args.config, args.state, args.out, args.max, request))


if __name__ == "__main__":
    main()
