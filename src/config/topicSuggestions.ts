export interface TopicOption {
  id: string;
  name: string;
  category: "certificate" | "general";
  description: string;
  badge?: string;
  examplePrompt: string;
}

export function getCertificateTopics(targetLanguage: string): TopicOption[] {
  const lang = (targetLanguage || "English").trim().toLowerCase();

  switch (lang) {
    case "english":
      return [
        {
          id: "ket",
          name: "KET (A2 Key)",
          category: "certificate",
          badge: "Cambridge A2",
          description: "Essential everyday vocabulary & basic conversation phrases",
          examplePrompt: "KET A2 Key Cambridge Exam Vocabulary"
        },
        {
          id: "pet",
          name: "PET (B1 Preliminary)",
          category: "certificate",
          badge: "Cambridge B1",
          description: "Intermediate social, work, travel & study vocabulary",
          examplePrompt: "PET B1 Preliminary Cambridge Exam Vocabulary"
        },
        {
          id: "fce",
          name: "FCE (B2 First)",
          category: "certificate",
          badge: "Cambridge B2",
          description: "Upper-intermediate idioms, expressions & formal discourse",
          examplePrompt: "FCE B2 First Cambridge Exam Vocabulary"
        },
        {
          id: "ielts",
          name: "IELTS Academic & General",
          category: "certificate",
          badge: "Band 6.5 - 8.0+",
          description: "Academic essays, data analysis, research & formal debate terms",
          examplePrompt: "IELTS Academic & General Exam High Frequency Vocabulary"
        },
        {
          id: "toeic",
          name: "TOEIC Business Communication",
          category: "certificate",
          badge: "Corporate 750+",
          description: "Corporate office, finance, logistics, meetings & negotiation terms",
          examplePrompt: "TOEIC Business & Corporate Workplace Vocabulary"
        }
      ];

    case "japanese":
      return [
        {
          id: "jlpt_n5",
          name: "JLPT N5 (Beginner)",
          category: "certificate",
          badge: "JLPT N5",
          description: "Basic daily greetings, family, numbers & elementary kanji",
          examplePrompt: "JLPT N5 Beginner Vocabulary"
        },
        {
          id: "jlpt_n4",
          name: "JLPT N4 (Basic)",
          category: "certificate",
          badge: "JLPT N4",
          description: "Everyday conversation, shopping, weather & daily routine",
          examplePrompt: "JLPT N4 Basic Japanese Vocabulary"
        },
        {
          id: "jlpt_n3",
          name: "JLPT N3 (Intermediate)",
          category: "certificate",
          badge: "JLPT N3",
          description: "Expressive vocabulary for work, hobbies & news summaries",
          examplePrompt: "JLPT N3 Intermediate Japanese Vocabulary"
        },
        {
          id: "jlpt_n2",
          name: "JLPT N2 (Upper-Intermediate)",
          category: "certificate",
          badge: "JLPT N2",
          description: "Business Japanese, newspaper articles & nuanced expressions",
          examplePrompt: "JLPT N2 Business & Media Japanese Vocabulary"
        },
        {
          id: "jlpt_n1",
          name: "JLPT N1 (Advanced)",
          category: "certificate",
          badge: "JLPT N1",
          description: "Formal academic prose, specialized fields & subtle nuances",
          examplePrompt: "JLPT N1 Advanced Specialized Japanese Vocabulary"
        }
      ];

    case "chinese":
      return [
        {
          id: "hsk_1",
          name: "HSK 1 (Level 1)",
          category: "certificate",
          badge: "HSK 1",
          description: "Foundation words, essential daily greetings & pinyin basics",
          examplePrompt: "HSK Level 1 Foundation Chinese Vocabulary"
        },
        {
          id: "hsk_2",
          name: "HSK 2 (Level 2)",
          category: "certificate",
          badge: "HSK 2",
          description: "Simple routines, directions, time & family relationships",
          examplePrompt: "HSK Level 2 Everyday Chinese Vocabulary"
        },
        {
          id: "hsk_3",
          name: "HSK 3 (Level 3)",
          category: "certificate",
          badge: "HSK 3",
          description: "Intermediate travel, dining, leisure & social interaction",
          examplePrompt: "HSK Level 3 Intermediate Chinese Vocabulary"
        },
        {
          id: "hsk_4",
          name: "HSK 4 (Level 4)",
          category: "certificate",
          badge: "HSK 4",
          description: "Fluent discussions on work, culture, emotion & technology",
          examplePrompt: "HSK Level 4 Work & Life Chinese Vocabulary"
        },
        {
          id: "hsk_5",
          name: "HSK 5 (Level 5)",
          category: "certificate",
          badge: "HSK 5",
          description: "Professional articles, speeches, literature & business context",
          examplePrompt: "HSK Level 5 Advanced Professional Chinese Vocabulary"
        }
      ];

    case "french":
      return [
        {
          id: "delf_a1",
          name: "DELF A1 (Découverte)",
          category: "certificate",
          badge: "DELF A1",
          description: "Basic introductions, personal info & immediate surroundings",
          examplePrompt: "DELF A1 Beginner French Vocabulary"
        },
        {
          id: "delf_a2",
          name: "DELF A2 (Survie)",
          category: "certificate",
          badge: "DELF A2",
          description: "Routine tasks, shopping, local geography & daily work",
          examplePrompt: "DELF A2 Elementary French Vocabulary"
        },
        {
          id: "delf_b1",
          name: "DELF B1 (Indépendant)",
          category: "certificate",
          badge: "DELF B1",
          description: "Travel, expressing opinions, plans & personal experiences",
          examplePrompt: "DELF B1 Intermediate French Vocabulary"
        },
        {
          id: "delf_b2",
          name: "DELF B2 (Avancé)",
          category: "certificate",
          badge: "DELF B2",
          description: "Debates, complex current affairs, media & professional discourse",
          examplePrompt: "DELF B2 Upper-Intermediate French Vocabulary"
        },
        {
          id: "dalf_c1",
          name: "DALF C1 (Autonome)",
          category: "certificate",
          badge: "DALF C1",
          description: "Academic analysis, literary expression & specialized domains",
          examplePrompt: "DALF C1 Advanced Academic French Vocabulary"
        }
      ];

    case "german":
      return [
        {
          id: "goethe_a1",
          name: "Goethe A1 (Start Deutsch)",
          category: "certificate",
          badge: "Goethe A1",
          description: "Basic phrases, introductions, numbers & everyday needs",
          examplePrompt: "Goethe Zertifikat A1 German Vocabulary"
        },
        {
          id: "goethe_a2",
          name: "Goethe A2 (Grundstufe)",
          category: "certificate",
          badge: "Goethe A2",
          description: "Workplace basics, environment, shopping & family life",
          examplePrompt: "Goethe Zertifikat A2 German Vocabulary"
        },
        {
          id: "goethe_b1",
          name: "Goethe B1 (Zertifikat B1)",
          category: "certificate",
          badge: "Goethe B1",
          description: "Independent travel, work discussions & expressing views",
          examplePrompt: "Goethe Zertifikat B1 German Vocabulary"
        },
        {
          id: "goethe_b2",
          name: "Goethe B2 (Mittelstufe)",
          category: "certificate",
          badge: "Goethe B2",
          description: "Technical discussions, abstract topics & formal writing",
          examplePrompt: "Goethe Zertifikat B2 German Vocabulary"
        },
        {
          id: "testdaf_c1",
          name: "TestDaF / Goethe C1",
          category: "certificate",
          badge: "TestDaF / C1",
          description: "University research, academic prose & complex business German",
          examplePrompt: "TestDaF C1 Academic German Vocabulary"
        }
      ];

    case "spanish":
      return [
        {
          id: "dele_a1",
          name: "DELE A1 (Acceso)",
          category: "certificate",
          badge: "DELE A1",
          description: "Basic greetings, personal details & immediate needs",
          examplePrompt: "DELE A1 Beginner Spanish Vocabulary"
        },
        {
          id: "dele_a2",
          name: "DELE A2 (Plataforma)",
          category: "certificate",
          badge: "DELE A2",
          description: "Daily routines, family, local geography & shopping",
          examplePrompt: "DELE A2 Elementary Spanish Vocabulary"
        },
        {
          id: "dele_b1",
          name: "DELE B1 (Umbral)",
          category: "certificate",
          badge: "DELE B1",
          description: "Travel, dreams, events, work & personal opinions",
          examplePrompt: "DELE B1 Intermediate Spanish Vocabulary"
        },
        {
          id: "dele_b2",
          name: "DELE B2 (Avanzado)",
          category: "certificate",
          badge: "DELE B2",
          description: "Complex arguments, current news, professional environments",
          examplePrompt: "DELE B2 Upper-Intermediate Spanish Vocabulary"
        },
        {
          id: "dele_c1",
          name: "DELE C1 (Dominio Operativo)",
          category: "certificate",
          badge: "DELE C1",
          description: "Fluent social, academic & professional Spanish discourse",
          examplePrompt: "DELE C1 Advanced Spanish Vocabulary"
        }
      ];

    case "korean":
      return [
        {
          id: "topik_1",
          name: "TOPIK I Level 1",
          category: "certificate",
          badge: "TOPIK I-1",
          description: "Basic survival Korean, family, food & daily greetings",
          examplePrompt: "TOPIK I Level 1 Elementary Korean Vocabulary"
        },
        {
          id: "topik_2",
          name: "TOPIK I Level 2",
          category: "certificate",
          badge: "TOPIK I-2",
          description: "Telephone conversations, appointments & public transport",
          examplePrompt: "TOPIK I Level 2 Basic Korean Vocabulary"
        },
        {
          id: "topik_3",
          name: "TOPIK II Level 3",
          category: "certificate",
          badge: "TOPIK II-3",
          description: "Public facility usage, social relationships & news basics",
          examplePrompt: "TOPIK II Level 3 Intermediate Korean Vocabulary"
        },
        {
          id: "topik_4",
          name: "TOPIK II Level 4",
          category: "certificate",
          badge: "TOPIK II-4",
          description: "Workplace communication, news articles & social issues",
          examplePrompt: "TOPIK II Level 4 Upper-Intermediate Korean Vocabulary"
        },
        {
          id: "topik_5",
          name: "TOPIK II Level 5",
          category: "certificate",
          badge: "TOPIK II-5",
          description: "Professional research, politics, economy & culture terms",
          examplePrompt: "TOPIK II Level 5 Advanced Professional Korean Vocabulary"
        }
      ];

    case "vietnamese":
      return [
        {
          id: "vpt_a1",
          name: "VPT A1 (Sơ cấp 1)",
          category: "certificate",
          badge: "VPT A1",
          description: "Greetings, family, numbers & basic street food ordering",
          examplePrompt: "VPT A1 Elementary Vietnamese Vocabulary"
        },
        {
          id: "vpt_a2",
          name: "VPT A2 (Sơ cấp 2)",
          category: "certificate",
          badge: "VPT A2",
          description: "Shopping, directions, weather & daily routine in Vietnam",
          examplePrompt: "VPT A2 Basic Vietnamese Vocabulary"
        },
        {
          id: "vpt_b1",
          name: "VPT B1 (Trung cấp 1)",
          category: "certificate",
          badge: "VPT B1",
          description: "Travel, workplace, traditional festivals & personal stories",
          examplePrompt: "VPT B1 Intermediate Vietnamese Vocabulary"
        },
        {
          id: "vpt_b2",
          name: "VPT B2 (Trung cấp 2)",
          category: "certificate",
          badge: "VPT B2",
          description: "Business communication, news summaries & cultural commentary",
          examplePrompt: "VPT B2 Upper-Intermediate Vietnamese Vocabulary"
        },
        {
          id: "vpt_c1",
          name: "VPT C1 (Cao cấp)",
          category: "certificate",
          badge: "VPT C1",
          description: "Formal academic, historical, literary & economic Vietnamese",
          examplePrompt: "VPT C1 Advanced Vietnamese Vocabulary"
        }
      ];

    case "italian":
      return [
        {
          id: "cils_a1",
          name: "CILS / CELI A1",
          category: "certificate",
          badge: "CILS A1",
          description: "Basic daily expressions, family & personal introduction",
          examplePrompt: "CILS A1 Elementary Italian Vocabulary"
        },
        {
          id: "cils_a2",
          name: "CILS / CELI A2",
          category: "certificate",
          badge: "CILS A2",
          description: "Everyday routine, local geography & shopping in Italy",
          examplePrompt: "CILS A2 Basic Italian Vocabulary"
        },
        {
          id: "cils_b1",
          name: "CILS / CELI B1",
          category: "certificate",
          badge: "CILS B1",
          description: "Intermediate social interaction, travel & personal opinions",
          examplePrompt: "CILS B1 Intermediate Italian Vocabulary"
        },
        {
          id: "cils_b2",
          name: "CILS / CELI B2",
          category: "certificate",
          badge: "CILS B2",
          description: "Professional discussions, media analysis & technical terms",
          examplePrompt: "CILS B2 Upper-Intermediate Italian Vocabulary"
        },
        {
          id: "cils_c1",
          name: "CILS / CELI C1",
          category: "certificate",
          badge: "CILS C1",
          description: "Advanced academic, literary & formal Italian communication",
          examplePrompt: "CILS C1 Advanced Italian Vocabulary"
        }
      ];

    default:
      return [
        {
          id: "cefr_a1",
          name: `${targetLanguage} CEFR A1`,
          category: "certificate",
          badge: "CEFR A1",
          description: "Basic greetings, self-introduction & foundational words",
          examplePrompt: `${targetLanguage} CEFR A1 Beginner Vocabulary`
        },
        {
          id: "cefr_a2",
          name: `${targetLanguage} CEFR A2`,
          category: "certificate",
          badge: "CEFR A2",
          description: "Daily routine, shopping, family & immediate needs",
          examplePrompt: `${targetLanguage} CEFR A2 Elementary Vocabulary`
        },
        {
          id: "cefr_b1",
          name: `${targetLanguage} CEFR B1`,
          category: "certificate",
          badge: "CEFR B1",
          description: "Travel, work, leisure & expressing personal opinions",
          examplePrompt: `${targetLanguage} CEFR B1 Intermediate Vocabulary`
        },
        {
          id: "cefr_b2",
          name: `${targetLanguage} CEFR B2`,
          category: "certificate",
          badge: "CEFR B2",
          description: "Complex arguments, professional contexts & media",
          examplePrompt: `${targetLanguage} CEFR B2 Upper-Intermediate Vocabulary`
        },
        {
          id: "cefr_c1",
          name: `${targetLanguage} CEFR C1`,
          category: "certificate",
          badge: "CEFR C1",
          description: "Academic research, formal fluency & specialized topics",
          examplePrompt: `${targetLanguage} CEFR C1 Advanced Vocabulary`
        }
      ];
  }
}

export function getGeneralTopics(): TopicOption[] {
  return [
    {
      id: "travel_dining",
      name: "Travel & Dining",
      category: "general",
      badge: "Everyday",
      description: "Airports, hotels, ordering food, directions & sightseeing",
      examplePrompt: "Travel, Hotels & Restaurant Dining"
    },
    {
      id: "business_office",
      name: "Business & Office",
      category: "general",
      badge: "Career",
      description: "Meetings, emails, negotiations, finance & presentations",
      examplePrompt: "Business, Career & Corporate Workplace"
    },
    {
      id: "tech_ai",
      name: "Technology & AI",
      category: "general",
      badge: "Modern",
      description: "Software, artificial intelligence, internet & digital devices",
      examplePrompt: "Technology, AI & Digital Innovation"
    },
    {
      id: "daily_hobbies",
      name: "Daily Life & Hobbies",
      category: "general",
      badge: "Lifestyle",
      description: "Sports, music, movies, shopping, home & leisure activities",
      examplePrompt: "Daily Life, Hobbies & Entertainment"
    },
    {
      id: "health_medical",
      name: "Health & Medical",
      category: "general",
      badge: "Wellness",
      description: "Body parts, symptoms, pharmacy, workout & healthy living",
      examplePrompt: "Health, Medical & Fitness"
    }
  ];
}
