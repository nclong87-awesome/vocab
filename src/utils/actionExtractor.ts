export function extractOrGenerateTopicActions(
  mainText: string,
  existingActions: any[] = [],
  lastUserMsg = "",
  _targetLanguage = "English",
  _nativeLanguage = "Vietnamese"
): any[] {
  const resultActions = Array.isArray(existingActions) ? [...existingActions] : [];

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
      { label: "🍽️ Dining Out & Restaurants (Nhà hàng & Gọi món)", action: "send_message", payload: { message: "Dining Out & Restaurants" } },
      { label: "✈️ Travel & Airports (Du lịch & Sân bay)", action: "send_message", payload: { message: "Travel & Airports" } },
      { label: "💼 Workplace & Business Small Talk (Giao tiếp Công sở)", action: "send_message", payload: { message: "Workplace & Business Small Talk" } },
      { label: "🗣️ Daily Conversations & Emotions (Giao tiếp Hàng ngày)", action: "send_message", payload: { message: "Daily Conversations & Emotions" } },
    ];
    for (const d of defaults) {
      if (!resultActions.some(a => a.label === d.label)) {
        resultActions.push(d);
      }
    }
  } else if (isGrammar) {
    const defaults = [
      { label: "⏳ Past Simple vs Present Perfect", action: "send_message", payload: { message: "Past Simple vs Present Perfect" } },
      { label: "💬 Conditional Sentences (Câu điều kiện)", action: "send_message", payload: { message: "Conditional Sentences (If clauses)" } },
      { label: "🔗 Relative Clauses & Pronouns (Mệnh đề quan hệ)", action: "send_message", payload: { message: "Relative Clauses & Pronouns" } },
      { label: "🔄 Passive Voice & Formality (Thể bị động)", action: "send_message", payload: { message: "Passive Voice & Formality" } },
    ];
    for (const d of defaults) {
      if (!resultActions.some(a => a.label === d.label)) {
        resultActions.push(d);
      }
    }
  } else if (isTranslation) {
    const defaults = [
      { label: "☕ Ordering Coffee & Polite Requests", action: "send_message", payload: { message: "Ordering Coffee & Polite Requests" } },
      { label: "🤝 Expressing Opinions & Disagreeing", action: "send_message", payload: { message: "Expressing Opinions & Disagreeing" } },
      { label: "👋 Formal vs Casual Greetings", action: "send_message", payload: { message: "Formal vs Casual Greetings" } },
    ];
    for (const d of defaults) {
      if (!resultActions.some(a => a.label === d.label)) {
        resultActions.push(d);
      }
    }
  } else if (isAskingToChoose) {
    const defaults = [
      { label: "🗣️ Daily Life & Small Talk", action: "send_message", payload: { message: "Daily Life & Small Talk" } },
      { label: "🎓 Career & Education", action: "send_message", payload: { message: "Career & Education" } },
      { label: "✈️ Travel & Culture", action: "send_message", payload: { message: "Travel & Culture" } },
      { label: "🎯 Hobbies & Free Time", action: "send_message", payload: { message: "Hobbies & Free Time" } },
    ];
    for (const d of defaults) {
      if (!resultActions.some(a => a.label === d.label)) {
        resultActions.push(d);
      }
    }
  }

  return resultActions;
}
