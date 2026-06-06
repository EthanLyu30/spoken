"""Curated bank of current ("new") TOEFL iBT INDEPENDENT speaking prompts.

The modern TOEFL independent task (Question 1) uses four recurring forms:
agree/disagree, paired preference, two-option choice, and three-choice. The
older "describe a person / place / experience" style is intentionally left out.
Cross-checked against TST Prep, examword, TestGlider and ETS materials. The
interview endpoint serves a random subset and blends in one AI scenario question.
"""

INDEPENDENT_QUESTIONS: list[str] = [
    # --- Agree / disagree ---
    "Do you agree or disagree with the following statement? Students should be required to take physical education classes. Use details and examples to explain your answer.",
    "Do you agree or disagree? It is better to finish one task completely before starting another, rather than working on several tasks at the same time.",
    "Do you agree or disagree with the following statement? Parents should let their children make their own mistakes and learn from them.",
    "Do you agree or disagree with the following statement? A person should never make an important decision alone.",
    "Do you agree or disagree? It is more important to be able to work with a group of people than to work independently.",
    "Do you agree or disagree with the following statement? Universities should require every student to take a public speaking course.",
    "Do you agree or disagree? People today spend too much time on personal enjoyment and not enough on their responsibilities.",
    "Do you agree or disagree with the following statement? Children should be required to help with household chores as soon as they are able to.",
    "Do you agree or disagree? It is better for students to have a part-time job while studying at university.",
    "Do you agree or disagree? Schools should allow students to use smartphones in class for learning.",
    "Do you agree or disagree with the following statement? Students should be highly organized in order to be successful in school.",
    "Do you agree or disagree? People's social skills have declined as their use of technology has increased.",
    "Do you agree or disagree with the following statement? People must love their jobs in order to be happy.",
    "Do you agree or disagree? Being independent is more important than relying on others. Use specific details and examples.",
    "Do you agree or disagree with the following statement? Social media does students more harm than good.",
    "Do you agree or disagree? It is better to be a specialist in one field than to know a little about many fields.",
    "Do you agree or disagree? Older people should avoid risky or adventurous activities the way young people enjoy them.",
    # --- Paired preference ---
    "Some people prefer to study alone. Others prefer to study with a group of classmates. Which do you prefer and why?",
    "Some people like to plan their free-time activities very carefully. Others choose not to make plans. Which do you prefer?",
    "Some students prefer to take online courses. Others prefer to take courses in a traditional classroom. Which do you think is better and why?",
    "Some people prefer to spend their money as soon as they earn it. Others prefer to save for the future. Which do you prefer?",
    "Some people prefer to live in a big city. Others prefer to live in a small town. Which do you prefer and why?",
    "Some people like to try new things. Others prefer to stick with what they already know. Which kind of person are you?",
    "Some students prefer teachers who are strict. Others prefer teachers who are easygoing. Which do you prefer and why?",
    "Some people prefer to work for a large company. Others prefer to work for a small company. Which would you prefer and why?",
    "Some people prefer to stay in touch with friends and family while traveling. Others prefer to disconnect and be alone. Which do you prefer and why?",
    "Some people like to read reviews before seeing a movie. Others prefer to watch a film without reading reviews. Which do you prefer?",
    "Some people prefer to be busy with something to do at all times. Others prefer to set aside time to do nothing. Which is better?",
    "Would you prefer to work at one job your entire life, or to switch jobs every few years? Explain why.",
    "When choosing a place to live, would you rather have a convenient but noisy place, or an inconvenient but quiet one?",
    "Do you prefer to receive advice from people your own age, or from people who are older than you? Explain why.",
    # --- Three-choice ---
    "Your school has received money to improve student life. Should it spend the money on a new gym, a larger library, or better dining options? Explain why.",
    "If you could improve one skill, which would you choose: speaking a foreign language, playing a musical instrument, or computer programming? Why?",
    "Which is the most important quality in a coworker: being friendly, being reliable, or being knowledgeable? Explain why.",
    "When visiting a new city, which would you most want to do: try the local food, visit historical sites, or shop at local markets? Why?",
    "Which helps students learn the most: studying with classmates, getting help from a teacher, or watching online videos? Explain why.",
    "Your town has money for one project. Should it build a new park, a public library, or a sports center? Why?",
    "Which is the best way to stay healthy: eating well, exercising regularly, or getting enough sleep? Explain your choice.",
    "Which is the most useful feature of a smartphone for a student: the camera, note-taking apps, or internet access? Explain why.",
    "Which aspect of university life is most important: academic study, making friends, or joining clubs? Why?",
    "To learn about a different culture, which is best: traveling there, reading about it, or talking with people from that culture? Explain why.",
    "Which would most improve your daily life: having more free time, having more money, or having better health? Why?",
    "If you were starting a small business, which would matter most: a good location, talented employees, or a strong online presence? Why?",
    # --- Opinion / everyday ---
    "What is one quality that makes someone a good friend? Use examples to support your answer.",
    "Some people believe success in life comes from hard work. Others believe it comes from luck. What do you think?",
    "What do you think is the best way for students to learn a foreign language? Explain with details.",
    "Do you think it is better to be an only child or to have siblings? Explain your choice.",
    "What is one change that would improve your school or workplace, and why?",
    "Some people think it is important to keep up with the news every day. Others are not interested. What is your opinion?",
    "Is it important for a leader to be a good public speaker? Explain why or why not.",
    "Some believe that one day robots will replace humans at many jobs. What do you think, and why?",
    "A company plans to build a factory in your hometown that will create jobs but also cause pollution. Would you support it? Why?",
    "If you had to give a friend some bad news, would you do it in a quiet private place or a busy public one? Explain why.",
    "Imagine you can donate money to a charity. Would you give it to a small local group or a large international one? Explain why.",
    "If you could change one thing about your hometown, what would it be and why?",
    "If you received a sum of money as a gift, what would you spend it on, and why?",
]
