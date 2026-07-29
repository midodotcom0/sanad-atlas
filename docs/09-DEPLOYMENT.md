# Deployment

## Prototype

Voraussetzungen: Node.js 22+, npm 10+.

```bash
npm ci
npm run import:test
npm run test
npm run lint
npm run build
npm run start
```

Der Prototyp benötigt keine Secrets. Er kann als Node-Deployment auf Vercel, Fly.io oder einem Container-Host laufen.

## Production target

```text
CDN / WAF
    │
Next.js Web + BFF
    ├── FastAPI Analyse-Service
    ├── PostgreSQL (Metadaten, Assertions, Audit)
    ├── Graph-DB (begrenzte Traversierungen)
    ├── OpenSearch (Arabisch + Transliteration)
    ├── Redis (Teilgraph-/Suchcache, Jobs)
    └── S3-kompatibler Storage (Rohdaten, Editionen, Parquet)
```

## Pflichtkonfiguration in Produktion

- `DATABASE_URL`, `GRAPH_DATABASE_URL`, `OPENSEARCH_URL`, `REDIS_URL`, `OBJECT_STORAGE_*` über Secret Manager.
- Migrationsjob vor Rollout, aber kein automatisches destruktives Schema-Reset.
- Readiness-Probes für relationale DB, Suchindex und Graph-Service.
- CSP mit expliziten Font-/Script-Quellen; Rate Limits für Suche und Pfade.
- Observability ohne Speicherung sensibler Forschungsnotizen in Logs.
- Datenversion und Indexversion gemeinsam deployen; Rollback muss beide wiederherstellen.
- Lizenz-Gate im Import: nicht freigegebene Quellen dürfen nie in die öffentliche Auslieferung gelangen.

## Skalierung

- Fachseiten SSR/cachen; Graphkomponente clientseitig und nur auf Graphseiten laden.
- Teilgraphantworten komprimieren und mit ETags versehen.
- Pfadabfragen serverseitig auf Tiefe, Laufzeit und Ergebniszahl begrenzen.
- Globale Übersicht aus voraggregierten LOD-Kacheln aufbauen.
