export const SUBJECT_MASTER = {
  en: { label: "英語", emoji: "🔤" },
  jp: { label: "国語", emoji: "📖" },
  math: { label: "数学", emoji: "🧮" },
  arith: { label: "算数", emoji: "➕" },
  sci: { label: "理科", emoji: "🧪" },
  soc: { label: "社会", emoji: "🌍" },
  life: { label: "生活", emoji: "🌱" },
  music: { label: "音楽", emoji: "🎵" },
  zukou: { label: "図工", emoji: "🎨" },
  pe: { label: "体育", emoji: "🏃" },
  home: { label: "家庭", emoji: "🏠" },
  art: { label: "美術", emoji: "🖌️" },
  tech: { label: "技術", emoji: "🛠️" },
  modernJa: { label: "現代文", emoji: "📘" },
  classicalJa: { label: "古典", emoji: "📜" },
  kanbun: { label: "漢文", emoji: "🀄" },
  physics: { label: "物理", emoji: "⚛️" },
  chemistry: { label: "化学", emoji: "⚗️" },
  biology: { label: "生物", emoji: "🧬" },
  earth: { label: "地学", emoji: "🌋" },
  historyJp: { label: "日本史", emoji: "🏯" },
  historyWorld: { label: "世界史", emoji: "🗺️" },
  geography: { label: "地理", emoji: "🧭" },
  gendaiSoc: { label: "現代社会", emoji: "🏛️" },
  ethics: { label: "倫理", emoji: "🤔" },
  politicsEconomy: { label: "政治・経済", emoji: "📊" },
  shodo: { label: "書道", emoji: "🖋️" },
  info: { label: "情報", emoji: "💻" },
  other: { label: "その他", emoji: "📌" },
};

export const SUBJECT_PACKS = [
  {
    id: "elementary",
    name: "小学生",
    showCategories: false,
    maxEnabled: 10,
    subjects: [
      { code: "en", category: "基本", order: 1, defaultEnabled: false },
      { code: "arith", category: "基本", order: 2, defaultEnabled: true },
      { code: "jp", category: "基本", order: 3, defaultEnabled: true },
      { code: "sci", category: "基本", order: 4, defaultEnabled: true },
      { code: "soc", category: "基本", order: 5, defaultEnabled: true },
      { code: "life", category: "基本", order: 6, defaultEnabled: false },
      { code: "music", category: "実技", order: 7, defaultEnabled: false },
      { code: "zukou", category: "実技", order: 8, defaultEnabled: false },
      { code: "pe", category: "実技", order: 9, defaultEnabled: false },
      { code: "home", category: "実技", order: 10, defaultEnabled: false },
      { code: "other", category: "その他", order: 11, defaultEnabled: true },
    ],
  },
  {
    id: "middle",
    name: "中学生",
    showCategories: false,
    maxEnabled: 10,
    subjects: [
      { code: "en", category: "基本", order: 1, defaultEnabled: true },
      { code: "math", category: "基本", order: 2, defaultEnabled: true },
      { code: "jp", category: "基本", order: 3, defaultEnabled: true },
      { code: "sci", category: "基本", order: 4, defaultEnabled: true },
      { code: "soc", category: "基本", order: 5, defaultEnabled: true },
      { code: "music", category: "実技", order: 6, defaultEnabled: false },
      { code: "art", category: "実技", order: 7, defaultEnabled: false },
      { code: "pe", category: "実技", order: 8, defaultEnabled: false },
      { code: "tech", category: "実技", order: 9, defaultEnabled: false },
      { code: "home", category: "実技", order: 10, defaultEnabled: false },
      { code: "other", category: "その他", order: 11, defaultEnabled: true },
    ],
  },
  {
    id: "high",
    name: "高校生",
    showCategories: true,
    maxEnabled: 10,
    subjects: [
      { code: "en", category: "外国語", order: 1, defaultEnabled: true },
      { code: "math", category: "数学", order: 2, defaultEnabled: true },
      { code: "jp", category: "国語", order: 3, defaultEnabled: true },
      { code: "physics", category: "理科", order: 4, defaultEnabled: false },
      { code: "gendaiSoc", category: "公民", order: 5, defaultEnabled: false },
      { code: "modernJa", category: "国語", order: 6, defaultEnabled: false },
      { code: "classicalJa", category: "国語", order: 7, defaultEnabled: false },
      { code: "kanbun", category: "国語", order: 8, defaultEnabled: false },
      { code: "chemistry", category: "理科", order: 9, defaultEnabled: false },
      { code: "biology", category: "理科", order: 10, defaultEnabled: false },
      { code: "earth", category: "理科", order: 11, defaultEnabled: false },
      { code: "historyJp", category: "地歴", order: 12, defaultEnabled: false },
      { code: "historyWorld", category: "地歴", order: 13, defaultEnabled: false },
      { code: "geography", category: "地歴", order: 14, defaultEnabled: false },
      { code: "ethics", category: "公民", order: 15, defaultEnabled: false },
      { code: "politicsEconomy", category: "公民", order: 16, defaultEnabled: false },
      { code: "music", category: "実技", order: 17, defaultEnabled: false },
      { code: "art", category: "実技", order: 18, defaultEnabled: false },
      { code: "shodo", category: "実技", order: 19, defaultEnabled: false },
      { code: "pe", category: "実技", order: 20, defaultEnabled: false },
      { code: "home", category: "実技", order: 21, defaultEnabled: false },
      { code: "info", category: "実技", order: 22, defaultEnabled: false },
      { code: "other", category: "その他", order: 23, defaultEnabled: true },
    ],
  },
];

const DEFAULT_PACK_ID = "middle";
const DEFAULT_MAX_ENABLED = 10;

export function getSubjectMeta(code) {
  const meta = SUBJECT_MASTER[code];
  if (!meta) return { label: code, emoji: "" };
  return { label: meta.label, emoji: meta.emoji ?? "" };
}

export function getSubjectLabel(code) {
  return getSubjectMeta(code).label;
}

export function getPackById(packId) {
  return SUBJECT_PACKS.find((pack) => pack.id === packId) ?? SUBJECT_PACKS.find((pack) => pack.id === DEFAULT_PACK_ID) ?? SUBJECT_PACKS[0];
}

export function getPackEntries(packId) {
  const pack = getPackById(packId);
  return [...pack.subjects]
    .sort((a, b) => a.order - b.order)
    .map((entry) => {
      const meta = getSubjectMeta(entry.code);
      return {
        code: entry.code,
        label: entry.labelOverride ?? meta.label,
        emoji: meta.emoji,
        category: entry.category,
        order: entry.order,
        defaultEnabled: entry.defaultEnabled === true,
      };
    });
}

export function resolveEnabledSubjects({ packId, enabledSubjects }) {
  const pack = getPackById(packId);
  const maxEnabled = typeof pack.maxEnabled === "number" ? pack.maxEnabled : DEFAULT_MAX_ENABLED;
  const packEntries = getPackEntries(pack.id);
  const hasExplicitEnabled = Array.isArray(enabledSubjects) && enabledSubjects.length > 0;
  const source = hasExplicitEnabled
    ? enabledSubjects
    : packEntries.filter((entry) => entry.defaultEnabled).map((entry) => entry.code);
  const selectedSet = new Set(
    source.filter((code) => typeof code === "string"),
  );

  const resolved = [];
  for (const entry of packEntries) {
    if (!selectedSet.has(entry.code)) continue;
    resolved.push(entry.code);
    if (resolved.length >= maxEnabled) break;
  }
  return resolved;
}
