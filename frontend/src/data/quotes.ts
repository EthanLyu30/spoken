export type QuoteCategory = "movie" | "speech" | "literature" | "people" | "proverb";

export interface Quote {
  /** Exact English wording. */
  text: string;
  /** Speaker: the character for film/dialogue, otherwise the author/speaker. */
  author: string;
  zh: string;
  category: QuoteCategory;
  /** Work / occasion + year, e.g. "Dead Poets Society (1989)". Omitted for proverbs. */
  source?: string;
  /** When / how to actually use this line in conversation or writing. */
  usage: string;
}

/**
 * Curated, attributed lines for daily shadowing. Attributions are kept honest:
 * famous misattributed/apocryphal quotes (e.g. the "Gandhi" / "Eleanor
 * Roosevelt" ones) are deliberately excluded. Each card shows when to use the
 * line and links out to a search so learners can hear the original.
 */
export const quotes: Quote[] = [
  // --- 电影 Movies ---
  {
    text: "Life was like a box of chocolates. You never know what you're gonna get.",
    author: "Forrest Gump",
    zh: "生活就像一盒巧克力，你永远不知道下一颗是什么味道。",
    category: "movie",
    source: "Forrest Gump (1994)",
    usage: "聊人生的不确定、安慰自己或别人坦然面对未知时。",
  },
  {
    text: "May the Force be with you.",
    author: "Han Solo",
    zh: "愿原力与你同在。",
    category: "movie",
    source: "Star Wars (1977)",
    usage: "为别人送行、考试/面试前打气，半开玩笑地祝好运。",
  },
  {
    text: "To infinity and beyond!",
    author: "Buzz Lightyear",
    zh: "飞向宇宙，浩瀚无垠！",
    category: "movie",
    source: "Toy Story (1995)",
    usage: "给团队或孩子鼓劲、开启一个大目标时的口号。",
  },
  {
    text: "Just keep swimming.",
    author: "Dory",
    zh: "不停地游就好。",
    category: "movie",
    source: "Finding Nemo (2003)",
    usage: "遇到困难想放弃时，鼓励自己或朋友再坚持一下。",
  },
  {
    text: "Hope is a good thing, maybe the best of things, and no good thing ever dies.",
    author: "Andy Dufresne",
    zh: "希望是美好的，也许是人间至善，而美好的事物永不消逝。",
    category: "movie",
    source: "The Shawshank Redemption (1994)",
    usage: "谈希望、鼓励身处低谷的人时；也很适合作文结尾。",
  },
  {
    text: "There's no place like home.",
    author: "Dorothy",
    zh: "没有什么地方比得上家。",
    category: "movie",
    source: "The Wizard of Oz (1939)",
    usage: "旅途归来、想家，或聊“家的意义”时。",
  },
  {
    text: "Carpe diem. Seize the day, boys.",
    author: "John Keating",
    zh: "把握当下，孩子们，及时行动。",
    category: "movie",
    source: "Dead Poets Society (1989)",
    usage: "鼓励别人抓住机会、别再拖延；演讲/作文谈“活在当下”。",
  },
  {
    text: "With great power comes great responsibility.",
    author: "Uncle Ben",
    zh: "能力越大，责任越大。",
    category: "movie",
    source: "Spider-Man (2002)",
    usage: "谈责任与能力，升职、带团队或为人父母时。",
  },
  {
    text: "I'll be back.",
    author: "The Terminator",
    zh: "我会回来的。",
    category: "movie",
    source: "The Terminator (1984)",
    usage: "轻松场合离开时，半开玩笑地说“我还会回来”。",
  },
  {
    text: "After all, tomorrow is another day.",
    author: "Scarlett O'Hara",
    zh: "毕竟，明天又是新的一天。",
    category: "movie",
    source: "Gone with the Wind (1939)",
    usage: "安慰遭遇挫折的人，相信明天会更好时。",
  },
  {
    text: "Here's looking at you, kid.",
    author: "Rick Blaine",
    zh: "敬你，孩子。",
    category: "movie",
    source: "Casablanca (1942)",
    usage: "浪漫或告别场合，俏皮地举杯、表达心意时。",
  },
  {
    text: "Keep your friends close, but your enemies closer.",
    author: "Michael Corleone",
    zh: "亲近你的朋友，但要更亲近你的敌人。",
    category: "movie",
    source: "The Godfather Part II (1974)",
    usage: "谈处世策略、如何对待竞争对手时。",
  },
  {
    text: "There's some good in this world, Mr. Frodo, and it's worth fighting for.",
    author: "Samwise Gamgee",
    zh: "这世上仍有美好，弗罗多先生，值得我们为之奋战。",
    category: "movie",
    source: "The Lord of the Rings: The Two Towers (2002)",
    usage: "在困境中鼓励别人坚守信念、别失去希望时。",
  },

  // --- 演讲 Speeches & TED ---
  {
    text: "Stay hungry. Stay foolish.",
    author: "Steve Jobs",
    zh: "求知若饥，虚心若愚。",
    category: "speech",
    source: "Stanford Commencement, 2005",
    usage: "毕业、新起点自勉，鼓励保持好奇与谦逊。",
  },
  {
    text: "Your time is limited, so don't waste it living someone else's life.",
    author: "Steve Jobs",
    zh: "你的时间有限，别浪费在过别人的生活上。",
    category: "speech",
    source: "Stanford Commencement, 2005",
    usage: "劝人忠于自己、别被他人期待左右；谈人生选择。",
  },
  {
    text: "Ask not what your country can do for you — ask what you can do for your country.",
    author: "John F. Kennedy",
    zh: "不要问国家能为你做什么，要问你能为国家做什么。",
    category: "speech",
    source: "Inaugural Address, 1961",
    usage: "谈责任、奉献、集体与个人，正式发言或作文时。",
  },
  {
    text: "The only thing we have to fear is fear itself.",
    author: "Franklin D. Roosevelt",
    zh: "我们唯一需要恐惧的，就是恐惧本身。",
    category: "speech",
    source: "First Inaugural Address, 1933",
    usage: "鼓励别人克服恐惧、勇敢面对困难时。",
  },
  {
    text: "I have a dream.",
    author: "Martin Luther King Jr.",
    zh: "我有一个梦想。",
    category: "speech",
    source: "March on Washington, 1963",
    usage: "表达理想、为愿景发声时；演讲/作文经典开头。",
  },
  {
    text: "Don't fake it till you make it. Fake it till you become it.",
    author: "Amy Cuddy",
    zh: "不要假装到成功为止，要假装到你真正成为那样的人。",
    category: "speech",
    source: "TED Talk, 2012",
    usage: "鼓励缺乏自信的人先表现自信、慢慢成为；上台/面试前。",
  },
  {
    text: "If you're not prepared to be wrong, you'll never come up with anything original.",
    author: "Ken Robinson",
    zh: "如果你不敢犯错，就永远想不出有原创性的东西。",
    category: "speech",
    source: "TED Talk, 2006",
    usage: "谈创新、鼓励团队大胆尝试、不怕犯错时。",
  },
  {
    text: "Education is the most powerful weapon which you can use to change the world.",
    author: "Nelson Mandela",
    zh: "教育是你能用来改变世界的最强武器。",
    category: "speech",
    source: "speech, 2003",
    usage: "谈教育的意义、写教育相关作文或演讲时。",
  },

  // --- 文学 Literature ---
  {
    text: "It is our choices that show what we truly are, far more than our abilities.",
    author: "Albus Dumbledore",
    zh: "决定我们是谁的，是我们的选择，而远非我们的能力。",
    category: "literature",
    source: "J.K. Rowling, Harry Potter and the Chamber of Secrets",
    usage: "谈品格与选择、鼓励为正确的事负责时。",
  },
  {
    text: "Not all those who wander are lost.",
    author: "J.R.R. Tolkien",
    zh: "并非所有徘徊的人都迷失了方向。",
    category: "literature",
    source: "The Lord of the Rings",
    usage: "安慰“看似没方向”的人，肯定探索与试错的价值。",
  },
  {
    text: "All we have to decide is what to do with the time that is given us.",
    author: "Gandalf",
    zh: "我们要做的，只是决定如何度过被赋予的时光。",
    category: "literature",
    source: "J.R.R. Tolkien, The Lord of the Rings",
    usage: "面对无法改变的处境，谈如何把握当下时。",
  },
  {
    text: "It does not do to dwell on dreams and forget to live.",
    author: "Albus Dumbledore",
    zh: "沉湎于梦想而忘记生活，是不可取的。",
    category: "literature",
    source: "J.K. Rowling, Harry Potter and the Philosopher's Stone",
    usage: "提醒别只空想、要行动，平衡理想与现实时。",
  },
  {
    text: "So we beat on, boats against the current, borne back ceaselessly into the past.",
    author: "F. Scott Fitzgerald",
    zh: "于是我们奋力搏击，如同逆水行舟，不停地被浪潮推回到过去。",
    category: "literature",
    source: "The Great Gatsby",
    usage: "谈奋斗与命运、怀旧时；偏文学化写作引用。",
  },
  {
    text: "We accept the love we think we deserve.",
    author: "Stephen Chbosky",
    zh: "我们接受自己认为配得上的爱。",
    category: "literature",
    source: "The Perks of Being a Wallflower",
    usage: "谈自我价值与亲密关系、自我成长时。",
  },
  {
    text: "Whatever our souls are made of, his and mine are the same.",
    author: "Emily Brontë",
    zh: "无论我们的灵魂由什么构成，他的和我的都是一样的。",
    category: "literature",
    source: "Wuthering Heights",
    usage: "表达深刻的灵魂共鸣或爱情时，浪漫场合。",
  },
  {
    text: "Tomorrow is always fresh, with no mistakes in it yet.",
    author: "Anne Shirley",
    zh: "明天总是崭新的，还没有任何过失。",
    category: "literature",
    source: "L.M. Montgomery, Anne of Green Gables",
    usage: "犯错后自我宽慰、满怀希望迎接新一天时。",
  },
  {
    text: "It was the best of times, it was the worst of times.",
    author: "Charles Dickens",
    zh: "那是最好的时代，也是最坏的时代。",
    category: "literature",
    source: "A Tale of Two Cities",
    usage: "形容矛盾交织的时代或处境时，写作开头很好用。",
  },
  {
    text: "To be, or not to be, that is the question.",
    author: "William Shakespeare",
    zh: "生存还是毁灭，这是个问题。",
    category: "literature",
    source: "Hamlet",
    usage: "面对重大两难抉择时引用，略带戏剧色彩。",
  },

  // --- 名人 Famous people ---
  {
    text: "The only way to do great work is to love what you do.",
    author: "Steve Jobs",
    zh: "把工作做到卓越的唯一方法，就是热爱你所做的事。",
    category: "people",
    source: "Stanford Commencement, 2005",
    usage: "谈职业选择、热爱与坚持时。",
  },
  {
    text: "Life is what happens when you're busy making other plans.",
    author: "John Lennon",
    zh: "生活，就是当你忙于计划时发生的事。",
    category: "people",
    source: "song \"Beautiful Boy\", 1980",
    usage: "提醒别只顾计划而错过眼前的生活时。",
  },
  {
    text: "The journey of a thousand miles begins with a single step.",
    author: "Lao Tzu",
    zh: "千里之行，始于足下。",
    category: "people",
    source: "Tao Te Ching",
    usage: "开启大目标、鼓励别人勇敢迈出第一步时。",
  },
  {
    text: "Well done is better than well said.",
    author: "Benjamin Franklin",
    zh: "做得好胜过说得好。",
    category: "people",
    source: "Poor Richard's Almanack",
    usage: "强调行动、少说多做、用结果说话时。",
  },
  {
    text: "Done is better than perfect.",
    author: "Sheryl Sandberg",
    zh: "完成胜过完美。",
    category: "people",
    source: "Lean In",
    usage: "治拖延与完美主义，鼓励先把事情做完时。",
  },
  {
    text: "You miss 100% of the shots you don't take.",
    author: "Wayne Gretzky",
    zh: "你不出手，就百分之百不会进球。",
    category: "people",
    usage: "鼓励别人大胆尝试、别因怕失败而不行动时。",
  },
  {
    text: "Do what you can, with what you have, where you are.",
    author: "Theodore Roosevelt",
    zh: "在你所处之地，用你所有的，做你能做的。",
    category: "people",
    usage: "资源有限时，鼓励就地起步、先做起来。",
  },
  {
    text: "Turn your wounds into wisdom.",
    author: "Oprah Winfrey",
    zh: "把伤痛化作智慧。",
    category: "people",
    usage: "安慰受挫的人、谈从痛苦经历中成长时。",
  },
  {
    text: "Don't watch the clock; do what it does. Keep going.",
    author: "Sam Levenson",
    zh: "别盯着时钟，像它一样不停向前。",
    category: "people",
    usage: "鼓励专注坚持、别总想着时间快慢时。",
  },
  {
    text: "Float like a butterfly, sting like a bee.",
    author: "Muhammad Ali",
    zh: "像蝴蝶一样飞舞，像蜜蜂一样蜇人。",
    category: "people",
    usage: "形容灵活敏捷、充满自信的宣言，也常用于比赛/体育语境。",
  },

  // --- 谚语 Proverbs (traditional, no single author) ---
  {
    text: "Practice makes perfect.",
    author: "English proverb",
    zh: "熟能生巧。",
    category: "proverb",
    usage: "鼓励反复练习、学习新技能时。",
  },
  {
    text: "Where there is a will, there is a way.",
    author: "English proverb",
    zh: "有志者，事竟成。",
    category: "proverb",
    usage: "鼓励别人只要有决心就能克服困难时。",
  },
  {
    text: "Actions speak louder than words.",
    author: "English proverb",
    zh: "行动胜于言辞。",
    category: "proverb",
    usage: "强调用行动证明、少空谈时。",
  },
  {
    text: "Rome wasn't built in a day.",
    author: "English proverb",
    zh: "罗马不是一天建成的。",
    category: "proverb",
    usage: "安慰急于求成的人，谈凡事需要循序渐进时。",
  },
  {
    text: "Better late than never.",
    author: "English proverb",
    zh: "迟到总比不到好。",
    category: "proverb",
    usage: "鼓励“虽迟但做”、开始永远不算晚时。",
  },
];

export const categoryLabels: Record<QuoteCategory, string> = {
  movie: "电影",
  speech: "演讲",
  literature: "文学",
  people: "名人",
  proverb: "谚语",
};

/** A web-search URL so learners can hear the original line and explore it. */
export function quoteSearchUrl(q: { text: string; author: string; source?: string }): string {
  const query = [`"${q.text}"`, q.author, q.source].filter(Boolean).join(" ");
  return `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
}
