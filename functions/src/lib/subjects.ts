export const SUBJECT_LABELS: Record<string, string> = {
  en: "英語",
  jp: "国語",
  math: "数学",
  arith: "算数",
  sci: "理科",
  soc: "社会",
  life: "生活",
  music: "音楽",
  zukou: "図工",
  pe: "体育",
  home: "家庭",
  art: "美術",
  tech: "技術",
  modernJa: "現代文",
  classicalJa: "古典",
  kanbun: "漢文",
  physics: "物理",
  chemistry: "化学",
  biology: "生物",
  earth: "地学",
  historyJp: "日本史",
  historyWorld: "世界史",
  geography: "地理",
  gendaiSoc: "現代社会",
  ethics: "倫理",
  politicsEconomy: "政治・経済",
  shodo: "書道",
  info: "情報",
  other: "その他",
};

export function subjectLabel(code: string): string {
  return SUBJECT_LABELS[code] ?? code;
}

export function subjectsLabel(codes: string[]): string {
  return codes.map(subjectLabel).join("・");
}

