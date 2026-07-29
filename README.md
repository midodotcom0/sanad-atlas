# Sanad Atlas — أطلس الإسناد

Klickbarer Research-MVP für einen quellengebundenen Hadith-Wissensgraphen. Der Bestand ist absichtlich als Mock-Daten gekennzeichnet und nicht für fachliche Schlussfolgerungen bestimmt.

Live-Demo: `https://midodotcom0.github.io/sanad-atlas/`

## Lokal starten

```bash
npm install
npm run dev
```

Danach `http://localhost:3000/hadith` öffnen.

## Verifikation

```bash
npm run test
npm run lint
npm run build
```

## Hauptansichten

- `/hadith` — zusammengeführte Wege mit Sammlungsfilter
- `/narrators/yahya` — Personenprofil
- `/network` — Lehrer-/Schüler-Ego-Graph
- `/compare` — quellengebundener Personenvergleich
- `/variants` — gekoppelte Matn-/Isnād-Analyse
- `/sources` — Quellen- und Rechte-Register

Die Spezifikationen liegen unter [`docs/`](./docs/).
