# Kleiner Testimport

Der Testbestand unter `data/test-import.json` enthält zwei bewusst nicht freigegebene Demonstrationsdatensätze. Er prüft den Importvertrag, ohne fremde Volltexte produktiv zu übernehmen.

```bash
npm run import:test
```

Der Validator blockiert fehlende Provenance-Felder, doppelte externe IDs und kommerzielle Nutzung bei ungeklärtem Lizenzstatus. Jede rohe Kettennamensform wird zunächst als unaufgelöste `NarratorOccurrence` ausgegeben; es findet kein automatischer Personen-Merge statt.

## Produktiver Importvertrag

1. Rohobjekt unverändert in Object Storage ablegen und checksumieren.
2. Rechte-/Lizenzprüfung bestehen.
3. Editions- und Nummerierungsidentität erzeugen.
4. Isnād und Matn segmentieren, Parser-Version speichern.
5. `NarratorOccurrence` erzeugen; Entity Resolution nur als Kandidatenliste.
6. Qualitätsregeln und Stichprobenprüfung.
7. Redaktionelle Freigabe in eine veröffentlichbare Datenversion.
