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

const estimatedBirthRanges: Record<string, [number, number]> = {
  yahya: [68, 72], malik: [90, 93], sufyan: [95, 98], hammad: [96, 99], layth: [92, 95],
  awzai: [86, 89], ibn_mubarak: [116, 119], shafii: [148, 150], qaanabi: [128, 132],
  yahya_yahya: [150, 154], abdullah_yusuf: [135, 140], humaydi: [160, 165], musaddad: [150, 155],
  qutayba: [148, 152], abu_bakr_shayba: [157, 160], ibn_numayr: [158, 162], ishaq: [159, 163],
  bukhari: [193, 194], muslim: [203, 206], nasai: [214, 216], abdullah_wahb: [123, 126],
  yunus: [88, 92], maan: [128, 132], bishr: [112, 116], wakii: [126, 130],
  muhammad_kathir: [130, 140], harun: [165, 170], ibn_uyayna: [106, 108], abu_dawud: [201, 203],
};

narrators.forEach((narrator) => {
  const range = estimatedBirthRanges[narrator.id];
  if (range) [narrator.birthAhMin, narrator.birthAhMax] = range;
});

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
  const variant = ["أ", "أ", "أ", "ب", "ب", "ب", "ج"][routeIndex];
  route.slice(0, -1).forEach((source, i) => {
    const target = route[i + 1];
    const key = `${source}-${target}`;
    const existing = edgeIndex.get(key);
    if (existing) {
      existing.data.count += 1;
      if (!existing.data.collection.includes(collection)) existing.data.collection += ` · ${collection}`;
      if (!existing.data.variants?.includes(variant)) existing.data.variants += ` · ${variant}`;
    } else {
      edgeIndex.set(key, {
        data: {
          id: key, source, target, verb: i < 4 ? "عن" : "حدثنا",
          evidence: source === "awzai" && target === "muhammad_kathir" ? "candidate" : "isnad",
          collection, count: 1, variants: variant,
        },
        classes: source === "awzai" && target === "muhammad_kathir" ? "uncertain" : "isnad",
      });
    }
  });
});
export const hadithEdges = [...edgeIndex.values()];

hadithEdges.forEach((edge) => {
  const variantCount = edge.data.variants?.split(" · ").length ?? 1;
  edge.classes = `${edge.classes ?? ""} ${variantCount > 1 ? "variant-shared" : `variant-${edge.data.variants === "أ" ? "a" : edge.data.variants === "ب" ? "b" : "c"}`}`.trim();
});

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
  data: {
    id: `ego-${i}`, source, target, verb: evidence === "isnad" ? "عن" : "ذُكر", evidence,
    collection: evidence === "isnad" ? "كتب الحديث" : "كتب الرجال", count: evidence === "isnad" ? 7 + i : 1,
    chronologyStatus: (() => {
      const teacher = narratorMap.get(source); const student = narratorMap.get(target);
      if (!teacher?.deathAh || !student?.birthAhMin) return "unknown";
      return teacher.deathAh >= student.birthAhMin + 10 ? "possible" : "impossible";
    })(),
    chronologyLabel: (() => {
      const teacher = narratorMap.get(source); const student = narratorMap.get(target);
      if (!teacher?.deathAh || !student?.birthAhMin) return "المعطيات الزمنية غير كافية";
      return teacher.deathAh >= student.birthAhMin + 10 ? "اللقاء ممكن زمنيا، وليس مثبتا بذلك وحده" : "تعارض زمني ظاهر يحتاج إلى مراجعة الهوية";
    })(),
  },
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
    id: "v1", label: "الرواية أ · البخاري", collections: ["البخاري"], branchIds: ["malik", "sufyan", "hammad"],
    text: "إِنَّمَا الأَعْمَالُ بِالنِّيَّاتِ، وَإِنَّمَا لِكُلِّ امْرِئٍ مَا نَوَى",
    translation: "صيغة متنية أولى مرتبطة بهذه الفروع في بيانات العرض.",
  },
  {
    id: "v2", label: "الرواية ب · مسلم والنسائي", collections: ["مسلم", "النسائي"], branchIds: ["layth", "ibn_mubarak", "qaanabi"],
    text: "إِنَّمَا الأَعْمَالُ بِالنِّيَّةِ، وَإِنَّمَا لاِمْرِئٍ مَا نَوَى",
    translation: "صيغة متنية ثانية مرتبطة بهذه الفروع في بيانات العرض.",
  },
];

export const collectionOptions = ["جميع المصنفات", "البخاري", "مسلم", "النسائي", "أبو داود"];

export const sourceRegister = [
  { title: "صحيح البخاري", author: "البخاري", tier: "الأحاديث والأسانيد", rights: "قيد المراجعة", origin: "تراث، الكتاب ٧٣٥" },
  { title: "صحيح مسلم", author: "مسلم", tier: "الأحاديث والأسانيد", rights: "قيد المراجعة", origin: "تراث، الكتاب ١٧٢٧" },
  { title: "تقريب التهذيب", author: "ابن حجر", tier: "هوية الرواة", rights: "قيد المراجعة", origin: "تراث، الكتاب ٨٦٠٩" },
  { title: "الكاشف", author: "الذهبي", tier: "الشيوخ والتلاميذ", rights: "قيد المراجعة", origin: "تراث، الكتاب ٢١٧١" },
];

export const prototypeNotice = "نسخة بحثية أولية · البيانات المستخرجة آليا لم تُراجع علميا بعد";
