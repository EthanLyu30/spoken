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
  | "PartyPopper"
  | "UtensilsCrossed"
  | "ShoppingBag"
  | "Hotel"
  | "MapPin"
  | "Presentation"
  | "Handshake"
  | "Headphones"
  | "MessageCircle"
  | "Scale"
  | "Video"
  | "ClipboardCheck"
  | "Megaphone";

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
  {
    id: "restaurant",
    slug: "dinner-reservation",
    title: "Dinner Reservation",
    titleZh: "餐厅订位点餐",
    category: "Dining",
    categoryZh: "餐饮",
    subtitle: "订位、看菜单、点一顿正式晚餐",
    goal: "Get a table, order a full meal, and ask about the dishes.",
    difficulty: 2,
    minutes: 6,
    icon: "UtensilsCrossed",
  },
  {
    id: "shopping",
    slug: "shopping-and-returns",
    title: "Shopping & Returns",
    titleZh: "购物与退换",
    category: "Shopping",
    categoryZh: "购物",
    subtitle: "试穿、比价、退换商品",
    goal: "Find an item, ask about size and price, and handle a return.",
    difficulty: 2,
    minutes: 5,
    icon: "ShoppingBag",
  },
  {
    id: "hotel",
    slug: "hotel-check-in",
    title: "Hotel Check-in",
    titleZh: "酒店入住",
    category: "Travel",
    categoryZh: "出行",
    subtitle: "办理入住、问设施、解决房间问题",
    goal: "Check in, ask about amenities, and sort out a room request.",
    difficulty: 2,
    minutes: 5,
    icon: "Hotel",
  },
  {
    id: "directions",
    slug: "asking-directions",
    title: "Asking Directions",
    titleZh: "街头问路",
    category: "Travel",
    categoryZh: "出行",
    subtitle: "向路人问路、听懂指引",
    goal: "Ask how to get somewhere and confirm the route.",
    difficulty: 1,
    minutes: 4,
    icon: "MapPin",
  },
  {
    id: "presentation",
    slug: "presentation-qa",
    title: "Presentation Q&A",
    titleZh: "汇报答疑",
    category: "Work",
    categoryZh: "职场",
    subtitle: "做完汇报后回答听众提问",
    goal: "Field questions about your presentation clearly and confidently.",
    difficulty: 4,
    minutes: 7,
    icon: "Presentation",
  },
  {
    id: "networking",
    slug: "networking-event",
    title: "Networking Event",
    titleZh: "职场社交",
    category: "Work",
    categoryZh: "职场",
    subtitle: "在活动上认识同行、交换联系",
    goal: "Introduce yourself, find common ground, and swap contacts.",
    difficulty: 3,
    minutes: 6,
    icon: "Handshake",
  },
  {
    id: "phone",
    slug: "customer-service-call",
    title: "Customer Service Call",
    titleZh: "客服来电",
    category: "Services",
    categoryZh: "服务",
    subtitle: "电话咨询 / 投诉、解决问题",
    goal: "Explain a problem on the phone and get it resolved.",
    difficulty: 3,
    minutes: 6,
    icon: "Headphones",
  },
  {
    id: "friend",
    slug: "catching-up",
    title: "Catching Up",
    titleZh: "和朋友闲聊",
    category: "Social",
    categoryZh: "社交",
    subtitle: "和好友聊近况、约周末",
    goal: "Catch up with a friend and make weekend plans.",
    difficulty: 1,
    minutes: 5,
    icon: "MessageCircle",
  },
  {
    id: "negotiation",
    slug: "business-negotiation",
    title: "Business Negotiation",
    titleZh: "商务谈判",
    category: "Business",
    categoryZh: "商务",
    subtitle: "就价格、交期与条款来回拉锯，达成共识",
    goal: "Negotiate price, timeline and terms, and reach a deal both sides can accept.",
    difficulty: 5,
    minutes: 8,
    icon: "Scale",
  },
  {
    id: "videocall",
    slug: "joining-a-video-call",
    title: "Joining a Video Call",
    titleZh: "远程视频会议",
    category: "Meeting",
    categoryZh: "会议",
    subtitle: "加入视频会议、处理音画小状况、轮流发言并对齐行动项",
    goal: "Join a video meeting, handle a tech hiccup, take your turn, and recap action items.",
    difficulty: 3,
    minutes: 6,
    icon: "Video",
  },
  {
    id: "oneonone",
    slug: "performance-review",
    title: "Performance Review",
    titleZh: "绩效面谈",
    category: "Career",
    categoryZh: "职业发展",
    subtitle: "和经理聊近期表现、接收反馈、对齐目标与成长",
    goal: "Talk through your recent work with your manager, take feedback well, and set goals.",
    difficulty: 4,
    minutes: 7,
    icon: "ClipboardCheck",
  },
  {
    id: "pitch",
    slug: "client-pitch",
    title: "Pitching to a Client",
    titleZh: "向客户路演",
    category: "Business",
    categoryZh: "商务",
    subtitle: "向潜在客户介绍方案、回应顾虑、推动下一步",
    goal: "Pitch your solution to a prospective client, handle objections, and agree on next steps.",
    difficulty: 5,
    minutes: 8,
    icon: "Megaphone",
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

export interface Chapter {
  title: string;
  titleZh: string;
  ids: string[];
}

/** Ordered chapters for the journey-map home. */
export const chapters: Chapter[] = [
  { title: "Daily Life", titleZh: "日常生活", ids: ["cafe", "restaurant", "shopping", "doctor"] },
  { title: "On the Go", titleZh: "出行在外", ids: ["airport", "hotel", "directions"] },
  { title: "At Work", titleZh: "职场进阶", ids: ["interview", "standup", "presentation", "networking"] },
  { title: "Business Pro", titleZh: "商务进阶", ids: ["negotiation", "videocall", "oneonone", "pitch"] },
  { title: "Social", titleZh: "社交时刻", ids: ["party", "friend", "phone"] },
];
