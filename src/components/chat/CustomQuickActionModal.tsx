import React, { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  X, 
  Sparkles, 
  Plus, 
  Trash2, 
  Edit3, 
  Check, 
  RotateCcw, 
  Bookmark, 
  Pin
} from "lucide-react";
import { 
  CustomQuickAction, 
  getCustomQuickActions, 
  saveCustomQuickAction, 
  deleteCustomQuickAction, 
  resetCustomQuickActionsToDefault,
  STARTER_PRESET_ACTIONS,
  formatPromptWithContext,
  CUSTOM_ACTIONS_UPDATED_EVENT
} from "../../services/jitActionChipsService";

interface CustomQuickActionModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetLanguage?: string;
  nativeLanguage?: string;
  appLanguage?: string;
  sampleWord?: string;
}

const EMOJI_OPTIONS = [
  "⚡", "💼", "🎓", "🇻🇳", "🧠", "⚠️", "🗣️", "🔗", "💡", "📝", "🎯", "⚖️", "📖", "🔄", "⭐", "🌐", "📚", "💬"
];

export default function CustomQuickActionModal({
  isOpen,
  onClose,
  targetLanguage = "English",
  nativeLanguage = "Vietnamese",
  appLanguage: _appLanguage = "vi",
  sampleWord = "eloquent"
}: CustomQuickActionModalProps) {
  const [activeTab, setActiveTab] = useState<"list" | "presets" | "editor">("list");
  const [actions, setActions] = useState<CustomQuickAction[]>([]);
  const [editingAction, setEditingAction] = useState<CustomQuickAction | null>(null);

  // Form State
  const [label, setLabel] = useState("");
  const [iconEmoji, setIconEmoji] = useState("⚡");
  const [promptTemplate, setPromptTemplate] = useState("");
  const [category, setCategory] = useState<CustomQuickAction["category"]>("study");
  const [scope, setScope] = useState<CustomQuickAction["scope"]>("both");
  const [description, setDescription] = useState("");
  const [isPinned, setIsPinned] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Load actions on open and listen to update events
  const loadActions = () => {
    setActions(getCustomQuickActions());
  };

  useEffect(() => {
    if (isOpen) {
      loadActions();
    }
  }, [isOpen]);

  useEffect(() => {
    const handleUpdated = () => {
      loadActions();
    };
    window.addEventListener(CUSTOM_ACTIONS_UPDATED_EVENT, handleUpdated);
    return () => window.removeEventListener(CUSTOM_ACTIONS_UPDATED_EVENT, handleUpdated);
  }, []);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2500);
  };

  const handleStartCreate = () => {
    setEditingAction(null);
    setLabel("");
    setIconEmoji("⚡");
    setPromptTemplate("Explain how to use '{word}' in natural conversation with 2 realistic examples.");
    setCategory("study");
    setScope("both");
    setDescription("");
    setIsPinned(false);
    setActiveTab("editor");
  };

  const handleStartEdit = (act: CustomQuickAction) => {
    setEditingAction(act);
    setLabel(act.label);
    setIconEmoji(act.iconEmoji || "⚡");
    setPromptTemplate(act.promptTemplate);
    setCategory(act.category);
    setScope(act.scope);
    setDescription(act.description || "");
    setIsPinned(Boolean(act.isPinned));
    setActiveTab("editor");
  };

  const handleDelete = async (id: string, name: string) => {
    if (window.confirm(`Are you sure you want to delete custom action "${name}"?`)) {
      await deleteCustomQuickAction(id);
      showToast(`Deleted "${name}"`);
    }
  };

  const handleTogglePin = async (act: CustomQuickAction) => {
    await saveCustomQuickAction({
      ...act,
      isPinned: !act.isPinned
    });
    showToast(act.isPinned ? `Unpinned "${act.label}"` : `Pinned "${act.label}"`);
  };

  const handleApplyPreset = async (preset: CustomQuickAction) => {
    const isAlreadyAdded = actions.some(a => a.id === preset.id || a.label.toLowerCase() === preset.label.toLowerCase());
    if (isAlreadyAdded) {
      showToast(`"${preset.label}" is already in your actions!`);
      return;
    }
    const newAct: CustomQuickAction = {
      ...preset,
      id: `custom-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      createdAt: Date.now()
    };
    await saveCustomQuickAction(newAct);
    showToast(`Added preset "${preset.label}"`);
  };

  const handleSaveForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!label.trim()) {
      alert("Please enter a short label for this action.");
      return;
    }
    if (!promptTemplate.trim()) {
      alert("Please enter a prompt template.");
      return;
    }

    const actionToSave: CustomQuickAction = {
      id: editingAction ? editingAction.id : `custom-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      label: label.trim(),
      iconEmoji: iconEmoji.trim() || "⚡",
      promptTemplate: promptTemplate.trim(),
      category,
      scope,
      description: description.trim() || undefined,
      isPinned,
      createdAt: editingAction ? editingAction.createdAt : Date.now(),
      updatedAt: Date.now()
    };

    await saveCustomQuickAction(actionToSave);
    showToast(editingAction ? `Updated "${actionToSave.label}"` : `Created "${actionToSave.label}"!`);
    setActiveTab("list");
  };

  const handleResetDefaults = async () => {
    if (window.confirm("Restore default quick actions? Any customized actions will be reset.")) {
      await resetCustomQuickActionsToDefault();
      showToast("Reset to default actions");
    }
  };

  const insertVariable = (varName: string) => {
    setPromptTemplate(prev => `${prev} ${varName}`);
  };

  // Preview generated prompt with sample word
  const previewPrompt = useMemo(() => {
    if (!promptTemplate) return "";
    return formatPromptWithContext(promptTemplate, {
      word: sampleWord,
      nativeLanguage,
      targetLanguage
    });
  }, [promptTemplate, sampleWord, nativeLanguage, targetLanguage]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-stone-900/60 backdrop-blur-xs animate-fadeIn">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 10 }}
        transition={{ duration: 0.18 }}
        className="bg-white rounded-2xl shadow-2xl border border-stone-200 w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden text-stone-800"
        id="custom-quick-actions-modal"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-stone-200 flex items-center justify-between bg-stone-50/80 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-amber-100 text-amber-900 flex items-center justify-center font-bold shadow-2xs">
              ⚡
            </div>
            <div>
              <h3 className="text-base font-bold text-stone-900 flex items-center gap-1.5">
                Custom Quick Actions
                <span className="text-[10px] font-bold uppercase tracking-wider bg-stone-200 text-stone-700 px-2 py-0.5 rounded-full">
                  JIT Chips
                </span>
              </h3>
              <p className="text-xs text-stone-500">
                Personalize 1-click prompt chips in the "Ask AI" modal and Chat
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-stone-200/70 hover:bg-stone-300 text-stone-700 flex items-center justify-center transition-colors cursor-pointer"
            title="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="px-5 pt-3 pb-2 border-b border-stone-100 bg-white flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-1 bg-stone-100 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => setActiveTab("list")}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                activeTab === "list"
                  ? "bg-white text-stone-900 shadow-2xs"
                  : "text-stone-600 hover:text-stone-900"
              }`}
            >
              <Bookmark className="w-3.5 h-3.5 text-amber-600" />
              <span>My Actions</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-stone-200 text-stone-700 font-mono">
                {actions.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("presets")}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                activeTab === "presets"
                  ? "bg-white text-stone-900 shadow-2xs"
                  : "text-stone-600 hover:text-stone-900"
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 text-sky-600" />
              <span>Presets Library</span>
            </button>

            <button
              type="button"
              onClick={handleStartCreate}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                activeTab === "editor" && !editingAction
                  ? "bg-white text-stone-900 shadow-2xs"
                  : "text-stone-600 hover:text-stone-900"
              }`}
            >
              <Plus className="w-3.5 h-3.5 text-emerald-600" />
              <span>Create New</span>
            </button>
          </div>

          {activeTab === "list" && (
            <button
              type="button"
              onClick={handleResetDefaults}
              className="text-[11px] font-semibold text-stone-400 hover:text-stone-700 transition-colors flex items-center gap-1 cursor-pointer"
              title="Reset actions to defaults"
            >
              <RotateCcw className="w-3 h-3" />
              <span className="hidden sm:inline">Reset Defaults</span>
            </button>
          )}
        </div>

        {/* Toast alert */}
        <AnimatePresence>
          {toastMessage && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="bg-amber-500 text-stone-950 text-xs font-bold px-4 py-1.5 text-center shrink-0"
            >
              {toastMessage}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Body Content */}
        <div className="p-5 flex-1 overflow-y-auto min-h-0 space-y-4">
          {/* TAB 1: MY ACTIONS LIST */}
          {activeTab === "list" && (
            <div className="space-y-3">
              {actions.length === 0 ? (
                <div className="text-center py-10 bg-stone-50 rounded-2xl border border-dashed border-stone-200 p-6 space-y-2">
                  <Sparkles className="w-8 h-8 text-stone-400 mx-auto" />
                  <h4 className="text-sm font-bold text-stone-800">No custom actions yet</h4>
                  <p className="text-xs text-stone-500 max-w-sm mx-auto">
                    Add quick actions from our presets library or create custom prompt chips for your specific learning goals.
                  </p>
                  <div className="pt-2 flex items-center justify-center gap-2">
                    <button
                      type="button"
                      onClick={() => setActiveTab("presets")}
                      className="px-3.5 py-1.5 rounded-lg bg-stone-900 text-white text-xs font-bold hover:bg-stone-800 transition-all cursor-pointer"
                    >
                      Browse Presets
                    </button>
                    <button
                      type="button"
                      onClick={handleStartCreate}
                      className="px-3.5 py-1.5 rounded-lg bg-white border border-stone-300 text-stone-700 text-xs font-bold hover:bg-stone-50 transition-all cursor-pointer"
                    >
                      Create Custom
                    </button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {actions.map((act) => (
                    <div
                      key={act.id}
                      className="bg-white border border-stone-200 hover:border-stone-300 rounded-xl p-3 shadow-2xs hover:shadow-xs transition-all flex flex-col justify-between gap-2 relative group"
                    >
                      <div className="space-y-1.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="text-base select-none">{act.iconEmoji || "⚡"}</span>
                            <span className="text-xs font-bold text-stone-900 leading-snug">
                              {act.label}
                            </span>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleTogglePin(act)}
                              className={`p-1 rounded-md transition-colors cursor-pointer ${
                                act.isPinned
                                  ? "text-amber-500 bg-amber-50 hover:bg-amber-100"
                                  : "text-stone-300 hover:text-stone-600 hover:bg-stone-100"
                              }`}
                              title={act.isPinned ? "Unpin from top" : "Pin to top of chips"}
                            >
                              <Pin className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleStartEdit(act)}
                              className="p-1 rounded-md text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition-colors cursor-pointer"
                              title="Edit action"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(act.id, act.label)}
                              className="p-1 rounded-md text-stone-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                              title="Delete action"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {act.description && (
                          <p className="text-[11px] text-stone-500 line-clamp-1">
                            {act.description}
                          </p>
                        )}

                        <div className="bg-stone-50 rounded-lg p-2 border border-stone-100 text-[11px] text-stone-600 font-mono leading-relaxed line-clamp-2">
                          "{act.promptTemplate}"
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-2 pt-1 border-t border-stone-100 text-[10px]">
                        <div className="flex items-center gap-1.5">
                          <span className="px-1.5 py-0.5 rounded bg-stone-100 text-stone-600 font-semibold uppercase tracking-wider">
                            {act.scope === "both" ? "Ask AI & Chat" : act.scope === "ask_ai" ? "Ask AI only" : "Chat only"}
                          </span>
                          <span className="px-1.5 py-0.5 rounded bg-stone-100 text-stone-500 capitalize">
                            {act.category}
                          </span>
                        </div>
                        {act.isPinned && (
                          <span className="text-amber-600 font-bold flex items-center gap-0.5">
                            ★ Pinned
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: PRESETS LIBRARY */}
          {activeTab === "presets" && (
            <div className="space-y-3">
              <div className="p-3 bg-sky-50/70 border border-sky-200 rounded-xl text-xs text-sky-900 flex items-center justify-between">
                <span>Select curated prompt templates designed by language educators to install with 1 click:</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {STARTER_PRESET_ACTIONS.map((preset) => {
                  const isAdded = actions.some(
                    a => a.id === preset.id || a.label.toLowerCase() === preset.label.toLowerCase()
                  );
                  return (
                    <div
                      key={preset.id}
                      className="bg-white border border-stone-200 rounded-xl p-3 flex flex-col justify-between gap-2 shadow-2xs"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="text-base select-none">{preset.iconEmoji}</span>
                            <h4 className="text-xs font-bold text-stone-900">{preset.label}</h4>
                          </div>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-stone-100 text-stone-600 font-semibold uppercase tracking-wider">
                            {preset.category}
                          </span>
                        </div>
                        <p className="text-[11px] text-stone-500 leading-snug">
                          {preset.description}
                        </p>
                        <div className="bg-stone-50 rounded-lg p-2 border border-stone-100 text-[11px] text-stone-600 font-mono leading-relaxed line-clamp-2">
                          "{preset.promptTemplate}"
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleApplyPreset(preset)}
                        disabled={isAdded}
                        className={`w-full py-1.5 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:cursor-default ${
                          isAdded
                            ? "bg-stone-100 text-stone-400 border border-stone-200"
                            : "bg-stone-900 hover:bg-stone-800 text-white shadow-2xs hover:shadow-xs"
                        }`}
                      >
                        {isAdded ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-600" />
                            <span>Installed in My Actions</span>
                          </>
                        ) : (
                          <>
                            <Plus className="w-3.5 h-3.5" />
                            <span>Add to My Quick Actions</span>
                          </>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 3: CREATE / EDIT FORM */}
          {activeTab === "editor" && (
            <form onSubmit={handleSaveForm} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-stone-700 block">
                    Action Icon (Emoji)
                  </label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={iconEmoji}
                      onChange={(e) => setIconEmoji(e.target.value)}
                      maxLength={4}
                      className="w-12 text-center text-lg bg-stone-50 border border-stone-300 rounded-lg py-1 font-emoji focus:border-stone-500 focus:outline-hidden"
                    />
                    <div className="flex flex-wrap gap-1 max-w-[170px]">
                      {EMOJI_OPTIONS.slice(0, 8).map((em) => (
                        <button
                          key={em}
                          type="button"
                          onClick={() => setIconEmoji(em)}
                          className="w-6 h-6 rounded bg-stone-100 hover:bg-stone-200 text-xs flex items-center justify-center cursor-pointer transition-colors"
                        >
                          {em}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="sm:col-span-2 space-y-1">
                  <label className="text-xs font-bold text-stone-700 block">
                    Action Chip Label <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="e.g. IELTS Speaking Band 8, Common Traps"
                    maxLength={35}
                    required
                    className="w-full text-xs bg-white border border-stone-300 rounded-lg px-3 py-2 text-stone-900 focus:border-stone-500 focus:outline-hidden font-medium"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-stone-700 block">
                    Category
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as any)}
                    className="w-full text-xs bg-white border border-stone-300 rounded-lg px-3 py-2 text-stone-900 focus:border-stone-500 focus:outline-hidden cursor-pointer"
                  >
                    <option value="study">🧠 Quiz & Study</option>
                    <option value="writing">✍️ Writing & Polish</option>
                    <option value="vocab">📚 Vocabulary</option>
                    <option value="chat">💬 Chat Session</option>
                    <option value="custom">⭐ Custom</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-stone-700 block">
                    Where Should It Appear?
                  </label>
                  <select
                    value={scope}
                    onChange={(e) => setScope(e.target.value as any)}
                    className="w-full text-xs bg-white border border-stone-300 rounded-lg px-3 py-2 text-stone-900 focus:border-stone-500 focus:outline-hidden cursor-pointer"
                  >
                    <option value="both">Both ("Ask AI" Modal & Main Chat)</option>
                    <option value="ask_ai">"Ask AI" Modal Only</option>
                    <option value="chat">Main Chat Only</option>
                  </select>
                </div>
              </div>

              {/* Prompt Template */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-stone-700">
                    Prompt Template <span className="text-rose-500">*</span>
                  </label>
                  <div className="flex items-center gap-1 text-[11px] text-stone-500">
                    <span>Insert dynamic tags:</span>
                    <button
                      type="button"
                      onClick={() => insertVariable("{word}")}
                      className="px-1.5 py-0.5 rounded bg-stone-100 hover:bg-stone-200 text-stone-800 font-mono font-bold cursor-pointer transition-colors"
                      title="Insert active word placeholder"
                    >
                      + {"{word}"}
                    </button>
                    <button
                      type="button"
                      onClick={() => insertVariable("{nativeLanguage}")}
                      className="px-1.5 py-0.5 rounded bg-stone-100 hover:bg-stone-200 text-stone-800 font-mono font-bold cursor-pointer transition-colors"
                      title="Insert native language"
                    >
                      + {"{nativeLanguage}"}
                    </button>
                  </div>
                </div>

                <textarea
                  value={promptTemplate}
                  onChange={(e) => setPromptTemplate(e.target.value)}
                  rows={3}
                  placeholder="Explain how to use '{word}' in natural conversation with 2 realistic examples."
                  required
                  className="w-full text-xs bg-white border border-stone-300 rounded-xl p-3 text-stone-900 focus:border-stone-500 focus:outline-hidden font-mono leading-relaxed"
                />
              </div>

              {/* Description & Pin Toggle */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-center">
                <div className="sm:col-span-2 space-y-1">
                  <label className="text-xs font-medium text-stone-600 block">
                    Short Description (Optional)
                  </label>
                  <input
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="e.g. Natural business correspondence"
                    className="w-full text-xs bg-white border border-stone-300 rounded-lg px-3 py-1.5 text-stone-900 focus:border-stone-500 focus:outline-hidden"
                  />
                </div>

                <label className="flex items-center gap-2 cursor-pointer mt-4 sm:mt-5 select-none">
                  <input
                    type="checkbox"
                    checked={isPinned}
                    onChange={(e) => setIsPinned(e.target.checked)}
                    className="rounded border-stone-300 text-amber-600 focus:ring-amber-500 w-4 h-4 cursor-pointer"
                  />
                  <span className="text-xs font-bold text-stone-700">Pin to Top of Chips</span>
                </label>
              </div>

              {/* Live Preview Box */}
              <div className="bg-stone-50 border border-stone-200 rounded-xl p-3 space-y-1.5">
                <div className="flex items-center justify-between text-[11px] font-bold text-stone-500 uppercase tracking-wider">
                  <span>Live Prompt Preview (when triggered on "{sampleWord}"):</span>
                  <span className="text-amber-700 font-sans font-medium text-[11px] normal-case">
                    Chip: {iconEmoji} {label || "Custom Action"}
                  </span>
                </div>
                <div className="text-xs text-stone-700 bg-white p-2.5 rounded-lg border border-stone-200/80 font-sans leading-relaxed">
                  {previewPrompt || <span className="text-stone-400 italic">Enter a prompt template above...</span>}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-stone-200">
                <button
                  type="button"
                  onClick={() => setActiveTab("list")}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-stone-600 hover:text-stone-900 bg-stone-100 hover:bg-stone-200 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-stone-900 hover:bg-stone-800 shadow-2xs hover:shadow-xs transition-all cursor-pointer flex items-center gap-1.5"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>{editingAction ? "Save Changes" : "Create Action Chip"}</span>
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-stone-200 bg-stone-50/80 flex items-center justify-between text-xs text-stone-500 shrink-0">
          <span className="flex items-center gap-1">
            <Sparkles className="w-3.5 h-3.5 text-amber-600" />
            <span>Chips synchronize automatically to your study database</span>
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-stone-200 hover:bg-stone-300 text-stone-800 font-bold transition-colors cursor-pointer"
          >
            Done
          </button>
        </div>
      </motion.div>
    </div>
  );
}
