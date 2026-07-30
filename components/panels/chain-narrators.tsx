"use client";

import { useEffect, useMemo, useState } from "react";
import type { ApiNarratorOccurrenceContext, LiveHadithGraph } from "@/lib/hadith-graph";
import { loadRijalEntry, researchApiAvailable, searchRijalCandidates, type ApiRijalEntry } from "@/lib/api-client";

/**
 * Die Erzähler dieses Sanads in der Reihenfolge des Textes, jeder mit dem, was
 * die Quelle über ihn sagt.
 *
 * Bisher musste man jeden Erzähler einzeln im Graphen anklicken, um seine
 * Übersetzung zu sehen. Diese Liste zeigt die ganze Kette auf einmal — dieselbe
 * Ansicht, die auch der Leser einer gedruckten Ausgabe hat, wenn er die Namen
 * der Reihe nach nachschlägt.
 *
 * Zwei Regeln, die hier nicht aufweichen dürfen:
 *
 * 1. Ein Treffer im Erzählerregister ist eine NAMENSGLEICHHEIT, keine
 *    festgestellte Identität. Die Liste sagt das an jeder Zeile, und sie wählt
 *    nicht still den ersten von mehreren gleichnamigen Kandidaten aus, ohne die
 *    Mehrdeutigkeit zu benennen.
 * 2. Eine relative Namensform («عن أبيه») bezeichnet keine Person für sich. Sie
 *    bekommt deshalb keine Karte, sondern bleibt als positionsgebundene Stelle
 *    stehen — dieselbe Regel wie in der Einzelkarte.
 */

type Resolution =
  | { state: "loading" }
  | { state: "relative" }
  | { state: "prophet" }
  | { state: "none" }
  | { state: "found"; entry: ApiRijalEntry; ambiguous: number };

function firstDeathYear(entry: ApiRijalEntry): string {
  const deaths = (entry.dateAssertions ?? []).filter((item) => item.kind === "death");
  if (deaths.length > 1) {
    // Mehrere belegte Jahre: alle nennen, nicht das erste als das Jahr ausgeben.
    return deaths.map((item) => item.valueAh?.toLocaleString("ar")).filter(Boolean).join(" · ") + " هـ";
  }
  const single = deaths[0]?.valueAh ?? entry.deathYearCandidate;
  return single ? `${single.toLocaleString("ar")} هـ` : "—";
}

export function ChainNarrators({ liveGraph, selectNode }: { liveGraph: LiveHadithGraph; selectNode?: (id: string) => void }) {
  // Nachgeschlagen wird je NAMENSFORM, angezeigt je STELLE. Was sich aus der
  // Stelle selbst ergibt — relative Form, Prophetennennung —, wird beim Rendern
  // abgeleitet und nicht in den Zustand geschrieben.
  const [lookups, setLookups] = useState<Record<string, Resolution>>({});

  /** Textreihenfolge: erst die Kette, darin die Position vom Sammler nach hinten. */
  const positions = useMemo(() => {
    const entries = Object.entries(liveGraph.occurrences) as Array<[string, ApiNarratorOccurrenceContext]>;
    return entries.sort(([, a], [, b]) => a.chainOrder - b.chainOrder || a.position - b.position);
  }, [liveGraph.occurrences]);

  useEffect(() => {
    if (!researchApiAvailable()) return;
    const controller = new AbortController();
    // Derselbe Name steht in mehreren Ketten an mehreren Stellen. Nachgeschlagen
    // wird er einmal; das spart Anfragen, ohne die Positionsbindung aufzugeben —
    // die Zeilen bleiben getrennt, nur die Abfrage wird geteilt.
    const wanted = new Map<string, ApiNarratorOccurrenceContext>();
    for (const [, context] of positions) {
      if (context.relativeForm || context.prophetMention) continue;
      if (!wanted.has(context.normalizedSurfaceForm)) wanted.set(context.normalizedSurfaceForm, context);
    }

    (async () => {
      for (const [key, context] of wanted) {
        try {
          const found = await searchRijalCandidates(context.rawSurfaceForm, controller.signal);
          const shamela = found.data.items.filter((item) => item.source === "shamela");
          const exact = shamela.filter((item) => item.matchKind === "exact_name");
          const usable = exact.length ? exact : shamela;
          const outcome: Resolution = usable[0]
            ? { state: "found", entry: (await loadRijalEntry(usable[0].id, controller.signal)).data, ambiguous: usable.length }
            : { state: "none" };
          setLookups((current) => ({ ...current, [key]: outcome }));
        } catch (caught) {
          if (caught instanceof DOMException && caught.name === "AbortError") return;
          setLookups((current) => ({ ...current, [key]: { state: "none" } }));
        }
      }
    })();

    return () => controller.abort();
  }, [positions]);

  if (!positions.length) {
    return <p className="empty-copy">لم يستخرج المحلل مواضع رواة لهذا الحديث.</p>;
  }

  return (
    <div className="chain-narrators">
      <p className="tab-intro">
        الرواة بترتيب النص. المطابقة مع دليل الرواة اسمية، وليست تعييناً محققاً لهوية الراوي في هذا السند.
      </p>
      <ol className="chain-narrator-list">
        {positions.map(([nodeId, context]) => {
          const outcome: Resolution = context.relativeForm
            ? { state: "relative" }
            : context.prophetMention
              ? { state: "prophet" }
              : lookups[context.normalizedSurfaceForm] ?? { state: "loading" };
          const entry = outcome.state === "found" ? outcome.entry : null;
          return (
            <li key={nodeId}>
              <div className="chain-narrator-head">
                <span className="chain-position" aria-hidden="true">{(context.position + 1).toLocaleString("ar")}</span>
                {selectNode ? (
                  <button type="button" className="chain-narrator-name" onClick={() => selectNode(nodeId)}>
                    {context.rawSurfaceForm}
                  </button>
                ) : <strong className="chain-narrator-name">{context.rawSurfaceForm}</strong>}
                {context.transmissionTerm ? <em className="transmission-term">{context.transmissionTerm}</em> : null}
              </div>

              {outcome.state === "relative" ? (
                <p className="chain-narrator-note">صيغة نسبية: تُحل داخل هذه السلسلة فقط، ولا تفتح لها ترجمة عامة.</p>
              ) : outcome.state === "prophet" ? (
                <p className="chain-narrator-note">موضع النبي صلى الله عليه وسلم، وليس موضع راوٍ في الدليل.</p>
              ) : outcome.state === "loading" ? (
                <p className="chain-narrator-note">جار البحث في دليل الرواة…</p>
              ) : outcome.state === "none" ? (
                <p className="chain-narrator-note">لم توجد ترجمة مطابقة لهذا اللفظ في الدليل.</p>
              ) : entry ? (
                <dl className="chain-narrator-facts">
                  {entry.longName && entry.longName !== entry.nameSurface ? <div><dt>الاسم</dt><dd>{entry.longName}</dd></div> : null}
                  <div><dt>النسب</dt><dd>{entry.nisbas?.join(" · ") || "—"}</dd></div>
                  <div><dt>الشهرة</dt><dd>{entry.laqab || "—"}</dd></div>
                  <div><dt>الوفاة</dt><dd>{firstDeathYear(entry)}</dd></div>
                  {entry.ibnHajarGrade ? <div><dt>حكم ابن حجر</dt><dd>{entry.ibnHajarGrade}</dd></div> : null}
                  {outcome.ambiguous > 1 ? (
                    <div className="chain-narrator-ambiguous">
                      <dt>تنبيه</dt>
                      <dd>في الدليل {outcome.ambiguous.toLocaleString("ar")} تراجم بهذا الاسم؛ الظاهر هنا أولها، والتعيين يحتاج إلى مراجعة.</dd>
                    </div>
                  ) : null}
                </dl>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
