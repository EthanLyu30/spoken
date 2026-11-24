import {
  ArrowRight, Bell, BookOpen, Briefcase, CalendarCheck, CalendarDays, ChartColumn, ChefHat, CircleHelp,
  ClipboardCheck, Clock3, Coffee, CornerUpRight, FileCheck, Flag, Footprints, Handshake, Hash, Lightbulb,
  ListChecks, ListTodo, Luggage, MapPin, MessagesSquare, Monitor, Moon, Music, Phone, Receipt, RotateCcw,
  Ruler, Scale, Shirt, Signpost, StickyNote, Target, Thermometer, Ticket, Users, UtensilsCrossed, Volume2,
  type LucideIcon,
} from "lucide-react";
import everyday from "../assets/prep/everyday-scenes.webp";
import work from "../assets/prep/work-scenes.webp";
import customAtlas from "../assets/prep/custom-scenes.webp";
import type { CustomScene } from "../lib/api";

export type RehearsalAir = "cafe" | "cafe-rain" | "daylight" | "sky" | "leaves" | "lamplight" | "screen" | "water";

interface RehearsalScene {
  atlas: string;
  cell: number;
  air: RehearsalAir;
  icons: readonly LucideIcon[];
}

const scenes: Record<string, RehearsalScene> = {
  airport: { atlas: everyday, cell: 0, air: "sky", icons: [Ticket, Luggage, Signpost] },
  hotel: { atlas: everyday, cell: 1, air: "lamplight", icons: [Bell, Coffee, Clock3] },
  doctor: { atlas: everyday, cell: 2, air: "daylight", icons: [Thermometer, Moon, CalendarCheck] },
  restaurant: { atlas: everyday, cell: 3, air: "lamplight", icons: [UtensilsCrossed, ChefHat, Receipt] },
  shopping: { atlas: everyday, cell: 4, air: "daylight", icons: [Shirt, Ruler, RotateCcw] },
  directions: { atlas: everyday, cell: 5, air: "leaves", icons: [MapPin, Footprints, CornerUpRight] },
  interview: { atlas: everyday, cell: 6, air: "daylight", icons: [Briefcase, ListChecks, Target] },
  party: { atlas: everyday, cell: 7, air: "lamplight", icons: [Users, Music, MessagesSquare] },
  friend: { atlas: everyday, cell: 8, air: "leaves", icons: [MessagesSquare, BookOpen, CalendarDays] },
  standup: { atlas: work, cell: 0, air: "daylight", icons: [StickyNote, Flag, ListTodo] },
  presentation: { atlas: work, cell: 1, air: "screen", icons: [ChartColumn, ClipboardCheck, CircleHelp] },
  networking: { atlas: work, cell: 2, air: "daylight", icons: [Briefcase, Lightbulb, Handshake] },
  phone: { atlas: work, cell: 3, air: "daylight", icons: [Phone, Hash, ListChecks] },
  negotiation: { atlas: work, cell: 4, air: "lamplight", icons: [CalendarDays, Scale, FileCheck] },
  videocall: { atlas: work, cell: 5, air: "screen", icons: [Volume2, Monitor, ListTodo] },
  oneonone: { atlas: work, cell: 6, air: "daylight", icons: [MessagesSquare, ChartColumn, CalendarCheck] },
  pitch: { atlas: work, cell: 7, air: "screen", icons: [Flag, Lightbulb, ArrowRight] },
  custom: { atlas: work, cell: 8, air: "daylight", icons: [] },
  ferry: { atlas: customAtlas, cell: 0, air: "water", icons: [] },
  rail: { atlas: customAtlas, cell: 1, air: "sky", icons: [] },
  bank: { atlas: customAtlas, cell: 2, air: "lamplight", icons: [] },
  pharmacy: { atlas: customAtlas, cell: 3, air: "daylight", icons: [] },
  apartment: { atlas: customAtlas, cell: 4, air: "lamplight", icons: [] },
  library: { atlas: customAtlas, cell: 5, air: "daylight", icons: [] },
  market: { atlas: customAtlas, cell: 6, air: "leaves", icons: [] },
  museum: { atlas: customAtlas, cell: 7, air: "lamplight", icons: [] },
  gym: { atlas: customAtlas, cell: 8, air: "daylight", icons: [] },
};

// Prefer a place named in the title, then look at the role, goal and scene setup.
const settings: readonly [id: string, keywords: RegExp][] = [
  ["ferry", /\b(?:ferr(?:y|ies)|harbou?r|pier|marina|cruise terminal)\b|渡轮|轮渡|游轮|码头|港口/i],
  ["rail", /\b(?:railway|railroad|rail station|train (?:station|ticket|travel)|subway|metro)\b|火车站|高铁|地铁|铁路/i],
  ["bank", /\b(?:bank(?:ing)?|bank teller|currency exchange|open(?:ing)? a (?:bank )?account)\b|银行|开户|柜员|换汇/i],
  ["pharmacy", /\b(?:pharmacy|pharmacist|drugstore|chemist's)\b|药店|药房|药剂师/i],
  ["apartment", /\b(?:apartment|landlord|tenant|roommate|rent(?:al)? agreement)\b|房东|租客|租房|公寓|合租/i],
  ["library", /\b(?:librar(?:y|ian)|classroom|campus|school)\b|图书馆|借书|教室|学校|校园/i],
  ["market", /\b(?:farmers['’]? market|produce market|market stall|street market)\b|菜市场|集市|摊位/i],
  ["museum", /\b(?:museum|art gallery|exhibit(?:ion)?)\b|博物馆|美术馆|展览/i],
  ["gym", /\b(?:gym|fitness cent(?:er|re)|personal train(?:er|ing))\b|健身|私教/i],
  ["airport", /\b(?:airport|boarding gate|airline|flight)\b|机场|值机|登机口|航班/i],
  ["doctor", /\b(?:doctor|dentist|hospital|clinic|health cent(?:er|re))\b|诊室|问诊|看医生|诊所|医院|牙医/i],
  ["hotel", /\b(?:hotel|inn|room service|guesthouse)\b|酒店|宾馆|旅店|退房/i],
  ["restaurant", /\b(?:restaurant|caf[eé]|coffee shop|barista|waiter)\b|咖啡店|咖啡馆|餐馆|餐厅|点餐/i],
  ["shopping", /\b(?:clothing (?:shop|store)|retail|fitting room|refund)\b|服装店|试衣|买衣服|退货/i],
  ["friend", /\b(?:park|garden|picnic)\b|公园|花园|野餐/i],
  ["interview", /\b(?:job interview|recruiter|hiring manager)\b|面试|招聘/i],
  ["videocall", /\b(?:video call|online meeting|screen share)\b|视频会议|网课|共享屏幕/i],
  ["standup", /\b(?:office|workplace|team meeting|standup|colleague)\b|办公室|开会|同事|站会/i],
];

export function rehearsalScene(id: string, custom?: CustomScene | null): RehearsalScene {
  if (id === "custom" && custom) {
    if (custom.rehearsal_theme && Object.prototype.hasOwnProperty.call(scenes, custom.rehearsal_theme)) {
      return scenes[custom.rehearsal_theme];
    }
    for (const text of [`${custom.title_zh ?? ""} ${custom.title}`, custom.goal, custom.partner_role, custom.persona, custom.opening_line]) {
      const setting = settings.find(([, keywords]) => keywords.test(text));
      if (setting) return scenes[setting[0]];
    }
  }
  return scenes[id] ?? scenes.custom;
}
