/**
 * Sample scenario catalogue used to drive the Home page in the scaffold.
 * In a later PR this is replaced by data served from the backend.
 */
export type ScenarioIcon =
  | "Briefcase"
  | "Coffee"
  | "Users"
  | "Plane"
  | "Stethoscope"
  | "PartyPopper";

export interface Scenario {
  id: string;
  slug: string;
  /** English title. */
  title: string;
  /** Chinese title. */
  titleZh: string;
  /** Short uppercase category tag (English). */
  category: string;
  categoryZh: string;
  /** One-line Chinese description. */
  subtitle: string;
  /** Editorial pull-line for the featured card. */
  goal: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
  minutes: number;
  icon: ScenarioIcon;
}

export const scenarios: Scenario[] = [
  {
    id: "interview",
    slug: "job-interview",
    title: "The Job Interview",
    titleZh: "求职面试",
    category: "Interview",
    categoryZh: "面试",
    subtitle: "和一位友好的招聘经理聊聊你的经历与优势",
    goal: "Walk a hiring manager through your experience, handle follow-ups, and close with a question of your own.",
    difficulty: 4,
    minutes: 8,
    icon: "Briefcase",
  },
  {
    id: "cafe",
    slug: "ordering-at-a-cafe",
    title: "Ordering at a Café",
    titleZh: "咖啡馆点单",
    category: "Dining",
    categoryZh: "点餐",
    subtitle: "点一杯咖啡和早午餐，应对加料与结账",
    goal: "Order a drink and brunch, customise it, and settle the bill.",
    difficulty: 1,
    minutes: 4,
    icon: "Coffee",
  },
  {
    id: "standup",
    slug: "the-team-standup",
    title: "The Team Standup",
    titleZh: "团队站会",
    category: "Meeting",
    categoryZh: "会议",
    subtitle: "汇报进度、说明阻塞点并对齐今日计划",
    goal: "Give a crisp status update and align on blockers.",
    difficulty: 3,
    minutes: 6,
    icon: "Users",
  },
  {
    id: "airport",
    slug: "airport-check-in",
    title: "Airport Check-in",
    titleZh: "机场值机",
    category: "Travel",
    categoryZh: "出行",
    subtitle: "办理登机、托运行李并确认登机口",
    goal: "Check in, check a bag, and confirm your gate.",
    difficulty: 2,
    minutes: 5,
    icon: "Plane",
  },
  {
    id: "doctor",
    slug: "doctors-visit",
    title: "A Doctor's Visit",
    titleZh: "看医生",
    category: "Health",
    categoryZh: "就医",
    subtitle: "描述症状、回答问诊并预约复诊",
    goal: "Describe symptoms and understand the advice you're given.",
    difficulty: 3,
    minutes: 6,
    icon: "Stethoscope",
  },
  {
    id: "party",
    slug: "small-talk-at-a-party",
    title: "Small Talk at a Party",
    titleZh: "派对寒暄",
    category: "Social",
    categoryZh: "社交",
    subtitle: "破冰、闲聊兴趣爱好并礼貌地结束对话",
    goal: "Break the ice, find common ground, and exit gracefully.",
    difficulty: 2,
    minutes: 5,
    icon: "PartyPopper",
  },
];

export function getScenario(id: string): Scenario | undefined {
  return scenarios.find((s) => s.id === id);
}

/** Map a 1–5 difficulty to a bilingual label. */
export function difficultyLabel(d: number): string {
  if (d <= 1) return "入门 · Easy";
  if (d === 2) return "初级 · Light";
  if (d === 3) return "中级 · Medium";
  if (d === 4) return "进阶 · Hard";
  return "高级 · Expert";
}
