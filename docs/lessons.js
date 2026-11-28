// Guided lessons: an ordered beginner course. Shared by the Linux app and the iPhone app.
//
// Adding a lesson: append an object to LESSONS (order = course order). Fields:
//   id       unique, never change it once published (progress is saved under it)
//   unit     one of the UNITS ids
//   title    short name shown in the list
//   minutes  rough time to read and do the quiz
//   groups   (kana lessons) hiragana GROUPS names this lesson teaches. The quiz then
//            asks every new kana automatically, shows "words you can now read",
//            and passing adds these rows to Kana practice.
//   parts    what to read, in order. Each part is one of:
//              { h: "Heading" }                       a small heading
//              { p: "Text with **bold**." }            a paragraph (Japanese is styled automatically)
//              { ex: [["日本語", "romaji", "English"], ...] }   examples with a 🔊 button
//              { tip: "..." }                          a highlighted tip
//   quiz     questions, asked in order. Each is one of:
//              { q, choices: [...], a: index, why }   multiple choice (a = index of the right one)
//              { q, type: ["romaji", ...], why }      type the answer in romaji (any listed spelling counts)
//              { q, build: ["word", "word", ...], en, why }  tap the tiles into the right order
//                                                     (build lists the tiles in the correct order)
//            `why` is shown after answering, right or wrong.
// A lesson is passed at PASS_SCORE or better.

export const PASS_SCORE = 0.8;

export const UNITS = [
  { id: "read", title: "Read hiragana", blurb: "Every sound in Japanese, and how to read it." },
  { id: "talk", title: "First conversations", blurb: "Greetings, introducing yourself, and your first sentences." },
  { id: "life", title: "Getting around", blurb: "Asking where things are, numbers, prices, ordering food." },
  { id: "okinawa", title: "Okinawa", blurb: "Local words you will hear and see on the island." },
];

export const LESSONS = [
  /* ------------------------------------------------------------ Unit 1 */
  {
    id: "how-it-works", unit: "read", title: "How Japanese sounds and is written", minutes: 8,
    parts: [
      { h: "Three scripts, one language" },
      { p: "Japanese mixes three sets of characters, often in the same sentence." },
      { ex: [
        ["ひらがな", "hiragana", "native words and grammar endings. Learn this first."],
        ["カタカナ", "katakana", "words from other languages, like コーヒー (koohii, coffee)"],
        ["漢字", "kanji", "characters that carry meaning, like 山 (yama, mountain)"],
      ] },
      { p: "Anything can be written in hiragana, so once you can read it you can read every beginner book, children's manga with furigana (small hiragana printed above kanji), and the readings of any word." },
      { h: "Five vowels, always the same" },
      { p: "Japanese has only five vowel sounds, and they never change the way English vowels do." },
      { ex: [
        ["あ", "a", "as in father"],
        ["い", "i", "as in machine"],
        ["う", "u", "as in food, but with relaxed lips (not rounded)"],
        ["え", "e", "as in get"],
        ["お", "o", "as in go, but short and pure"],
      ] },
      { h: "Every kana is one beat" },
      { p: "Each hiragana is one beat of the same length. Keep the beats even and don't stress one syllable like English does. さかな (sakana, fish) is three even beats: sa-ka-na." },
      { tip: "Pimsleur trains your ear for this. When a word sounds rushed or stretched, count its beats on your fingers." },
    ],
    quiz: [
      { q: "Which script is learned first and can write any word?", choices: ["Hiragana", "Katakana", "Kanji"], a: 0, why: "Hiragana covers every sound, so it can write any word." },
      { q: "Which script is used for words borrowed from other languages, like coffee?", choices: ["Hiragana", "Katakana", "Kanji"], a: 1, why: "Katakana is for loanwords: コーヒー (koohii)." },
      { q: "How many beats are in さかな (sakana)?", choices: ["2", "3", "4"], a: 1, why: "sa-ka-na: one beat per kana." },
      { q: "The Japanese vowel a sounds like the a in…", choices: ["cat", "father", "cake"], a: 1, why: "Always the open 'ah' of father." },
      { q: "The Japanese vowel e sounds like the e in…", choices: ["get", "see", "her"], a: 0, why: "A short 'eh', as in get." },
      { q: "In Japanese, a syllable is usually stressed by…", choices: ["Saying it louder and longer, like English", "Keeping every beat even in length", "Always stressing the first syllable"], a: 1, why: "Beats stay even. Japanese uses pitch, not loudness, and you'll pick that up by listening." },
    ],
  },
  {
    id: "kana-vowels", unit: "read", title: "Vowels: あ い う え お", minutes: 8, groups: ["Vowels"],
    parts: [
      { p: "These five are the base of the whole chart. Every other row is a consonant plus one of these vowels." },
      { ex: [["あ", "a", ""], ["い", "i", ""], ["う", "u", ""], ["え", "e", ""], ["お", "o", ""]] },
      { tip: "あ and お look alike. お has a separate tick on the upper right, and its loop sits low. あ has a cross at the top and no tick." },
      { p: "Two vowels side by side are each said, as separate beats: あい (ai, love) is a-i, two beats. いいえ (iie, no) is i-i-e, three beats." },
      { ex: [["あい", "ai", "love"], ["いいえ", "iie", "no"], ["うえ", "ue", "above, up"], ["いえ", "ie", "house, home"]] },
    ],
    quiz: [
      { q: "How many beats is いいえ (no)?", choices: ["2", "3"], a: 1, why: "i-i-e. The doubled い is held for two beats." },
    ],
  },
  {
    id: "kana-k", unit: "read", title: "K row: か き く け こ", minutes: 8, groups: ["K"],
    parts: [
      { p: "Add k to each vowel. The row is completely regular." },
      { ex: [["か", "ka", ""], ["き", "ki", ""], ["く", "ku", ""], ["け", "ke", ""], ["こ", "ko", ""]] },
      { tip: "き has two crossbars. さ (coming next) has only one. く is a simple beak, like a mouth saying 'coo'." },
      { p: "With the vowels and the K row you can already read real words." },
      { ex: [["かお", "kao", "face"], ["こえ", "koe", "voice"], ["ここ", "koko", "here"], ["きく", "kiku", "to listen, to ask"]] },
    ],
    quiz: [],
  },
  {
    id: "kana-s", unit: "read", title: "S row: さ し す せ そ", minutes: 8, groups: ["S"],
    parts: [
      { p: "Add s to each vowel, with one exception: し is shi, not si." },
      { ex: [["さ", "sa", ""], ["し", "shi", "the odd one out"], ["す", "su", ""], ["せ", "se", ""], ["そ", "so", ""]] },
      { tip: "さ and ち (T row) are mirror images. さ opens to the left at the bottom like an S curve; ち has its bowl facing right." },
      { p: "す (su) and the u in many words is almost silent after s and k: です sounds like 'dess', and すき (suki, to like) sounds close to 'ski'." },
      { ex: [["すし", "sushi", "sushi"], ["すき", "suki", "to like"], ["あさ", "asa", "morning"], ["せかい", "sekai", "world"]] },
    ],
    quiz: [
      { q: "How is し read?", choices: ["si", "shi", "chi"], a: 1, why: "It breaks the row's pattern: shi." },
    ],
  },
  {
    id: "kana-t", unit: "read", title: "T row: た ち つ て と", minutes: 10, groups: ["T"],
    parts: [
      { p: "Two readings break the pattern here: ち is chi and つ is tsu." },
      { ex: [["た", "ta", ""], ["ち", "chi", ""], ["つ", "tsu", "like the ts in cats"], ["て", "te", ""], ["と", "to", ""]] },
      { tip: "つ is the hard one for English speakers. Say 'cats' and keep only the end: ts-u. It starts a word just fine: つき (tsuki, moon)." },
      { tip: "て is one smooth stroke curving left. と has a small slanted tick on top." },
      { ex: [["ちかい", "chikai", "close, near"], ["つくえ", "tsukue", "desk"], ["たかい", "takai", "tall; expensive"], ["そと", "soto", "outside"]] },
    ],
    quiz: [
      { q: "Which word means 'desk'? (Read it.)", choices: ["つくえ", "ちかい", "そと"], a: 0, why: "つくえ = tsu-ku-e." },
    ],
  },
  {
    id: "kana-n", unit: "read", title: "N row: な に ぬ ね の", minutes: 8, groups: ["N"],
    parts: [
      { p: "A regular row: na, ni, nu, ne, no." },
      { ex: [["な", "na", ""], ["に", "ni", ""], ["ぬ", "nu", ""], ["ね", "ne", ""], ["の", "no", "also a very common particle: of, 's"]] },
      { tip: "ぬ ends in a little loop, め (M row) doesn't. ね also ends in a loop, which れ and わ don't." },
      { p: "の joins two nouns, like 's or 'of': わたしの (watashi no) = my. You'll see it everywhere." },
      { ex: [["ねこ", "neko", "cat"], ["いぬ", "inu", "dog"], ["なつ", "natsu", "summer"], ["にく", "niku", "meat"]] },
    ],
    quiz: [
      { q: "の between two nouns usually means…", choices: ["and", "'s / of", "is"], a: 1, why: "わたしの ねこ = my cat (cat of me)." },
    ],
  },
  {
    id: "kana-h", unit: "read", title: "H row: は ひ ふ へ ほ", minutes: 10, groups: ["H"],
    parts: [
      { ex: [["は", "ha", "read wa when it's a particle"], ["ひ", "hi", ""], ["ふ", "fu", "a soft blow, between f and h"], ["へ", "he", "read e when it's a particle"], ["ほ", "ho", ""]] },
      { p: "ふ is made by blowing gently through relaxed lips, not by touching your teeth like an English f." },
      { p: "Two of these have a second job. As grammar words (particles), は is read **wa** and へ is read **e**. That's why こんにちは (hello) ends in wa. You'll meet the particle は properly in Unit 2." },
      { tip: "は, ほ and け are cousins. ほ has a closed top bar; は doesn't. け has no loop at all." },
      { ex: [["はな", "hana", "flower; nose"], ["ひと", "hito", "person"], ["ふね", "fune", "boat"], ["ほし", "hoshi", "star"]] },
    ],
    quiz: [
      { q: "In こんにちは (hello), the last kana is read…", choices: ["ha", "wa", "he"], a: 1, why: "It was originally the particle は, so it's read wa: konnichiwa." },
    ],
  },
  {
    id: "kana-m", unit: "read", title: "M row: ま み む め も", minutes: 8, groups: ["M"],
    parts: [
      { ex: [["ま", "ma", ""], ["み", "mi", ""], ["む", "mu", ""], ["め", "me", ""], ["も", "mo", "also means 'too, also'"]] },
      { tip: "ま looks like ほ with the left stroke taken away. め is ぬ without the loop." },
      { p: "も as a particle means 'too': わたしも (watashi mo) = me too." },
      { ex: [["みみ", "mimi", "ear"], ["むし", "mushi", "bug, insect"], ["あめ", "ame", "rain; candy"], ["うみ", "umi", "the sea"]] },
    ],
    quiz: [
      { q: "わたしも means…", choices: ["my", "me too", "not me"], a: 1, why: "も = too, also." },
    ],
  },
  {
    id: "kana-yrw", unit: "read", title: "Y, R and W rows, and ん", minutes: 12, groups: ["Y", "R", "W + n"],
    parts: [
      { p: "The Y row has only three kana. There is no yi or ye in modern Japanese." },
      { ex: [["や", "ya", ""], ["ゆ", "yu", ""], ["よ", "yo", ""]] },
      { p: "The Japanese r is a quick tap of the tongue, somewhere between r, l and d, like the tt in American 'butter'." },
      { ex: [["ら", "ra", ""], ["り", "ri", ""], ["る", "ru", ""], ["れ", "re", ""], ["ろ", "ro", ""]] },
      { ex: [["わ", "wa", ""], ["を", "wo", "said o; only used as a particle"], ["ん", "n", "its own beat"]] },
      { p: "を sounds just like お but is only ever the object particle (you'll meet it in Unit 3). ん is the only kana that's a lone consonant, and it still gets a full beat: ほん (hon, book) is two beats, ho-n." },
      { tip: "る has a loop at the bottom, ろ doesn't. わ, ね and れ share a left side; look at how each one ends on the right." },
      { ex: [["やま", "yama", "mountain"], ["ゆき", "yuki", "snow"], ["さくら", "sakura", "cherry blossom"], ["わたし", "watashi", "I, me"], ["ほん", "hon", "book"]] },
    ],
    quiz: [
      { q: "How many beats is ほん (book)?", choices: ["1", "2"], a: 1, why: "ho-n. ん gets its own beat." },
      { q: "を is pronounced…", choices: ["wo, with a strong w", "o, like お", "u"], a: 1, why: "Most people say it exactly like お." },
    ],
  },
  {
    id: "kana-dakuten", unit: "read", title: "Dakuten: が ざ だ ば ぱ", minutes: 12, groups: ["G (dakuten)", "Z (dakuten)", "D (dakuten)", "B (dakuten)", "P (handakuten)"],
    parts: [
      { p: "Two small marks turn kana you already know into new sounds. No new shapes to learn." },
      { p: "The two dots ゛ (dakuten) make the sound voiced: k→g, s→z, t→d, h→b. The small circle ゜ (handakuten) turns h into p." },
      { ex: [["か → が", "ka → ga", ""], ["さ → ざ", "sa → za", ""], ["し → じ", "shi → ji", ""], ["た → だ", "ta → da", ""], ["は → ば → ぱ", "ha → ba → pa", ""]] },
      { tip: "ぢ (ji) and づ (zu) sound exactly like じ and ず and are rare. When you need to write ji or zu, it's almost always じ or ず." },
      { ex: [["かぞく", "kazoku", "family"], ["ごはん", "gohan", "rice; a meal"], ["でんわ", "denwa", "telephone"], ["ぶた", "buta", "pig"], ["さんぽ", "sanpo", "a walk, a stroll"]] },
    ],
    quiz: [
      { q: "Add dakuten to ひ. What's the sound?", choices: ["bi", "pi", "gi"], a: 0, why: "h + ゛ = b. h + ゜ = p." },
      { q: "Which is usually used to write 'ji'?", choices: ["じ", "ぢ"], a: 0, why: "ぢ exists but is rare." },
    ],
  },
  {
    id: "kana-small-tsu", unit: "read", title: "Small っ and long vowels", minutes: 10,
    parts: [
      { h: "Small っ: a pause" },
      { p: "A small っ isn't read as tsu. It's a one-beat pause that doubles the next consonant. In romaji you write the next consonant twice." },
      { ex: [["きて", "kite", "come (please)"], ["きって", "kitte", "a postage stamp"], ["まって", "matte", "wait!"], ["いっしょ", "issho", "together"]] },
      { tip: "Hold your mouth ready for the next sound for one beat, like the gap in 'bookcase' (boo-k-case)." },
      { h: "Long vowels change meaning" },
      { p: "Holding a vowel for two beats can make a different word. Listen for it in Pimsleur." },
      { ex: [["おばさん", "obasan", "aunt, middle-aged woman"], ["おばあさん", "obaasan", "grandmother, old woman"], ["おじさん", "ojisan", "uncle, middle-aged man"], ["おじいさん", "ojiisan", "grandfather, old man"]] },
      { p: "Two spellings sound long: えい is usually said ええ, and おう is said おお. So せんせい (teacher) sounds like sensee and ありがとう sounds like arigatoo. In this app's romaji they're written as spelled: sensei, arigatou." },
    ],
    quiz: [
      { q: "Read this: きって", type: ["kitte"], why: "っ doubles the t: ki-t-te, three beats." },
      { q: "Read this: まって (wait!)", type: ["matte"], why: "っ doubles the t." },
      { q: "Read this: いっしょ (together)", type: ["issho", "isshyo", "issyo"], why: "っ before sh doubles the s: issho." },
      { q: "おばあさん means…", choices: ["aunt", "grandmother"], a: 1, why: "The long あ makes it grandmother. おばさん is aunt." },
      { q: "How many beats is きって?", choices: ["2", "3", "4"], a: 1, why: "ki-(pause)-te. The small っ is a beat." },
      { q: "せんせい (teacher) is pronounced closest to…", choices: ["sen-sei with an 'ay' sound", "sen-see, the e held long"], a: 1, why: "えい is usually said as a long え." },
    ],
  },
  {
    id: "kana-combos", unit: "read", title: "Combos: きゃ しゅ ちょ", minutes: 12, groups: ["Combos K S T N", "Combos H M R", "Combos G J B P"],
    parts: [
      { p: "A kana ending in i plus a small ゃ, ゅ or ょ blends into one beat. Look at the size: small means blend." },
      { ex: [["き + ゃ = きゃ", "kya", "one beat"], ["し + ゅ = しゅ", "shu", ""], ["ち + ょ = ちょ", "cho", ""], ["じ + ゃ = じゃ", "ja", ""]] },
      { p: "Compare: きや (ki-ya, two beats, normal-size や) and きゃ (kya, one beat). The same goes for びょういん (byouin, hospital) and びよういん (biyouin, hair salon), which people really do mix up." },
      { tip: "し, ち and じ combos drop the y: しゃ sha, ちゃ cha, じゃ ja." },
      { ex: [["おちゃ", "ocha", "green tea"], ["しゃしん", "shashin", "photo"], ["きょう", "kyou", "today"], ["りょこう", "ryokou", "a trip, travel"], ["じゃあね", "jaa ne", "see you (casual)"]] },
      { p: "That's all of hiragana. Keep the Kana tab in your daily routine until every square in Progress turns green." },
    ],
    quiz: [
      { q: "How many beats is きゃ?", choices: ["1", "2"], a: 0, why: "Small ゃ blends into one beat." },
      { q: "びょういん is a hospital. What's びよういん?", choices: ["Also a hospital", "A hair salon"], a: 1, why: "Big よ = separate beat, and a different word." },
    ],
  },

  /* ------------------------------------------------------------ Unit 2 */
  {
    id: "greetings", unit: "talk", title: "Greetings and thanks", minutes: 10,
    parts: [
      { p: "Japanese greetings change with the time of day and with how polite you need to be. Use the polite version with strangers, shop staff and anyone older; the short one with friends." },
      { ex: [
        ["おはようございます", "ohayou gozaimasu", "good morning (polite)"],
        ["おはよう", "ohayou", "morning! (friends)"],
        ["こんにちは", "konnichiwa", "hello, good afternoon"],
        ["こんばんは", "konbanwa", "good evening"],
        ["おやすみなさい", "oyasuminasai", "good night (going to bed)"],
      ] },
      { p: "こんにちは and こんばんは end in the particle は, read wa." },
      { h: "Thanks and sorry" },
      { ex: [
        ["ありがとうございます", "arigatou gozaimasu", "thank you (polite)"],
        ["ありがとう", "arigatou", "thanks (friends)"],
        ["すみません", "sumimasen", "excuse me; sorry; thanks for the trouble"],
        ["ごめんなさい", "gomennasai", "I'm sorry (personal apology)"],
        ["だいじょうぶです", "daijoubu desu", "it's fine; I'm OK; no thanks"],
      ] },
      { tip: "すみません is the most useful word on this page: getting a waiter's attention, squeezing past someone, and thanking someone who went out of their way all use it." },
      { h: "Saying goodbye" },
      { p: "さようなら sounds final, almost like 'farewell'. Friends say じゃあね or またね (see you). Leaving work or a shop you'll hear しつれいします (shitsurei shimasu, excuse me for leaving)." },
      { ex: [["じゃあね", "jaa ne", "see you"], ["またね", "mata ne", "see you again"], ["またあした", "mata ashita", "see you tomorrow"]] },
    ],
    quiz: [
      { q: "You walk into a shop at 10 a.m. You say…", choices: ["おはようございます", "こんばんは", "おやすみなさい"], a: 0, why: "Morning, and polite to staff." },
      { q: "You need a waiter's attention. You say…", choices: ["ごめんなさい", "すみません", "じゃあね"], a: 1, why: "すみません means excuse me." },
      { q: "A friend is leaving after dinner. You say…", choices: ["さようなら", "またね", "こんにちは"], a: 1, why: "さようなら sounds too final between friends." },
      { q: "Type the romaji: thank you (polite)", type: ["arigatou gozaimasu", "arigatougozaimasu", "arigato gozaimasu", "arigatoo gozaimasu"], why: "ありがとうございます, arigatou gozaimasu." },
      { q: "Someone offers you more food and you're full. You can say…", choices: ["だいじょうぶです", "おはよう", "ありがとう only"], a: 0, why: "だいじょうぶです politely means 'I'm fine (no thanks)'." },
      { q: "What sound ends こんばんは?", choices: ["ha", "wa"], a: 1, why: "It's the particle は: konbanwa." },
    ],
  },
  {
    id: "self-intro", unit: "talk", title: "Introducing yourself", minutes: 12,
    parts: [
      { p: "A Japanese self-introduction follows a set pattern. Learn it as one block and you can use it on your first day." },
      { ex: [
        ["はじめまして。", "hajimemashite.", "Nice to meet you. (first meeting only)"],
        ["(name) です。", "(name) desu.", "I'm (name)."],
        ["アメリカから きました。", "amerika kara kimashita.", "I came from America."],
        ["よろしく おねがいします。", "yoroshiku onegaishimasu.", "Please treat me well. (closes every introduction)"],
      ] },
      { p: "アメリカ is katakana (a foreign word). Katakana is taught in the Kana tab." },
      { p: "**です (desu)** means 'is / am / are' and makes a sentence polite. The u is nearly silent: 'dess'." },
      { p: "You usually don't say わたしは (I) at all. Japanese drops words that are obvious, and 'I' is usually obvious." },
      { h: "さん" },
      { p: "Put さん (san) after other people's names: たなかさん. Never after your own name." },
      { ex: [["たなかさん", "Tanaka-san", "Mr./Ms. Tanaka"], ["おなまえは？", "onamae wa?", "And your name? (polite)"], ["こちらこそ", "kochira koso", "likewise, the pleasure is mine"]] },
      { tip: "When someone says よろしくおねがいします to you, you can answer こちらこそ よろしくおねがいします." },
    ],
    quiz: [
      { q: "What do you say only the first time you meet someone?", choices: ["はじめまして", "おはよう", "またね"], a: 0, why: "はじめまして = nice to meet you (for the first time)." },
      { q: "Which ends a self-introduction?", choices: ["よろしくおねがいします", "すみません", "いただきます"], a: 0, why: "It's how every introduction closes." },
      { q: "Your name is Sam. Which is right?", choices: ["サムさんです", "サムです"], a: 1, why: "Never put さん on your own name." },
      { q: "Build: I'm Tanaka.", build: ["たなか", "です"], en: "I'm Tanaka.", why: "Name + です. わたしは is left out." },
      { q: "Build: I came from America.", build: ["アメリカ", "から", "きました"], en: "I came from America.", why: "から = from. It comes after the place." },
      { q: "Type the romaji: よろしく", type: ["yoroshiku"], why: "yo-ro-shi-ku." },
    ],
  },
  {
    id: "wa-desu", unit: "talk", title: "This is that: は and です", minutes: 12,
    parts: [
      { p: "The first sentence pattern: **A は B です** = 'A is B'. は (read wa) marks the topic, what you're talking about." },
      { ex: [
        ["わたしは がくせいです。", "watashi wa gakusei desu.", "I am a student."],
        ["たなかさんは せんせいです。", "Tanaka-san wa sensei desu.", "Ms. Tanaka is a teacher."],
        ["これは すしです。", "kore wa sushi desu.", "This is sushi."],
      ] },
      { h: "Questions: add か" },
      { p: "Put か (ka) at the end and it becomes a yes/no question. No word order change." },
      { ex: [
        ["がくせいですか。", "gakusei desu ka.", "Are you a student?"],
        ["はい、がくせいです。", "hai, gakusei desu.", "Yes, I am a student."],
        ["いいえ、がくせいじゃないです。", "iie, gakusei ja nai desu.", "No, I'm not a student."],
      ] },
      { h: "Not: じゃないです" },
      { p: "Replace です with **じゃないです** (ja nai desu) to say 'is not'. You'll also see the more formal ではありません (dewa arimasen), which means the same." },
      { tip: "Japanese has no 'a' or 'the' and no plural endings. がくせい is a student, the student, or students; context decides." },
    ],
    quiz: [
      { q: "In わたしは, how is は read?", choices: ["ha", "wa"], a: 1, why: "As the topic particle, は is read wa." },
      { q: "How do you turn がくせいです into a question?", choices: ["ですがくせい", "がくせいですか", "かがくせいです"], a: 1, why: "Just add か at the end." },
      { q: "'It's not sushi' is…", choices: ["すしです", "すしじゃないです", "すしですか"], a: 1, why: "じゃないです = is not." },
      { q: "Build: This is sushi.", build: ["これ", "は", "すし", "です"], en: "This is sushi.", why: "A は B です." },
      { q: "Build: Is Tanaka a teacher?", build: ["たなかさん", "は", "せんせい", "です", "か"], en: "Is Tanaka a teacher?", why: "Add か to make a question." },
      { q: "はい means…", choices: ["yes", "no"], a: 0, why: "はい = yes, いいえ = no." },
    ],
  },
  {
    id: "question-words", unit: "talk", title: "What, who, where: question words", minutes: 10,
    parts: [
      { p: "Put a question word where the answer would go, and end with か." },
      { ex: [
        ["なん / なに", "nan / nani", "what"],
        ["だれ", "dare", "who"],
        ["どこ", "doko", "where"],
        ["いつ", "itsu", "when"],
        ["いくら", "ikura", "how much (money)"],
      ] },
      { p: "なに becomes なん before です: **なんですか** (nan desu ka) = what is it?" },
      { ex: [
        ["これは なんですか。", "kore wa nan desu ka.", "What is this?"],
        ["あのひとは だれですか。", "ano hito wa dare desu ka.", "Who is that person?"],
        ["えきは どこですか。", "eki wa doko desu ka.", "Where is the station?"],
        ["たんじょうびは いつですか。", "tanjoubi wa itsu desu ka.", "When is your birthday?"],
      ] },
      { tip: "In anime you'll hear なに？ alone as 'What?!'. It's casual; with people you don't know, use なんですか." },
    ],
    quiz: [
      { q: "どこ means…", choices: ["who", "where", "when"], a: 1, why: "どこ = where." },
      { q: "だれ means…", choices: ["who", "what", "how much"], a: 0, why: "だれ = who." },
      { q: "'What is this?'", choices: ["これは なにですか", "これは なんですか", "これは どこですか"], a: 1, why: "なに becomes なん before です." },
      { q: "Build: Where is the station?", build: ["えき", "は", "どこ", "です", "か"], en: "Where is the station?", why: "The question word goes where the answer would: えきは あそこです (it's over there)." },
      { q: "Type the romaji: いつ", type: ["itsu", "itu"], why: "i-tsu = when." },
    ],
  },

  /* ------------------------------------------------------------ Unit 3 */
  {
    id: "kore-sore-are", unit: "life", title: "This, that, over there", minutes: 10,
    parts: [
      { p: "Japanese splits 'this' and 'that' three ways: near me (こ), near you (そ), and far from both of us (あ). The question form starts with ど." },
      { ex: [
        ["これ / それ / あれ / どれ", "kore / sore / are / dore", "this one / that one / that one over there / which one"],
        ["ここ / そこ / あそこ / どこ", "koko / soko / asoko / doko", "here / there / over there / where"],
        ["この / その / あの / どの + thing", "kono / sono / ano / dono", "this … / that … / that … over there / which …"],
      ] },
      { p: "これ stands alone. この always needs a noun after it: このほん (this book)." },
      { ex: [
        ["それは なんですか。", "sore wa nan desu ka.", "What's that (near you)?"],
        ["おてあらいは どこですか。", "otearai wa doko desu ka.", "Where's the restroom?"],
        ["あそこです。", "asoko desu.", "It's over there."],
        ["このみせは たかいです。", "kono mise wa takai desu.", "This shop is expensive."],
      ] },
      { tip: "Pointing at something on a menu and saying これ (this one) gets you a long way." },
    ],
    quiz: [
      { q: "The thing is in your friend's hand. You call it…", choices: ["これ", "それ", "あれ"], a: 1, why: "そ = near the listener." },
      { q: "A building far from both of you is…", choices: ["これ", "それ", "あれ"], a: 2, why: "あ = far from both." },
      { q: "Which needs a noun after it?", choices: ["これ", "この"], a: 1, why: "この + noun: このほん." },
      { q: "Build: Where's the restroom?", build: ["おてあらい", "は", "どこ", "です", "か"], en: "Where's the restroom?", why: "おてあらい = restroom (polite)." },
      { q: "'It's over there.'", choices: ["ここです", "あそこです", "どこですか"], a: 1, why: "あそこ = over there." },
    ],
  },
  {
    id: "numbers", unit: "life", title: "Numbers and prices", minutes: 14,
    parts: [
      { ex: [
        ["いち", "ichi", "1"], ["に", "ni", "2"], ["さん", "san", "3"], ["よん / し", "yon / shi", "4"], ["ご", "go", "5"],
        ["ろく", "roku", "6"], ["なな / しち", "nana / shichi", "7"], ["はち", "hachi", "8"], ["きゅう / く", "kyuu / ku", "9"], ["じゅう", "juu", "10"],
      ] },
      { p: "4, 7 and 9 have two readings. Use よん, なな and きゅう when counting things or saying prices. し sounds like 'death', so people avoid it." },
      { h: "Bigger numbers are built like Lego" },
      { p: "じゅう is 10. 11 is じゅういち (10+1). 20 is にじゅう (2×10). 35 is さんじゅうご (3×10+5)." },
      { ex: [["じゅういち", "juuichi", "11"], ["にじゅう", "nijuu", "20"], ["さんじゅうご", "sanjuugo", "35"], ["ひゃく", "hyaku", "100"], ["せん", "sen", "1,000"]] },
      { tip: "A few hundreds change sound: さんびゃく (300), ろっぴゃく (600), はっぴゃく (800). Don't worry about them yet; people will understand you." },
      { h: "Prices" },
      { p: "Money is えん (en, yen)." },
      { ex: [
        ["いくらですか。", "ikura desu ka.", "How much is it?"],
        ["ひゃくえんです。", "hyaku en desu.", "It's 100 yen."],
        ["ごひゃくえん", "gohyaku en", "500 yen"],
        ["せんえん", "sen en", "1,000 yen"],
      ] },
    ],
    quiz: [
      { q: "Type the romaji for 3", type: ["san"], why: "さん." },
      { q: "Type the romaji for 8", type: ["hachi"], why: "はち." },
      { q: "When saying a price, 4 is usually…", choices: ["し", "よん"], a: 1, why: "し sounds like 'death', so よん is preferred." },
      { q: "にじゅう is…", choices: ["12", "20", "200"], a: 1, why: "に (2) × じゅう (10)." },
      { q: "さんじゅうご is…", choices: ["35", "53", "305"], a: 0, why: "3×10 + 5." },
      { q: "How do you ask 'How much is it?'", choices: ["いつですか", "いくらですか", "どこですか"], a: 1, why: "いくら = how much." },
      { q: "Type the romaji for 100", type: ["hyaku"], why: "ひゃく: a combo, one beat for hya." },
    ],
  },
  {
    id: "masu-verbs", unit: "life", title: "Doing things: ます verbs", minutes: 14,
    parts: [
      { p: "Polite verbs end in **ます** (masu, said 'mass'). The verb always comes at the end of the sentence." },
      { ex: [
        ["たべます", "tabemasu", "eat"], ["のみます", "nomimasu", "drink"], ["いきます", "ikimasu", "go"],
        ["きます", "kimasu", "come"], ["みます", "mimasu", "see, watch"], ["します", "shimasu", "do"],
      ] },
      { h: "Four endings to know" },
      { ex: [
        ["たべます", "tabemasu", "I eat / I will eat"],
        ["たべません", "tabemasen", "I don't eat / won't eat"],
        ["たべました", "tabemashita", "I ate"],
        ["たべましょう", "tabemashou", "Let's eat"],
      ] },
      { p: "There's no separate future tense: たべます covers 'eat' and 'will eat'." },
      { p: "Asking with **〜ませんか** (won't you…?) is the friendly way to invite someone." },
      { ex: [
        ["いっしょに たべませんか。", "issho ni tabemasen ka.", "Would you like to eat together?"],
        ["いいですね。", "ii desu ne.", "Sounds good!"],
        ["いきましょう。", "ikimashou.", "Let's go."],
      ] },
      { tip: "Pimsleur drills exactly these endings. When you hear ます, ません, ました, say the English in your head." },
    ],
    quiz: [
      { q: "のみます means…", choices: ["eat", "drink", "go"], a: 1, why: "のみます = drink." },
      { q: "'I went' is…", choices: ["いきます", "いきました", "いきません"], a: 1, why: "ました = past." },
      { q: "'Let's watch' is…", choices: ["みましょう", "みません", "みました"], a: 0, why: "ましょう = let's." },
      { q: "たべません means…", choices: ["I ate", "I don't eat", "Let's eat"], a: 1, why: "ません = not." },
      { q: "The friendliest way to invite someone to go together:", choices: ["いきます", "いっしょに いきませんか", "いきました"], a: 1, why: "〜ませんか = won't you…? A soft invitation." },
      { q: "Type the romaji: します (do)", type: ["shimasu", "simasu"], why: "し is shi." },
    ],
  },
  {
    id: "particles-o-ni-de", unit: "life", title: "Particles を, に, で", minutes: 14,
    parts: [
      { p: "Particles are small words after a noun that show its job in the sentence. Word order is flexible as long as the verb stays at the end." },
      { ex: [
        ["を (o)", "o", "the thing being acted on: eat what?"],
        ["に (ni)", "ni", "where you're going; at what time"],
        ["で (de)", "de", "where something happens; by what means"],
      ] },
      { ex: [
        ["すしを たべます。", "sushi o tabemasu.", "I eat sushi."],
        ["えきに いきます。", "eki ni ikimasu.", "I go to the station."],
        ["しちじに おきます。", "shichiji ni okimasu.", "I get up at 7."],
        ["うちで えいがを みます。", "uchi de eiga o mimasu.", "I watch a movie at home."],
        ["くるまで いきます。", "kuruma de ikimasu.", "I go by car."],
      ] },
      { tip: "In Okinawa almost everyone drives or takes the bus; くるまで (by car) and バスで (by bus) will come up constantly." },
      { p: "を is written with the W-row kana but sounds like お." },
    ],
    quiz: [
      { q: "みずを のみます: what does を mark?", choices: ["the place", "what is drunk", "the time"], a: 1, why: "を marks the object: water." },
      { q: "'I go to Naha.' なは__ いきます", choices: ["を", "に", "で"], a: 1, why: "に marks the destination." },
      { q: "'I eat at home.' うち__ たべます", choices: ["を", "に", "で"], a: 2, why: "で marks where an action happens." },
      { q: "'I go by bus.' バス__ いきます", choices: ["で", "を", "は"], a: 0, why: "で also means 'by means of'." },
      { q: "Build: I watch a movie at home.", build: ["うち", "で", "えいが", "を", "みます"], en: "I watch a movie at home.", why: "Place で, thing を, verb last." },
      { q: "Build: I go to the station.", build: ["えき", "に", "いきます"], en: "I go to the station.", why: "Destination に, verb last." },
    ],
  },
  {
    id: "ordering", unit: "life", title: "Ordering food and shopping", minutes: 12,
    parts: [
      { p: "Two phrases cover most of ordering: **〜をください** (please give me…) and **〜をおねがいします** (…please, a bit softer)." },
      { ex: [
        ["これを ください。", "kore o kudasai.", "This one, please."],
        ["みずを ください。", "mizu o kudasai.", "Water, please."],
        ["ビールを おねがいします。", "biiru o onegaishimasu.", "A beer, please."],
        ["おかいけい おねがいします。", "okaikei onegaishimasu.", "The check, please."],
      ] },
      { h: "Counting things: ひとつ, ふたつ, みっつ" },
      { p: "For ordering items there's a special set of numbers that works for almost anything." },
      { ex: [["ひとつ", "hitotsu", "one (thing)"], ["ふたつ", "futatsu", "two"], ["みっつ", "mittsu", "three"], ["よっつ", "yottsu", "four"]] },
      { ex: [["これを ふたつ ください。", "kore o futatsu kudasai.", "Two of these, please."]] },
      { h: "At the table" },
      { ex: [
        ["いただきます", "itadakimasu", "said before eating"],
        ["ごちそうさまでした", "gochisousama deshita", "said after eating, thanks for the meal"],
        ["おいしい！", "oishii!", "delicious!"],
      ] },
      { tip: "Say ごちそうさまでした to the staff on your way out of a small restaurant. It's noticed and appreciated." },
    ],
    quiz: [
      { q: "'Water, please.'", choices: ["みずを ください", "みずは どこですか", "みずです"], a: 0, why: "〜をください = please give me…" },
      { q: "'Two of these, please.'", choices: ["これを ひとつ ください", "これを ふたつ ください", "これを みっつ ください"], a: 1, why: "ふたつ = two things." },
      { q: "Before you start eating, you say…", choices: ["ごちそうさまでした", "いただきます", "おやすみなさい"], a: 1, why: "いただきます before, ごちそうさまでした after." },
      { q: "You want the check. You say…", choices: ["おかいけい おねがいします", "いただきます", "はじめまして"], a: 0, why: "おかいけい = the bill." },
      { q: "Build: This one, please.", build: ["これ", "を", "ください"], en: "This one, please.", why: "Point at the menu and say this." },
      { q: "Type the romaji: おいしい (delicious)", type: ["oishii"], why: "o-i-shi-i." },
    ],
  },

  /* ------------------------------------------------------------ Unit 4 */
  {
    id: "uchinaaguchi", unit: "okinawa", title: "Okinawan words you'll hear", minutes: 12,
    parts: [
      { p: "Daily life in Okinawa runs in standard Japanese, the Japanese this course teaches, often with a relaxed local accent. The old Okinawan language (うちなーぐち, uchinaaguchi) is spoken mostly by older people, but some of its words are everywhere: on signs, in shops, and among friends." },
      { p: "The ー mark means 'hold the vowel', just like a doubled vowel. It's usually a katakana mark, but Okinawan words written in hiragana use it too." },
      { ex: [
        ["はいさい", "haisai", "hello (said by men)"],
        ["はいたい", "haitai", "hello (said by women)"],
        ["めんそーれ", "mensoore", "welcome! (you'll see it at the airport)"],
        ["にふぇーでーびる", "nifeedeebiru", "thank you"],
        ["なんくるないさ", "nankurunaisa", "it'll work out, don't worry"],
        ["ちばりよー", "chibariyoo", "go for it! hang in there!"],
      ] },
      { h: "Words about people" },
      { ex: [
        ["うちなーんちゅ", "uchinaanchu", "an Okinawan person"],
        ["ないちゃー", "naichaa", "someone from mainland Japan"],
        ["ゆいまーる", "yuimaaru", "neighbors helping each other, a community spirit"],
      ] },
      { tip: "なんくるないさ is often explained as 'it'll be fine if you've done your best', not 'don't bother trying'. Using it right earns a smile." },
      { p: "Using one or two of these with locals shows you care about the place. Don't worry about speaking uchinaaguchi; standard Japanese is what you need for daily life and friends." },
    ],
    quiz: [
      { q: "めんそーれ means…", choices: ["goodbye", "welcome", "thank you"], a: 1, why: "めんそーれ = welcome, seen on signs all over the island." },
      { q: "A man greeting a friend in Okinawan might say…", choices: ["はいさい", "はいたい", "ちばりよー"], a: 0, why: "はいさい (men), はいたい (women)." },
      { q: "にふぇーでーびる means…", choices: ["thank you", "excuse me", "delicious"], a: 0, why: "The Okinawan thank you." },
      { q: "A friend is nervous about a job interview. You say…", choices: ["めんそーれ", "ちばりよー", "ないちゃー"], a: 1, why: "ちばりよー = go for it!" },
      { q: "What language do people in Okinawa mostly use day to day?", choices: ["Uchinaaguchi only", "Standard Japanese, with local words and accent", "English"], a: 1, why: "Standard Japanese, which is what this course teaches." },
      { q: "Type the romaji: なんくるないさ", type: ["nankurunaisa", "nankuru naisa"], why: "nan-ku-ru-na-i-sa." },
    ],
  },
];
