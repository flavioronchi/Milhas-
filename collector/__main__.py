"""Faz uma rodada de buscas (aos poucos) e grava web/data/results.json.

Cada rodada busca só um lote por fonte e guarda o progresso em data/state.json:
primeiro os pedidos feitos no app (sob demanda), depois as rotas monitoradas.

Uso:
  python -m collector                       # rodada normal
  python -m collector --command-env CMD     # aplica o comando do app em $CMD (JSON) e faz a rodada
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


def run(config_path: Path, state_path: Path, monitors_path: Path, out_path: Path,
        max_per_source: int | None, command: dict | None) -> int:
    config = json.loads(config_path.read_text(encoding="utf-8"))
    milheiro = config["milheiro_brl"]
    pacing = config.get("pacing", {})
    sources = [get_source(n) for n in config.get("sources", [])]
    today = date.today()
    monitors: list[dict] = json.loads(monitors_path.read_text(encoding="utf-8")) if monitors_path.exists() else []

    state = json.loads(state_path.read_text(encoding="utf-8")) if state_path.exists() else {}
    sweep = state.setdefault("sweep", {})
    checked: dict[str, str] = state.setdefault("checked", {})
    stored: dict[str, list] = state.setdefault("awards", {})
    state.setdefault("requests", [])
    if not sweep.get("started_at"):
        sweep.update(number=1, started_at=now_iso(), last_completed_at=None)

    errors: list[dict] = []
    last_command = None
    if command is not None:
        try:
            kind = command.get("type", "search")
            if kind in ("search", "calendar"):
                req = ondemand.normalize_search(command, config, today)
                ondemand.add_request(state, req, ondemand.utcnow())
                msg = f"Busca registrada ({req['id']})"
            elif kind in ("monitor_add", "monitor_remove"):
                msg = ondemand.apply_monitor_command(monitors, command, config, today)
                monitors_path.parent.mkdir(parents=True, exist_ok=True)
                monitors_path.write_text(json.dumps(monitors, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            else:
                raise ValueError(f"Comando desconhecido: '{kind}'")
            last_command = {"ok": True, "message": msg}
        except (ValueError, TypeError, KeyError) as exc:
            msg = f"Comando inválido: {exc}"
            errors.append({"source": "app", "search": "", "error": msg})
            last_command = {"ok": False, "message": msg}
        last_command["at"] = now_iso()
        last_command["type"] = command.get("type", "search")
        print(last_command["message"])

    monitored = [Route.from_dict(r) for r in config.get("routes", [])] + [Route.from_dict(m) for m in monitors]
    app_ids = {m["id"] for m in monitors}

    # Pedidos ainda abertos (o mais recente primeiro) viram rotas temporárias.
    requests = [r for r in state["requests"] if r.get("legs") and ondemand.request_last_day(r) >= today.isoformat()]
    state["requests"] = requests
    req_routes = {r["id"]: ondemand.to_routes(r, today) for r in requests}

    mon_keys, req_keys = set(), {r["id"]: set() for r in requests}
    for source in sources:
        mon_tasks = all_tasks(monitored, source.programs, today)
        mon_keys.update(t.key for t in mon_tasks)
        queue: list[Task] = []
        for r in requests:
            tasks = all_tasks(req_routes[r["id"]], source.programs, today)
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
    if last_command:
        state["last_command"] = last_command

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
        "routes": [{**r.to_dict(), "managed_by": "app" if r.id in app_ids else "config"} for r in monitored],
        "requests": [
            {k: r.get(k) for k in ("id", "type", "program", "origins", "destinations", "any_destination", "legs",
                                   "date", "flex", "return_date", "month", "created_at", "completed_at", "done", "total")}
            for r in requests
        ],
        "last_command": state.get("last_command"),
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
    p.add_argument("--monitors", type=Path, default=ROOT / "data" / "monitors.json")
    p.add_argument("--out", type=Path, default=ROOT / "web" / "data" / "results.json")
    p.add_argument("--max", type=int, default=None, help="limite de buscas por fonte nesta rodada")
    p.add_argument("--command-env", metavar="VAR", help="variável de ambiente com o comando (JSON) vindo do app")
    args = p.parse_args()
    command = None
    if args.command_env:
        raw = os.environ.get(args.command_env, "").strip()
        if raw:  # vazio = rodada agendada/manual sem comando
            try:
                command = json.loads(raw)
            except json.JSONDecodeError:
                command = {"type": "invalido"}
            if not isinstance(command, dict):
                command = {"type": "invalido"}
    sys.exit(run(args.config, args.state, args.monitors, args.out, args.max, command))


if __name__ == "__main__":
    main()
