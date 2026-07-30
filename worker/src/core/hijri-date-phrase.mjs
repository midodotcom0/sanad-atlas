/**
 * Zerlegt eine hidschri-Datumsangabe in ihre EINZELNEN belegten Möglichkeiten.
 *
 * Hintergrund: die Quellen nennen für eine Person regelmäßig mehrere Jahre
 * nebeneinander — «145، أو: 146هـ، أو: 147هـ، وقيل: 144هـ» sind vier Angaben,
 * nicht eine. Bis hierher hat der Atlas davon genau eine gezeigt
 * (`death_year_ah`), womit drei belegte Aussagen unsichtbar blieben. Das
 * widerspricht Abschnitt 7 der Projektbeschreibung: widersprüchliche
 * Datierungen müssen gleichzeitig sichtbar sein, und es wird nichts gemittelt,
 * gerundet oder zu einer Spanne verschmolzen.
 *
 * Diese Funktion rechnet deshalb NICHT. Sie liest die Jahre, die dastehen, und
 * behält den Wortlaut jeder einzelnen Angabe bei.
 *
 * Der Unterschied zwischen den Verbindungen ist fachlich, nicht kosmetisch:
 *   «أو»   — eine alternative Lesung INNERHALB derselben Aussage,
 *   «وقيل» — eine EIGENSTÄNDIGE Aussage einer anderen Autorität.
 * Beide bleiben getrennt gekennzeichnet, damit die Oberfläche sie nicht als
 * gleichrangige Zahlenreihe darstellt.
 */

const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";

/** Wandelt arabisch-indische Ziffern in ASCII, sonst unverändert. */
function toAsciiDigits(value) {
  let out = "";
  for (const char of value) {
    const index = ARABIC_INDIC.indexOf(char);
    out += index >= 0 ? String(index) : char;
  }
  return out;
}

/**
 * Näherungs- und Grenzangaben. Sie ändern die Bedeutung des Jahres und dürfen
 * nicht verschwinden: «مات بعد 140» nennt kein Todesjahr 140.
 */
const QUALIFIERS = [
  ["بعيد", "shortly_after"],
  ["قبيل", "shortly_before"],
  ["بعد", "after"],
  ["قبل", "before"],
  ["نحو", "circa"],
  ["حدود", "circa"],
  ["زهاء", "circa"],
];

/** «وقيل»/«قيل» führt eine eigenständige Aussage ein, «أو» eine Lesart derselben. */
function relationFor(connector, isFirst) {
  if (isFirst) return "primary";
  if (/ق(?:ي|ِي)ل/.test(connector)) return "reported";
  if (/أو|او/.test(connector)) return "alternative";
  return "additional";
}

function qualifierFor(segment) {
  for (const [word, code] of QUALIFIERS) {
    if (segment.includes(word)) return code;
  }
  return null;
}

/**
 * Liest alle Jahresangaben einer Phrase.
 *
 * @param {string|null|undefined} phrase Wortlaut aus der Quelle
 * @param {"birth"|"death"} kind
 * @returns {{assertions: Array<object>, sourcePhrase: string|null}}
 */
export function parseHijriYearPhrase(phrase, kind) {
  const sourcePhrase = typeof phrase === "string" && phrase.trim() ? phrase.trim() : null;
  if (!sourcePhrase) return { assertions: [], sourcePhrase: null };

  const ascii = toAsciiDigits(sourcePhrase);
  const assertions = [];
  const seen = new Set();
  const pattern = /(\d{1,4})/g;
  let match;
  let previousEnd = 0;

  while ((match = pattern.exec(ascii)) !== null) {
    const year = Number(match[1]);
    // Ein Jahr über 1100 AH ist in diesem Bestand keine Jahresangabe, sondern
    // eine Seiten- oder Bandzahl, die versehentlich in der Phrase steht.
    if (!year || year > 1100) { previousEnd = match.index + match[0].length; continue; }

    // Der Text zwischen der letzten Zahl und dieser trägt die Verbindung
    // («أو:», «وقيل:») und einen möglichen Grenzzusatz.
    const connector = ascii.slice(previousEnd, match.index);
    const isFirst = assertions.length === 0;
    const relation = relationFor(connector, isFirst);
    const qualifier = qualifierFor(isFirst ? ascii.slice(0, match.index) : connector);

    // Der angezeigte Wortlaut umfasst die Verbindung und das Jahr samt «هـ»,
    // damit in der Oberfläche «وقيل: 144هـ» steht und nicht bloß «144».
    const tailMatch = /^\s*(?:هـ|هجرية|هج)?/.exec(ascii.slice(match.index + match[0].length));
    const wordingStart = isFirst ? match.index : previousEnd;
    const wording = sourcePhrase.slice(wordingStart, match.index + match[0].length + (tailMatch ? tailMatch[0].length : 0))
      // Das «هـ» am Anfang gehört noch zur VORIGEN Angabe und würde sonst
      // jede Folgeangabe als «هـ، وقيل: 144هـ» ausgeben.
      .replace(/^[\s،؛,.:]*(?:هـ|هجرية|هج)?[\s،؛,.:]*/, "")
      .trim();

    const key = `${year}|${relation}|${qualifier ?? ""}`;
    if (!seen.has(key)) {
      seen.add(key);
      // Feldbild von ApiRijalDateAssertion (lib/api-client.ts) — kein zweites
      // Vokabular fuer dieselbe Sache.
      assertions.push({
        kind,
        verb: null,
        qualifier,
        valueAh: year,
        approximate: qualifier === "circa",
        rawPhrase: wording || String(year),
        textOffset: match.index,
        evidenceClass: "rijal_statement",
        confidence: null,
        reviewStatus: "machine_unreviewed",
        // «أو» (Lesart derselben Aussage) gegen «وقيل» (eigenstaendige Aussage).
        relation,
        // Kein Wert ohne Rueckfuehrbarkeit: die vollstaendige Quellphrase
        // bleibt an jeder einzelnen Angabe haengen.
        sourcePhrase,
      });
    }
    previousEnd = match.index + match[0].length;
  }

  return { assertions, sourcePhrase };
}

/**
 * Baut die Datumsangaben eines Rijāl-Eintrags aus den beiden Wortlautspalten.
 *
 * Bewusst OHNE Rückfall auf `death_year_ah`/`birth_year_ah`: diese Liste sagt
 * aus, was im Wortlaut der Quelle steht. Nennt die Quelle kein Jahr in Ziffern
 * — etwa in den Turath-Werken, die es ausgeschrieben führen («ست وثلاثين
 * ومئتين») — bleibt die Liste leer, statt eine Aussage zu erzeugen, für die es
 * hier keinen Beleg gibt. Das ausgewertete Einzeljahr steht weiterhin in
 * `deathYearCandidate`.
 *
 * @param {Record<string, any>} row Zeile aus rijal_entry_ref
 */
export function rijalDateAssertions(row) {
  return [
    ...parseHijriYearPhrase(row.birth_original_phrase, "birth").assertions,
    ...parseHijriYearPhrase(row.death_original_phrase, "death").assertions,
  ];
}
