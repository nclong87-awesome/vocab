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

  // Sort actions so that individual word additions are processed FIRST, and batch actions (add_multiplewords) LAST.
  // This preserves the original individual action types and prevents them from being converted to confirm_save_word prematurely.
  const sortedActions = [...lastMsgWithWordActions.suggestedActions].sort((a, b) => {
    const aIsBatch = a && a.action === "add_multiplewords";
    const bIsBatch = b && b.action === "add_multiplewords";
    if (aIsBatch && !bIsBatch) return 1;
    if (!aIsBatch && bIsBatch) return -1;
    return 0;
  });

  for (const act of sortedActions) {
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
        const hasFullDetails = Boolean(w.translation && w.definition);

        remainingWordActions.push({
          label: hasFullDetails
            ? t("action_confirm_add_word", appLang, { word: w.word, details })
            : t("action_confirm_add", appLang, { word: w.word, translation: w.translation || "" }),
          action: hasFullDetails ? "confirm_save_word" : "add_word",
          payload: hasFullDetails ? w : { word: w.word, hint: w.hint || w.definition },
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

    let finalAct = { ...act };
    if (finalAct.action === "confirm_save_word") {
      const hasFullDetails = Boolean(finalAct.payload?.translation && finalAct.payload?.definition);
      if (!hasFullDetails) {
        finalAct.action = "add_word";
        if (finalAct.payload) {
          const hint = finalAct.payload.definition || finalAct.payload.translation || (finalAct.payload.hint && !finalAct.payload.hint.startsWith("Paired with") ? finalAct.payload.hint : undefined);
          finalAct.payload = {
            word: finalAct.payload.word,
            definition: finalAct.payload.definition,
            translation: finalAct.payload.translation,
            hint,
          };
        }
      }
    }
    remainingWordActions.push(finalAct);
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
  const lowerUser = (lastUserMsg || "").toLowerCase();

  // 1. Check if this message or context is related to "Polish Sentence" / Fix Grammar
  const isFixGrammarRelated =
    lowerMain.includes("polish sentence") ||
    lowerMain.includes("fix grammar") ||
    lowerMain.includes("polishing expression") ||
    lowerMain.includes("analyzing sentence") ||
    lowerMain.includes("trau chuốt câu") ||
    lowerMain.includes("sửa ngữ pháp") ||
    lowerMain.includes("đang phân tích câu") ||
    lowerMain.includes("satz verfeinern") ||
    lowerMain.includes("pulir oración") ||
    lowerMain.includes("polir la phrase") ||
    lowerMain.includes("文章のブラッシュアップ") ||
    lowerMain.includes("문장 다듬기") ||
    lowerMain.includes("句子润色") ||
    lowerMain.includes("enter or paste any sentence below") ||
    lowerMain.includes("nhập hoặc dán bất kỳ câu nào") ||
    lowerMain.includes("fix-grammar-prompt") ||
    lowerUser.includes("polish sentence") ||
    lowerUser.includes("fix grammar") ||
    lowerUser.includes("trau chuốt câu") ||
    lowerUser.includes("sửa ngữ pháp") ||
    resultActions.some((a) => a?.action === "fix_another" || a?.action === "copy_text");

  // If this is related to Polish Sentence / Fix Grammar, return existing actions without adding sample sentences or topic suggestions
  if (isFixGrammarRelated) {
    return resultActions;
  }

  // 2. Check for general analyzing / status / loading messages
  const isStatusOrAnalyzing =
    lowerMain.includes("analyzing") ||
    lowerMain.includes("đang phân tích") ||
    lowerMain.includes("generating") ||
    lowerMain.includes("đang tạo") ||
    lowerMain.includes("thinking") ||
    lowerMain.includes("đang suy nghĩ");

  if (isStatusOrAnalyzing) {
    return resultActions;
  }

  // 3. Welcome & Word Confirmation check
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
  const hasInteractive = resultActions.some(
    (act) =>
      act &&
      (act.action === "send_message" ||
        act.action === "start_practice" ||
        act.action === "common_phrases" ||
        act.action === "explain_grammar" ||
        act.action === "translate_contrast" ||
        act.action === "quiz_answer")
  );

  if (hasInteractive && resultActions.filter((a) => a.action === "send_message" || a.action === "quiz_answer").length >= 2) {
    return resultActions;
  }

  // 4. Try parsing bullet points or numbered lists in mainText
  const listItems: string[] = [];
  const lines = (mainText || "").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
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
      if (!resultActions.some((a) => a.label?.toLowerCase() === item.toLowerCase())) {
        resultActions.push({
          label: item,
          action: "send_message",
          payload: { message: item },
        });
      }
    }
    return resultActions;
  }

  // 5. Topic suggestions should ONLY appear for explicit "Generate words by topic" requests
  const isGenerateByTopic =
    lowerMain.includes("generate words by topic") ||
    lowerMain.includes("tạo từ vựng theo chủ đề") ||
    lowerMain.includes("generate_topic") ||
    lowerMain.includes("by topic") ||
    lowerUser.includes("generate words by topic") ||
    lowerUser.includes("tạo từ vựng theo chủ đề") ||
    lowerUser.includes("generate_topic") ||
    lowerMain.includes("select a topic below") ||
    lowerMain.includes("chọn một chủ đề bên dưới");

  if (isGenerateByTopic) {
    const defaults = [
      { label: t("topic_dining", appLang), action: "send_message", payload: { message: "Dining Out & Restaurants" } },
      { label: t("topic_travel", appLang), action: "send_message", payload: { message: "Travel & Airports" } },
      { label: t("topic_workplace", appLang), action: "send_message", payload: { message: "Workplace & Business Small Talk" } },
      { label: t("topic_daily", appLang), action: "send_message", payload: { message: "Daily Conversations & Emotions" } },
    ];
    for (const d of defaults) {
      if (!resultActions.some((a) => a.label === d.label)) {
        resultActions.push(d);
      }
    }
  }

  return resultActions;
}
