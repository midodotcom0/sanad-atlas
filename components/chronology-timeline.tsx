import { compareChronology } from "@/lib/chronology";
import type { DateAssertion, Narrator } from "@/lib/types";

const WIDTH = 780;
const START_X = 105;
const END_X = 750;

function scale(year: number, min: number, max: number) {
  return START_X + ((year - min) / Math.max(1, max - min)) * (END_X - START_X);
}

function glyph(assertion: DateAssertion, y: number, min: number, max: number) {
  const start = scale(assertion.yearMin, min, max);
  const end = scale(assertion.yearMax, min, max);
  const className = `date-mark source-${assertion.sourceKey} precision-${assertion.precision}`;
  if (assertion.precision === "exact") return <circle key={assertion.id} className={className} cx={start} cy={y} r="5"><title>{assertion.sourceLabel}: {assertion.yearMin} هـ · {assertion.reference}</title></circle>;
  if (assertion.precision === "before") return <path key={assertion.id} className={className} d={`M ${start} ${y} H ${START_X + 8} l 8 -5 m -8 5 l 8 5`}><title>{assertion.sourceLabel}: قبل {assertion.yearMin} هـ · {assertion.reference}</title></path>;
  if (assertion.precision === "after") return <path key={assertion.id} className={className} d={`M ${start} ${y} H ${END_X - 8} l -8 -5 m 8 5 l -8 5`}><title>{assertion.sourceLabel}: بعد {assertion.yearMin} هـ · {assertion.reference}</title></path>;
  return <rect key={assertion.id} className={className} x={start} y={y - 5} width={Math.max(4, end - start)} height="10" rx="5"><title>{assertion.sourceLabel}: {assertion.yearMin}–{assertion.yearMax} هـ · {assertion.reference}</title></rect>;
}

export function ChronologyTimeline({ first, second, assertions }: { first: Narrator; second: Narrator; assertions: DateAssertion[] }) {
  const relevant = assertions.filter((item) => item.narratorId === first.id || item.narratorId === second.id);
  const years = relevant.flatMap((item) => [item.yearMin, item.yearMax]);
  const min = Math.floor(((years.length ? Math.min(...years) : 0) - 10) / 10) * 10;
  const max = Math.ceil(((years.length ? Math.max(...years) : 250) + 10) / 10) * 10;
  const ticks = Array.from({ length: Math.floor((max - min) / 25) + 1 }, (_, index) => min + index * 25);
  const comparison = compareChronology(assertions, first.id, second.id);
  const resultLabel = comparison.result === "possible"
    ? `ممكن زمنيا · أقصى تداخل ظاهر ${comparison.overlapYears} سنة`
    : comparison.result === "impossible"
      ? `متعذر زمنيا · أقل فجوة ${comparison.gapYears} سنة`
      : "المعطيات غير كافية";

  return (
    <div className="chronology-chart">
      <svg viewBox={`0 0 ${WIDTH} 190`} role="img" aria-labelledby="chronology-title chronology-desc">
        <title id="chronology-title">مقارنة زمنية بين {first.nameAr} و{second.nameAr}</title>
        <desc id="chronology-desc">كل تاريخ مرسوم مستقلا بلون مصدره وشكل درجة دقته. لا تثبت المقارنة اللقاء أو السماع.</desc>
        {ticks.map((year) => <g className="time-tick" key={year}><line x1={scale(year, min, max)} x2={scale(year, min, max)} y1="24" y2="156" /><text x={scale(year, min, max)} y="18">{year}</text></g>)}
        <text className="person-label" x="96" y="62">{first.shortAr}</text>
        <text className="person-label" x="96" y="126">{second.shortAr}</text>
        <line className="axis-line" x1={START_X} x2={END_X} y1="65" y2="65" />
        <line className="axis-line" x1={START_X} x2={END_X} y1="129" y2="129" />
        {relevant.filter((item) => item.narratorId === first.id).map((item, index) => glyph(item, 52 + (index % 3) * 12, min, max))}
        {relevant.filter((item) => item.narratorId === second.id).map((item, index) => glyph(item, 116 + (index % 3) * 12, min, max))}
      </svg>
      <div className="timeline-legend">
        <span><i className="legend-source ibn-hajar" />ابن حجر</span><span><i className="legend-source al-dhahabi" />الذهبي</span>
        <span><i className="legend-shape exact" />سنة محددة</span><span><i className="legend-shape range" />مدى أو تقريب</span>
      </div>
      <p className={`chronology-result ${comparison.result}`}>{resultLabel}. هذا حساب زمني فقط، وليس إثباتا للقاء أو السماع.</p>
    </div>
  );
}
