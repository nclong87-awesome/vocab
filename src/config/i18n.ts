export type TranslationKey =
  | "app_title"
  | "nav_collection"
  | "nav_analytics"
  | "nav_settings"
  | "nav_dashboard"
  | "nav_chat"
  | "nav_flashcards"
  | "nav_quiz"
  | "settings_language_title"
  | "settings_language_desc"
  | "settings_app_language"
  | "settings_app_language_desc"
  | "settings_target_language"
  | "settings_target_language_desc"
  | "settings_native_language"
  | "settings_native_language_desc"
  | "settings_save_lang"
  | "settings_lang_saved"
  | "settings_match_native"
  | "quiz_definition_prompt"
  | "quiz_sentence_prompt"
  | "quiz_listening_prompt"
  | "quiz_picture_prompt"
  | "quiz_spelling_prompt"
  | "quiz_feedback_correct"
  | "quiz_feedback_incorrect"
  | "quiz_verify"
  | "quiz_next"
  | "quiz_finish"
  | "quiz_summary_title"
  | "quiz_summary_subtitle"
  | "quiz_no_words_title"
  | "quiz_no_words_desc"
  | "quiz_correct_count"
  | "quiz_accuracy"
  | "quiz_retry_missed"
  | "quiz_star_missed"
  | "quiz_go_back"
  | "quiz_type_answer_placeholder"
  | "word_count"
  | "streak_days"
  | "mastered_count"
  | "studied_count"
  | "add_word_btn"
  | "search_placeholder"
  | "ai_coach_title"
  | "chat_welcome_msg"
  | "chat_placeholder_adding_word"
  | "chat_placeholder_photo"
  | "chat_placeholder_default"
  | "photo_attached"
  | "photo_suggest_hint"
  | "photo_extract_hint"
  | "polished_sentence"
  | "suggested_replies"
  | "audio_clip"
  | "tap_play_audio"
  | "play_clip"
  | "copied"
  | "copy"
  | "option_label"
  | "col_filter_placeholder"
  | "col_sort_label"
  | "col_sort_newest"
  | "col_sort_oldest"
  | "col_sort_alpha"
  | "col_sort_unlearned"
  | "col_no_words_found"
  | "col_empty_search"
  | "col_empty_list"
  | "col_terms_count"
  | "analytics_title"
  | "analytics_headline"
  | "analytics_quote"
  | "analytics_practice_weak"
  | "analytics_analyzing"
  | "analytics_reanalyze"
  | "analytics_coach"
  | "analytics_mastered_title"
  | "analytics_improving_title"
  | "analytics_all_words"
  | "analytics_improving_words"
  | "analytics_mastered_words"
  | "analytics_refresher_due"
  | "analytics_starred"
  | "analytics_search_placeholder"
  | "analytics_sort_label"
  | "analytics_sort_weakest"
  | "analytics_sort_highest"
  | "analytics_sort_alpha"
  | "analytics_sort_recent"
  | "quick_actions_title"
  | "quick_actions_search_placeholder"
  | "quick_cat_all"
  | "quick_cat_writing"
  | "quick_cat_study"
  | "quick_cat_vocab"
  | "quick_cat_chat"
  | "quick_all_actions"
  | "quick_close_grid"
  | "flashcards_empty_title"
  | "flashcards_empty_desc"
  | "flashcards_back_dash"
  | "flashcards_card_mode"
  | "flashcards_list_mode"
  | "flashcards_click_flip"
  | "flashcards_meaning_trans"
  | "flashcards_example_usage"
  | "flashcards_memory_strength"
  | "flashcards_got_it"
  | "flashcards_practice_btn"
  | "flashcards_mastered"
  | "flashcards_mark_mastered"
  | "flashcards_previous"
  | "flashcards_next_word"
  | "flashcards_take_quiz"
  | "qa_fix_grammar_label"
  | "qa_fix_grammar_title"
  | "qa_fix_grammar_desc"
  | "qa_suggest_reply_label"
  | "qa_suggest_reply_title"
  | "qa_suggest_reply_desc"
  | "qa_start_quiz_label"
  | "qa_start_quiz_title"
  | "qa_start_quiz_desc"
  | "qa_flash_card_label"
  | "qa_flash_card_title"
  | "qa_flash_card_desc"
  | "qa_generate_words_label"
  | "qa_generate_words_title"
  | "qa_generate_words_desc"
  | "qa_add_word_label"
  | "qa_add_word_title"
  | "qa_add_word_desc"
  | "qa_interactive_prompts_label"
  | "qa_interactive_prompts_title"
  | "qa_interactive_prompts_desc"
  | "qa_explain_grammar_label"
  | "qa_explain_grammar_title"
  | "qa_explain_grammar_desc"
  | "qa_common_phrases_label"
  | "qa_common_phrases_title"
  | "qa_common_phrases_desc"
  | "qa_translate_contrast_label"
  | "qa_translate_contrast_title"
  | "qa_translate_contrast_desc"
  | "qa_new_chat_label"
  | "qa_new_chat_title"
  | "qa_new_chat_desc"
  | "qa_cat_writing"
  | "qa_cat_study"
  | "qa_cat_vocab"
  | "qa_cat_chat"
  | "action_add_to_col"
  | "action_confirm_add"
  | "action_next_flashcard"
  | "action_suggest_another";

export type LanguageTranslations = Partial<Record<TranslationKey, string>>;

// Map language codes/names to dictionary keys
function normalizeLangKey(langNameOrCode?: string): string {
  if (!langNameOrCode) return "en";
  const name = langNameOrCode.toLowerCase().trim();
  if (name.includes("vietnam") || name === "vi" || name === "vi-vn") return "vi";
  if (name.includes("spanish") || name === "es" || name === "es-es") return "es";
  if (name.includes("french") || name === "fr" || name === "fr-fr") return "fr";
  if (name.includes("german") || name === "de" || name === "de-de") return "de";
  if (name.includes("japan") || name === "ja" || name === "ja-jp") return "ja";
  if (name.includes("chin") || name === "zh" || name === "zh-cn" || name === "mandarin") return "zh";
  if (name.includes("kore") || name === "ko" || name === "ko-kr") return "ko";
  if (name.includes("ital") || name === "it" || name === "it-it") return "it";
  if (name.includes("portug") || name === "pt" || name === "pt-pt" || name === "pt-br") return "pt";
  if (name.includes("russ") || name === "ru" || name === "ru-ru") return "ru";
  if (name.includes("dutch") || name === "nl" || name === "nl-nl") return "nl";
  if (name.includes("arab") || name === "ar" || name === "ar-sa") return "ar";
  if (name.includes("hind") || name === "hi" || name === "hi-in") return "hi";
  if (name.includes("turk") || name === "tr" || name === "tr-tr") return "tr";
  if (name.includes("polis") || name === "pl" || name === "pl-pl") return "pl";
  if (name.includes("swed") || name === "sv" || name === "sv-se") return "sv";
  if (name.includes("greek") || name === "el" || name === "el-gr") return "el";
  if (name.includes("thai") || name === "th" || name === "th-th") return "th";
  if (name.includes("indones") || name === "id" || name === "id-id") return "id";
  return "en";
}

export const translations: Record<string, LanguageTranslations> = {
  en: {
    app_title: "Vocab Learner",
    nav_collection: "Collection",
    nav_analytics: "Analytics",
    nav_settings: "Settings",
    nav_dashboard: "Dashboard",
    nav_chat: "AI Tutor",
    nav_flashcards: "Flashcards",
    nav_quiz: "Practice Quiz",
    settings_language_title: "Language & Interface Preferences",
    settings_language_desc: "Configure your App Language, Target Learning Language, and Native Explanation Language.",
    settings_app_language: "App Language (UI & Quiz Speech)",
    settings_app_language_desc: "The interface language for the app. Speech for quiz questions and feedback will follow this language.",
    settings_target_language: "Target Language (Language to Learn)",
    settings_target_language_desc: "Vocabulary words, audio pronunciations, and flashcards will be studied in this language.",
    settings_native_language: "Native Language (Explanations & Translations)",
    settings_native_language_desc: "Definitions, example translations, and hints will be explained in this language.",
    settings_save_lang: "Save Language Preferences",
    settings_lang_saved: "Language preferences saved successfully!",
    settings_match_native: "Match Native Language",
    quiz_definition_prompt: "Which word matches the following definition?",
    quiz_sentence_prompt: "Fill in the blank for the sentence:",
    quiz_listening_prompt: "Listen to the audio clip and select the correct matching word:",
    quiz_picture_prompt: "Which word matches the visual concept shown below?",
    quiz_spelling_prompt: "Type the correct word you hear or read:",
    quiz_feedback_correct: "Correct!",
    quiz_feedback_incorrect: "Incorrect! Correct answer: \"{answer}\"",
    quiz_verify: "Verify Answer",
    quiz_next: "Next Question",
    quiz_finish: "Finish Quiz",
    quiz_summary_title: "Quiz Completed",
    quiz_summary_subtitle: "Performance analysis complete. Review your results and missed words below.",
    quiz_no_words_title: "No Words to Practice Today",
    quiz_no_words_desc: "You have reviewed all eligible vocabulary items recently! There are no words due for practice right now.",
    quiz_correct_count: "Correct Answers",
    quiz_accuracy: "Accuracy Rate",
    quiz_retry_missed: "Retry Missed Questions",
    quiz_star_missed: "Star Missed Words",
    quiz_go_back: "Go Back",
    quiz_type_answer_placeholder: "Type your answer here...",
    word_count: "Words",
    streak_days: "Day Streak",
    mastered_count: "Mastered",
    studied_count: "Studied",
    add_word_btn: "Add Word",
    search_placeholder: "Search vocabulary...",
    ai_coach_title: "AI Study Companion",
    chat_welcome_msg: "¡Hola! Welcome to your interactive AI Language Coach. I'm here to help you master **{target}** from your native language **{native}**.\n\nYou can chat with me, ask me to translate phrases, explain grammar rules, or introduce new words.\n\nTry asking me: *'What are some common idioms in {target}?'* or click one of the quick actions below to start learning!",
    chat_placeholder_adding_word: "Adding new word to collection...",
    chat_placeholder_photo: "Ask AI Vision about this image or click Send to analyze...",
    chat_placeholder_default: "Ask AI tutor, practice conversation, or request grammar feedback...",
    photo_attached: "Photo Attached:",
    photo_suggest_hint: "AI Vision will suggest casual responses and target vocabulary from this screenshot",
    photo_extract_hint: "AI Vision will analyze and extract vocabulary",
    polished_sentence: "Polished Sentence:",
    suggested_replies: "Suggested Replies (Quick Copy):",
    audio_clip: "Audio Clip",
    tap_play_audio: "Tap play to listen to pronunciation",
    play_clip: "Play Clip",
    copied: "Copied!",
    copy: "Copy",
    option_label: "Option",
    col_filter_placeholder: "Filter terms by spelling, translation, or definition...",
    col_sort_label: "Sort:",
    col_sort_newest: "New Words First",
    col_sort_oldest: "Oldest First",
    col_sort_alpha: "Alphabetical (A-Z)",
    col_sort_unlearned: "Unlearned First",
    col_no_words_found: "No Vocabulary Words Found",
    col_empty_search: "No terms match your search filter.",
    col_empty_list: "Your vocabulary list is empty. Add new words through the Chat view!",
    col_terms_count: "terms",
    analytics_title: "AI Vocabulary Analytics",
    analytics_headline: "Performance & Mastery Dashboard",
    analytics_quote: "\"Track memory retention, identify weak words needing practice, view mastered terms, and receive AI-guided cognitive learning insights.\"",
    analytics_practice_weak: "Practice Weak Words",
    analytics_analyzing: "Analyzing...",
    analytics_reanalyze: "Re-Analyze with AI",
    analytics_coach: "AI Performance Coach",
    analytics_mastered_title: "Mastered Words",
    analytics_improving_title: "Need Improvement",
    analytics_all_words: "All Words",
    analytics_improving_words: "Need Improvement",
    analytics_mastered_words: "Mastered Words",
    analytics_refresher_due: "Refresher Due",
    analytics_starred: "Starred",
    analytics_search_placeholder: "Search term, definition, or translation...",
    analytics_sort_label: "Sort:",
    analytics_sort_weakest: "Weakest / Lowest Strength First",
    analytics_sort_highest: "Highest Strength / Mastered First",
    analytics_sort_alpha: "Alphabetical (A - Z)",
    analytics_sort_recent: "Recently Reviewed First",
    quick_actions_title: "Quick AI Actions",
    quick_actions_search_placeholder: "Search actions (e.g. grammar, quiz, topic)...",
    quick_cat_all: "All Actions",
    quick_cat_writing: "✍️ Writing & Polish",
    quick_cat_study: "🧠 Quiz & Study",
    quick_cat_vocab: "📚 Vocabulary",
    quick_cat_chat: "💬 Chat Session",
    quick_all_actions: "All Actions",
    quick_close_grid: "Close Grid",
    flashcards_empty_title: "Vocabulary list is empty",
    flashcards_empty_desc: "This list doesn't have any words yet. You can add words manually or generate them with AI.",
    flashcards_back_dash: "Back to Dashboard",
    flashcards_card_mode: "Card Mode",
    flashcards_list_mode: "List View",
    flashcards_click_flip: "Click to Flip Card",
    flashcards_meaning_trans: "Meaning & Translation",
    flashcards_example_usage: "Example Usage",
    flashcards_memory_strength: "Memory Strength:",
    flashcards_got_it: "Got it (+10%)",
    flashcards_practice_btn: "Practice (-10%)",
    flashcards_mastered: "Mastered",
    flashcards_mark_mastered: "Mark as Mastered",
    flashcards_previous: "Previous",
    flashcards_next_word: "Next Word",
    flashcards_take_quiz: "Take Quiz",
    qa_fix_grammar_label: "Fix Grammar",
    qa_fix_grammar_title: "Fix Grammar & Polish",
    qa_fix_grammar_desc: "Check spelling, grammar, and improve natural clarity",
    qa_suggest_reply_label: "Suggest Reply",
    qa_suggest_reply_title: "Suggest Casual Reply",
    qa_suggest_reply_desc: "Suggest casual replies and target vocabulary from a screenshot or text of a conversation",
    qa_start_quiz_label: "Start Quiz",
    qa_start_quiz_title: "Start Today's Quiz",
    qa_start_quiz_desc: "Interactive flashcards and recall challenge",
    qa_flash_card_label: "Flash Card",
    qa_flash_card_title: "Flash Card",
    qa_flash_card_desc: "Practice candidate words as interactive AI flash cards with speech & extra contextual example sentences",
    qa_generate_words_label: "Generate Words",
    qa_generate_words_title: "Generate Words",
    qa_generate_words_desc: "Build vocabulary around travel, business, or custom topics",
    qa_add_word_label: "Add Word",
    qa_add_word_title: "Add Word to Collection",
    qa_add_word_desc: "Manually store new words with notes & definitions",
    qa_interactive_prompts_label: "Interactive AI Prompts",
    qa_interactive_prompts_title: "Interactive Language Coach",
    qa_interactive_prompts_desc: "Ask AI coach for interactive guidance on Grammar Rules, Nuance Translation, or Situational Phrases",
    qa_explain_grammar_label: "Explain Grammar Rules",
    qa_explain_grammar_title: "Explain Grammar Rules (in Native Language)",
    qa_explain_grammar_desc: "Ask AI coach for a breakdown of grammar rules & syntax in your native language",
    qa_common_phrases_label: "Common Phrases",
    qa_common_phrases_title: "Common Phrases & Idioms",
    qa_common_phrases_desc: "Learn essential daily expressions & conversational idioms by topic or scenario",
    qa_translate_contrast_label: "Translate & Compare",
    qa_translate_contrast_title: "Translate & Contrast",
    qa_translate_contrast_desc: "Compare nuances between native phrasing and target language for custom sentences",
    qa_new_chat_label: "Start New Chat",
    qa_new_chat_title: "Start Fresh Chat Session",
    qa_new_chat_desc: "Clear current conversation thread and start fresh",
    qa_cat_writing: "Writing",
    qa_cat_study: "Study",
    qa_cat_vocab: "Vocab",
    qa_cat_chat: "Chat",
    action_add_to_col: "Add \"{word}\" to collection",
    action_confirm_add: "➕ Confirm & Add \"{word}\" ({translation})",
    action_next_flashcard: "🃏 Next Flash Card",
    action_suggest_another: "💬 Suggest Another Casual Reply"
  },
  vi: {
    app_title: "Học Từ Vựng AI",
    nav_collection: "Bộ Từ Vựng",
    nav_analytics: "Phân Tích",
    nav_settings: "Cài Đặt",
    nav_dashboard: "Trang Chủ",
    nav_chat: "Gia Sư AI",
    nav_flashcards: "Thẻ Ghi Nhớ",
    nav_quiz: "Luyện Tập Quiz",
    settings_language_title: "Cài Đặt Ngôn Ngữ & Giao Diện",
    settings_language_desc: "Cấu hình Ngôn ngữ Ứng dụng, Ngôn ngữ Cần học và Ngôn ngữ Mẹ đẻ của bạn.",
    settings_app_language: "Ngôn Ngữ Ứng Dụng (Giao diện & Giọng đọc Quiz)",
    settings_app_language_desc: "Ngôn ngữ giao diện người dùng. Giọng đọc câu hỏi quiz và phản hồi đúng/sai sẽ phát theo ngôn ngữ này.",
    settings_target_language: "Ngôn Ngữ Cần Học (Target Language)",
    settings_target_language_desc: "Từ vựng, phát âm và thẻ học sẽ được rèn luyện theo ngôn ngữ này.",
    settings_native_language: "Ngôn Ngữ Mẹ Đẻ (Giải thích & Dịch nghĩa)",
    settings_native_language_desc: "Định nghĩa, bản dịch ví dụ và gợi ý sẽ được giải thích bằng ngôn ngữ này.",
    settings_save_lang: "Lưu Cài Đặt Ngôn Ngữ",
    settings_lang_saved: "Đã cập nhật cài đặt ngôn ngữ thành công!",
    settings_match_native: "Giống Ngôn Ngữ Mẹ Đẻ",
    quiz_definition_prompt: "Từ nào phù hợp với định nghĩa sau đây?",
    quiz_sentence_prompt: "Điền vào chỗ trống trong câu sau:",
    quiz_listening_prompt: "Nghe đoạn âm thanh và chọn từ tương ứng:",
    quiz_picture_prompt: "Từ nào phù hợp với hình ảnh dưới đây?",
    quiz_spelling_prompt: "Nhập từ chính xác mà bạn nghe được hoặc đọc:",
    quiz_feedback_correct: "Chính xác!",
    quiz_feedback_incorrect: "Chưa chính xác! Đáp án đúng là: \"{answer}\"",
    quiz_verify: "Xác Nhận Đáp Án",
    quiz_next: "Câu Tiếp Theo",
    quiz_finish: "Hoàn Thành Quiz",
    quiz_summary_title: "Đã Hoàn Thành Bài Quiz",
    quiz_summary_subtitle: "Phân tích kết quả luyện tập của bạn bên dưới.",
    quiz_no_words_title: "Không Có Từ Nào Cần Ôn Tập Hôn Nay",
    quiz_no_words_desc: "Bạn đã hoàn thành các từ đến lịch ôn tập! Hãy quay lại sau hoặc thêm từ mới.",
    quiz_correct_count: "Số Câu Đúng",
    quiz_accuracy: "Tỷ Lệ Chính Xác",
    quiz_retry_missed: "Làm Lại Các Câu Sai",
    quiz_star_missed: "Đánh Dấu Sao Từ Chưa Đúng",
    quiz_go_back: "Quay Lại",
    quiz_type_answer_placeholder: "Nhập câu trả lời của bạn...",
    word_count: "Từ Vựng",
    streak_days: "Ngày Liên Tục",
    mastered_count: "Đã Thành Thạo",
    studied_count: "Đã Học",
    add_word_btn: "Thêm Từ",
    search_placeholder: "Tìm kiếm từ vựng...",
    ai_coach_title: "Trợ Lý Học Tập AI",
    chat_welcome_msg: "Xin chào! Chào mừng bạn đến với Trợ Lý Học Ngôn Ngữ AI. Tôi ở đây để giúp bạn thành thạo **{target}** từ ngôn ngữ mẹ đẻ **{native}**.\n\nBạn có thể trò chuyện với tôi, yêu cầu tôi dịch cụm từ, giải thích ngữ pháp hoặc giới thiệu từ mới.\n\nHãy thử hỏi tôi: *'Một số thành ngữ phổ biến trong {target} là gì?'* hoặc nhấp vào một trong các thao tác nhanh bên dưới để bắt đầu học!",
    chat_placeholder_adding_word: "Đang thêm từ mới vào bộ từ vựng...",
    chat_placeholder_photo: "Hỏi AI Vision về hình ảnh này hoặc nhấn Gửi để phân tích...",
    chat_placeholder_default: "Hỏi gia sư AI, luyện trò chuyện hoặc yêu cầu nhận xét ngữ pháp...",
    photo_attached: "Ảnh Đã Đính Kèm:",
    photo_suggest_hint: "AI Vision sẽ gợi ý các câu trả lời tự nhiên và từ vựng từ ảnh chụp màn hình này",
    photo_extract_hint: "AI Vision sẽ phân tích và trích xuất từ vựng khi gửi",
    polished_sentence: "Câu Tinh Chỉnh:",
    suggested_replies: "Gợi Ý Trả Lời (Sao Chép Nhanh):",
    audio_clip: "Đoạn Âm Thanh",
    tap_play_audio: "Nhấn phát để nghe phát âm",
    play_clip: "Phát Âm",
    copied: "Đã sao chép!",
    copy: "Sao chép",
    option_label: "Lựa chọn",
    col_filter_placeholder: "Lọc từ vựng theo chính tả, bản dịch hoặc định nghĩa...",
    col_sort_label: "Sắp xếp:",
    col_sort_newest: "Từ mới nhất",
    col_sort_oldest: "Cũ nhất trước",
    col_sort_alpha: "Bảng chữ cái (A-Z)",
    col_sort_unlearned: "Chưa thuộc trước",
    col_no_words_found: "Không Tìm Thấy Từ Vựng Nào",
    col_empty_search: "Không có từ nào khớp với bộ lọc tìm kiếm.",
    col_empty_list: "Bộ từ vựng của bạn đang trống. Thêm từ mới thông qua giao diện Trợ lý AI!",
    col_terms_count: "từ vựng",
    analytics_title: "Phân Tích Từ Vựng AI",
    analytics_headline: "Bảng Phân Tích Hiệu Suất & Thành Thạo",
    analytics_quote: "\"Theo dõi khả năng ghi nhớ, xác định từ yếu cần luyện tập, xem các từ đã thành thạo và nhận đánh giá từ gia sư AI.\"",
    analytics_practice_weak: "Luyện Tập Từ Yếu",
    analytics_analyzing: "Đang Phân Tích...",
    analytics_reanalyze: "Phân Tích Lại Với AI",
    analytics_coach: "Gia Sư Đánh Giá Hiệu Suất AI",
    analytics_mastered_title: "Từ Đã Thành Thạo",
    analytics_improving_title: "Cần Cải Thiện",
    analytics_all_words: "Tất Cả Từ Vựng",
    analytics_improving_words: "Từ Cần Cải Thiện",
    analytics_mastered_words: "Từ Đã Thành Thạo",
    analytics_refresher_due: "Đến Lịch Ôn Tập",
    analytics_starred: "Đã Đánh Dấu Sao",
    analytics_search_placeholder: "Tìm kiếm từ, định nghĩa hoặc bản dịch...",
    analytics_sort_label: "Sắp xếp:",
    analytics_sort_weakest: "Mức độ ghi nhớ thấp nhất trước",
    analytics_sort_highest: "Mức độ ghi nhớ cao nhất trước",
    analytics_sort_alpha: "Bảng chữ cái (A - Z)",
    analytics_sort_recent: "Vừa ôn tập gần đây",
    quick_actions_title: "Thao Tác AI Nhanh",
    quick_actions_search_placeholder: "Tìm thao tác (ví dụ: ngữ pháp, quiz, chủ đề)...",
    quick_cat_all: "Tất Cả Thao Tác",
    quick_cat_writing: "✍️ Viết & Sửa Lỗi",
    quick_cat_study: "🧠 Trắc Nghiệm & Luyện Tập",
    quick_cat_vocab: "📚 Bộ Từ Vựng",
    quick_cat_chat: "💬 Phiên Trò Chuyện",
    quick_all_actions: "Tất Cả Thao Tác",
    quick_close_grid: "Đóng Lưới",
    flashcards_empty_title: "Danh sách từ vựng đang trống",
    flashcards_empty_desc: "Danh sách này chưa có từ nào. Bạn có thể thêm từ thủ công hoặc tạo từ mới với AI.",
    flashcards_back_dash: "Quay Lại Trang Chủ",
    flashcards_card_mode: "Chế Độ Thẻ",
    flashcards_list_mode: "Chế Độ Danh Sách",
    flashcards_click_flip: "Nhấp Để Lật Thẻ",
    flashcards_meaning_trans: "Ý Nghĩa & Bản Dịch",
    flashcards_example_usage: "Ví Dụ Sử Dụng",
    flashcards_memory_strength: "Độ Ghi Nhớ:",
    flashcards_got_it: "Đã Nhớ (+10%)",
    flashcards_practice_btn: "Cần Luyện (-10%)",
    flashcards_mastered: "Thành Thạo",
    flashcards_mark_mastered: "Đánh Dấu Thành Thạo",
    flashcards_previous: "Từ Trước",
    flashcards_next_word: "Từ Tiếp Theo",
    flashcards_take_quiz: "Làm Bài Quiz",
    qa_fix_grammar_label: "Sửa Ngữ Pháp",
    qa_fix_grammar_title: "Sửa Ngữ Pháp & Tinh Chỉnh",
    qa_fix_grammar_desc: "Kiểm tra chính tả, ngữ pháp và cải thiện độ tự nhiên",
    qa_suggest_reply_label: "Gợi Ý Trả Lời",
    qa_suggest_reply_title: "Gợi Ý Trả Lời Tự Nhiên",
    qa_suggest_reply_desc: "Gợi ý câu trả lời và từ vựng từ ảnh chụp màn hình hoặc đoạn chat",
    qa_start_quiz_label: "Làm Bài Quiz",
    qa_start_quiz_title: "Bắt Đầu Bài Quiz Hôm Nay",
    qa_start_quiz_desc: "Thử thách ghi nhớ qua thẻ ghi nhớ tương tác",
    qa_flash_card_label: "Thẻ Ghi Nhớ",
    qa_flash_card_title: "Thẻ Ghi Nhớ AI",
    qa_flash_card_desc: "Luyện tập từ vựng dạng thẻ ghi nhớ AI tương tác có phát âm",
    qa_generate_words_label: "Tạo Từ Vựng",
    qa_generate_words_title: "Tạo Bộ Từ Vựng",
    qa_generate_words_desc: "Xây dựng từ vựng theo chủ đề du lịch, công việc hoặc tùy chỉnh",
    qa_add_word_label: "Thêm Từ Mới",
    qa_add_word_title: "Thêm Từ Vào Bộ Từ Vựng",
    qa_add_word_desc: "Thêm từ mới thủ công kèm ghi chú và định nghĩa",
    qa_interactive_prompts_label: "Gợi Ý AI Tương Tác",
    qa_interactive_prompts_title: "Gia Sư Ngôn Ngữ Tương Tác",
    qa_interactive_prompts_desc: "Yêu cầu AI hướng dẫn ngữ pháp, dịch thuật hoặc mẫu câu tình huống",
    qa_explain_grammar_label: "Giải Thích Ngữ Pháp",
    qa_explain_grammar_title: "Giải Thích Quy Tắc Ngữ Pháp",
    qa_explain_grammar_desc: "Yêu cầu gia sư AI giải thích ngữ pháp bằng tiếng mẹ đẻ",
    qa_common_phrases_label: "Cụm Từ Phổ Biến",
    qa_common_phrases_title: "Cụm Từ & Thành Ngữ Phổ Biến",
    qa_common_phrases_desc: "Học các mẫu câu giao tiếp và thành ngữ thông dụng theo chủ đề",
    qa_translate_contrast_label: "Dịch & So Sánh",
    qa_translate_contrast_title: "Dịch & So Sánh Sắc Thái",
    qa_translate_contrast_desc: "So sánh sắc thái giữa câu tiếng mẹ đẻ và ngôn ngữ đang học",
    qa_new_chat_label: "Bắt Đầu Chat Mới",
    qa_new_chat_title: "Tạo Phiên Trò Chuyện Mới",
    qa_new_chat_desc: "Xóa lịch sử đoạn chat hiện tại và bắt đầu lại",
    qa_cat_writing: "Sửa Lỗi",
    qa_cat_study: "Luyện Tập",
    qa_cat_vocab: "Từ Vựng",
    qa_cat_chat: "Trò Chuyện",
    action_add_to_col: "Thêm \"{word}\" vào bộ từ vựng",
    action_confirm_add: "➕ Xác nhận & Thêm \"{word}\" ({translation})",
    action_next_flashcard: "🃏 Thẻ Ghi Nhớ Tiếp Theo",
    action_suggest_another: "💬 Gợi Ý Câu Trả Lời Khác"
  },
  es: {
    app_title: "Aprende Vocabulario AI",
    nav_collection: "Colección",
    nav_analytics: "Análisis",
    nav_settings: "Ajustes",
    nav_dashboard: "Inicio",
    nav_chat: "Tutor AI",
    nav_flashcards: "Tarjetas",
    nav_quiz: "Cuestionario",
    settings_language_title: "Preferencias de Idioma e Interfaz",
    settings_language_desc: "Configura el Idioma de la Aplicación, el Idioma de Aprendizaje y tu Idioma Nativo.",
    settings_app_language: "Idioma de la Aplicación (Interfaz y Voz de Cuestionario)",
    settings_app_language_desc: "Idioma de la interfaz. La voz de las preguntas del cuestionario y la retroalimentación seguirá este idioma.",
    settings_target_language: "Idioma Objetivo (Idioma a Aprender)",
    settings_target_language_desc: "Las palabras y pronunciaciones se estudiarán en este idioma.",
    settings_native_language: "Idioma Nativo (Explicaciones y Traducciones)",
    settings_native_language_desc: "Las definiciones y traducciones se explicarán en este idioma.",
    settings_save_lang: "Guardar Preferencias de Idioma",
    settings_lang_saved: "¡Preferencias de idioma guardadas con éxito!",
    settings_match_native: "Usar Idioma Nativo",
    quiz_definition_prompt: "¿Qué palabra coincide con la siguiente definición?",
    quiz_sentence_prompt: "Completa el espacio en blanco de la oración:",
    quiz_listening_prompt: "Escucha el audio y selecciona la palabra correcta:",
    quiz_picture_prompt: "¿Qué palabra coincide con la imagen mostrada?",
    quiz_spelling_prompt: "Escribe la palabra correcta que escuchas o lees:",
    quiz_feedback_correct: "¡Correcto!",
    quiz_feedback_incorrect: "¡Incorrecto! La respuesta correcta es: \"{answer}\"",
    quiz_verify: "Verificar Respuesta",
    quiz_next: "Siguiente Pregunta",
    quiz_finish: "Finalizar Cuestionario",
    quiz_summary_title: "Cuestionario Completado",
    quiz_summary_subtitle: "Análisis de rendimiento completado. Revisa tus resultados a continuación.",
    quiz_no_words_title: "Sin Palabras para Practicar Hoy",
    quiz_no_words_desc: "¡Has repasado todo el vocabulario programado para hoy! Vuelve más tarde o añade nuevas palabras.",
    quiz_correct_count: "Respuestas Correctas",
    quiz_accuracy: "Tasa de Acierto",
    quiz_retry_missed: "Reintentar Falladas",
    quiz_star_missed: "Marcar Falladas con Estrella",
    quiz_go_back: "Volver",
    quiz_type_answer_placeholder: "Escribe tu respuesta aquí...",
    word_count: "Palabras",
    streak_days: "Días Seguidos",
    mastered_count: "Dominadas",
    studied_count: "Estudiadas",
    add_word_btn: "Añadir Palabra",
    search_placeholder: "Buscar vocabulario...",
    ai_coach_title: "Compañero de Estudio AI"
  },
  fr: {
    app_title: "Apprendre le Vocabulaire AI",
    nav_collection: "Collection",
    nav_analytics: "Analyses",
    nav_settings: "Paramètres",
    nav_dashboard: "Accueil",
    nav_chat: "Tuteur IA",
    nav_flashcards: "Cartes",
    nav_quiz: "Quiz de Pratique",
    settings_language_title: "Préférences de Langue et d'Interface",
    settings_language_desc: "Configurez la langue de l'application, la langue cible et votre langue maternelle.",
    settings_app_language: "Langue de l'Application (Interface et Synthèse Vocale du Quiz)",
    settings_app_language_desc: "Langue de l'interface. La lecture vocale des questions et réponses du quiz suivra cette langue.",
    settings_target_language: "Langue Cible (Langue à Apprendre)",
    settings_target_language_desc: "Le vocabulaire et la prononciation seront étudiés dans cette langue.",
    settings_native_language: "Langue Maternelle (Explications et Traductions)",
    settings_native_language_desc: "Les définitions et traductions seront expliquées dans cette langue.",
    settings_save_lang: "Enregistrer les Préférences",
    settings_lang_saved: "Préférences de langue enregistrées !",
    settings_match_native: "Identique à la Langue Maternelle",
    quiz_definition_prompt: "Quel mot correspond à la définition suivante ?",
    quiz_sentence_prompt: "Remplissez le blanc dans la phrase :",
    quiz_listening_prompt: "Écoutez l'extrait audio et sélectionnez le bon mot :",
    quiz_picture_prompt: "Quel mot correspond à l'image ci-dessous ?",
    quiz_spelling_prompt: "Écrivez le mot exact que vous entendez ou lisez :",
    quiz_feedback_correct: "Correct !",
    quiz_feedback_incorrect: "Incorrect ! La bonne réponse est : \"{answer}\"",
    quiz_verify: "Vérifier la Réponse",
    quiz_next: "Question Suivante",
    quiz_finish: "Terminer le Quiz",
    quiz_summary_title: "Quiz Terminé",
    quiz_summary_subtitle: "Analyse des performances terminée. Consultez vos résultats ci-dessous.",
    quiz_no_words_title: "Aucun Mot à Réviser Aujourd'hui",
    quiz_no_words_desc: "Vous avez révisé tous vos mots récents ! Revenez plus tard ou ajoutez de nouveaux mots.",
    quiz_correct_count: "Réponses Correctes",
    quiz_accuracy: "Taux de Réussite",
    quiz_retry_missed: "Rejouer les Erreurs",
    quiz_star_missed: "Ajouter une Étoile aux Erreurs",
    quiz_go_back: "Retour",
    quiz_type_answer_placeholder: "Écrivez votre réponse ici...",
    word_count: "Mots",
    streak_days: "Jours Conformatifs",
    mastered_count: "Maîtrisés",
    studied_count: "Étudiés",
    add_word_btn: "Ajouter un Mot",
    search_placeholder: "Rechercher du vocabulaire...",
    ai_coach_title: "Compagnon d'Étude IA"
  },
  de: {
    app_title: "Wortschatz Lernen KI",
    nav_collection: "Sammlung",
    nav_analytics: "Analysen",
    nav_settings: "Einstellungen",
    nav_dashboard: "Übersicht",
    nav_chat: "KI-Tutor",
    nav_flashcards: "Karteikarten",
    nav_quiz: "Übungsquiz",
    settings_language_title: "Sprach- und Oberflächeneinstellungen",
    settings_language_desc: "Konfigurieren Sie App-Sprache, Zielsprache und Muttersprache.",
    settings_app_language: "App-Sprache (Benutzeroberfläche & Quiz-Sprachausgabe)",
    settings_app_language_desc: "Sprache der App-Oberfläche. Die Sprachausgabe für Quizfragen und Feedback folgt dieser Sprache.",
    settings_target_language: "Zielsprache (Zu lernende Sprache)",
    settings_target_language_desc: "Vokabeln und Aussprache werden in dieser Sprache gelernt.",
    settings_native_language: "Muttersprache (Erklärungen & Übersetzungen)",
    settings_native_language_desc: "Definitionen und Beispiele werden in dieser Sprache erklärt.",
    settings_save_lang: "Spracheinstellungen Speichern",
    settings_lang_saved: "Spracheinstellungen erfolgreich gespeichert!",
    settings_match_native: "An Muttersprache Anpassen",
    quiz_definition_prompt: "Welches Wort passt zu folgender Definition?",
    quiz_sentence_prompt: "Fülle die Lücke im Satz aus:",
    quiz_listening_prompt: "Höre die Audiodatei an und wähle das passende Wort:",
    quiz_picture_prompt: "Welches Wort passt zu diesem Bild?",
    quiz_spelling_prompt: "Schreibe das richtige Wort auf:",
    quiz_feedback_correct: "Richtig!",
    quiz_feedback_incorrect: "Falsch! Die richtige Antwort lautet: \"{answer}\"",
    quiz_verify: "Antwort Überprüfen",
    quiz_next: "Nächste Frage",
    quiz_finish: "Quiz Beenden",
    quiz_summary_title: "Quiz Abgeschlossen",
    quiz_summary_subtitle: "Leistungsanalyse abgeschlossen. Siehe Ergebnisse unten.",
    quiz_no_words_title: "Keine Wörter zum Üben Heute",
    quiz_no_words_desc: "Alle fälligen Vokabeln wurden wiederholt! Komme später zurück oder füge neue Wörter hinzu.",
    quiz_correct_count: "Richtige Antworten",
    quiz_accuracy: "Genauigkeit",
    quiz_retry_missed: "Falsche Fragen Wiederholen",
    quiz_star_missed: "Falsche Wörter Markieren",
    quiz_go_back: "Zurück",
    quiz_type_answer_placeholder: "Antwort hier eingeben...",
    word_count: "Wörter",
    streak_days: "Tage Serie",
    mastered_count: "Gemeistert",
    studied_count: "Gelernt",
    add_word_btn: "Wort Hinzufügen",
    search_placeholder: "Vokabeln suchen...",
    ai_coach_title: "KI-Lernbegleiter"
  },
  ja: {
    app_title: "AI単語学習",
    nav_collection: "単語帳",
    nav_analytics: "分析",
    nav_settings: "設定",
    nav_dashboard: "ダッシュボード",
    nav_chat: "AIチューター",
    nav_flashcards: "単語カード",
    nav_quiz: "小テスト",
    settings_language_title: "言語・インターフェース設定",
    settings_language_desc: "アプリの言語、学習対象言語、母国語を設定します。",
    settings_app_language: "アプリ言語 (画面表示 & クイズ音声)",
    settings_app_language_desc: "アプリの表示言語です。クイズの問題文および正解/不正解の音声読み上げもこの言語で行われます。",
    settings_target_language: "学習対象言語 (Target Language)",
    settings_target_language_desc: "単語や発音はこの言語で学習します。",
    settings_native_language: "母国語 (解説・翻訳言語)",
    settings_native_language_desc: "定義や例文の翻訳はこの言語で表示されます。",
    settings_save_lang: "言語設定を保存",
    settings_lang_saved: "言語設定を保存しました！",
    settings_match_native: "母国語に合わせる",
    quiz_definition_prompt: "次の定義に該当する単語を選んでください：",
    quiz_sentence_prompt: "文の空欄に当てはまる単語を選んでください：",
    quiz_listening_prompt: "音声を聞いて正解の単語を選んでください：",
    quiz_picture_prompt: "以下の画像を表す単語を選んでください：",
    quiz_spelling_prompt: "聞こえた、または正しい単語を入力してください：",
    quiz_feedback_correct: "正解です！",
    quiz_feedback_incorrect: "不正解です！正解は: 「{answer}」",
    quiz_verify: "回答を確認",
    quiz_next: "次の問題",
    quiz_finish: "クイズ完了",
    quiz_summary_title: "クイズ完了！",
    quiz_summary_subtitle: "成績分析が完了しました。以下で結果を確認してください。",
    quiz_no_words_title: "本日復習する単語はありません",
    quiz_no_words_desc: "最近すべての対象単語を復習しました！また後で確認するか、新しい単語を追加してください。",
    quiz_correct_count: "正解数",
    quiz_accuracy: "正解率",
    quiz_retry_missed: "間違えた問題を再挑戦",
    quiz_star_missed: "間違えた単語にスターを付ける",
    quiz_go_back: "戻る",
    quiz_type_answer_placeholder: "回答を入力してください...",
    word_count: "単語数",
    streak_days: "連続学習日数",
    mastered_count: "習得済み",
    studied_count: "学習済み",
    add_word_btn: "単語を追加",
    search_placeholder: "単語を検索...",
    ai_coach_title: "AI学習パートナー"
  },
  zh: {
    app_title: "AI 词汇学堂",
    nav_collection: "词汇本",
    nav_analytics: "数据分析",
    nav_settings: "应用设置",
    nav_dashboard: "首页",
    nav_chat: "AI 导师",
    nav_flashcards: "记忆卡片",
    nav_quiz: "单元测验",
    settings_language_title: "语言与界面偏好设置",
    settings_language_desc: "设置应用界面语言、目标学习语言及母语解释语言。",
    settings_app_language: "应用界面语言 (UI 及测验语音)",
    settings_app_language_desc: "应用界面的显示语言。测验题目与回答反馈语音将跟随此语言。",
    settings_target_language: "目标学习语言 (Target Language)",
    settings_target_language_desc: "生词、发音与记忆卡片将基于此语言进行练习。",
    settings_native_language: "母语 (解释与翻译语言)",
    settings_native_language_desc: "释义、例句翻译与提示将以此语言呈现。",
    settings_save_lang: "保存语言偏好",
    settings_lang_saved: "语言设置已成功保存！",
    settings_match_native: "与母语保持一致",
    quiz_definition_prompt: "请选择与以下释义匹配的词汇：",
    quiz_sentence_prompt: "请在句子填空处选择正确的词汇：",
    quiz_listening_prompt: "请听录音并选择对应的正确词汇：",
    quiz_picture_prompt: "请选择与下图含义匹配的词汇：",
    quiz_spelling_prompt: "请输入你听到的正确词汇：",
    quiz_feedback_correct: "回答正确！",
    quiz_feedback_incorrect: "回答错误！正确答案是：\"{answer}\"",
    quiz_verify: "验证答案",
    quiz_next: "下一题",
    quiz_finish: "完成测验",
    quiz_summary_title: "测验已完成！",
    quiz_summary_subtitle: "学习表现分析已生成，请在下方查看测验结果。",
    quiz_no_words_title: "今日暂无待复习词汇",
    quiz_no_words_desc: "你已复习完近期所有需复习的词汇！请稍后再试或添加新词汇。",
    quiz_correct_count: "答对题数",
    quiz_accuracy: "正确率",
    quiz_retry_missed: "重做错题",
    quiz_star_missed: "加星标标记错词",
    quiz_go_back: "返回",
    quiz_type_answer_placeholder: "在此输入你的答案...",
    word_count: "词汇总量",
    streak_days: "连续学习天数",
    mastered_count: "已精通",
    studied_count: "已学习",
    add_word_btn: "添加词汇",
    search_placeholder: "搜索词汇...",
    ai_coach_title: "AI 学习助手"
  },
  ko: {
    app_title: "AI 어휘 학습기",
    nav_collection: "단어장",
    nav_analytics: "학습 분석",
    nav_settings: "설정",
    nav_dashboard: "홈",
    nav_chat: "AI 튜터",
    nav_flashcards: "플래시카드",
    nav_quiz: "퀴즈 연습",
    settings_language_title: "언어 및 인터페이스 설정",
    settings_language_desc: "앱 언어, 학습 목표 언어 및 모국어 설정을 지정합니다.",
    settings_app_language: "앱 언어 (UI 및 퀴즈 음성)",
    settings_app_language_desc: "앱 인터페이스 언어입니다. 퀴즈 질문 및 정답/오답 안내 음성이 이 언어로 재생됩니다.",
    settings_target_language: "학습 목표 언어 (Target Language)",
    settings_target_language_desc: "단어, 발음 및 학습 카드가 이 언어로 구성됩니다.",
    settings_native_language: "모국어 (설명 및 번역 언어)",
    settings_native_language_desc: "단어 뜻, 예문 번역 및 힌트가 이 언어로 설명됩니다.",
    settings_save_lang: "언어 설정 저장",
    settings_lang_saved: "언어 설정이 성공적으로 저장되었습니다!",
    settings_match_native: "모국어와 동일하게 설정",
    quiz_definition_prompt: "다음 뜻에 해당하는 단어를 선택하세요:",
    quiz_sentence_prompt: "문장의 빈칸에 들어갈 올바른 단어를 선택하세요:",
    quiz_listening_prompt: "음성을 듣고 올바른 단어를 선택하세요:",
    quiz_picture_prompt: "아래 이미지에 해당하는 단어를 선택하세요:",
    quiz_spelling_prompt: "들리는 단어의 올바른 철자를 입력하세요:",
    quiz_feedback_correct: "정답입니다!",
    quiz_feedback_incorrect: "오답입니다! 정답은: \"{answer}\"",
    quiz_verify: "정답 확인",
    quiz_next: "다음 문제",
    quiz_finish: "퀴즈 완료",
    quiz_summary_title: "퀴즈 완료!",
    quiz_summary_subtitle: "학습 성과 분석이 완료되었습니다. 아래 결과를 확인하세요.",
    quiz_no_words_title: "오늘 복습할 단어가 없습니다",
    quiz_no_words_desc: "최근 복습할 모든 단어를 이미 학습하셨습니다! 나중에 다시 시도하거나 새 단어를 추가하세요.",
    quiz_correct_count: "맞힌 개수",
    quiz_accuracy: "정답률",
    quiz_retry_missed: "틀린 문제 다시 풀기",
    quiz_star_missed: "틀린 단어 즐겨찾기 추가",
    quiz_go_back: "돌아가기",
    quiz_type_answer_placeholder: "정답을 입력하세요...",
    word_count: "단어 수",
    streak_days: "연속 학습일",
    mastered_count: "마스터함",
    studied_count: "학습함",
    add_word_btn: "단어 추가",
    search_placeholder: "단어 검색...",
    ai_coach_title: "AI 학습 도우미"
  }
};

/**
 * Main translation retrieval function
 */
export function t(key: TranslationKey, langNameOrCode?: string, params?: Record<string, string>): string {
  const normKey = normalizeLangKey(langNameOrCode);
  const dict = translations[normKey] || translations["en"];
  let text = dict[key] || translations["en"][key] || key;

  if (params) {
    Object.entries(params).forEach(([paramKey, paramVal]) => {
      text = text.replace(new RegExp(`\\{${paramKey}\\}`, "g"), paramVal);
    });
  }

  return text;
}
