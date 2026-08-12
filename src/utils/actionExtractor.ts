import { t } from "../config/i18n";

export function getRemainingWordActions(
  messages: any[],
  currentWords: any[],
  justAddedWord?: string,
  appLang: string = "English"
): any[] {
  if (!Array.isArray(messages) || messages.length === 0) return [];

  // Search backwards for the most recent assistant message with word addition actions
  const reversed = [...messages].reverse();
  const lastMsgWithWordActions = reversed.find((m) =>
    m &&
    m.role === "assistant" &&
    Array.isArray(m.suggestedActions) &&
    m.suggestedActions.some(
      (a: any) =>
        a &&
        (a.action === "add_word" ||
          a.action === "confirm_save_word" ||
          a.action === "select_definition" ||
          a.action === "add_multiplewords")
    )
  );

  if (!lastMsgWithWordActions || !Array.isArray(lastMsgWithWordActions.suggestedActions)) {
    return [];
  }

  const normalizedJustAdded = (justAddedWord || "").trim().toLowerCase();
  const wordsList = Array.isArray(currentWords) ? currentWords : [];

  const remainingWordActions: any[] = [];
  const seenWords = new Set<string>();

  for (const act of lastMsgWithWordActions.suggestedActions) {
    if (!act || typeof act !== "object") continue;

    if (act.action === "add_multiplewords" && Array.isArray(act.payload?.words)) {
      for (const w of act.payload.words) {
        const actWord = (w?.word || "").trim().toLowerCase();
        if (!actWord) continue;
        if (normalizedJustAdded && actWord === normalizedJustAdded) continue;
        if (seenWords.has(actWord)) continue;
        const isAlreadyInCollection = wordsList.some(
          (item) => item && typeof item.word === "string" && item.word.trim().toLowerCase() === actWord
        );
        if (isAlreadyInCollection) continue;

        seenWords.add(actWord);
        const details = w.translation || w.definition || "";
        remainingWordActions.push({
          label: t("action_confirm_add_word", appLang, { word: w.word, details }),
          action: "confirm_save_word",
          payload: w,
        });
      }
      continue;
    }

    const isWordAction =
      act.action === "add_word" ||
      act.action === "confirm_save_word" ||
      act.action === "select_definition";

    if (!isWordAction) continue;

    const actWord = (
      act.payload?.word ||
      act.payload?.targetWord ||
      (act as any).word ||
      ""
    ).trim().toLowerCase();

    if (!actWord) continue;

    // Skip if it matches the newly added word
    if (normalizedJustAdded && actWord === normalizedJustAdded) continue;

    // Skip if already seen or in collection
    if (seenWords.has(actWord)) continue;
    const isAlreadyInCollection = wordsList.some(
      (w) => w && typeof w.word === "string" && w.word.trim().toLowerCase() === actWord
    );
    if (isAlreadyInCollection) continue;

    seenWords.add(actWord);
    remainingWordActions.push(act);
  }

  if (remainingWordActions.length === 0) {
    return [];
  }

  // If 2 or more remaining word actions, add a batch action at the top
  if (remainingWordActions.length > 1) {
    const candidatePayloads = remainingWordActions
      .map((a) => a.payload)
      .filter(Boolean);

    const batchAction = {
      label: t("action_add_all_remaining", appLang, { count: String(remainingWordActions.length) }),
      action: "add_multiplewords",
      payload: { words: candidatePayloads },
    };

    return [batchAction, ...remainingWordActions];
  }

  return remainingWordActions;
}

export function extractOrGenerateTopicActions(
  mainText: string,
  existingActions: any[] = [],
  lastUserMsg = "",
  _targetLanguage = "English",
  _nativeLanguage = "English",
  appLang = "English"
): any[] {
  const resultActions = Array.isArray(existingActions) ? [...existingActions] : [];

  const lowerMain = (mainText || "").toLowerCase();
  const isWelcomeMsg =
    lowerMain.includes("interactive ai language coach") ||
    lowerMain.includes("trợ lý học ngôn ngữ ai") ||
    lowerMain.includes("welcome to your interactive") ||
    lowerMain.includes("chào mừng bạn đến với trợ lý") ||
    lowerMain.includes("welcome-msg") ||
    lowerMain.includes("quick actions below") ||
    lowerMain.includes("thao tác nhanh bên dưới") ||
    lowerMain.includes("try asking me:") ||
    lowerMain.includes("hãy thử hỏi tôi:");

  const isWordConfirmation =
    lowerMain.includes("successfully added") ||
    lowerMain.includes("đã thêm thành công") ||
    lowerMain.includes("already in your vocabulary collection") ||
    lowerMain.includes("đã có trong bộ sưu tập");

  if (isWelcomeMsg || isWordConfirmation) {
    return resultActions;
  }

  // Check if this is the "Fix Grammar" prompt card asking user to enter/paste a sentence
  const isFixGrammarPrompt =
    lowerMain.includes("fix grammar & polish sentence") ||
    lowerMain.includes("sửa ngữ pháp & trau chuốt câu") ||
    lowerMain.includes("enter or paste any sentence below") ||
    lowerMain.includes("nhập hoặc dán bất kỳ câu nào") ||
    lowerMain.includes("fix-grammar-prompt");

  if (isFixGrammarPrompt) {
    const sampleSentences = [
      { label: '✏️ "I have went to the store yesterday."', action: "send_message", payload: { message: "I have went to the store yesterday." } },
      { label: '✏️ "She don\'t like coffee very much."', action: "send_message", payload: { message: "She don't like coffee very much." } },
      { label: '✏️ "If I will see him, I will call you."', action: "send_message", payload: { message: "If I will see him, I will call you." } },
    ];
    for (const s of sampleSentences) {
      if (!resultActions.some(a => a.payload?.message === s.payload.message)) {
        resultActions.push(s);
      }
    }
    return resultActions;
  }

  // Check if existingActions already has word addition actions
  const hasWordActions = resultActions.some(
    (act) =>
      act &&
      (act.action === "add_word" ||
        act.action === "confirm_save_word" ||
        act.action === "select_definition" ||
        act.action === "add_multiplewords")
  );

  if (hasWordActions) {
    return resultActions;
  }

  // Check if existingActions already has interactive navigation actions
  const hasInteractive = resultActions.some(act =>
    act && (
      act.action === "send_message" ||
      act.action === "start_quiz" ||
      act.action === "common_phrases" ||
      act.action === "explain_grammar" ||
      act.action === "translate_contrast" ||
      act.action === "quiz_answer"
    )
  );

  // If we already have 2+ send_message or quiz_answer actions, return
  if (hasInteractive && resultActions.filter(a => a.action === "send_message" || a.action === "quiz_answer").length >= 2) {
    return resultActions;
  }

  // 1. Try parsing bullet points or numbered lists in mainText
  const listItems: string[] = [];
  const lines = (mainText || "").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    // Match lines starting with -, *, or 1., 2. etc.
    const match = trimmed.match(/^(?:[\-*•]|\d+[\.\)])\s*(?:\*{1,2})?([^\*\n\r]+?)(?:\*{1,2})?(?:\s*\(([^)]+)\))?$/);
    if (match && match[1]) {
      let labelCandidate = match[1].replace(/^[\-*•\d\.\)\s]+/, "").trim();
      if (match[2] && !labelCandidate.includes(match[2])) {
        labelCandidate += ` (${match[2].trim()})`;
      }
      labelCandidate = labelCandidate.replace(/^["'“”]+|["'“”]+$/g, "").trim();
      if (
        labelCandidate.length >= 3 &&
        labelCandidate.length <= 90 &&
        !labelCandidate.toLowerCase().startsWith("http") &&
        !labelCandidate.toLowerCase().startsWith("note:")
      ) {
        listItems.push(labelCandidate);
      }
    }
  }

  if (listItems.length >= 2 && listItems.length <= 8) {
    for (const item of listItems) {
      if (!resultActions.some(a => a.label?.toLowerCase() === item.toLowerCase())) {
        resultActions.push({
          label: item,
          action: "send_message",
          payload: { message: item }
        });
      }
    }
    return resultActions;
  }

  // 2. Check keywords if AI or User text invites topic/scenario choices or is a common phrase/grammar/translate query
  const combinedText = ((mainText || "") + " " + (lastUserMsg || "")).toLowerCase();

  const isCommonPhrases = combinedText.includes("common phrase") || combinedText.includes("idiom") || combinedText.includes("cụm từ") || combinedText.includes("thành ngữ") || combinedText.includes("phrases");
  const isGrammar = combinedText.includes("grammar") || combinedText.includes("ngữ pháp") || combinedText.includes("rule") || combinedText.includes("luật");
  const isTranslation = combinedText.includes("translate") || combinedText.includes("dịch") || combinedText.includes("compare") || combinedText.includes("so sánh") || combinedText.includes("nuance");
  const isAskingToChoose = combinedText.includes("chủ đề") || combinedText.includes("gợi ý") || combinedText.includes("chọn") || combinedText.includes("lựa chọn") || combinedText.includes("topic") || combinedText.includes("scenario") || combinedText.includes("dưới đây") || combinedText.includes("choose") || combinedText.includes("select");

  if (isCommonPhrases || (isAskingToChoose && !isGrammar && !isTranslation)) {
    const defaults = [
      { label: t("topic_dining", appLang), action: "send_message", payload: { message: "Dining Out & Restaurants" } },
      { label: t("topic_travel", appLang), action: "send_message", payload: { message: "Travel & Airports" } },
      { label: t("topic_workplace", appLang), action: "send_message", payload: { message: "Workplace & Business Small Talk" } },
      { label: t("topic_daily", appLang), action: "send_message", payload: { message: "Daily Conversations & Emotions" } },
    ];
    for (const d of defaults) {
      if (!resultActions.some(a => a.label === d.label)) {
        resultActions.push(d);
      }
    }
  } else if (isGrammar) {
    const defaults = [
      { label: t("topic_grammar_tenses", appLang), action: "send_message", payload: { message: "Past Simple vs Present Perfect" } },
      { label: t("topic_grammar_conditional", appLang), action: "send_message", payload: { message: "Conditional Sentences (If clauses)" } },
      { label: t("topic_grammar_relative", appLang), action: "send_message", payload: { message: "Relative Clauses & Pronouns" } },
      { label: t("topic_grammar_passive", appLang), action: "send_message", payload: { message: "Passive Voice & Formality" } },
    ];
    for (const d of defaults) {
      if (!resultActions.some(a => a.label === d.label)) {
        resultActions.push(d);
      }
    }
  } else if (isTranslation) {
    const defaults = [
      { label: t("topic_translate_coffee", appLang), action: "send_message", payload: { message: "Ordering Coffee & Polite Requests" } },
      { label: t("topic_translate_opinions", appLang), action: "send_message", payload: { message: "Expressing Opinions & Disagreeing" } },
      { label: t("topic_translate_greetings", appLang), action: "send_message", payload: { message: "Formal vs Casual Greetings" } },
    ];
    for (const d of defaults) {
      if (!resultActions.some(a => a.label === d.label)) {
        resultActions.push(d);
      }
    }
  } else if (isAskingToChoose) {
    const defaults = [
      { label: t("topic_choose_daily", appLang), action: "send_message", payload: { message: "Daily Life & Small Talk" } },
      { label: t("topic_choose_career", appLang), action: "send_message", payload: { message: "Career & Education" } },
      { label: t("topic_choose_travel", appLang), action: "send_message", payload: { message: "Travel & Culture" } },
      { label: t("topic_choose_hobbies", appLang), action: "send_message", payload: { message: "Hobbies & Free Time" } },
    ];
    for (const d of defaults) {
      if (!resultActions.some(a => a.label === d.label)) {
        resultActions.push(d);
      }
    }
  }

  return resultActions;
}
