"use client";

import { useState } from "react";
import { SourceTag } from "../atlas-primitives";

/**
 * Redaktionsoberflaeche als Prototyp. Bewusst noch ohne Persistenz: die
 * Revisions-API, die Vier-Augen-Freigabe und die Rollen kommen mit
 * Umsetzungsplan P5.8. Der Hinweis darauf steht sichtbar in der Oberflaeche,
 * damit niemand eine hier getroffene Entscheidung fuer gespeichert haelt.
 */
const initialReviewItems = [
  { id: "REV-1042", kind: "هوية", title: "أبيه", context: "موضع راوٍ في البخاري ٥٤ · السلسلة ١", source: "صحيح البخاري · ج ١، ص ٧٨", before: "غير محلول", proposal: "إبراهيم بن سعد" },
  { id: "REV-1043", kind: "تاريخ", title: "وفاة يحيى بن سعيد", context: "تعارض بين سنتي ١٤٣ و١٤٤ هـ", source: "تهذيب التهذيب / ميزان الاعتدال", before: "١٤٣ هـ", proposal: "إبقاء القولين" },
  { id: "REV-1044", kind: "عنقود متن", title: "اقتراح ضم روايتين", context: "تشابه رمزي ٠٫٩٢ · دلالي ٠٫٨٨", source: "البخاري ١ / مسلم ١٩٠٧", before: "عنقودان", proposal: "عنقود مقترح واحد" },
  { id: "REV-1045", kind: "علاقة", title: "يحيى ← مالك", context: "إسناد صريح وعبارة في كتاب رجال", source: "موضعا مصدر مستقلان", before: "دليل إسنادي", proposal: "إضافة دليل رجالي مستقل" },
];

export function EditorView() {
  const [items, setItems] = useState(initialReviewItems);
  const [selected, setSelected] = useState(initialReviewItems[0].id);
  const [rationale, setRationale] = useState("");
  const [revisions, setRevisions] = useState<{ item: typeof initialReviewItems[number]; action: string; rationale: string }[]>([]);
  const active = items.find((item) => item.id === selected) ?? items[0];

  const decide = (action: "قبول" | "رفض") => {
    if (!active || rationale.trim().length < 8) return;
    setRevisions((current) => [...current, { item: active, action, rationale: rationale.trim() }]);
    setItems((current) => current.filter((item) => item.id !== active.id));
    setSelected(items.find((item) => item.id !== active.id)?.id ?? "");
    setRationale("");
  };

  const undo = () => {
    const revision = revisions.at(-1);
    if (!revision) return;
    setItems((current) => [revision.item, ...current]);
    setSelected(revision.item.id);
    setRevisions((current) => current.slice(0, -1));
  };

  return (
    <div className="content-view editor-view" dir="rtl">
      <header className="view-intro compact"><span className="eyebrow">مساحة المحقق</span><h1>كل قرار قابل للتتبع والتراجع.</h1><p>لا تُخفي المراجعة نتيجة الآلة. يسجل النظام السبب، والمصدر، والمحرر، والفرق قبل القرار وبعده.</p></header>
      <p className="rights-withheld" role="note"><strong>نموذج أولي غير محفوظ</strong>قرارات هذه الجلسة تبقى في المتصفح فقط. لا تُكتب مراجعة، ولا تُسند إلى محرر، ولا تُصدر نسخة جديدة، إلى أن تُوصل هذه اللوحة بواجهة المراجعات.</p>
      <div className="editor-summary"><span><strong>{items.length.toLocaleString("ar")}</strong> بانتظار المراجعة</span><span><strong>{revisions.length.toLocaleString("ar")}</strong> قرارات في هذه الجلسة</span><button type="button" onClick={undo} disabled={!revisions.length}>التراجع عن آخر قرار</button></div>
      <div className="editor-layout">
        <section className="review-queue" aria-label="طابور المراجعة">
          <div className="review-heading"><h2>طابور المراجعة</h2><span>مرتب بحسب أثر القرار</span></div>
          {items.length ? items.map((item) => <button type="button" className={selected === item.id ? "active" : ""} key={item.id} onClick={() => setSelected(item.id)}><span>{item.kind} · {item.id}</span><strong>{item.title}</strong><small>{item.context}</small></button>) : <div className="review-empty"><strong>اكتملت عناصر هذه العينة</strong><p>تظل القرارات مسجلة ويمكن التراجع عنها.</p></div>}
        </section>
        <section className="decision-workbench" aria-live="polite">
          {active ? <>
            <div className="decision-top"><span>{active.kind}</span><SourceTag /></div>
            <h2>{active.title}</h2><p>{active.context}</p>
            <div className="before-after"><article><span>قبل</span><strong>{active.before}</strong></article><article><span>الاقتراح</span><strong>{active.proposal}</strong></article></div>
            <div className="decision-source"><span>المصدر الملزم</span><strong>{active.source}</strong><button type="button">فتح موضع المصدر ↗</button></div>
            <label className="rationale-field">سبب القرار<textarea value={rationale} onChange={(event) => setRationale(event.target.value)} placeholder="اكتب تعليلا علميا مرتبطا بالمصدر…" rows={4} /><small>ثمانية أحرف على الأقل. يُحفظ النص ضمن EditorialRevision.</small></label>
            <div className="decision-actions"><button type="button" className="reject" onClick={() => decide("رفض")} disabled={rationale.trim().length < 8}>رفض الاقتراح</button><button type="button" className="accept" onClick={() => decide("قبول")} disabled={rationale.trim().length < 8}>قبول وتسجيل المراجعة</button></div>
          </> : <div className="review-empty"><strong>لا عنصر محدد</strong><p>اختر عنصرا من طابور المراجعة.</p></div>}
        </section>
      </div>
    </div>
  );
}
