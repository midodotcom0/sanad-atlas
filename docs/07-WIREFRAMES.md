# Wireframes der fünf Kernseiten

## 1. Hadith-Wege

```text
┌ Logo ───── Suche ───────────────────── Sprache · Vergleich ┐
├ Hadith · Überlieferer · Netz · Vergleich · Varianten ─────┤
├ Titel + Sammlungsfilter ───────────────────────────────────┤
│                         │ Informationspanel                │
│ Prophet → gemeinsame    │ Matn / ausgewählte Kette         │
│ Kette → Verzweigungen   │ Sammlung / Nummer / Edition      │
│ → Sammler               │ Quellen / Prüfstatus             │
│                         │                                  │
├ Legende / Zoom ─────────┴──────────────────────────────────┤
└ Wege · frühe Äste · Matn-Familien ─────────────────────────┘
```

## 2. Überliefererprofil

```text
┌ Suche / Modusnavigation ───────────────────────────────────┐
│ Lehrer ───┐             │ Name, Identitätsstatus          │
│ Lehrer ───┼→ ZENTRUM ───┼ Ṭabaqa, Jahre, Orte             │
│           └→ Schüler     │ Netzwerkstatistik               │
│              Schüler     │ Aussagen + Originalquellen      │
└ große Gruppen als Liste ┴──────────────────────────────────┘
```

## 3. Lehrer-/Schülernetz

```text
┌ Evidenzfilter · Tiefe · Region ────────────────────────────┐
│ Lehrer        ausgewählte Person        Schüler            │
│  ○ ───────╲      ╭────────╮      ╱────── ○                │
│  ○ ────────╲─────│ Zentrum│─────╱─────── ○   +116         │
│                  ╰────────╯                                │
└ durchgezogen = Kette · gestrichelt = Biografie ────────────┘
```

## 4. Personenvergleich

```text
┌ Person A ───────── gemeinsamer Knoten ───────── Person B ┐
├ Netzwerk ───────────────────┬ Biografie ──────────────────┤
│ Lehrer, Schüler, Pfade      │ Zeitachse, Orte, Reisen     │
├ Hadith-Überlieferung ───────┼ Jarḥ wa-Taʿdīl ────────────┤
│ Cluster und Matn-Familien   │ Originalaussagen nebenein.  │
└─────────────────────────────┴──────────────────────────────┘
```

## 5. Matn-/Isnād-Varianten

```text
┌ Variante A · Variante B ───────────────────────────────────┐
│ Matn-Dokument                  │ verknüpfte Wege            │
│ إِنَّمَا الأعمال [بالنيات]     │ ... ─ ● ─ hervorgehoben   │
│                               │ ... ─ ○ ─ abgedimmt        │
│ Übersetzung                   │ Klick auf Knoten → Texte   │
│ Unterschiede: alt → neu       │                             │
└───────────────────────────────┴─────────────────────────────┘
```
