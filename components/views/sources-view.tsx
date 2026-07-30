"use client";

import { sourceRegister } from "@/lib/mock-data";

/**
 * Quellen- und Rechteverzeichnis (Abschnitt 10). Enthaelt keinen Editionstext
 * und darf keinen enthalten: hier steht nur, welches Werk in welcher Rechtelage
 * ist.
 */
export function SourcesView() {
  const cleared = sourceRegister.filter((source) => source.rights !== "قيد المراجعة").length;
  return (
    <div className="content-view sources-view" dir="rtl">
      <header className="view-intro"><span className="eyebrow">حقوق البيانات وسلسلة المصدر</span><h1>لا معلومة بلا أصل.</h1><p>يُراجع إدخال كل كتاب وطبعة ورخصة ومقدار النص المسموح به على حدة، مع فصل الخام عن المشتق وعن المادة المعتمدة.</p></header>
      <div className="rights-banner">
        <span>{cleared.toLocaleString("ar")} / {sourceRegister.length.toLocaleString("ar")}</span>
        <div>
          <strong>مصدران مفتوحان، وبقية الطبعات تحتاج إلى مراجعة</strong>
          <p>Sanadset وMulti-IsnadSet مسجلان برخصتيهما؛ أما نصوص تراث فتظل خلف بوابة حقوق كل طبعة، وتُحجب من كل استجابة لم تُعتمد.</p>
        </div>
        <button type="button">تصدير قائمة فحص الحقوق</button>
      </div>
      <div className="source-table-wrap">
        <table className="source-table"><thead><tr><th>الكتاب</th><th>المؤلف</th><th>الأولوية</th><th>الأصل</th><th>الحقوق</th></tr></thead><tbody>{sourceRegister.map((source) => <tr key={source.title}><td><strong>{source.title}</strong></td><td>{source.author}</td><td>{source.tier}</td><td>{source.origin}</td><td><span className={source.rights === "قيد المراجعة" ? "rights-pending" : "rights-cleared"}>{source.rights}</span></td></tr>)}</tbody></table>
      </div>
      <div className="source-footnotes"><article><span>الملف ٠١</span><h2>قائمة بأهم كتب التراجم والجرح والتعديل</h2><p>قائمة من تسع صفحات تشمل كتب الرجال، والسؤالات، والأسماء، والتدليس، والمراسيل. صورة الصفحة مقدمة عند خطأ التعرف النصي.</p></article><article><span>الملف ٠٢</span><h2>طبقات رواة الأحاديث</h2><p>لوحة كبيرة للطبقات تصف ترتيبها بأنه تقريبي واجتهادي؛ لذلك تُستعمل دليلا للمراجعة لا تصنيفا نهائيا.</p></article></div>
    </div>
  );
}
