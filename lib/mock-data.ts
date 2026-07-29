import type { GraphEdge, GraphNode, Narrator, SourceAssertion } from "./types";

const n = (
  id: string,
  nameAr: string,
  shortAr: string,
  transliteration: string,
  role: Narrator["role"],
  tabaqa: string,
  deathAh: number | undefined,
  region: string,
  confidence: Narrator["confidence"] = "verified",
): Narrator => ({ id, nameAr, shortAr, transliteration, role, tabaqa, deathAh, region, confidence, teachers: [], students: [], hadithCount: 1 });

export const narrators: Narrator[] = [
  n("prophet", "النبي محمد ﷺ", "النبي ﷺ", "Prophet Muhammad ﷺ", "prophet", "النبوة", 11, "المدينة"),
  n("umar", "عمر بن الخطاب", "عمر بن الخطاب", "ʿUmar ibn al-Khaṭṭāb", "companion", "الصحابة", 23, "المدينة"),
  n("alqama", "علقمة بن وقاص الليثي", "علقمة بن وقاص", "ʿAlqama ibn Waqqāṣ", "tabii", "كبار التابعين", 62, "المدينة"),
  n("muhammad_ibrahim", "محمد بن إبراهيم التيمي", "محمد التيمي", "Muḥammad ibn Ibrāhīm al-Taymī", "tabii", "أوساط التابعين", 120, "المدينة"),
  n("yahya", "يحيى بن سعيد الأنصاري", "يحيى الأنصاري", "Yaḥyā ibn Saʿīd al-Anṣārī", "tabii", "صغار التابعين", 143, "المدينة"),
  n("malik", "مالك بن أنس", "مالك بن أنس", "Mālik ibn Anas", "later", "أتباع التابعين", 179, "المدينة"),
  n("sufyan", "سفيان الثوري", "سفيان الثوري", "Sufyān al-Thawrī", "later", "أتباع التابعين", 161, "الكوفة"),
  n("hammad", "حماد بن زيد", "حماد بن زيد", "Ḥammād ibn Zayd", "later", "أتباع التابعين", 179, "البصرة"),
  n("layth", "الليث بن سعد", "الليث بن سعد", "al-Layth ibn Saʿd", "later", "أتباع التابعين", 175, "مصر"),
  n("awzai", "عبد الرحمن الأوزاعي", "الأوزاعي", "al-Awzāʿī", "later", "أتباع التابعين", 157, "الشام"),
  n("ibn_mubarak", "عبد الله بن المبارك", "ابن المبارك", "ʿAbd Allāh ibn al-Mubārak", "later", "أوساط أتباع التابعين", 181, "خراسان"),
  n("shafii", "محمد بن إدريس الشافعي", "الشافعي", "Muḥammad al-Shāfiʿī", "later", "الطبقة التاسعة", 204, "مكة"),
  n("qaanabi", "عبد الله بن مسلمة القعنبي", "القعنبي", "ʿAbd Allāh al-Qaʿnabī", "later", "الطبقة التاسعة", 221, "البصرة"),
  n("yahya_yahya", "يحيى بن يحيى الليثي", "يحيى الليثي", "Yaḥyā ibn Yaḥyā al-Laythī", "later", "الطبقة العاشرة", 234, "نيسابور"),
  n("abdullah_yusuf", "عبد الله بن يوسف التنيسي", "عبد الله التنيسي", "ʿAbd Allāh ibn Yūsuf", "later", "الطبقة التاسعة", 218, "دمشق"),
  n("humaydi", "عبد الله بن الزبير الحميدي", "الحميدي", "al-Ḥumaydī", "later", "الطبقة العاشرة", 219, "مكة"),
  n("musaddad", "مسدد بن مسرهد", "مسدد", "Musaddad ibn Musarhad", "later", "الطبقة العاشرة", 228, "البصرة"),
  n("qutayba", "قتيبة بن سعيد", "قتيبة بن سعيد", "Qutayba ibn Saʿīd", "later", "الطبقة العاشرة", 240, "بلخ"),
  n("abu_bakr_shayba", "أبو بكر بن أبي شيبة", "ابن أبي شيبة", "Abū Bakr ibn Abī Shayba", "later", "الطبقة العاشرة", 235, "الكوفة"),
  n("ibn_numayr", "محمد بن عبد الله بن نمير", "ابن نمير", "Ibn Numayr", "later", "الطبقة العاشرة", 234, "الكوفة"),
  n("ishaq", "إسحاق بن راهويه", "ابن راهويه", "Isḥāq ibn Rāhawayh", "later", "الطبقة العاشرة", 238, "نيسابور"),
  n("bukhari", "محمد بن إسماعيل البخاري", "البخاري", "al-Bukhārī", "compiler", "الطبقة الحادية عشرة", 256, "بخارى"),
  n("muslim", "مسلم بن الحجاج", "مسلم", "Muslim ibn al-Ḥajjāj", "compiler", "الطبقة الحادية عشرة", 261, "نيسابور"),
  n("nasai", "أحمد بن شعيب النسائي", "النسائي", "al-Nasāʾī", "compiler", "الطبقة الثالثة عشرة", 303, "نسأ"),
  n("abdullah_wahb", "عبد الله بن وهب", "ابن وهب", "ʿAbd Allāh ibn Wahb", "later", "الطبقة التاسعة", 197, "مصر"),
  n("yunus", "يونس بن يزيد الأيلي", "يونس الأيلي", "Yūnus ibn Yazīd", "later", "الطبقة السابعة", 159, "أيلة", "high"),
  n("maan", "معن بن عيسى", "معن بن عيسى", "Maʿn ibn ʿĪsā", "later", "الطبقة التاسعة", 198, "المدينة"),
  n("bishr", "بشر بن المفضل", "بشر بن المفضل", "Bishr ibn al-Mufaḍḍal", "later", "الطبقة الثامنة", 187, "البصرة"),
  n("wakii", "وكيع بن الجراح", "وكيع", "Wakīʿ ibn al-Jarrāḥ", "later", "الطبقة التاسعة", 197, "الكوفة"),
  n("muhammad_kathir", "محمد بن كثير العبدي", "محمد العبدي", "Muḥammad ibn Kathīr", "later", "الطبقة العاشرة", 223, "البصرة", "medium"),
  n("harun", "هارون بن سعيد الأيلي", "هارون الأيلي", "Hārūn ibn Saʿīd", "later", "الطبقة العاشرة", 253, "مصر"),
  n("ibn_uyayna", "سفيان بن عيينة", "ابن عيينة", "Sufyān ibn ʿUyayna", "later", "الطبقة الثامنة", 198, "مكة"),
  n("abu_dawud", "سليمان بن الأشعث أبو داود", "أبو داود", "Abū Dāwūd", "compiler", "الطبقة الحادية عشرة", 275, "سجستان"),
];

export const narratorMap = new Map(narrators.map((item) => [item.id, item]));

const routes = [
  ["prophet", "umar", "alqama", "muhammad_ibrahim", "yahya", "malik", "abdullah_yusuf", "bukhari"],
  ["prophet", "umar", "alqama", "muhammad_ibrahim", "yahya", "sufyan", "wakii", "bukhari"],
  ["prophet", "umar", "alqama", "muhammad_ibrahim", "yahya", "hammad", "musaddad", "bukhari"],
  ["prophet", "umar", "alqama", "muhammad_ibrahim", "yahya", "layth", "qutayba", "muslim"],
  ["prophet", "umar", "alqama", "muhammad_ibrahim", "yahya", "ibn_mubarak", "ishaq", "muslim"],
  ["prophet", "umar", "alqama", "muhammad_ibrahim", "yahya", "malik", "qaanabi", "nasai"],
  ["prophet", "umar", "alqama", "muhammad_ibrahim", "yahya", "awzai", "muhammad_kathir", "abu_dawud"],
];

const generationX: Record<string, number> = {
  prophet: 80, umar: 265, alqama: 450, muhammad_ibrahim: 635, yahya: 820,
};
const branchXs = [1005, 1005, 1005, 1005, 1005, 1005, 1005];
const branchYs = [90, 205, 320, 435, 550, 665, 780];

const hadithIds = [...new Set(routes.flat())];
export const hadithNodes: GraphNode[] = hadithIds.map((id) => {
  const narrator = narratorMap.get(id)!;
  let x = generationX[id];
  let y = 435;
  if (!x) {
    const routeIndex = routes.findIndex((route) => route.includes(id));
    const position = routes[routeIndex].indexOf(id);
    x = branchXs[routeIndex] + (position - 5) * 180;
    y = branchYs[routeIndex];
  }
  return {
    data: {
      id, label: narrator.shortAr, subtitle: narrator.deathAh ? `ت ${narrator.deathAh} هـ` : narrator.tabaqa,
      kind: narrator.role, status: narrator.confidence,
    },
    position: { x, y },
    classes: narrator.role,
  };
});

const edgeIndex = new Map<string, GraphEdge>();
routes.forEach((route, routeIndex) => {
  const collection = ["البخاري", "البخاري", "البخاري", "مسلم", "مسلم", "النسائي", "أبو داود"][routeIndex];
  route.slice(0, -1).forEach((source, i) => {
    const target = route[i + 1];
    const key = `${source}-${target}`;
    const existing = edgeIndex.get(key);
    if (existing) {
      existing.data.count += 1;
      if (!existing.data.collection.includes(collection)) existing.data.collection += ` · ${collection}`;
    } else {
      edgeIndex.set(key, {
        data: {
          id: key, source, target, verb: i < 4 ? "عن" : "حدثنا",
          evidence: source === "awzai" && target === "muhammad_kathir" ? "candidate" : "isnad",
          collection, count: 1,
        },
        classes: source === "awzai" && target === "muhammad_kathir" ? "uncertain" : "isnad",
      });
    }
  });
});
export const hadithEdges = [...edgeIndex.values()];

const egoLinks = [
  ["alqama", "yahya", "biographical"], ["muhammad_ibrahim", "yahya", "isnad"], ["yahya", "malik", "isnad"],
  ["yahya", "sufyan", "isnad"], ["yahya", "hammad", "isnad"], ["yahya", "layth", "isnad"],
  ["yahya", "awzai", "biographical"], ["yahya", "ibn_mubarak", "isnad"], ["yahya", "maan", "biographical"],
  ["yahya", "bishr", "isnad"], ["yahya", "muhammad_kathir", "candidate"],
] as const;

export const egoNodes: GraphNode[] = [...new Set(egoLinks.flatMap(([a, b]) => [a, b]))].map((id) => {
  const narrator = narratorMap.get(id)!;
  const isCenter = id === "yahya";
  const isTeacher = egoLinks.some(([a, b]) => a === id && b === "yahya");
  const groupIndex = isTeacher ? egoLinks.filter(([, b]) => b === "yahya").findIndex(([a]) => a === id) : egoLinks.filter(([a]) => a === "yahya").findIndex(([, b]) => b === id);
  return {
    data: { id, label: narrator.shortAr, subtitle: narrator.deathAh ? `ت ${narrator.deathAh} هـ` : narrator.tabaqa, kind: narrator.role, status: narrator.confidence },
    position: isCenter ? { x: 520, y: 340 } : { x: isTeacher ? 170 : 870, y: 95 + groupIndex * (isTeacher ? 220 : 105) },
    classes: `${narrator.role}${isCenter ? " center" : ""}`,
  };
});

export const egoEdges: GraphEdge[] = egoLinks.map(([source, target, evidence], i) => ({
  data: { id: `ego-${i}`, source, target, verb: evidence === "isnad" ? "عن" : "ذُكر", evidence, collection: evidence === "isnad" ? "كتب الحديث" : "كتب الرجال", count: evidence === "isnad" ? 7 + i : 1 },
  classes: evidence,
}));

export const assertions: SourceAssertion[] = [
  { id: "a1", subjectId: "yahya", scholar: "يحيى بن معين", phraseAr: "ثقة", normalized: "thiqa", work: "تهذيب التهذيب", volume: "11", page: "223", status: "pending" },
  { id: "a2", subjectId: "yahya", scholar: "أحمد بن حنبل", phraseAr: "ثبت", normalized: "thabt", work: "تهذيب الكمال", volume: "31", page: "346", status: "pending" },
  { id: "a3", subjectId: "malik", scholar: "يحيى بن معين", phraseAr: "ثقة", normalized: "thiqa", work: "الجرح والتعديل", volume: "1", page: "12", status: "pending" },
  { id: "a4", subjectId: "sufyan", scholar: "الذهبي", phraseAr: "الإمام الحافظ", normalized: "praise", work: "سير أعلام النبلاء", volume: "7", page: "229", status: "pending" },
  { id: "a5", subjectId: "muhammad_kathir", scholar: "ابن حجر", phraseAr: "صدوق كثير الغلط", normalized: "qualified", work: "تقريب التهذيب", volume: "1", page: "504", status: "pending" },
];

export const matnVariants = [
  {
    id: "v1", label: "Variante A · Bukhārī", collections: ["البخاري"], branchIds: ["malik", "sufyan", "hammad"],
    text: "إِنَّمَا الأَعْمَالُ بِالنِّيَّاتِ، وَإِنَّمَا لِكُلِّ امْرِئٍ مَا نَوَى",
    translation: "Die Taten richten sich nach den Absichten; jedem Menschen kommt zu, was er beabsichtigt hat.",
  },
  {
    id: "v2", label: "Variante B · Muslim / Nasāʾī", collections: ["مسلم", "النسائي"], branchIds: ["layth", "ibn_mubarak", "qaanabi"],
    text: "إِنَّمَا الأَعْمَالُ بِالنِّيَّةِ، وَإِنَّمَا لاِمْرِئٍ مَا نَوَى",
    translation: "Die Handlungen gelten nach der Absicht; für einen Menschen gilt, was er beabsichtigte.",
  },
];

export const collectionOptions = ["Alle Sammlungen", "البخاري", "مسلم", "النسائي", "أبو داود"];

export const sourceRegister = [
  { title: "تقريب التهذيب", author: "ابن حجر", tier: "Personenidentität", rights: "zu klären", origin: "Beigefügte Bücherliste, S. 1" },
  { title: "تهذيب التهذيب", author: "ابن حجر", tier: "Personenidentität", rights: "zu klären", origin: "Beigefügte Bücherliste, S. 1" },
  { title: "ميزان الاعتدال", author: "الذهبي", tier: "Kritik", rights: "zu klären", origin: "Beigefügte Bücherliste, S. 1" },
  { title: "الجرح والتعديل", author: "ابن أبي حاتم", tier: "Personenidentität", rights: "zu klären", origin: "Beigefügte Bücherliste, S. 1" },
  { title: "المؤتلف والمختلف", author: "الدارقطني", tier: "Namensauflösung", rights: "zu klären", origin: "Beigefügte Bücherliste, S. 7" },
  { title: "المراسيل", author: "ابن أبي حاتم", tier: "Spezialproblem", rights: "zu klären", origin: "Beigefügte Bücherliste, S. 8" },
];

export const prototypeNotice = "Forschungsprototyp · Mock-Daten · Fachliche Angaben noch nicht redaktionell verifiziert";
