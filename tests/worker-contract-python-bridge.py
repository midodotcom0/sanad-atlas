#!/usr/bin/env python3
"""Bruecke fuer tests/worker-contract.check.mjs (P3.2-Abnahme): ruft
backend/app/repository.py's CorpusRepository-Methoden direkt auf (ohne
FastAPI/uvicorn -- im Sandbox nicht startbar) und gibt das Ergebnis als JSON
auf stdout aus. So kann der Node-Test denselben Methodenaufruf gegen den
Worker-Router UND die tatsaechliche FastAPI-Referenzimplementierung
ausfuehren und feldweise vergleichen.

Nur LESEND: importiert ausschliesslich backend/app/repository.py (Agent 3s
Datei, hier unveraendert), ruft keine Schreiboperation auf.

Aufruf: python3 worker-contract-python-bridge.py <methodname> '<json:{"args":[...],"kwargs":{...}}>'
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.repository import repository  # noqa: E402


def main() -> None:
    method_name = sys.argv[1]
    payload = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
    args = payload.get("args", [])
    kwargs = payload.get("kwargs", {})
    method = getattr(repository, method_name)
    result = method(*args, **kwargs)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
