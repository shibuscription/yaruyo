export const SUBJECTS = [
  { code: "en", label: "英語" },
  { code: "math", label: "数学" },
  { code: "jp", label: "国語" },
  { code: "sci", label: "理科" },
  { code: "soc", label: "社会" },
  { code: "other", label: "その他" },
];

export function subjectLabel(code) {
  return SUBJECTS.find((s) => s.code === code)?.label ?? code;
}
