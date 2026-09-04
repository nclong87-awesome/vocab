import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Sparkles,
  RefreshCw,
  Compass,
  Briefcase,
  Target,
  MessageCircle,
  GraduationCap,
  Sliders,
  CheckCircle2,
  AlertCircle,
  Lightbulb,
  Tag,
  Code,
  ChevronDown,
  ChevronUp,
  Cpu,
  Zap,
  Clock
} from "lucide-react";
import { UserPersonalityProfile, LearnerArchetype, Word, UserStats, LLMConfig } from "../../types";
import {
  getStoredUserPersonalityProfile,
  analyzeAndSavePersonalityProfile,
  generateFallbackPersonalityProfile,
  getMilestoneProgress,
  InteractionMilestoneProgress
} from "../../services/userPersonalityProfileService";
import { getAllUserInquiries } from "../../services/userInquiryService";

interface AiPersonalityProfileCardProps {
  words?: Word[];
  stats?: UserStats;
  llmConfig?: LLMConfig;
  targetLanguage?: string;
  nativeLanguage?: string;
  appLanguage?: string;
  onRefreshStart?: () => void;
  onRefreshEnd?: () => void;
}

export default function AiPersonalityProfileCard({
  words = [],
  stats,
  llmConfig,
  targetLanguage = "English",
  nativeLanguage = "Vietnamese",
  appLanguage: _appLanguage = "Vietnamese",
  onRefreshStart,
  onRefreshEnd
}: AiPersonalityProfileCardProps) {
  const [profile, setProfile] = useState<UserPersonalityProfile | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showPromptPatch, setShowPromptPatch] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [milestone, setMilestone] = useState<InteractionMilestoneProgress>(() => getMilestoneProgress());

  // Listen to milestone updates and background auto-refreshes
  useEffect(() => {
    const handleMilestoneUpdate = () => {
      setMilestone(getMilestoneProgress());
    };

    const handleAutoRefreshStart = () => {
      setMilestone(prev => ({ ...prev, isRefreshing: true }));
    };

    const handleAutoRefreshComplete = (e: any) => {
      if (e.detail?.profile) {
        setProfile(e.detail.profile);
      }
      setMilestone(getMilestoneProgress());
    };

    window.addEventListener("vocab-interaction-recorded", handleMilestoneUpdate);
    window.addEventListener("vocab-profile-auto-refresh-start", handleAutoRefreshStart);
    window.addEventListener("vocab-profile-auto-refresh-complete", handleAutoRefreshComplete);

    return () => {
      window.removeEventListener("vocab-interaction-recorded", handleMilestoneUpdate);
      window.removeEventListener("vocab-profile-auto-refresh-start", handleAutoRefreshStart);
      window.removeEventListener("vocab-profile-auto-refresh-complete", handleAutoRefreshComplete);
    };
  }, []);

  // Load profile on mount and listen to updates
  useEffect(() => {
    let mounted = true;
    const loadProfile = async () => {
      setIsLoading(true);
      try {
        const stored = await getStoredUserPersonalityProfile();
        if (stored && mounted) {
          setProfile(stored);
        } else if (mounted) {
          // Initialize starter profile
          const starter = generateFallbackPersonalityProfile({
            words,
            stats,
            targetLanguage,
            nativeLanguage
          });
          setProfile(starter);
        }
      } catch (err) {
        console.warn("Failed to read profile:", err);
      } finally {
        if (mounted) setIsLoading(false);
      }
    };

    loadProfile();

    const handleProfileUpdate = (e: any) => {
      if (e.detail?.profile) {
        setProfile(e.detail.profile);
      }
    };

    window.addEventListener("vocab-user-profile-updated", handleProfileUpdate);
    return () => {
      mounted = false;
      window.removeEventListener("vocab-user-profile-updated", handleProfileUpdate);
    };
  }, [words.length, targetLanguage, nativeLanguage]);

  const handleRefreshProfile = async () => {
    if (isGenerating) return;
    setIsGenerating(true);
    setError(null);
    onRefreshStart?.();

    try {
      const updated = await analyzeAndSavePersonalityProfile({
        words,
        stats,
        targetLanguage,
        nativeLanguage,
        llmConfig
      });
      setProfile(updated);
      setMilestone(getMilestoneProgress());
    } catch (err: any) {
      console.error("Profile refresh failed:", err);
      setError(err?.message || "Failed to update profile. Using existing profile.");
    } finally {
      setIsGenerating(false);
      onRefreshEnd?.();
    }
  };

  const getArchetypeIcon = (archetype: LearnerArchetype) => {
    switch (archetype) {
      case "Pragmatic Professional":
        return <Briefcase className="w-5 h-5 text-blue-600" />;
      case "Curious Explorer":
        return <Compass className="w-5 h-5 text-emerald-600" />;
      case "Meticulous Perfectionist":
        return <Target className="w-5 h-5 text-purple-600" />;
      case "Casual Conversationalist":
        return <MessageCircle className="w-5 h-5 text-amber-600" />;
      case "Academic Achiever":
        return <GraduationCap className="w-5 h-5 text-rose-600" />;
      default:
        return <Sparkles className="w-5 h-5 text-indigo-600" />;
    }
  };

  const inquiries = getAllUserInquiries();
  const askAiCount = inquiries.filter(i => i.source === "ask_ai_dialog" || i.word).length;
  const mainChatCount = inquiries.length - askAiCount;

  if (isLoading && !profile) {
    return (
      <div id="ai-personality-card-skeleton" className="bg-white border border-stone-200/90 rounded-2xl p-6 shadow-xs animate-pulse mb-6">
        <div className="h-5 bg-stone-200 rounded w-1/3 mb-4" />
        <div className="h-4 bg-stone-100 rounded w-2/3 mb-2" />
        <div className="h-4 bg-stone-100 rounded w-1/2" />
      </div>
    );
  }

  if (!profile) return null;

  return (
    <div
      id="ai-personality-profile-card"
      className="bg-white border border-stone-200/90 rounded-2xl shadow-xs overflow-hidden mb-6 transition-all"
    >
      {/* CARD HEADER */}
      <div className="p-5 sm:p-6 bg-stone-900 text-stone-100">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center gap-3">
            <div className="p-2.5 bg-white/10 backdrop-blur-xs rounded-xl border border-white/10 shrink-0">
              {getArchetypeIcon(profile.archetype)}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs uppercase tracking-wider text-amber-300 font-semibold">
                  Learner Personality Engine
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-white/15 text-stone-200 border border-white/10">
                  v{profile.version}
                </span>
                {profile.modelUsed && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] bg-stone-800 text-stone-300 border border-stone-700 flex items-center gap-1">
                    <Cpu className="w-2.5 h-2.5" />
                    {profile.modelUsed}
                  </span>
                )}
              </div>
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-white mt-0.5">
                {profile.archetype}
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              id="refresh-personality-profile-button"
              onClick={handleRefreshProfile}
              disabled={isGenerating}
              className="px-4 py-2 bg-white/10 hover:bg-white/20 active:bg-white/25 text-white border border-white/20 rounded-xl text-xs font-semibold tracking-wide transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
              title="Refresh with latest chat and 'Ask AI' inputs"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isGenerating ? "animate-spin text-amber-400" : ""}`} />
              <span>{isGenerating ? "Synthesizing..." : "Analyze Activity"}</span>
            </button>
          </div>
        </div>

        {/* SUMMARY & TRAITS */}
        <p className="mt-3.5 text-xs sm:text-sm text-stone-300 font-serif italic leading-relaxed max-w-3xl">
          "{profile.archetypeSummary}"
        </p>

        {/* TRAIT BADGES */}
        <div className="flex flex-wrap items-center gap-2 mt-4 pt-3 border-t border-white/10">
          <span className="text-[11px] text-stone-400 font-medium">Distinctive Traits:</span>
          {profile.archetypeTraits.map((trait, idx) => (
            <span
              key={idx}
              className="px-2.5 py-1 rounded-lg text-xs font-medium bg-white/10 text-stone-200 border border-white/10"
            >
              {trait}
            </span>
          ))}

          <div className="sm:ml-auto flex items-center gap-2 text-[11px] text-stone-400">
            <span>Confidence:</span>
            <div className="w-16 bg-stone-700 rounded-full h-2 overflow-hidden">
              <div
                className="bg-amber-400 h-full rounded-full transition-all duration-500"
                style={{ width: `${profile.confidenceScore}%` }}
              />
            </div>
            <span className="font-semibold text-amber-300">{profile.confidenceScore}%</span>
          </div>
        </div>
      </div>

      {/* ERROR BANNER IF ANY */}
      {error && (
        <div className="px-5 py-2.5 bg-rose-50 border-b border-rose-200 flex items-center gap-2 text-rose-800 text-xs">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
          <span>{error}</span>
        </div>
      )}

      {/* BODY CONTENT */}
      <div className="p-5 sm:p-6 space-y-6">
        {/* CONTINUOUS BACKGROUND MILESTONE AUTO-REFRESH WIDGET */}
        <div
          id="milestone-auto-refresh-tracker"
          className="p-4 rounded-xl border border-amber-200/80 bg-gradient-to-br from-amber-50/50 via-stone-50/40 to-stone-50/80 shadow-2xs"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-2.5">
            <div className="flex items-start sm:items-center gap-2.5">
              <div className="p-1.5 rounded-lg bg-amber-100/90 text-amber-800 shrink-0 mt-0.5 sm:mt-0">
                <Zap className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-bold text-stone-900">
                    Automatic Profile Evolution Trigger
                  </span>
                  {milestone.isRefreshing ? (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500 text-white flex items-center gap-1 animate-pulse">
                      <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                      Auto-synthesizing in background...
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-100 text-amber-900 border border-amber-200/80">
                      Every {milestone.threshold} interactions
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-stone-600 mt-0.5">
                  Tracks inquiries, quiz completions, and flashcard reviews to continuously update your persona in the background without manual intervention.
                </p>
              </div>
            </div>

            <div className="flex sm:flex-col items-baseline sm:items-end justify-between shrink-0 pl-7 sm:pl-0">
              <div className="text-xs font-bold text-stone-900">
                <span className="text-sm sm:text-base text-amber-800">{milestone.interactionsSinceLastMilestone}</span>
                <span className="text-stone-700"> / {milestone.threshold} interactions</span>
              </div>
              <span className="text-[10px] text-stone-700 font-medium">
                {milestone.threshold - milestone.interactionsSinceLastMilestone > 0
                  ? `${milestone.threshold - milestone.interactionsSinceLastMilestone} until next auto-refresh`
                  : "Triggering background update"}
              </span>
            </div>
          </div>

          {/* PROGRESS BAR */}
          <div className="w-full bg-stone-200/90 rounded-full h-2.5 overflow-hidden p-0.5 border border-stone-200">
            <motion.div
              className={`h-full rounded-full ${
                milestone.isRefreshing
                  ? "bg-gradient-to-r from-amber-400 via-emerald-400 to-amber-500 animate-pulse"
                  : "bg-amber-600"
              }`}
              initial={{ width: 0 }}
              animate={{ width: `${milestone.progressPercent}%` }}
              transition={{ duration: 0.4, ease: "easeOut" }}
            />
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 mt-2 pt-2 border-t border-amber-200/40 text-[10px] text-stone-700">
            <div className="flex items-center gap-1">
              <Clock className="w-3 h-3 text-stone-600" />
              <span>
                Total learning activity recorded:{" "}
                <strong className="text-stone-800">{milestone.totalInteractions}</strong>
              </span>
            </div>
            <span>
              Last profile compilation:{" "}
              <strong className="text-stone-800">
                {milestone.lastRefreshTimestamp
                  ? new Date(milestone.lastRefreshTimestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                  : "Initial baseline"}
              </strong>
            </span>
          </div>
        </div>

        {/* SIGNAL INGESTION METRICS BAR */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-stone-50 border border-stone-200/70 p-3.5 rounded-xl">
          <div>
            <div className="text-[10px] text-stone-700 uppercase font-semibold">Inquiries Analyzed</div>
            <div className="text-base font-bold text-stone-900 mt-0.5">{inquiries.length} queries</div>
          </div>
          <div>
            <div className="text-[10px] text-stone-700 uppercase font-semibold">'Ask AI' Word Queries</div>
            <div className="text-base font-bold text-indigo-700 mt-0.5">{askAiCount} queries</div>
          </div>
          <div>
            <div className="text-[10px] text-stone-700 uppercase font-semibold">Main Chat Queries</div>
            <div className="text-base font-bold text-emerald-700 mt-0.5">{mainChatCount} queries</div>
          </div>
          <div>
            <div className="text-[10px] text-stone-700 uppercase font-semibold">Active Vocabulary Base</div>
            <div className="text-base font-bold text-stone-900 mt-0.5">{words.length} cards</div>
          </div>
        </div>

        {/* LEARNING STYLE & MODALITY PREFERENCES */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Sliders className="w-4 h-4 text-stone-600" />
            <h3 className="text-xs uppercase tracking-wider font-bold text-stone-800">
              Cognitive Learning Modality & Preferences
            </h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="p-3 bg-stone-50 border border-stone-200 rounded-xl">
              <span className="text-[11px] text-stone-700 block mb-1">Primary Modality</span>
              <span className="text-xs font-bold text-stone-900 capitalize">
                {profile.learningPreferences?.primaryModality?.replace("_", " ") || "Contextual Examples"}
              </span>
            </div>

            <div className="p-3 bg-stone-50 border border-stone-200 rounded-xl">
              <span className="text-[11px] text-stone-700 block mb-1">Explanation Depth</span>
              <span className="text-xs font-bold text-stone-900 capitalize">
                {profile.learningPreferences?.explanationDepth?.replace("_", " ") || "Punchy Concise"}
              </span>
            </div>

            <div className="p-3 bg-stone-50 border border-stone-200 rounded-xl">
              <span className="text-[11px] text-stone-700 block mb-1">Formality Preference</span>
              <span className="text-xs font-bold text-stone-900 capitalize">
                {profile.learningPreferences?.formalityPreference?.replace("_", " ") || "Business Casual"}
              </span>
            </div>

            <div className="p-3 bg-stone-50 border border-stone-200 rounded-xl">
              <span className="text-[11px] text-stone-700 block mb-1">Challenge Attitude</span>
              <span className="text-xs font-bold text-stone-900 capitalize">
                {profile.learningPreferences?.challengeAttitude?.replace("_", " ") || "Fast Paced Gamified"}
              </span>
            </div>
          </div>
        </div>

        {/* DETECTED INTERESTS & FREQUENT QUESTION PATTERNS */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Interests */}
          <div className="p-4 border border-stone-200 rounded-xl bg-stone-50/50">
            <div className="flex items-center gap-1.5 text-xs font-bold text-stone-800 mb-2.5">
              <Tag className="w-3.5 h-3.5 text-stone-600" />
              <span>Demonstrated Topics & Vocabulary Interests</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {profile.detectedInterests && profile.detectedInterests.length > 0 ? (
                profile.detectedInterests.map((interest, i) => (
                  <span
                    key={i}
                    className="px-2.5 py-1 rounded-md text-xs font-medium bg-white border border-stone-200 text-stone-800 shadow-2xs"
                  >
                    {interest}
                  </span>
                ))
              ) : (
                <span className="text-xs text-stone-700 italic">Exploring diverse vocabulary domains</span>
              )}
            </div>
          </div>

          {/* Frequent Question Types */}
          <div className="p-4 border border-stone-200 rounded-xl bg-stone-50/50">
            <div className="flex items-center gap-1.5 text-xs font-bold text-stone-800 mb-2.5">
              <Lightbulb className="w-3.5 h-3.5 text-amber-600" />
              <span>Frequent Inquiry Patterns</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {profile.frequentQuestionTypes && profile.frequentQuestionTypes.length > 0 ? (
                profile.frequentQuestionTypes.map((qType, i) => (
                  <span
                    key={i}
                    className="px-2.5 py-1 rounded-md text-xs font-medium bg-amber-50 border border-amber-200/70 text-amber-900 capitalize"
                  >
                    {qType.replace("_", " ")}
                  </span>
                ))
              ) : (
                <span className="text-xs text-stone-700 italic">Nuance comparison & context queries</span>
              )}
            </div>
          </div>
        </div>

        {/* DIAGNOSTICS: STRENGTHS, BLIND SPOTS & ACTIONABLE ADVICE */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
          {/* Strengths */}
          <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50/40">
            <div className="flex items-center gap-2 mb-2 text-xs font-bold text-emerald-900 uppercase tracking-wide">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>Cognitive Strengths</span>
            </div>
            <ul className="space-y-1.5">
              {profile.diagnostics?.strengths?.map((s, idx) => (
                <li key={idx} className="text-xs text-emerald-950 flex items-start gap-2">
                  <span className="text-emerald-500 font-bold">•</span>
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Blind spots */}
          <div className="p-4 rounded-xl border border-amber-200 bg-amber-50/40">
            <div className="flex items-center gap-2 mb-2 text-xs font-bold text-amber-900 uppercase tracking-wide">
              <AlertCircle className="w-4 h-4 text-amber-600" />
              <span>Focus Opportunities</span>
            </div>
            <ul className="space-y-1.5">
              {profile.diagnostics?.blindSpots?.map((b, idx) => (
                <li key={idx} className="text-xs text-amber-950 flex items-start gap-2">
                  <span className="text-amber-500 font-bold">•</span>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* ACTIONABLE COACHING ADVICE */}
        {profile.diagnostics?.actionableAdvice && (
          <div className="p-4 bg-indigo-50/60 border border-indigo-200/80 rounded-xl">
            <div className="flex items-center gap-2 text-xs font-bold text-indigo-900 uppercase tracking-wide mb-1">
              <Lightbulb className="w-4 h-4 text-indigo-600" />
              <span>7-Day Adaptive Strategy</span>
            </div>
            <p className="text-xs sm:text-sm text-indigo-950 leading-relaxed font-serif">
              {profile.diagnostics.actionableAdvice}
            </p>
          </div>
        )}

        {/* TRANSPARENT SYSTEM PROMPT PATCH ACCORDION */}
        <div className="pt-2 border-t border-stone-200/80">
          <button
            onClick={() => setShowPromptPatch(!showPromptPatch)}
            className="w-full flex items-center justify-between text-xs text-stone-700 hover:text-stone-900 transition-colors py-1 cursor-pointer font-medium"
          >
            <div className="flex items-center gap-2">
              <Code className="w-3.5 h-3.5 text-stone-500" />
              <span>AI System Persona Directive (Injected into Chat & Word Coaching)</span>
            </div>
            {showPromptPatch ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>

          <AnimatePresence>
            {showPromptPatch && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden mt-2"
              >
                <div className="p-3.5 bg-stone-900 text-stone-200 text-xs font-mono rounded-xl border border-stone-800 leading-relaxed">
                  <div className="text-[11px] text-amber-400 font-semibold mb-1 uppercase tracking-wider">
                    // Active Prompt Patch:
                  </div>
                  {profile.tailoredSystemPromptPatch || "Standard balanced vocabulary pedagogy."}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
