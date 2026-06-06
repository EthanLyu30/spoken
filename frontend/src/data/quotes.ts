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
}

/**
 * Curated, attributed lines for daily shadowing. Attributions are kept honest:
 * famous misattributed/apocryphal quotes (e.g. the "Gandhi" / "Eleanor
 * Roosevelt" ones) are deliberately excluded. Each card links out to a search
 * so learners can hear the original and explore further.
 */
export const quotes: Quote[] = [
  // --- 电影 Movies ---
  {
    text: "Life was like a box of chocolates. You never know what you're gonna get.",
    author: "Forrest Gump",
    zh: "生活就像一盒巧克力，你永远不知道下一颗是什么味道。",
    category: "movie",
    source: "Forrest Gump (1994)",
  },
  {
    text: "May the Force be with you.",
    author: "Han Solo",
    zh: "愿原力与你同在。",
    category: "movie",
    source: "Star Wars (1977)",
  },
  {
    text: "To infinity and beyond!",
    author: "Buzz Lightyear",
    zh: "飞向宇宙，浩瀚无垠！",
    category: "movie",
    source: "Toy Story (1995)",
  },
  {
    text: "Just keep swimming.",
    author: "Dory",
    zh: "不停地游就好。",
    category: "movie",
    source: "Finding Nemo (2003)",
  },
  {
    text: "Hope is a good thing, maybe the best of things, and no good thing ever dies.",
    author: "Andy Dufresne",
    zh: "希望是美好的，也许是人间至善，而美好的事物永不消逝。",
    category: "movie",
    source: "The Shawshank Redemption (1994)",
  },
  {
    text: "There's no place like home.",
    author: "Dorothy",
    zh: "没有什么地方比得上家。",
    category: "movie",
    source: "The Wizard of Oz (1939)",
  },
  {
    text: "Carpe diem. Seize the day, boys.",
    author: "John Keating",
    zh: "把握当下，孩子们，及时行动。",
    category: "movie",
    source: "Dead Poets Society (1989)",
  },
  {
    text: "With great power comes great responsibility.",
    author: "Uncle Ben",
    zh: "能力越大，责任越大。",
    category: "movie",
    source: "Spider-Man (2002)",
  },
  {
    text: "I'll be back.",
    author: "The Terminator",
    zh: "我会回来的。",
    category: "movie",
    source: "The Terminator (1984)",
  },
  {
    text: "After all, tomorrow is another day.",
    author: "Scarlett O'Hara",
    zh: "毕竟，明天又是新的一天。",
    category: "movie",
    source: "Gone with the Wind (1939)",
  },

  // --- 演讲 Speeches & TED ---
  {
    text: "Stay hungry. Stay foolish.",
    author: "Steve Jobs",
    zh: "求知若饥，虚心若愚。",
    category: "speech",
    source: "Stanford Commencement, 2005",
  },
  {
    text: "Your time is limited, so don't waste it living someone else's life.",
    author: "Steve Jobs",
    zh: "你的时间有限，别浪费在过别人的生活上。",
    category: "speech",
    source: "Stanford Commencement, 2005",
  },
  {
    text: "Ask not what your country can do for you — ask what you can do for your country.",
    author: "John F. Kennedy",
    zh: "不要问国家能为你做什么，要问你能为国家做什么。",
    category: "speech",
    source: "Inaugural Address, 1961",
  },
  {
    text: "The only thing we have to fear is fear itself.",
    author: "Franklin D. Roosevelt",
    zh: "我们唯一需要恐惧的，就是恐惧本身。",
    category: "speech",
    source: "First Inaugural Address, 1933",
  },
  {
    text: "I have a dream.",
    author: "Martin Luther King Jr.",
    zh: "我有一个梦想。",
    category: "speech",
    source: "March on Washington, 1963",
  },
  {
    text: "Don't fake it till you make it. Fake it till you become it.",
    author: "Amy Cuddy",
    zh: "不要假装到成功为止，要假装到你真正成为那样的人。",
    category: "speech",
    source: "TED Talk, 2012",
  },
  {
    text: "If you're not prepared to be wrong, you'll never come up with anything original.",
    author: "Ken Robinson",
    zh: "如果你不敢犯错，就永远想不出有原创性的东西。",
    category: "speech",
    source: "TED Talk, 2006",
  },
  {
    text: "Education is the most powerful weapon which you can use to change the world.",
    author: "Nelson Mandela",
    zh: "教育是你能用来改变世界的最强武器。",
    category: "speech",
    source: "speech, 2003",
  },

  // --- 文学 Literature ---
  {
    text: "It is our choices that show what we truly are, far more than our abilities.",
    author: "Albus Dumbledore",
    zh: "决定我们是谁的，是我们的选择，而远非我们的能力。",
    category: "literature",
    source: "J.K. Rowling, Harry Potter and the Chamber of Secrets",
  },
  {
    text: "Not all those who wander are lost.",
    author: "J.R.R. Tolkien",
    zh: "并非所有徘徊的人都迷失了方向。",
    category: "literature",
    source: "The Lord of the Rings",
  },
  {
    text: "All we have to decide is what to do with the time that is given us.",
    author: "Gandalf",
    zh: "我们要做的，只是决定如何度过被赋予的时光。",
    category: "literature",
    source: "J.R.R. Tolkien, The Lord of the Rings",
  },
  {
    text: "It does not do to dwell on dreams and forget to live.",
    author: "Albus Dumbledore",
    zh: "沉湎于梦想而忘记生活，是不可取的。",
    category: "literature",
    source: "J.K. Rowling, Harry Potter and the Philosopher's Stone",
  },
  {
    text: "So we beat on, boats against the current, borne back ceaselessly into the past.",
    author: "F. Scott Fitzgerald",
    zh: "于是我们奋力搏击，如同逆水行舟，不停地被浪潮推回到过去。",
    category: "literature",
    source: "The Great Gatsby",
  },
  {
    text: "We accept the love we think we deserve.",
    author: "Stephen Chbosky",
    zh: "我们接受自己认为配得上的爱。",
    category: "literature",
    source: "The Perks of Being a Wallflower",
  },
  {
    text: "Whatever our souls are made of, his and mine are the same.",
    author: "Emily Brontë",
    zh: "无论我们的灵魂由什么构成，他的和我的都是一样的。",
    category: "literature",
    source: "Wuthering Heights",
  },
  {
    text: "Tomorrow is always fresh, with no mistakes in it yet.",
    author: "Anne Shirley",
    zh: "明天总是崭新的，还没有任何过失。",
    category: "literature",
    source: "L.M. Montgomery, Anne of Green Gables",
  },

  // --- 名人 Famous people ---
  {
    text: "The only way to do great work is to love what you do.",
    author: "Steve Jobs",
    zh: "把工作做到卓越的唯一方法，就是热爱你所做的事。",
    category: "people",
    source: "Stanford Commencement, 2005",
  },
  {
    text: "Life is what happens when you're busy making other plans.",
    author: "John Lennon",
    zh: "生活，就是当你忙于计划时发生的事。",
    category: "people",
    source: "song \"Beautiful Boy\", 1980",
  },
  {
    text: "The journey of a thousand miles begins with a single step.",
    author: "Lao Tzu",
    zh: "千里之行，始于足下。",
    category: "people",
    source: "Tao Te Ching",
  },
  {
    text: "Well done is better than well said.",
    author: "Benjamin Franklin",
    zh: "做得好胜过说得好。",
    category: "people",
    source: "Poor Richard's Almanack",
  },
  {
    text: "Done is better than perfect.",
    author: "Sheryl Sandberg",
    zh: "完成胜过完美。",
    category: "people",
    source: "Lean In",
  },
  {
    text: "You miss 100% of the shots you don't take.",
    author: "Wayne Gretzky",
    zh: "你不出手，就百分之百不会进球。",
    category: "people",
  },
  {
    text: "Do what you can, with what you have, where you are.",
    author: "Theodore Roosevelt",
    zh: "在你所处之地，用你所有的，做你能做的。",
    category: "people",
  },
  {
    text: "Turn your wounds into wisdom.",
    author: "Oprah Winfrey",
    zh: "把伤痛化作智慧。",
    category: "people",
  },
  {
    text: "Don't watch the clock; do what it does. Keep going.",
    author: "Sam Levenson",
    zh: "别盯着时钟，像它一样不停向前。",
    category: "people",
  },

  // --- 谚语 Proverbs (traditional, no single author) ---
  { text: "Practice makes perfect.", author: "English proverb", zh: "熟能生巧。", category: "proverb" },
  { text: "Where there is a will, there is a way.", author: "English proverb", zh: "有志者，事竟成。", category: "proverb" },
  { text: "Actions speak louder than words.", author: "English proverb", zh: "行动胜于言辞。", category: "proverb" },
  { text: "Rome wasn't built in a day.", author: "English proverb", zh: "罗马不是一天建成的。", category: "proverb" },
  { text: "Better late than never.", author: "English proverb", zh: "迟到总比不到好。", category: "proverb" },
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
