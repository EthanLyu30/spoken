import {
  ArrowRight, Bell, BookOpen, Briefcase, CalendarCheck, CalendarDays, ChartColumn, ChefHat, CircleHelp,
  ClipboardCheck, Clock3, Coffee, CornerUpRight, FileCheck, Flag, Footprints, Handshake, Hash, Lightbulb,
  ListChecks, ListTodo, Luggage, MapPin, MessagesSquare, Monitor, Moon, Music, Phone, Receipt, RotateCcw,
  Ruler, Scale, Shirt, Signpost, StickyNote, Target, Thermometer, Ticket, Users, UtensilsCrossed, Volume2,
  type LucideIcon,
} from "lucide-react";
import everyday from "../assets/prep/everyday-scenes.webp";
import work from "../assets/prep/work-scenes.webp";

export type RehearsalAir = "cafe" | "daylight" | "sky" | "leaves" | "lamplight" | "screen";

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
};

export function rehearsalScene(id: string): RehearsalScene {
  return scenes[id] ?? scenes.custom;
}
