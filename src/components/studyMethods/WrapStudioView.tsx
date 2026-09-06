import { useState, useEffect } from "react";
import { 
  Zap, 
  Sparkles, 
  PenTool, 
  Volume2, 
  Heart, 
  Image as ImageIcon, 
  Send, 
  CheckCircle2, 
  MessageSquare, 
  Trophy, 
  Check 
} from "lucide-react";
import { Word, SentenceEvaluation, TargetWordMission, TTSConfig, LLMConfig } from "../../types";
import { 
  evaluatePersonalSentenceService, 
  generateTargetWordMissionService 
} from "../../services/studyMethodsService";
import { speakText } from "../../utils/ttsService";

interface WrapStudioViewProps {
  words: Word[];
  targetLanguage: string;
  nativeLanguage: string;
  appLanguage?: string;
  ttsConfig?: TTSConfig;
  llmConfig?: LLMConfig;
  onUpdateWords?: (updated: Word[]) => void;
}

export default function WrapStudioView({
  words,
  targetLanguage,
  nativeLanguage,
  appLanguage: _appLanguage = "Vietnamese",
  ttsConfig,
  llmConfig,
  onUpdateWords: _onUpdateWords
}: WrapStudioViewProps) {
  const [activeTab, setActiveTab] = useState<"wrap" | "sentence" | "mission">("sentence");

  // WRAP Flow State
  const [currentWrapWordIndex, setCurrentWrapWordIndex] = useState(0);
  const [wrapWrittenInput, setWrapWrittenInput] = useState("");
  const [wrapAssociationInput, setWrapAssociationInput] = useState("");
  const [wrapPictureInput, setWrapPictureInput] = useState("");
  const [wrapStep, setWrapStep] = useState<1 | 2 | 3 | 4>(1); // 1: Write, 2: Repeat, 3: Associate, 4: Picture
  const [wrapCompletedCount, setWrapCompletedCount] = useState(0);

  // Personal Sentence Producer State
  const [sentenceWord, setSentenceWord] = useState<Word | null>(null);
  const [userSentenceInput, setUserSentenceInput] = useState("");
  const [isEvaluatingSentence, setIsEvaluatingSentence] = useState(false);
  const [sentenceEvaluation, setSentenceEvaluation] = useState<SentenceEvaluation | null>(null);

  // Target Word Mission State
  const [activeMission, setActiveMission] = useState<TargetWordMission | null>(null);
  const [isGeneratingMission, setIsGeneratingMission] = useState(false);
  const [missionChatMessages, setMissionChatMessages] = useState<{ role: "ai" | "user"; text: string }[]>([]);
  const [missionUserInput, setMissionUserInput] = useState("");

  useEffect(() => {
    if (words.length > 0 && !sentenceWord) {
      const candidate = words.find(w => !w.learned || w.starred) || words[0];
      setSentenceWord(candidate);
    }
  }, [words, sentenceWord]);

  const currentWrapWord = words[currentWrapWordIndex] || words[0] || null;

  const speak = (text: string) => {
    if (!text) return;
    speakText(text, ttsConfig, llmConfig, targetLanguage);
  };

  // Handle Evaluate Sentence
  const handleEvaluatePersonalSentence = async () => {
    if (!sentenceWord || !userSentenceInput.trim()) return;

    setIsEvaluatingSentence(true);
    setSentenceEvaluation(null);
    try {
      const evalResult = await evaluatePersonalSentenceService({
        word: sentenceWord,
        userSentence: userSentenceInput.trim(),
        targetLanguage,
        nativeLanguage,
        cfg: llmConfig
      });
      setSentenceEvaluation(evalResult);
    } catch (e) {
      console.error("Sentence evaluation failed:", e);
    } finally {
      setIsEvaluatingSentence(false);
    }
  };

  // Handle Mission Creation
  const handleCreateMission = async () => {
    setIsGeneratingMission(true);
    try {
      const targetWordsPool = words.filter(w => !w.learned || w.starred).slice(0, 4);
      const mission = await generateTargetWordMissionService({
        targetWords: targetWordsPool.length > 0 ? targetWordsPool : words.slice(0, 4),
        targetLanguage,
        nativeLanguage,
        cfg: llmConfig
      });
      setActiveMission(mission);
      setMissionChatMessages([{ role: "ai", text: mission.suggestedOpening }]);
    } catch (e) {
      console.error("Failed to generate mission:", e);
    } finally {
      setIsGeneratingMission(false);
    }
  };

  const handleSendMissionMessage = () => {
    if (!missionUserInput.trim() || !activeMission) return;
    const userText = missionUserInput.trim();
    const nextMessages = [...missionChatMessages, { role: "user" as const, text: userText }];
    setMissionChatMessages(nextMessages);
    setMissionUserInput("");

    // Check which target words were used in user's message
    const updatedTargetWords = activeMission.targetWords.map(tw => {
      if (userText.toLowerCase().includes(tw.word.toLowerCase())) {
        return { ...tw, used: true };
      }
      return tw;
    });
    setActiveMission({ ...activeMission, targetWords: updatedTargetWords });

    // Simulate AI response continuing the roleplay scenario
    setTimeout(() => {
      setMissionChatMessages(prev => [
        ...prev,
        {
          role: "ai",
          text: `Thank you for sharing! That makes complete sense. How should we proceed with the next detail?`
        }
      ]);
    }, 800);
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-white border border-stone-200 p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-md bg-emerald-100 text-emerald-900 flex items-center justify-center font-bold text-xs font-serif">
              4
            </span>
            <h3 className="text-lg font-bold text-stone-900">Deep Processing & WRAP Studio</h3>
            <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 font-semibold">
              Active Production & Nuance Coaching
            </span>
          </div>
          <p className="text-xs sm:text-sm text-stone-600 max-w-2xl leading-relaxed">
            Cognitive psychology shows that the depth of mental processing determines long-term retention. 
            Write original sentences about your real life, get AI nuance coaching, and complete conversational missions.
          </p>
        </div>

        {/* Sub-tab Navigation */}
        <div className="flex bg-stone-100 p-1 rounded-lg border border-stone-200 shrink-0 self-start md:self-center">
          <button
            type="button"
            onClick={() => setActiveTab("sentence")}
            className={`px-3 py-1.5 text-xs font-bold rounded-md flex items-center gap-1.5 transition-all cursor-pointer ${
              activeTab === "sentence" ? "bg-white text-stone-950 shadow-xs" : "text-stone-600 hover:text-stone-950"
            }`}
          >
            <PenTool className="w-3.5 h-3.5 text-emerald-600" />
            <span>Personal Sentence Coach</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("wrap")}
            className={`px-3 py-1.5 text-xs font-bold rounded-md flex items-center gap-1.5 transition-all cursor-pointer ${
              activeTab === "wrap" ? "bg-white text-stone-950 shadow-xs" : "text-stone-600 hover:text-stone-950"
            }`}
          >
            <Zap className="w-3.5 h-3.5 text-amber-600" />
            <span>WRAP Flow</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("mission")}
            className={`px-3 py-1.5 text-xs font-bold rounded-md flex items-center gap-1.5 transition-all cursor-pointer ${
              activeTab === "mission" ? "bg-white text-stone-950 shadow-xs" : "text-stone-600 hover:text-stone-950"
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5 text-sky-600" />
            <span>Mission Chat</span>
          </button>
        </div>
      </div>

      {/* Tab 1: Personal Sentence Coach */}
      {activeTab === "sentence" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Target Word Picker & Input */}
          <div className="lg:col-span-2 bg-white border border-stone-200 rounded-2xl p-5 sm:p-6 space-y-5 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-stone-100">
              <div>
                <h4 className="text-sm font-bold text-stone-900">Personal Sentence Challenge</h4>
                <p className="text-xs text-stone-500">
                  Write 1–2 sentences about your real life or daily habits using the target word.
                </p>
              </div>

              {/* Word Switcher */}
              <div className="flex items-center gap-2">
                <select
                  value={sentenceWord?.id || ""}
                  onChange={(e) => {
                    const w = words.find(item => item.id === e.target.value) || null;
                    setSentenceWord(w);
                    setUserSentenceInput("");
                    setSentenceEvaluation(null);
                  }}
                  className="text-xs font-bold p-2 rounded-lg border border-stone-200 bg-white"
                >
                  {words.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.word} ({w.translation})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Target Word Focus Banner */}
            {sentenceWord && (
              <div className="bg-emerald-50/50 p-4 rounded-xl border border-emerald-100 flex items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl font-black text-stone-950 font-serif">
                      {sentenceWord.word}
                    </span>
                    <span className="text-xs font-mono text-stone-400">
                      {sentenceWord.pronunciation || ""} • {sentenceWord.partOfSpeech}
                    </span>
                  </div>
                  <p className="text-xs text-emerald-900 font-serif font-bold">
                    Meaning: "{sentenceWord.translation}"
                  </p>
                  {sentenceWord.example && (
                    <p className="text-[11px] text-stone-500 italic">
                      Context hint: "{sentenceWord.example}"
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => speak(sentenceWord.word)}
                  className="p-2.5 rounded-full bg-white border border-emerald-200 hover:bg-emerald-100 text-emerald-900 transition-colors shadow-2xs"
                  title="Listen pronunciation"
                >
                  <Volume2 className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Input Form */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-stone-800">
                Your Personal Sentence in {targetLanguage}:
              </label>
              <textarea
                value={userSentenceInput}
                onChange={(e) => setUserSentenceInput(e.target.value)}
                placeholder={`e.g. When I visited the coffee shop yesterday, I noticed how ${sentenceWord?.word || "this word"}...`}
                rows={4}
                className="w-full text-xs sm:text-sm p-3.5 rounded-xl border border-stone-200 focus:border-stone-900 outline-none leading-relaxed resize-none bg-stone-50/30"
              />
              <div className="flex items-center justify-between text-[11px] text-stone-400 font-mono">
                <span>Personal connection = 5x stronger recall</span>
                <span>{userSentenceInput.trim().split(/\s+/).filter(Boolean).length} words</span>
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="button"
              disabled={isEvaluatingSentence || !userSentenceInput.trim()}
              onClick={handleEvaluatePersonalSentence}
              className="w-full py-3 rounded-xl bg-stone-900 hover:bg-black text-amber-300 font-bold text-xs flex items-center justify-center gap-2 shadow-xs cursor-pointer disabled:opacity-50 transition-all"
            >
              {isEvaluatingSentence ? (
                <>
                  <Sparkles className="w-4 h-4 animate-spin text-amber-400" />
                  <span>Evaluating Grammar & Nuance...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 text-amber-400" />
                  <span>Submit for AI Nuance Coaching</span>
                </>
              )}
            </button>
          </div>

          {/* AI Coach Feedback Card */}
          <div className="lg:col-span-1 bg-white border border-stone-200 rounded-2xl p-5 sm:p-6 space-y-4 shadow-xs">
            <h4 className="text-xs font-bold uppercase tracking-wider text-stone-900 font-mono flex items-center gap-1.5">
              <Trophy className="w-4 h-4 text-amber-500" /> AI Coach Feedback
            </h4>

            {sentenceEvaluation ? (
              <div className="space-y-4 text-xs animate-in fade-in duration-200">
                {/* Score & Badge */}
                <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-between">
                  <div>
                    <span className="text-[10px] font-mono text-emerald-800 font-bold uppercase">
                      Naturalness Score
                    </span>
                    <h5 className="text-2xl font-black text-emerald-950 font-mono">
                      {sentenceEvaluation.score} / 100
                    </h5>
                  </div>
                  <span className="text-xs px-2.5 py-1 rounded-full bg-white text-emerald-900 border border-emerald-300 font-bold">
                    {sentenceEvaluation.naturalness}
                  </span>
                </div>

                {/* Coaching Critique */}
                <div className="space-y-1">
                  <span className="text-[11px] font-bold text-stone-700 uppercase font-mono">Feedback:</span>
                  <p className="text-stone-700 leading-relaxed bg-stone-50 p-3 rounded-lg border border-stone-100">
                    {sentenceEvaluation.feedback}
                  </p>
                </div>

                {/* Polished Native Version */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-stone-700 uppercase font-mono">Polished Version:</span>
                    <button
                      type="button"
                      onClick={() => speak(sentenceEvaluation.polishedSentence)}
                      className="p-1 text-stone-400 hover:text-stone-900"
                      title="Listen polished sentence"
                    >
                      <Volume2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <p className="text-stone-900 font-serif font-bold italic bg-amber-50/50 p-3 rounded-lg border border-amber-200/80">
                    "{sentenceEvaluation.polishedSentence}"
                  </p>
                </div>

                {/* Collocation Tips */}
                {sentenceEvaluation.collocationTips && (
                  <div className="space-y-1">
                    <span className="text-[11px] font-bold text-stone-700 uppercase font-mono">Natural Collocations:</span>
                    <p className="text-stone-600 text-[11px] bg-sky-50/50 p-2.5 rounded-lg border border-sky-100">
                      {sentenceEvaluation.collocationTips}
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="py-16 text-center space-y-2 border border-dashed border-stone-200 rounded-xl">
                <PenTool className="w-8 h-8 text-stone-300 mx-auto" />
                <p className="text-xs text-stone-500 font-medium">Ready for your sentence</p>
                <p className="text-[11px] text-stone-400 px-4">
                  Write a sentence in {targetLanguage} and click submit to receive instant scoring and polish!
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 2: WRAP Method Flow (Write, Repeat, Associate, Picture) */}
      {activeTab === "wrap" && currentWrapWord && (
        <div className="max-w-2xl mx-auto bg-white border border-stone-200 rounded-2xl p-6 sm:p-8 space-y-6 shadow-xs">
          {/* WRAP Step Breadcrumbs */}
          <div className="flex items-center justify-between pb-4 border-b border-stone-100">
            <div className="flex items-center gap-3">
              {[
                { num: 1, label: "Write", icon: PenTool },
                { num: 2, label: "Repeat", icon: Volume2 },
                { num: 3, label: "Associate", icon: Heart },
                { num: 4, label: "Picture", icon: ImageIcon }
              ].map((step) => {
                const isCurrent = wrapStep === step.num;
                const isPast = wrapStep > step.num;
                return (
                  <div key={step.num} className="flex items-center gap-1.5">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center font-mono font-bold text-xs ${
                      isCurrent ? "bg-stone-900 text-amber-300" : isPast ? "bg-emerald-600 text-white" : "bg-stone-100 text-stone-400"
                    }`}>
                      {isPast ? <Check className="w-3.5 h-3.5" /> : step.num}
                    </div>
                    <span className={`text-xs font-bold hidden sm:inline ${isCurrent ? "text-stone-900" : "text-stone-400"}`}>
                      {step.label}
                    </span>
                  </div>
                );
              })}
            </div>
            {wrapCompletedCount > 0 && (
              <span className="text-[11px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                {wrapCompletedCount} Mastered
              </span>
            )}
          </div>

          {/* Current Word Display */}
          <div className="text-center space-y-2 py-2">
            <h3 className="text-3xl font-black text-stone-950 font-serif">
              {currentWrapWord.word}
            </h3>
            <p className="text-sm font-serif font-bold text-amber-900">
              "{currentWrapWord.translation}"
            </p>
          </div>

          {/* Step 1: WRITE */}
          {wrapStep === 1 && (
            <div className="space-y-4">
              <div className="p-3 bg-stone-50 rounded-xl border border-stone-100 text-xs text-stone-600">
                <strong>Step 1 (Write):</strong> Manually type the target word to build motor memory.
              </div>
              <input
                type="text"
                value={wrapWrittenInput}
                onChange={(e) => setWrapWrittenInput(e.target.value)}
                placeholder={`Type "${currentWrapWord.word}" here...`}
                className="w-full text-base font-bold text-center p-3 rounded-xl border border-stone-200 focus:border-stone-900 outline-none"
              />
              <button
                type="button"
                disabled={wrapWrittenInput.trim().toLowerCase() !== currentWrapWord.word.toLowerCase()}
                onClick={() => setWrapStep(2)}
                className="w-full py-2.5 rounded-xl bg-stone-900 text-amber-300 font-bold text-xs disabled:opacity-40 cursor-pointer"
              >
                Next: Repeat Audio →
              </button>
            </div>
          )}

          {/* Step 2: REPEAT */}
          {wrapStep === 2 && (
            <div className="space-y-4 text-center">
              <div className="p-3 bg-stone-50 rounded-xl border border-stone-100 text-xs text-stone-600">
                <strong>Step 2 (Repeat):</strong> Listen to the native pronunciation and repeat aloud 3 times.
              </div>
              <button
                type="button"
                onClick={() => speak(currentWrapWord.word)}
                className="p-4 rounded-full bg-amber-100 hover:bg-amber-200 text-amber-950 mx-auto transition-colors cursor-pointer shadow-xs"
              >
                <Volume2 className="w-6 h-6" />
              </button>
              <button
                type="button"
                onClick={() => setWrapStep(3)}
                className="w-full py-2.5 rounded-xl bg-stone-900 text-amber-300 font-bold text-xs cursor-pointer"
              >
                Next: Personal Association →
              </button>
            </div>
          )}

          {/* Step 3: ASSOCIATE */}
          {wrapStep === 3 && (
            <div className="space-y-4">
              <div className="p-3 bg-stone-50 rounded-xl border border-stone-100 text-xs text-stone-600">
                <strong>Step 3 (Associate):</strong> What personal memory, friend, or routine does this word remind you of?
              </div>
              <textarea
                value={wrapAssociationInput}
                onChange={(e) => setWrapAssociationInput(e.target.value)}
                placeholder="e.g. Reminds me of my trip to Hanoi when I ordered iced coffee..."
                rows={3}
                className="w-full text-xs p-3 rounded-xl border border-stone-200 focus:border-stone-900 outline-none resize-none"
              />
              <button
                type="button"
                disabled={!wrapAssociationInput.trim()}
                onClick={() => setWrapStep(4)}
                className="w-full py-2.5 rounded-xl bg-stone-900 text-amber-300 font-bold text-xs disabled:opacity-40 cursor-pointer"
              >
                Next: Picture It →
              </button>
            </div>
          )}

          {/* Step 4: PICTURE */}
          {wrapStep === 4 && (
            <div className="space-y-4">
              <div className="p-3 bg-stone-50 rounded-xl border border-stone-100 text-xs text-stone-600">
                <strong>Step 4 (Picture):</strong> Close your eyes and visualize a vivid scene. Briefly describe the picture.
              </div>
              <textarea
                value={wrapPictureInput}
                onChange={(e) => setWrapPictureInput(e.target.value)}
                placeholder="e.g. A vibrant cafe with warm sunbeams shining through stained glass..."
                rows={3}
                className="w-full text-xs p-3 rounded-xl border border-stone-200 focus:border-stone-900 outline-none resize-none"
              />
              <button
                type="button"
                onClick={() => {
                  setWrapCompletedCount(prev => prev + 1);
                  setWrapStep(1);
                  setWrapWrittenInput("");
                  setWrapAssociationInput("");
                  setWrapPictureInput("");
                  if (currentWrapWordIndex < words.length - 1) {
                    setCurrentWrapWordIndex(prev => prev + 1);
                  }
                }}
                className="w-full py-2.5 rounded-xl bg-emerald-700 text-white font-bold text-xs hover:bg-emerald-800 cursor-pointer"
              >
                Complete WRAP for this Word! 🎉
              </button>
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Target Word Conversational Mission */}
      {activeTab === "mission" && (
        <div className="bg-white border border-stone-200 rounded-2xl p-5 sm:p-6 space-y-4 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-stone-100">
            <div>
              <h4 className="text-sm font-bold text-stone-900">Conversational Target-Word Mission</h4>
              <p className="text-xs text-stone-500">
                Converse in {targetLanguage} to accomplish a real-world scenario while using your target words!
              </p>
            </div>

            <button
              type="button"
              disabled={isGeneratingMission}
              onClick={handleCreateMission}
              className="px-4 py-2 rounded-lg bg-stone-900 hover:bg-black text-amber-300 font-bold text-xs flex items-center gap-2 cursor-pointer shadow-xs disabled:opacity-50"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span>{activeMission ? "New Mission" : "Launch Mission"}</span>
            </button>
          </div>

          {activeMission ? (
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
              {/* Mission Scenario & Word Tracker */}
              <div className="lg:col-span-1 bg-stone-50 p-4 rounded-xl border border-stone-200 space-y-3">
                <div>
                  <span className="text-[10px] font-mono font-bold uppercase text-stone-400">Scenario</span>
                  <h5 className="text-xs font-bold text-stone-900">{activeMission.title}</h5>
                  <p className="text-[11px] text-stone-600 mt-1">{activeMission.scenario}</p>
                </div>

                <div className="pt-2 border-t border-stone-200 space-y-1.5">
                  <span className="text-[10px] font-mono font-bold uppercase text-stone-400">
                    Target Words ({activeMission.targetWords.filter(t => t.used).length}/{activeMission.targetWords.length} Used)
                  </span>
                  <div className="space-y-1">
                    {activeMission.targetWords.map((tw) => (
                      <div
                        key={tw.word}
                        className={`p-1.5 rounded text-xs flex items-center justify-between ${
                          tw.used ? "bg-emerald-100 text-emerald-950 font-bold" : "bg-white border border-stone-200 text-stone-600"
                        }`}
                      >
                        <span>{tw.word}</span>
                        {tw.used && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Interactive Chat Box */}
              <div className="lg:col-span-3 border border-stone-200 rounded-xl flex flex-col h-80 overflow-hidden bg-white">
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {missionChatMessages.map((msg, idx) => (
                    <div
                      key={idx}
                      className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[80%] p-3 rounded-xl text-xs font-serif leading-relaxed ${
                          msg.role === "user"
                            ? "bg-stone-900 text-white rounded-br-none"
                            : "bg-stone-100 text-stone-900 rounded-bl-none"
                        }`}
                      >
                        {msg.text}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Chat Input */}
                <div className="p-3 border-t border-stone-200 bg-stone-50 flex items-center gap-2">
                  <input
                    type="text"
                    value={missionUserInput}
                    onChange={(e) => setMissionUserInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSendMissionMessage()}
                    placeholder={`Type your reply in ${targetLanguage}...`}
                    className="flex-1 text-xs px-3 py-2 rounded-lg border border-stone-200 bg-white outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleSendMissionMessage}
                    className="p-2 rounded-lg bg-stone-900 text-amber-300 hover:bg-black cursor-pointer"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="py-12 text-center space-y-2 border border-dashed border-stone-200 rounded-xl">
              <MessageSquare className="w-8 h-8 text-stone-300 mx-auto" />
              <p className="text-xs text-stone-500 font-medium">No mission active.</p>
              <button
                type="button"
                onClick={handleCreateMission}
                className="text-xs text-stone-900 font-bold underline cursor-pointer"
              >
                Launch conversational roleplay mission
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
