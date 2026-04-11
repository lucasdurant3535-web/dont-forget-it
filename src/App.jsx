import React, { useState, useRef, useEffect } from "react";
import { presetDecks } from "./data/presetDecks"
import { auth, db } from "./firebase";
import { collection, doc, setDoc, getDoc, getDocs, updateDoc, serverTimestamp } from "firebase/firestore";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  GoogleAuthProvider,
  signInWithPopup
} from "firebase/auth";
import { deleteDoc } from "firebase/firestore";
import { FEATURES, hasAccess } from "./features";
import { generateCardsWithAI } from "./services/ai";

import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase"; // ou onde você inicializa

console.log("Auth:", auth);
console.log("Firestore:", db);

function getDue(cards) {
  const now = new Date();
  return cards.filter(c => new Date(c.nextReview) <= now);
}

function daysBetween(dateString) {
  const now = new Date();
  const past = new Date(dateString);
  return (now - past) / (1000 * 60 * 60 * 24);
}

export default function App() {

  const DAILY_GOAL = 20;

  // ✅ STREAK (dias consecutivos)
  function getDateKey(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function getYesterdayKey() {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return getDateKey(d);
  }

  const [streak, setStreak] = useState(() => {
    const saved = localStorage.getItem("streakData");
    if (!saved) return 0;

    try {
      const parsed = JSON.parse(saved);
      return Number(parsed.streak || 0);
    } catch {
      return 0;
    }
  });

  // 🏅 Medalhas de streak (ano todo)
  const STREAK_MILESTONES = [7, 14, 30, 60, 120, 180, 240, 365];

  function getStreakMedal(streakValue) {
    const earned = STREAK_MILESTONES.filter(m => streakValue >= m);
    const last = earned.length ? earned[earned.length - 1] : null;
    const next = STREAK_MILESTONES.find(m => streakValue < m) || null;

    const medal =
      last === 365 ? "💎 Lenda (365)" :
        last === 240 ? "👑 Imperador (240)" :
          last === 180 ? "🏆 Elite (180)" :
            last === 120 ? "🚀 Mestre (120)" :
              last === 60 ? "🔥 Fênix (60)" :
                last === 30 ? "🥇 Ouro (30)" :
                  last === 14 ? "🥈 Prata (14)" :
                    last === 7 ? "🥉 Bronze (7)" :
                      "Sem medalha ainda";

    return { last, next, medal };
  }

  const streakMedal = getStreakMedal(streak);

  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem("darkmode");
    return saved === null ? true : saved === "true";
  });
  useEffect(() => localStorage.setItem("darkmode", dark), [dark]);

  const [decks, setDecks] = useState([]);

  const allDecks = [...presetDecks, ...decks].filter(
    (deck, index, arr) =>
      deck &&
      deck.id &&
      typeof deck.name === "string" &&
      deck.name.trim() !== "" &&
      arr.findIndex(d => String(d.id) === String(deck.id)) === index
  );

  useEffect(() => {
    localStorage.removeItem("decks");
  }, []);

  const [activeDeckId, setActiveDeckId] = useState(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [user, setUser] = useState(null);
  const [userData, setUserData] = useState(null);
  const [toast, setToast] = useState(null);
  const [userDataLoading, setUserDataLoading] = useState(false);
  const [showPremiumWelcome, setShowPremiumWelcome] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiPreview, setAiPreview] = useState(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiTheme, setAiTheme] = useState("");
  const [aiAmount, setAiAmount] = useState(10);
  const [aiUsageInfo, setAiUsageInfo] = useState(null);
  const [authMode, setAuthMode] = useState("login");
  const [authLoading, setAuthLoading] = useState(true);
  const [deckTopic, setDeckTopic] = useState("");
  const [studyMode, setStudyMode] = useState("deck"); // "deck" ou "topic"
  const [studyTopic, setStudyTopic] = useState(null);
  const [notes, setNotes] = useState([]);
  const [newNoteTitle, setNewNoteTitle] = useState("");
  const [newNoteContent, setNewNoteContent] = useState("");
  const [newNoteTopic, setNewNoteTopic] = useState("");
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [notesLoading, setNotesLoading] = useState(false);
  const [noteFont, setNoteFont] = useState("Inter");
  const [openedNote, setOpenedNote] = useState(null);
  const [isEditingOpenedNote, setIsEditingOpenedNote] = useState(false);
  const [editedOpenedNoteContent, setEditedOpenedNoteContent] = useState("");
  const [editedOpenedNoteTitle, setEditedOpenedNoteTitle] = useState("");
  const [editedOpenedNoteTopic, setEditedOpenedNoteTopic] = useState("");


  const subscription = userData?.subscription || {};

  const currentPlan = subscription.plan || "free";
  const subscriptionStatus = subscription.status || "inactive";

  const cancelAtPeriodEnd = subscription.cancelAtPeriodEnd;
  const currentPeriodEnd = subscription.currentPeriodEnd || null;
  const lastInvoiceStatus = subscription.lastInvoiceStatus || null;

  const isPremium =
    currentPlan === "premium" &&
    (subscriptionStatus === "active" || subscriptionStatus === "past_due");

  const isCancelScheduled =
    cancelAtPeriodEnd === true || cancelAtPeriodEnd === "true";

  const isPaymentIssue = lastInvoiceStatus === "payment_failed";

  const activeDeck = allDecks.find(d => String(d.id) === String(activeDeckId));
  const isPresetDeck = !!activeDeck?.isBuiltIn;
  const isActiveDeckPremium = !!activeDeck?.premium;
  const isLockedPresetDeck = isPresetDeck && isActiveDeckPremium && !isPremium;
  const userDecks = decks.filter(deck => !deck.isBuiltIn);

  const nowIso = new Date().toISOString();

  const todayDueCount = userDecks.reduce((total, deck) => {
    const dueInDeck = (deck.cards || []).filter(card => {
      return (card.nextReview || nowIso) <= nowIso;
    }).length;

    return total + dueInDeck;
  }, 0);

  const todayNewCardsCount = userDecks.reduce((total, deck) => {
    const newInDeck = (deck.cards || []).filter(card => {
      return !card.reviewHistory || card.reviewHistory.length === 0;
    }).length;

    return total + newInDeck;
  }, 0);

  const hasUserDecks = userDecks.length > 0;

  const canUseCreateDecks = hasAccess("createDecks", isPremium);
  const canUseAddCards = hasAccess("addCards", isPremium);
  const canUseStudy = hasAccess("study", isPremium);
  const canUseBeginnerPresetDecks = hasAccess("beginnerPresetDecks", isPremium);

  const canUseStreak = hasAccess("streak", isPremium);
  const canUseMedals = hasAccess("medals", isPremium);
  const canUseAdvancedStats = hasAccess("advancedStats", isPremium);
  const canUseIntermediatePresetDecks = hasAccess("intermediatePresetDecks", isPremium);
  const canUseAdvancedPresetDecks = hasAccess("advancedPresetDecks", isPremium);
  const canUseAiTools = hasAccess("aiTools", isPremium);
  const canUseStreakArea = canUseStreak && canUseMedals;

  const tabsBarRef = useRef(null);

  const isDraggingTabsRef = useRef(false);
  const tabsDragStartXRef = useRef(0);
  const tabsScrollLeftRef = useRef(0);

  const studyDecks = userDecks;
  const studyActiveDeck = studyDecks.find(
    deck => String(deck.id) === String(activeDeckId)
  ) || null;

  const aiLimitReached = aiUsageInfo?.remaining === 0;

  const audioCacheRef = useRef({});
  const currentAudioRef = useRef(null);

  const dueByTopic = getDueCardsByTopic();

  const FREE_NOTES_LIMIT = 10;

  const hasReachedNotesLimit =
    !isPremium && (notes?.length || 0) >= FREE_NOTES_LIMIT;

  const aiFloatingButton = {
    position: "fixed",
    right: 20,
    bottom: 90,
    width: 58,
    height: 58,
    borderRadius: "50%",
    border: "none",
    background: dark ? "#7c5cff" : "#6d4aff",
    color: "#fff",
    fontWeight: 900,
    fontSize: 18,
    letterSpacing: 0.5,
    cursor: "pointer",
    boxShadow: dark
      ? "0 10px 30px rgba(124,92,255,0.35)"
      : "0 10px 30px rgba(109,74,255,0.28)",
    zIndex: 9999,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "transform 0.2s ease, opacity 0.2s ease",
  };

  const texts = {
    pt: {
      today: "Hoje",
      study: "Estudar",
      decks: "Decks",
      add: "Carta",
      premium: "Premium",
      settings: "Configurações",

      reminder: "Lembrete diário",
      reminderDescription: "Receba um lembrete para entrar no app e estudar.",

      activate: "Ativar lembrete",
      deactivate: "Desativar",

      language: "Idioma",
      languageDescription: "Escolha o idioma da interface do aplicativo.",

      todayTitle: "Seu dia",
      toReview: "Para revisar",
      newCards: "Cartas novas",
      dailyGoal: "Meta diária",
      streak: "Sequência",
      startStudy: "Começar estudo",

      studyReady: "Pronto para estudar",
      studyMessage: "Existem {{count}} cartas esperando por você.",
      startSession: "Começar sessão",

      createDeck: "Criar deck",
      newDeckName: "Nome do novo deck",
      deleteDeck: "Excluir deck",

      addCardTitle: "Adicionar carta",
      question: "Pergunta",
      answer: "Resposta",
      addCard: "Adicionar carta",

      stats: "Dados",
      cognitiveEvolution: "Evolução cognitiva",
      level: "Nível",
      averageStability: "Estabilidade média",
      averageRetention: "Retenção média",
      averageResponseTime: "Tempo médio de resposta",
      insight: "Insight"
    },

    en: {
      today: "Today",
      study: "Study",
      decks: "Decks",
      add: "Card",
      premium: "Premium",
      settings: "Settings",

      reminder: "Daily reminder",
      reminderDescription: "Receive a reminder to open the app and study.",

      activate: "Enable reminder",
      deactivate: "Disable",

      language: "Language",
      languageDescription: "Choose the app interface language.",

      todayTitle: "Your day",
      toReview: "To review",
      newCards: "New cards",
      dailyGoal: "Daily goal",
      streak: "Streak",
      startStudy: "Start study",

      studyReady: "Ready to study",
      studyMessage: "There are {{count}} cards waiting for you.",
      startSession: "Start session",

      createDeck: "Create deck",
      newDeckName: "New deck name",
      deleteDeck: "Delete deck",

      addCardTitle: "Add card",
      question: "Question",
      answer: "Answer",
      addCard: "Add card",

      stats: "Stats",
      cognitiveEvolution: "Cognitive evolution",
      level: "Level",
      averageStability: "Average stability",
      averageRetention: "Average retention",
      averageResponseTime: "Average response time",
      insight: "Insight"
    }
  };

  const hideScrollbar = `
  .hide-scrollbar::-webkit-scrollbar {
    display: none;
  }

  .hide-scrollbar {
    -ms-overflow-style: none;
    scrollbar-width: none;
  }
`;

  const drawerAnimation = `
@keyframes slideInLeft {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(0);
  }
}
`;

  const toastAnimation = `
@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translate(-50%, 20px);
  }
  to {
    opacity: 1;
    transform: translate(-50%, 0);
  }
}
`;

  async function ensureUserDocument(user) {
    if (!user) return;

    console.log("🔥 Rodando ensureUserDocument para:", user.uid);

    const userRef = doc(db, "users", user.uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
      console.log("🆕 Criando usuário no Firestore...");

      await setDoc(userRef, {
        uid: user.uid,
        name: user.displayName || "",
        email: user.email || "",
        photoURL: user.photoURL || "",
        language: "pt",
        plan: "free",
        subscription: {
          plan: "free",
          status: "inactive",
          source: "manual",
          startedAt: null,
          expiresAt: null
        },
        premiumOnboarding: {
          welcomeSeen: false,
          completed: false,
          completedAt: null
        },
        notifications: {
          enabled: false,
          time: "20:00"
        },
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      console.log("✅ Usuário criado com sucesso");
    } else {
      console.log("👤 Usuário já existe");
    }
  }

  async function loadUserData(uid) {
    if (!uid) return null;

    const userRef = doc(db, "users", uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) return null;

    return {
      id: userSnap.id,
      ...userSnap.data()
    };
  }

  async function ensureUserSubscription(userDoc) {
    if (!user || !userDoc) return;

    if (userDoc.subscription?.plan) return;

    try {
      const userRef = doc(db, "users", user.uid);

      await updateDoc(userRef, {
        subscription: {
          plan: userDoc.plan || "free",
          status: userDoc.plan === "premium" ? "active" : "inactive",
          source: "manual",
          startedAt: userDoc.plan === "premium" ? new Date().toISOString() : null,
          expiresAt: null
        },
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error("Erro ao garantir subscription do usuário:", error);
    }
  }

  async function ensurePremiumOnboarding(userDoc) {
    if (!user || !userDoc) return;

    if (userDoc.premiumOnboarding) return;

    try {
      const userRef = doc(db, "users", user.uid);

      await updateDoc(userRef, {
        premiumOnboarding: {
          welcomeSeen: false,
          completed: false,
          completedAt: null
        },
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error("Erro ao garantir premiumOnboarding:", error);
    }
  }

  async function ensureUserNotifications(userDoc) {
    if (!user || !userDoc) return;

    if (userDoc.notifications) return;

    try {
      const userRef = doc(db, "users", user.uid);

      await updateDoc(userRef, {
        notifications: {
          enabled: false,
          time: "20:00"
        },
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error("Erro ao garantir notifications:", error);
    }
  }

  async function requestNotificationPermission() {
    if (!("Notification" in window)) {
      showToast("Seu navegador não suporta notificações");
      return false;
    }

    const permission = await Notification.requestPermission();

    return permission === "granted";
  }

  function sendSimpleNotification() {
    if (!("Notification" in window)) return;
    if (Notification.permission !== "granted") return;

    new Notification("Don't Forget It", {
      body: "Hora de estudar. Sua memória precisa de consistência 🧠",
      icon: "/pwa-192x192.png"
    });
  }

  async function updateNotificationSettings(patch) {
    if (!user) return;

    try {
      const userRef = doc(db, "users", user.uid);

      const next = {
        enabled: userData?.notifications?.enabled || false,
        time: userData?.notifications?.time || "20:00",
        ...patch
      };

      await updateDoc(userRef, {
        notifications: next,
        updatedAt: serverTimestamp()
      });

      setUserData(prev => ({
        ...prev,
        notifications: next
      }));
    } catch (error) {
      console.error("Erro notificações:", error);
    }
  }

  async function enableReminder() {
    const ok = await requestNotificationPermission();

    if (!ok) return;

    await updateNotificationSettings({
      enabled: true
    });

    showToast("Lembrete ativado 🔔", "success");
  }

  async function ensureUserLanguage(userDoc) {
    if (!user || !userDoc) return;

    if (userDoc.language) return;

    try {
      const userRef = doc(db, "users", user.uid);

      await updateDoc(userRef, {
        language: "pt",
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error("Erro ao garantir language:", error);
    }
  }

  function t(key, vars = {}) {
    const lang = userData?.language || "pt";
    let text = texts[lang][key] || key;

    Object.keys(vars).forEach(k => {
      text = text.replace(`{{${k}}}`, vars[k]);
    });

    return text;
  }

  async function handleGenerateCardsAI() {
    try {
      setAiLoading(true);
      setAiError("");
      setAiPreview(null);

      if (!user) {
        setAiError("Você precisa estar logado.");
        return;
      }

      const userRef = doc(db, "users", user.uid);
      const snap = await getDoc(userRef);
      const userData = snap.data();

      const check = canUseAI(userData);

      if (!check.allowed) {
        await loadAIUsage();
        setAiError(`Você atingiu o limite mensal de gerações (${check.limit}).`);
        return;
      }

      const requestedAmount = Number(aiAmount) || 10;
      const safeAmount = Math.min(requestedAmount, check.maxCards);

      const res = await generateCardsWithAI({
        theme: aiTheme,
        amount: safeAmount,
        language: "pt-BR",
        level: "iniciante",
      });

      if (res?.ok) {
        setAiPreview(res.content);
        await incrementAIUsage(user);
        await loadAIUsage();
      } else {
        setAiError("A IA não retornou conteúdo.");
      }
    } catch (err) {
      console.error(err);
      setAiError(err?.message || "Erro ao gerar cartas com IA.");
    } finally {
      setAiLoading(false);
    }
  }

  function normalizeCardLang(text, aiLang, fallbackLang) {
    if (!text) return fallbackLang || "unknown";

    const normalizedAiLang = (aiLang || "").trim();

    // se a IA marcou português, aceita
    if (normalizedAiLang === "pt-BR") return "pt-BR";

    // heurística simples para português
    const looksPortuguese =
      /[ãõçáàâéêíóôõú]/i.test(text) ||
      /\b(o|a|os|as|um|uma|de|da|do|das|dos|que|como|para|com|não|por|em)\b/i.test(text);

    if (looksPortuguese) return "pt-BR";

    // se a IA mandou algum idioma e o texto não parece português, aceita
    if (normalizedAiLang) return normalizedAiLang;

    // fallback final
    return fallbackLang || "unknown";
  }

  async function handleSaveAIDeck() {
    try {
      console.log("aiPreview:", aiPreview);
      console.log("user:", user);

      if (!aiPreview) {
        alert("Nenhum conteúdo gerado pela IA para salvar.");
        return;
      }

      if (!user) {
        alert("Você precisa estar logado para salvar um deck.");
        return;
      }

      const deckCollectionRef = collection(db, "users", user.uid, "decks");
      const newDeckRef = doc(deckCollectionRef);

      const nowIso = new Date().toISOString();

      const localDeck = {
        id: newDeckRef.id,
        name: aiPreview.title || "Novo deck com IA",
        description:
          aiPreview.description || "Deck gerado por inteligência artificial.",
        level: "iniciante",
        isBuiltIn: false,
        sourcePresetId: null,
        userId: user.uid,
        createdAt: nowIso,
        updatedAt: nowIso,
        cards: (aiPreview.cards || []).map((card, index) => ({
          id: `${newDeckRef.id}-card-${index + 1}`,
          question: card.front,
          answer: card.back,
          questionLang: normalizeCardLang(card.front, card.frontLang, language),
          answerLang: normalizeCardLang(card.back, card.backLang, "pt-BR"),
          repetition: 0,
          interval: 0,
          ease: 2.5,
          stability: 1,
          nextReview: nowIso,
          lastReview: nowIso,
          reviewHistory: [],
        })),
      };

      const firestoreDeck = {
        ...localDeck,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      await setDoc(newDeckRef, firestoreDeck);

      setDecks((prev) => [localDeck, ...prev]);
      setActiveDeckId(localDeck.id);
      setTab("decks");

      alert("Novo deck criado com sucesso 🚀");

      setAiPreview(null);
      setAiOpen(false);
      setAiTheme("");
      setAiAmount(10);
      setAiError("");
    } catch (err) {
      console.error("Erro ao salvar deck gerado por IA:", err);
      alert(`Erro ao salvar deck: ${err.message}`);
    }
  }

  function canUseAI(userData) {
    if (!userData) return { allowed: false, limit: 0, maxCards: 0 };

    const currentMonth = new Date().toISOString().slice(0, 7); // ex: 2026-03

    const usage = userData.aiUsage || {
      month: currentMonth,
      count: 0,
    };

    const isPremium = Boolean(
      userData &&
      (
        userData.plan === "premium" ||
        userData.subscription?.plan === "premium" ||
        userData.subscription?.status === "active"
      )
    );

    const FREE_LIMIT = 1;
    const PREMIUM_LIMIT = 30;

    const FREE_MAX_CARDS = 15;
    const PREMIUM_MAX_CARDS = 30;

    const limit = isPremium ? PREMIUM_LIMIT : FREE_LIMIT;
    const maxCards = isPremium ? PREMIUM_MAX_CARDS : FREE_MAX_CARDS;


    if (usage.month !== currentMonth) {
      return {
        allowed: true,
        usage: { month: currentMonth, count: 0 },
        limit,
        maxCards,
        isPremium,
      };
    }

    if (usage.count >= limit) {
      return {
        allowed: false,
        usage,
        limit,
        maxCards,
        isPremium,
      };
    }

    return {
      allowed: true,
      usage,
      limit,
      maxCards,
      isPremium,
    };
  }

  async function incrementAIUsage(user) {
    const userRef = doc(db, "users", user.uid);

    const currentMonth = new Date().toISOString().slice(0, 7); // ex: 2026-03

    const snap = await getDoc(userRef);
    const data = snap.data();

    let usage = data?.aiUsage || { month: currentMonth, count: 0 };

    if (usage.month !== currentMonth) {
      usage = { month: currentMonth, count: 0 };
    }

    usage.count += 1;

    await updateDoc(userRef, {
      aiUsage: usage,
    });

    return usage;
  }

  async function loadAIUsage() {
    if (!user) return;

    const userRef = doc(db, "users", user.uid);
    const snap = await getDoc(userRef);
    const userData = snap.data();

    const currentMonth = new Date().toISOString().slice(0, 7);

    const isPremium =
      userData?.plan === "premium" ||
      userData?.subscription?.plan === "premium" ||
      userData?.subscription?.status === "active";

    const limit = isPremium ? 30 : 1;

    let usage = userData?.aiUsage || {
      month: currentMonth,
      count: 0,
    };

    if (usage.month !== currentMonth) {
      usage = {
        month: currentMonth,
        count: 0,
      };
    }

    const current = usage.count || 0;
    const remaining = Math.max(limit - current, 0);

    setAiUsageInfo({
      current,
      limit,
      remaining,
      isPremium,
    });
  }

  async function speakWithAI(text, lang) {
    try {
      if (!text || !lang) return;
      if (lang === "pt-BR") return;

      const cacheKey = `${lang}::${text}`;

      // para áudio anterior
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
        currentAudioRef.current.currentTime = 0;
      }

      // ✅ usa cache se já existir
      if (audioCacheRef.current[cacheKey]) {
        const cachedAudio = new Audio(audioCacheRef.current[cacheKey]);
        currentAudioRef.current = cachedAudio;
        await cachedAudio.play();
        return;
      }

      const generateSpeech = httpsCallable(functions, "generateSpeech");
      const res = await generateSpeech({ text, lang });

      const base64 = res.data.audioBase64;
      const audioSrc = `data:audio/mp3;base64,${base64}`;

      // salva no cache
      audioCacheRef.current[cacheKey] = audioSrc;

      const audio = new Audio(audioSrc);
      currentAudioRef.current = audio;
      await audio.play();
    } catch (err) {
      console.error("Erro ao tocar áudio com IA:", err);
    }
  }

  function shouldSpeak(lang, text = "") {
    if (!lang || lang === "pt-BR") return false;

    const looksPortuguese =
      /[ãõçáàâéêíóôõú]/i.test(text) ||
      /\b(o|a|os|as|um|uma|de|da|do|das|dos|que|como|para|com|não|por|em)\b/i.test(text);

    if (looksPortuguese) return false;

    return true;
  }

  function getDueCardsByTopic() {
    const topicMap = {};

    decks.forEach(deck => {
      if (!deck.cards || !Array.isArray(deck.cards)) return;

      const topic = deck.topic || "Geral";
      const dueCards = getDue(deck.cards);

      if (dueCards.length === 0) return;

      if (!topicMap[topic]) {
        topicMap[topic] = {
          topic,
          count: 0,
          decks: [],
          cards: []
        };
      }

      topicMap[topic].count += dueCards.length;
      topicMap[topic].decks.push(deck.id);
      topicMap[topic].cards.push(
        ...dueCards.map(card => ({
          ...card,
          deckId: deck.id,
          deckName: deck.name,
          topic
        }))
      );
    });

    return Object.values(topicMap).sort((a, b) => b.count - a.count);
  }

  function startTopicSession(topicGroup) {
    if (!topicGroup?.cards?.length) return;

    setStudyMode("topic");
    setStudyTopic(topicGroup.topic);
    setSession(topicGroup.cards);
    setIndex(0);
    setShowBack(false);
    setStudyStarted(true);
    setTab("study");
    setStartTime(Date.now());
  }

  async function updateSingleCardInDeck(deckId, updatedCard) {
    if (!deckId) return false;
    if (!user) return false;

    const targetDeck = decks.find(d => String(d.id) === String(deckId));
    if (!targetDeck) return false;

    if (targetDeck.isBuiltIn) {
      showToast("Este é um deck padrão. Adicione-o à sua conta para salvar progresso");
      return false;
    }

    const updatedCards = (targetDeck.cards || []).map(c =>
      c.id === updatedCard.id ? updatedCard : c
    );

    try {
      await updateDoc(
        doc(db, "users", user.uid, "decks", String(deckId)),
        {
          cards: updatedCards,
          updatedAt: new Date().toISOString()
        }
      );

      setDecks(prev =>
        prev.map(d =>
          String(d.id) === String(deckId)
            ? { ...d, cards: updatedCards }
            : d
        )
      );

      return true;
    } catch (error) {
      console.error("Erro ao atualizar carta no deck:", error);
      showToast("Erro ao salvar progresso", "error");
      return false;
    }
  }

  function startDeckStudy(selectedDeck) {
    if (!selectedDeck?.cards?.length) {
      showToast("Esse deck não tem cartas ainda", "error");
      return;
    }

    const dueCards = getDue(selectedDeck.cards);

    const cardsToStudy = dueCards.length > 0 ? dueCards : selectedDeck.cards;

    setStudyMode("deck");
    setStudyTopic(null);
    setSession(cardsToStudy);
    setIndex(0);
    setShowBack(false);
    setStudyStarted(true);
    setStartTime(Date.now());
    setActiveDeckId(selectedDeck.id);
    setTab("study");
  }

  async function createNote() {
    const cleanTitle = newNoteTitle.trim();
    const cleanContent = newNoteContent.trim();
    const cleanTopic = newNoteTopic.trim();

    if (!user) {
      showToast("Você precisa estar logado para criar notas", "error");
      return;
    }

    if (hasReachedNotesLimit) {
      showToast?.("Você atingiu o limite de notas do plano gratuito ✨");
      return;
    }

    if (!cleanTitle || !cleanContent) {
      showToast("Preencha título e conteúdo da nota", "error");
      return;
    }

    try {
      const noteId = Date.now().toString();
      const now = new Date().toISOString();

      const noteData = {
        id: noteId,
        title: cleanTitle,
        content: cleanContent,
        topic: cleanTopic || "Geral",
        font: noteFont,
        userId: user.uid,
        createdAt: now,
        updatedAt: now
      };

      await setDoc(
        doc(db, "users", user.uid, "notes", noteId),
        noteData
      );

      setNotes(prev => [noteData, ...prev]);
      setNewNoteTitle("");
      setNewNoteContent("");
      setNewNoteTopic("");
      showToast("Nota criada com sucesso", "success");
    } catch (error) {
      console.error("Erro ao criar nota:", error);
      showToast("Erro ao criar nota", "error");
    }
  }

  function startEditNote(note) {
    setEditingNoteId(note.id);
    setNewNoteTitle(note.title || "");
    setNewNoteContent(note.content || "");
    setNewNoteTopic(note.topic || "");
    setNoteFont(note.font || "Inter");
  }

  async function updateNoteItem() {
    const cleanTitle = newNoteTitle.trim();
    const cleanContent = newNoteContent.trim();
    const cleanTopic = newNoteTopic.trim();

    if (!user || !editingNoteId) return;

    if (!cleanTitle || !cleanContent) {
      showToast("Preencha título e conteúdo da nota", "error");
      return;
    }

    try {
      const updatedAt = new Date().toISOString();

      await updateDoc(
        doc(db, "users", user.uid, "notes", String(editingNoteId)),
        {
          title: cleanTitle,
          content: cleanContent,
          topic: cleanTopic || "Geral",
          font: noteFont,
          updatedAt
        }
      );

      setNotes(prev => {
        const updated = prev.map(note =>
          String(note.id) === String(editingNoteId)
            ? {
              ...note,
              title: cleanTitle,
              content: cleanContent,
              topic: cleanTopic || "Geral",
              updatedAt
            }
            : note
        );

        if (openedNote && String(openedNote.id) === String(editingNoteId)) {
          setOpenedNote(prev => ({
            ...prev,
            title: cleanTitle,
            content: cleanContent,
            topic: cleanTopic || "Geral",
            font: noteFont,
            updatedAt
          }));
        }

        return updated.sort((a, b) => {
          const aTime = new Date(a.updatedAt || a.createdAt || 0).getTime();
          const bTime = new Date(b.updatedAt || b.createdAt || 0).getTime();
          return bTime - aTime;
        });
      });

      setEditingNoteId(null);
      setNewNoteTitle("");
      setNewNoteContent("");
      setNewNoteTopic("");
      showToast("Nota atualizada", "success");
    } catch (error) {
      console.error("Erro ao atualizar nota:", error);
      showToast("Erro ao atualizar nota", "error");
    }
  }

  async function deleteNoteItem(noteId) {
    if (!user) return;

    try {
      await deleteDoc(doc(db, "users", user.uid, "notes", String(noteId)));

      setNotes(prev => prev.filter(note => String(note.id) !== String(noteId)));

      if (String(editingNoteId) === String(noteId)) {
        setEditingNoteId(null);
        setNewNoteTitle("");
        setNewNoteContent("");
        setNewNoteTopic("");
      }

      showToast("Nota excluída", "success");
    } catch (error) {
      console.error("Erro ao excluir nota:", error);
      showToast("Erro ao excluir nota", "error");
    }
  }

  function cancelNoteEditing() {
    setEditingNoteId(null);
    setNewNoteTitle("");
    setNewNoteContent("");
    setNewNoteTopic("");

    if (openedNote && String(openedNote.id) === String(noteId)) {
      setOpenedNote(null);
      setIsEditingOpenedNote(false);
      setEditedOpenedNoteTitle("");
      setEditedOpenedNoteContent("");
      setEditedOpenedNoteTopic("");
    }
  }

  async function handleSaveOpenedNote() {
    if (!openedNote || !user) return;

    const updatedNote = {
      ...openedNote,
      title: editedOpenedNoteTitle.trim(),
      content: editedOpenedNoteContent.trim(),
      topic: editedOpenedNoteTopic.trim(),
      font: openedNote.font || noteFont,
      updatedAt: new Date().toISOString(),
    };

    try {
      const noteRef = doc(db, "users", user.uid, "notes", openedNote.id);

      await updateDoc(noteRef, {
        title: updatedNote.title,
        content: updatedNote.content,
        topic: updatedNote.topic,
        font: updatedNote.font,
        updatedAt: serverTimestamp(),
      });

      setNotes((prev) =>
        prev.map((note) => (note.id === openedNote.id ? updatedNote : note))
      );

      setOpenedNote(updatedNote);
      setIsEditingOpenedNote(false);
    } catch (error) {
      console.error("Erro ao salvar nota aberta:", error);
    }
  }

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async currentUser => {
      setAuthLoading(true);
      setUser(currentUser);

      if (!currentUser) {
        setUserData(null);
        setUserDataLoading(false);
        setAuthLoading(false);
        return;
      }

      setUserDataLoading(true);

      try {
        await ensureUserDocument(currentUser);

        let loadedUserData = await loadUserData(currentUser.uid);

        await ensureUserSubscription(loadedUserData);
        loadedUserData = await loadUserData(currentUser.uid);

        await ensurePremiumOnboarding(loadedUserData);
        loadedUserData = await loadUserData(currentUser.uid);

        await ensureUserNotifications(loadedUserData);
        loadedUserData = await loadUserData(currentUser.uid);

        await ensureUserLanguage(loadedUserData);
        loadedUserData = await loadUserData(currentUser.uid);

        setUserData(loadedUserData);
      } catch (error) {
        console.error("Erro ao carregar dados do usuário:", error);
      } finally {
        setUserDataLoading(false);
        setAuthLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    async function loadUserDecks() {
      if (!user) {
        setDecks([]);
        return;
      }

      try {
        const snapshot = await getDocs(
          collection(db, "users", user.uid, "decks")
        );

        const loadedDecks = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));

        setDecks(loadedDecks);
      } catch (error) {
        console.error("Erro ao carregar decks:", error);
      }
    }

    loadUserDecks();
  }, [user]);

  useEffect(() => {
    if (!userData?.notifications?.enabled) return;

    const interval = setInterval(() => {
      const time = userData.notifications.time || "20:00";
      const [h, m] = time.split(":").map(Number);

      const now = new Date();

      if (now.getHours() === h && now.getMinutes() === m) {
        sendSimpleNotification();
      }
    }, 60000);

    return () => clearInterval(interval);
  }, [userData]);

  useEffect(() => {
    if (!userData) return;

    const isPremiumActive =
      userData?.subscription?.plan === "premium" &&
      userData?.subscription?.status === "active";

    const welcomeSeen = userData?.premiumOnboarding?.welcomeSeen;

    if (isPremiumActive && !welcomeSeen) {
      setShowPremiumWelcome(true);
    }
  }, [userData]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const checkout = params.get("checkout");

    if (checkout === "success") {
      setToast({
        message: "Pagamento realizado com sucesso! Agora é só aguardar a ativação do Premium.",
        type: "success"
      });

      const newUrl = window.location.pathname;
      window.history.replaceState({}, document.title, newUrl);
    }
  }, []);

  useEffect(() => {
    if (!user) {
      setNotes([]);
      return;
    }

    const loadNotes = async () => {
      setNotesLoading(true);

      try {
        const notesRef = collection(db, "users", user.uid, "notes");
        const snap = await getDocs(notesRef);

        const loadedNotes = snap.docs.map(docItem => ({
          ...docItem.data(),
          id: docItem.id
        }));

        loadedNotes.sort((a, b) => {
          const aTime = new Date(a.updatedAt || a.createdAt || 0).getTime();
          const bTime = new Date(b.updatedAt || b.createdAt || 0).getTime();
          return bTime - aTime;
        });

        setNotes(loadedNotes);
      } catch (error) {
        console.error("Erro ao carregar notas:", error);
        showToast("Erro ao carregar notas", "error");
      } finally {
        setNotesLoading(false);
      }
    };

    loadNotes();
  }, [user]);

  useEffect(() => {
    if (openedNote) {
      setEditedOpenedNoteTitle(openedNote.title || "");
      setEditedOpenedNoteContent(openedNote.content || "");
      setEditedOpenedNoteTopic(openedNote.topic || "");
      setIsEditingOpenedNote(false);
    }
  }, [openedNote]);

  // 📥 Recupera sessão parcial (se for do mesmo dia)
  useEffect(() => {
    const saved = localStorage.getItem("partialSession");

    if (!saved) return;

    try {
      const parsed = JSON.parse(saved);

      // só retoma se for no mesmo dia e no mesmo deck
      if (parsed.startDate === getDateKey() && parsed.deckId === activeDeckId) {
        setSession(parsed.session || []);
        setIndex(parsed.index || 0);
        setShowBack(parsed.showBack || false);
        setStudyStarted(true);
      } else {
        localStorage.removeItem("partialSession");
      }
    } catch {
      console.error("Erro ao carregar sessão parcial");
      localStorage.removeItem("partialSession");
    }
  }, [activeDeckId]);

  const [newDeck, setNewDeck] = useState("");

  async function cancelPremium() {
    if (!user) {
      showToast("Você precisa estar logado");
      return;
    }

    try {
      const userRef = doc(db, "users", user.uid);

      const nextSubscription = {
        plan: "premium",
        status: "cancelled",
        source: "manual",
        startedAt: userData?.subscription?.startedAt || null,
        expiresAt: null
      };

      await updateDoc(userRef, {
        subscription: nextSubscription,
        updatedAt: serverTimestamp()
      });

      setUserData(prev => ({
        ...prev,
        subscription: nextSubscription
      }));

      showToast("Assinatura cancelada");
    } catch (error) {
      console.error("Erro ao cancelar premium:", error);
      showToast("Erro ao cancelar");
    }
  }

  async function completePremiumOnboarding() {
    if (!user) return;

    try {
      const userRef = doc(db, "users", user.uid);

      await updateDoc(userRef, {
        premiumOnboarding: {
          welcomeSeen: true,
          completed: true,
          completedAt: new Date().toISOString()
        },
        updatedAt: serverTimestamp()
      });

      setUserData(prev => ({
        ...prev,
        premiumOnboarding: {
          welcomeSeen: true,
          completed: true,
          completedAt: new Date().toISOString()
        }
      }));

      setShowPremiumWelcome(false);
      showToast("Bem-vindo ao Premium ✨", "success");
    } catch (error) {
      console.error("Erro ao finalizar onboarding premium:", error);
      showToast("Erro ao finalizar onboarding");
    }
  }

  async function dismissPremiumWelcome() {
    if (!user) return;

    try {
      const userRef = doc(db, "users", user.uid);

      await updateDoc(userRef, {
        premiumOnboarding: {
          welcomeSeen: true,
          completed: false,
          completedAt: null
        },
        updatedAt: serverTimestamp()
      });

      setUserData(prev => ({
        ...prev,
        premiumOnboarding: {
          welcomeSeen: true,
          completed: false,
          completedAt: null
        }
      }));

      setShowPremiumWelcome(false);
    } catch (error) {
      console.error("Erro ao fechar boas-vindas premium:", error);
      showToast("Erro ao fechar boas-vindas");
    }
  }

  async function createDeck() {
    const cleanName = newDeck.trim();
    const cleanTopic = deckTopic.trim();

    console.log("CRIANDO DECK:", {
      newDeck,
      deckTopic
    });

    if (!cleanName) return;

    if (!user) {
      showToast("Você precisa estar logado para criar um deck");
      return;
    }

    const deckExists = [...presetDecks, ...decks].some(
      d => d.name?.trim().toLowerCase() === cleanName.toLowerCase()
    );

    if (deckExists) {
      showToast("Já existe um deck com esse nome");
      return;
    }

    try {
      const deckId = Date.now().toString();
      const now = new Date().toISOString();

      const deckData = {
        id: deckId,
        name: cleanName,
        topic: cleanTopic || "Geral",
        cards: [],
        userId: user.uid,
        createdAt: now,
        updatedAt: now,
        isBuiltIn: false
      };

      await setDoc(
        doc(db, "users", user.uid, "decks", deckId),
        deckData
      );

      setDecks(prev => [...prev, deckData]);
      setNewDeck("");
      setDeckTopic("");

      showToast("Deck criado com sucesso", "success");
    } catch (error) {
      console.error("Erro ao criar deck:", error);
      showToast("Erro ao salvar deck");
    }
  }

  function handleTabsMouseDown(e) {
    const slider = tabsBarRef.current;
    if (!slider) return;

    isDraggingTabsRef.current = true;
    tabsDragStartXRef.current = e.pageX - slider.offsetLeft;
    tabsScrollLeftRef.current = slider.scrollLeft;
  }

  function handleTabsMouseMove(e) {
    const slider = tabsBarRef.current;
    if (!slider || !isDraggingTabsRef.current) return;

    e.preventDefault();

    const x = e.pageX - slider.offsetLeft;
    const walk = x - tabsDragStartXRef.current;

    slider.scrollLeft = tabsScrollLeftRef.current - walk;
  }

  function handleTabsMouseUp() {
    isDraggingTabsRef.current = false;
  }

  function handleTabsMouseLeave() {
    isDraggingTabsRef.current = false;
  }

  function canAccessPresetDeck(deck, isPremiumUser) {
    if (!deck) return false;

    if (!deck.premium) return true;

    return isPremiumUser;
  }

  async function addPresetDeckToAccount() {
    if (!user) {
      showToast("Você precisa estar logado");
      return;
    }

    if (!activeDeck || !isPresetDeck) {
      return;
    }

    const allowed = canAccessPresetDeck(activeDeck, isPremium);

    if (!allowed) {
      showToast("Este deck é exclusivo do Premium ✨");
      setTab("premium");
      return;
    }

    setLoading(true);

    try {
      const deckId = Date.now().toString();
      const now = new Date().toISOString();

      const copiedCards = activeDeck.cards.map((card, index) => ({
        ...card,
        id: `${deckId}-card-${index + 1}`,
        repetition: 0,
        interval: 0,
        ease: 2.5,
        nextReview: now,
        lastReview: now,
        reviewHistory: [],
        stability: 1
      }));

      const newDeck = {
        id: deckId,
        name: `${activeDeck.name} (Meu deck)`,
        description: activeDeck.description || "",
        topic: deckTopic?.trim() || "Geral",
        level: activeDeck.level || "",
        isBuiltIn: false,
        sourcePresetId: activeDeck.id,
        userId: user.uid,
        createdAt: now,
        updatedAt: now,
        cards: copiedCards
      };

      await setDoc(
        doc(db, "users", user.uid, "decks", deckId),
        newDeck
      );

      setDecks(prev => [...prev, newDeck]);
      setActiveDeckId(deckId);
      setTab("study");

      showToast("Deck adicionado à sua conta", "success");
    } catch (error) {
      console.error("Erro ao adicionar deck padrão:", error);
      showToast("Erro ao adicionar deck");
    } finally {
      setLoading(false);
    }
  }

  async function deleteDeck(deckId) {
    if (!user) return;

    if (!window.confirm("Excluir este deck permanentemente?")) return;

    try {
      await deleteDoc(doc(db, "users", user.uid, "decks", deckId));

      setDecks(prev => prev.filter(d => String(d.id) !== String(deckId)));

      if (String(activeDeckId) === String(deckId)) {
        setActiveDeckId(null);
      }

      showToast("Deck excluído", "success");
    } catch (error) {
      console.error("Erro ao excluir deck:", error);
      showToast("Erro ao excluir deck");
    }
  }

  function showToast(message, type = "default") {
    console.log("TOAST CHAMADO:", message);

    setToast({ message, type });

    setTimeout(() => {
      setToast(null);
    }, 4000);
  }

  function canAccessPresetDeck(deck, isPremiumUser) {
    if (!deck) return false;

    // deck free → sempre pode acessar
    if (!deck.premium) return true;

    // deck premium → só premium pode acessar
    return isPremiumUser;
  }


  async function handleRegister() {
    if (!email || !password) return;

    try {
      await createUserWithEmailAndPassword(auth, email, password);
      showToast("Conta criada com sucesso", "success");
      setEmail("");
      setPassword("");
    } catch (error) {
      console.error("Erro ao criar conta:", error);
      showToast("Erro ao criar conta");
    }
  }

  async function handleLogin() {
    if (!email || !password) {
      showToast("Preencha email e senha", "error");
      return;
    }

    try {
      await signInWithEmailAndPassword(auth, email, password);

      showToast("Login realizado", "success");
      setEmail("");
      setPassword("");
    } catch (error) {
      console.error("Erro no login:", error);

      let message = "Erro ao fazer login";

      switch (error.code) {
        case "auth/invalid-credential":
          message = "Email ou senha incorretos";
          break;
        case "auth/user-not-found":
          message = "Usuário não encontrado";
          break;
        case "auth/wrong-password":
          message = "Senha incorreta";
          break;
        case "auth/too-many-requests":
          message = "Muitas tentativas. Tente novamente mais tarde";
          break;
        case "auth/invalid-email":
          message = "Email inválido";
          break;
        default:
          message = "Erro ao fazer login";
      }

      showToast(message, "error");
    }
  }

  async function handleLogout() {
    try {
      await signOut(auth);
      showToast("Logout realizado", "success");
    } catch (error) {
      console.error("Erro no logout:", error);
      showToast("Erro ao sair");
    }
  }

  async function handleGoogleLogin() {
    try {
      const provider = new GoogleAuthProvider();

      await signInWithPopup(auth, provider);

      showToast("Login com Google realizado com sucesso!", "success");
    } catch (error) {
      console.error("Erro no login com Google:", error);

      if (error.code === "auth/popup-closed-by-user") {
        showToast("Login com Google cancelado.");
        return;
      }

      if (error.code === "auth/account-exists-with-different-credential") {
        showToast("Já existe uma conta com esse email usando outro método de login.");
        return;
      }

      showToast("Erro ao entrar com Google.");
    }
  }

  async function updateCards(cards) {
    if (!activeDeckId) return false;

    if (isPresetDeck) {
      showToast("Este é um deck padrão. Adicione-o à sua conta para salvar progresso");
      return false;
    }

    if (!user) return false;

    try {
      await updateDoc(
        doc(db, "users", user.uid, "decks", String(activeDeckId)),
        {
          cards,
          updatedAt: new Date().toISOString()
        }
      );

      setDecks(prev =>
        prev.map(d =>
          String(d.id) === String(activeDeckId) ? { ...d, cards } : d
        )
      );

      return true;
    } catch (error) {
      console.error("Erro ao atualizar cartas:", error);
      showToast("Erro ao salvar cartas", "error");
      return false;
    }
  }

  const [front, setFront] = useState("");
  const [back, setBack] = useState("");

  async function addCard() {
    if (!front || !back || !activeDeck) return;

    const now = new Date().toISOString();

    const newCard = {
      id: Date.now(),
      question: front,
      answer: back,
      repetition: 0,
      interval: 0,
      ease: 2.5,
      nextReview: now,
      lastReview: now,
      reviewHistory: [],
      stability: 1
    };

    await updateCards([...activeDeck.cards, newCard]);

    setFront("");
    setBack("");
  }

  function autoResize(e) {
    const el = e.target;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }

  function calculateSM2(card, quality) {
    let { repetition, interval, ease } = card;

    if (quality < 3) {
      repetition = 0;
      interval = 1;
    } else {
      repetition += 1;

      if (repetition === 1) interval = 1;
      else if (repetition === 2) interval = 6;
      else interval = Math.round(interval * ease);
    }

    ease = ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
    if (ease < 1.3) ease = 1.3;

    return { repetition, interval, ease };
  }

  function calculateStability(card, quality, interval) {
    let stability = card.stability || 1;
    if (quality < 3) return 1;
    return stability + interval * (quality / 5);
  }

  function calculateRetention(card) {
    const S = card.stability || 1;
    const t = daysBetween(card.lastReview || card.nextReview);
    return Math.exp(-t / S);
  }

  function calculateNextInterval(stability) {
    const targetRetention = 0.9;
    const interval = -stability * Math.log(targetRetention);
    return Math.max(1, Math.round(interval));
  }

  const [session, setSession] = useState([]);
  const [index, setIndex] = useState(0);
  const [showBack, setShowBack] = useState(false);
  const [studyStarted, setStudyStarted] = useState(false);
  const [startTime, setStartTime] = useState(null);
  const [todayCount, setTodayCount] = useState(0);
  const [tab, setTab] = useState("today"); // today | decks | add | stats
  const [loading, setLoading] = useState(false);


  function startSession() {
    if (!activeDeck) return;

    const due = getDue(activeDeck.cards);
    if (due.length === 0) return;

    setSession(due);
    setIndex(0);
    setShowBack(false);
    setStartTime(Date.now());
    setStudyStarted(true);

    // ✅ vai direto para a aba Study
    setTab("study");
  }

  function pauseSession() {
    if (studyStarted && session.length > 0) {
      const sessionData = {
        deckId: activeDeckId,
        session,
        index,
        showBack,
        startDate: getDateKey()
      };

      localStorage.setItem("partialSession", JSON.stringify(sessionData));

      setSession([]);
      setIndex(0);
      setShowBack(false);
      setStartTime(null);
      setTab("today");
      setStudyStarted(false);
    }


    setSession([]);
    setIndex(0);
    setShowBack(false);
    setStartTime(null);
    setTab("today");
    setStudyStarted(false);
  }

  function endSession() {
    localStorage.removeItem("partialSession");

    setSession([]);
    setIndex(0);
    setShowBack(false);
    setStartTime(null);
    setTab("today");
    setStudyStarted(false);
  }

  function nextCard(newIndex) {
    setIndex(newIndex);
    setShowBack(false);
    setStartTime(Date.now());
  }

  // 🔥 STREAK UPDATE
  function updateStreak() {
    const todayKey = getDateKey();
    const yesterdayKey = getYesterdayKey();

    const saved = localStorage.getItem("streakData");
    let lastStudyDate = null;
    let currentStreak = 0;

    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        lastStudyDate = parsed.lastStudyDate || null;
        currentStreak = Number(parsed.streak || 0);
      } catch {
        lastStudyDate = null;
        currentStreak = 0;
      }
    }

    // Se já contou hoje, não altera
    if (lastStudyDate === todayKey) {
      setStreak(currentStreak);
      return;
    }

    // Continua sequência
    if (lastStudyDate === yesterdayKey) {
      currentStreak += 1;
    } else {
      // Nova sequência
      currentStreak = 1;
    }

    const newData = { lastStudyDate: todayKey, streak: currentStreak };
    localStorage.setItem("streakData", JSON.stringify(newData));
    setStreak(currentStreak);
  }

  async function rate(quality) {
    const card = session[index];
    const responseTime = Date.now() - startTime;

    const sm2 = calculateSM2(card, quality);
    const newStability = calculateStability(card, quality, sm2.interval);
    const idealInterval = calculateNextInterval(newStability);

    const next = new Date();
    next.setDate(next.getDate() + idealInterval);

    const updatedCard = {
      ...card,
      ...sm2,
      stability: newStability,
      interval: idealInterval,
      nextReview: next.toISOString(),
      lastReview: new Date().toISOString(),
      reviewHistory: [
        ...(card.reviewHistory || []),
        { quality, responseTime, date: new Date().toISOString() }
      ]
    };

    let saved = false;

    if (studyMode === "topic") {
      saved = await updateSingleCardInDeck(card.deckId, updatedCard);
    } else {
      const updated = activeDeck.cards.map(c =>
        c.id === card.id ? updatedCard : c
      );

      saved = await updateCards(updated);
    }

    if (!saved) return;

    setSession(prev =>
      prev.map((c, i) => (i === index ? updatedCard : c))
    );

    setTodayCount(prev => prev + 1);
    updateStreak();

    if (index + 1 < session.length) {
      nextCard(index + 1);
    } else {
      setSession([]);
      setStudyStarted(false);
      setStudyMode("deck");
      setStudyTopic(null);
      localStorage.removeItem("partialSession");
    }
  }

  const cards = activeDeck?.cards || [];
  const dueCount = getDue(cards).length;
  const newCardsCount = cards.filter(c => c.repetition === 0).length;
  const progressPercent = Math.min((todayCount / DAILY_GOAL) * 100, 100);

  const averageStability =
    cards.length > 0
      ? cards.reduce((sum, c) => sum + (c.stability || 1), 0) / cards.length
      : 0;

  const averageRetention =
    cards.length > 0
      ? cards.reduce((sum, c) => sum + calculateRetention(c), 0) / cards.length
      : 0;

  const allReviews = allDecks.flatMap(deck =>
    (deck.cards || []).flatMap(card => card.reviewHistory || [])
  );

  const averageResponseTime =
    allReviews.length > 0
      ? allReviews.reduce((sum, r) => sum + r.responseTime, 0) /
      allReviews.length /
      1000
      : 0;

  // ✅ INSIGHTS AUTOMÁTICOS
  const hardRate =
    allReviews.length > 0
      ? allReviews.filter(r => r.quality <= 3).length / allReviews.length
      : 0;

  function getInsight({ dueCount, averageRetention, averageResponseTime, hardRate }) {
    if (dueCount === 0) {
      return "✅ Você está em dia. Se quiser acelerar, adicione cartas novas ou faça uma revisão leve.";
    }

    if (averageRetention > 0.9 && averageResponseTime < 2.5) {
      return "🚀 Você está muito bem: alta retenção e respostas rápidas. Pode aumentar o volume ou adicionar conteúdo mais difícil.";
    }

    if (hardRate >= 0.45) {
      return "🧠 Muitas avaliações estão caindo em ‘Difícil/Esqueci’. Dica: reduza o ritmo de cartas novas e revise mais cedo.";
    }

    if (averageRetention < 0.75) {
      return "📉 Sua retenção está baixa. Sugestão: faça sessões mais curtas e frequentes (2–3 por dia) para reforçar o espaçamento.";
    }

    if (averageResponseTime > 6) {
      return "⏱️ Você está demorando mais para responder. Talvez as cartas estejam longas — tente quebrar em partes menores.";
    }

    return `🎯 Você tem ${dueCount} cartas para hoje. Priorize constância: 10–15 minutos já mantêm o cérebro em evolução.`;
  }

  const insightText = getInsight({
    dueCount,
    averageRetention,
    averageResponseTime,
    hardRate
  });

  function getLocalDateKey(dateInput) {
    const date = new Date(dateInput);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function getWeeklyData() {
    const today = new Date();
    const data = [];

    for (let i = 6; i >= 0; i--) {
      const day = new Date();
      day.setDate(today.getDate() - i);

      const dayString = getLocalDateKey(day);

      const count = allReviews.filter(r => {
        if (!r?.date) return false;
        return getLocalDateKey(r.date) === dayString;
      }).length;

      data.push({
        label: day.toLocaleDateString("pt-BR", { weekday: "short" }),
        count
      });
    }

    return data;
  }

  const weeklyData = getWeeklyData();
  const maxWeekly = Math.max(...weeklyData.map(d => d.count), 1);

  function getCognitiveLevel(stability) {
    if (stability < 3) return "Iniciante 🐣";
    if (stability < 8) return "Aprendiz 📘";
    if (stability < 15) return "Intermediário 🚀";
    if (stability < 30) return "Avançado 🧠";
    return "Elite 🏆";
  }

  const container = {
    width: "100%",
    maxWidth: 420,
    margin: "0 auto",
    padding: 20,
    boxSizing: "border-box",
    overflowX: "hidden",
    fontFamily: "'Inter', sans-serif",
    background: dark
      ? "linear-gradient(180deg, #0f0f14, #1a1a22)"
      : "#f2f2f2",
    color: dark ? "#fff" : "#000",
    minHeight: "100vh"
  };

  const premiumHero = {
    padding: 20,
    borderRadius: 24,
    background: dark
      ? "linear-gradient(135deg, rgba(124,92,255,0.22), rgba(90,139,255,0.16))"
      : "linear-gradient(135deg, rgba(124,92,255,0.12), rgba(90,139,255,0.10))",
    border: dark
      ? "1px solid rgba(124,92,255,0.35)"
      : "1px solid rgba(124,92,255,0.18)",
    boxShadow: dark
      ? "0 12px 40px rgba(0,0,0,0.28)"
      : "0 12px 30px rgba(124,92,255,0.10)"
  };

  const premiumBadge = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 12px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 800,
    background: dark ? "rgba(255,215,0,0.12)" : "rgba(255,215,0,0.18)",
    border: "1px solid rgba(255,215,0,0.32)",
    color: dark ? "#FFD76A" : "#8A6300"
  };

  const premiumFeatureCard = {
    padding: 16,
    borderRadius: 18,
    background: dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
    border: dark ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(0,0,0,0.06)"
  };

  const premiumCompareCard = {
    flex: 1,
    minWidth: 240,
    padding: 16,
    borderRadius: 18,
    background: dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
    border: dark ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(0,0,0,0.06)"
  };

  const box = {
    background: dark ? "#1e1e1e" : "#fff",
    borderRadius: 18,
    padding: 18,
    marginBottom: 16
  };

  const formContainer = {
    maxWidth: 500,
    margin: "0 auto"
  };

  const flipSound = new Audio();
  flipSound.src = "/flip.mp3";

  const formWidth = 320;

  const input = {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 12,
    border: dark
      ? "1px solid rgba(255,255,255,0.10)"
      : "1px solid rgba(0,0,0,0.08)",
    background: dark
      ? "rgba(255,255,255,0.06)"
      : "#fff",
    color: dark ? "#fff" : "#111",
    fontSize: 14,
    outline: "none",
    boxSizing: "border-box",
    appearance: "none",
    WebkitAppearance: "none"
  };

  const inputStyle = {
    width: 350,
    maxWidth: "100%",
    padding: 12,
    marginBottom: 10,
    borderRadius: 10,
    border: "1px solid #ccc",
    fontSize: 14,
    outline: "none",
    boxSizing: "border-box"
  };

  const button = {
    padding: 14,
    width: "100%",
    borderRadius: 14,
    border: "none",
    marginTop: 10,
    fontWeight: "bold",
    cursor: "pointer",
    fontSize: 16
  };
  const tabsBar = {
    display: "flex",
    gap: 6,
    padding: 8,
    borderRadius: 16,
    background: dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)",
    border: dark ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(0,0,0,0.06)",
    marginBottom: 16,
    overflowX: "auto",
    WebkitOverflowScrolling: "touch",
    cursor: "grab",
    userSelect: "none"
  };

  const tabBtn = {
    padding: "10px 14px",
    borderRadius: 14,
    border: "none",
    cursor: "pointer",
    fontWeight: 800,
    fontSize: 12,
    letterSpacing: 0.1,
    background: "transparent",
    color: dark ? "rgba(255,255,255,0.75)" : "rgba(0,0,0,0.7)",
    whiteSpace: "nowrap",
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center"
  };

  const tabBtnActive = {
    background: dark
      ? "linear-gradient(135deg, rgba(124,58,237,0.9), rgba(236,72,153,0.8))"
      : "linear-gradient(135deg, rgba(37,99,235,0.9), rgba(16,185,129,0.85))",
    color: "#fff",
    boxShadow: dark ? "0 10px 25px rgba(0,0,0,0.35)" : "0 10px 25px rgba(0,0,0,0.12)"
  };

  const hintBox = {
    ...box,
    background: dark ? "rgba(255,255,255,0.06)" : "#fff",
    border: dark ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(0,0,0,0.06)"
  };
  const headerBox = {
    padding: "16px 18px",
    borderRadius: 24,

    background: dark
      ? "linear-gradient(135deg, #1c1c1c, #121212)"
      : "linear-gradient(135deg, #ffffff, #f8fafc)",

    border: dark
      ? "1px solid rgba(255,255,255,0.06)"
      : "1px solid rgba(0,0,0,0.05)",

    boxShadow: dark
      ? "0 10px 30px rgba(0,0,0,0.35)"
      : "0 10px 30px rgba(0,0,0,0.06)",

    backdropFilter: "blur(10px)",

    marginBottom: 10
  };

  const headerTitle = {
    fontSize: "22px",
    fontWeight: "bold",
    marginBottom: "10px"
  };

  const headerProgressBar = {
    width: "100%",
    height: "10px",
    background: "#333",
    borderRadius: "10px",
    overflow: "hidden"
  };

  const headerProgressFill = {
    height: "100%",
    width: `${progressPercent}%`,
    background: "linear-gradient(90deg, #4CAF50, #81C784)",
    transition: "0.4s",
    borderRadius: 10
  };

  const noteInputStyle = {
    width: "100%",
    padding: "14px 16px",
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.04)",
    color: "#fff",
    fontSize: 15,
    outline: "none",
  };

  const noteTextareaStyle = {
    width: "100%",
    minHeight: 360,
    padding: "16px",
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.04)",
    color: "#fff",
    fontSize: 16,
    lineHeight: 1.8,
    outline: "none",
    resize: "vertical",
  };

  const primaryButtonStyle = {
    border: "none",
    borderRadius: 14,
    padding: "12px 18px",
    fontWeight: 700,
    cursor: "pointer",
    background: "linear-gradient(135deg, #7c3aed, #6366f1)",
    color: "#fff",
  };

  const secondaryButtonStyle = {
    border: "none",
    borderRadius: 14,
    padding: "12px 18px",
    fontWeight: 700,
    cursor: "pointer",
    background: "#fff",
    color: "#111",
  };

  if (authLoading || (user && userDataLoading)) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: dark ? "#121212" : "#f5f7fb",
          color: dark ? "#fff" : "#111",
          padding: 24
        }}
      >
        <div style={{ textAlign: "center" }}>
          <img
            src="/logo-192.png"
            alt="Don't Forget It logo"
            style={{
              width: 48,
              height: 48,
              objectFit: "contain",
              borderRadius: 12,
              marginBottom: 12,
              opacity: 0.9
            }}
          />

          <p style={{ margin: 0, opacity: 0.8 }}>
            Carregando sua conta...
          </p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: dark ? "#121212" : "#f5f5f5",
          padding: 20
        }}
      >
        {toast && (
          <div
            style={{
              position: "fixed",
              bottom: 30,
              left: "50%",
              transform: "translateX(-50%)",
              background:
                toast.type === "success"
                  ? "linear-gradient(135deg, #7C5CFF, #5A8BFF)"
                  : "rgba(0,0,0,0.85)",
              color: "#fff",
              padding: "14px 20px",
              borderRadius: 14,
              fontSize: 14,
              fontWeight: 600,
              boxShadow: "0 12px 40px rgba(0,0,0,0.3)",
              zIndex: 10001,
              opacity: 1,
              animation: "fadeInUp 0.4s ease",
              maxWidth: "90%",
              textAlign: "center"
            }}
          >
            {toast.message}
          </div>
        )}

        <div
          style={{
            width: "100%",
            maxWidth: 380,
            padding: 28,
            borderRadius: 24,
            background: dark ? "#1e1e1e" : "#ffffff",
            boxShadow: dark
              ? "0 20px 50px rgba(0,0,0,0.35)"
              : "0 20px 50px rgba(0,0,0,0.12)",
            textAlign: "center"
          }}
        >
          <div style={{ marginBottom: 14 }}>
            <img
              src="/logo-192.png"
              alt="Don't Forget It logo"
              style={{
                width: 56,
                height: 56,
                objectFit: "contain",
                borderRadius: 14,
                display: "block",
                margin: "0 auto"
              }}
            />
          </div>

          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900 }}>
            Don't Forget It
          </h1>

          <p style={{ fontSize: 14, opacity: 0.75, marginTop: 10, marginBottom: 24 }}>
            O sistema de memória que se adapta ao seu cérebro em tempo real.
          </p>

          <input
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="Email"
            style={inputStyle}
          />

          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Senha"
            style={inputStyle}
          />

          <button
            onClick={authMode === "login" ? handleLogin : handleRegister}
            style={{
              ...button,
              background: "linear-gradient(135deg, #7C5CFF, #5A8BFF)",
              color: "#fff",
              width: "100%",
              marginTop: 8,
              boxShadow: "0 8px 30px rgba(124,92,255,0.25)"
            }}
          >
            {authMode === "login" ? "Entrar" : "Criar conta"}
          </button>

          <button
            onClick={handleGoogleLogin}
            style={{
              ...button,
              background: dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)",
              color: dark ? "#fff" : "#111",
              border: dark ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(0,0,0,0.08)",
              width: "100%",
              marginTop: 10
            }}
          >
            Entrar com Google
          </button>

          <p
            onClick={() => setAuthMode(authMode === "login" ? "register" : "login")}
            style={{
              marginTop: 14,
              fontSize: 14,
              textAlign: "center",
              opacity: 0.8,
              cursor: "pointer"
            }}
          >
            {authMode === "login"
              ? "Não tem uma conta? Cadastre-se"
              : "Já tem uma conta? Entrar"}
          </p>
        </div>
      </div>
    );
  }

  if (studyStarted && activeDeck && session.length > 0) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: dark ? "#121212" : "#f5f5f5",
          padding: 20,
          display: "flex",
          justifyContent: "center",
          alignItems: "center"
        }}
      >
        <div style={{ width: "100%", maxWidth: 620 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              marginBottom: 18
            }}
          >
            <button
              onClick={pauseSession}
              style={{
                ...button,
                background: "rgba(255,255,255,0.06)",
                color: "#fff",
                border: "1px solid rgba(255,255,255,0.08)",
                flex: 1
              }}
            >
              ⏸️ Pausar
            </button>

            <div style={{ marginBottom: 10 }}>
              <div style={{ fontWeight: 900, fontSize: 22, opacity: 0.8 }}>
                {index + 1}/{session.length}
              </div>

              {studyMode === "topic" && (
                <div style={{ marginTop: 6, fontSize: 13, opacity: 0.8 }}>
                  Sessão do tópico: <strong>{studyTopic}</strong>
                </div>
              )}

              {studyMode === "topic" && session[index]?.deckName && (
                <div style={{ marginTop: 4, fontSize: 12, opacity: 0.7 }}>
                  Deck: {session[index].deckName}
                </div>
              )}
            </div>

            <button
              onClick={endSession}
              style={{
                ...button,
                background: "rgba(255,255,255,0.06)",
                color: "#fff",
                border: "1px solid rgba(255,255,255,0.08)",
                flex: 1
              }}
            >
              ⛔ Encerrar
            </button>
          </div>

          <div
            style={{
              perspective: "1200px",
              marginTop: 10
            }}
          >
            <div
              onClick={() => {
                flipSound.currentTime = 0;
                flipSound.play();
                setShowBack(!showBack);
              }}
              style={{
                position: "relative",
                width: "100%",
                minHeight: 260,
                transformStyle: "preserve-3d",
                transition: "transform 600ms cubic-bezier(.2,.8,.2,1)",
                transform: showBack ? "rotateY(180deg)" : "rotateY(0deg)",
                cursor: "pointer"
              }}
            >
              {/* FRENTE */}
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  padding: 24,
                  borderRadius: 24,
                  background: dark ? "#1a1a1d" : "#ffffff",
                  border: dark ? "1px solid rgba(255,255,255,0.06)" : "1px solid rgba(0,0,0,0.06)",
                  backfaceVisibility: "hidden",
                  WebkitBackfaceVisibility: "hidden",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  textAlign: "center",
                  fontSize: 28,
                  fontWeight: 800,
                  lineHeight: 1.25,
                  color: dark ? "#fff" : "#111",
                  boxShadow: dark ? "0 18px 45px rgba(0,0,0,0.35)" : "0 18px 45px rgba(0,0,0,0.10)"
                }}
              >
                {session[index].question}
              </div>

              {/* VERSO */}
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  padding: 24,
                  borderRadius: 24,
                  background: dark ? "#202024" : "#ffffff",
                  border: dark ? "1px solid rgba(255,255,255,0.06)" : "1px solid rgba(0,0,0,0.06)",
                  backfaceVisibility: "hidden",
                  WebkitBackfaceVisibility: "hidden",
                  transform: "rotateY(180deg)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  textAlign: "center",
                  fontSize: 24,
                  fontWeight: 700,
                  lineHeight: 1.3,
                  color: dark ? "#fff" : "#111",
                  boxShadow: dark ? "0 18px 45px rgba(0,0,0,0.35)" : "0 18px 45px rgba(0,0,0,0.10)"
                }}
              >
                {session[index].answer}
              </div>
            </div>

            <p
              style={{
                marginTop: 12,
                marginBottom: 0,
                fontSize: 13,
                opacity: 0.7,
                textAlign: "center"
              }}
            >
              Toque na carta para virar
            </p>
            <button
              onClick={() => {
                const card = session[index];

                const text = showBack
                  ? card.answer
                  : card.question;

                const lang = showBack
                  ? card.answerLang
                  : card.questionLang;

                if (shouldSpeak(lang, text)) {
                  speakWithAI(text, lang);
                }
              }}
              style={{
                marginTop: 12,
                border: "none",
                background: "transparent",
                color: dark ? "#fff" : "#111",
                fontSize: 20,
                cursor: "pointer",
                opacity: 0.85,
                display: "block",
                marginLeft: "auto",
                marginRight: "auto"
              }}
            >
              🔊
            </button>
          </div>

          {showBack && (
            <div
              style={{
                marginTop: 22,
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12
              }}
            >
              <button
                onClick={() => rate(2)}
                style={{
                  ...button,
                  background: "linear-gradient(135deg, #7C5CFF, #5A8BFF)",
                  color: "#fff",
                  boxShadow: "0 8px 30px rgba(124,92,255,0.25)"
                }}
              >
                ❌ Esqueci
              </button>

              <button
                onClick={() => rate(3)}
                style={{
                  ...button,
                  background: "rgba(255,255,255,0.06)",
                  color: "#fff",
                  border: "1px solid rgba(255,255,255,0.08)"
                }}
              >
                ⚠️ Difícil
              </button>

              <button
                onClick={() => rate(4)}
                style={{
                  ...button,
                  background: "rgba(255,255,255,0.06)",
                  color: "#fff",
                  border: "1px solid rgba(255,255,255,0.08)"
                }}
              >
                👍 Bom
              </button>

              <button
                onClick={() => rate(5)}
                style={{
                  ...button,
                  background: "linear-gradient(135deg, #7C5CFF, #5A8BFF)",
                  color: "#fff",
                  boxShadow: "0 8px 30px rgba(124,92,255,0.25)"
                }}
              >
                🚀 Fácil
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }
  return (
    <div style={container}>
      <style>{toastAnimation + hideScrollbar + drawerAnimation}</style>
      <style>
        {`
/* esconder scroll do modal premium */
.premium-modal::-webkit-scrollbar {
  display: none;
}
`}
      </style>
      <div style={headerBox}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 14,
            padding: "2px 0"
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              minWidth: 0,
              flex: 1
            }}
          >
            <img
              src="/logo-192.png"
              alt="Don't Forget It logo"
              style={{
                width: 36,
                height: 36,
                objectFit: "contain",
                borderRadius: 10,
                flexShrink: 0
              }}
            />

            <h1
              style={{
                fontSize: 18,
                margin: 0,
                fontWeight: 900,
                letterSpacing: -0.8,
                color: dark ? "#fff" : "#111",
                lineHeight: 1.2,
                paddingBottom: 1,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              Don't Forget It
            </h1>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexShrink: 0
            }}
          >
            <button
              onClick={() => setShowSettings(true)}
              title="Configurações"
              style={{
                width: 38,
                height: 38,
                border: "none",
                borderRadius: 12,
                background: dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)",
                fontSize: 18,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0
              }}
            >
              ⚙️
            </button>

            <button
              onClick={() => setDark(!dark)}
              title="Alternar tema"
              style={{
                width: 38,
                height: 38,
                border: "none",
                borderRadius: 12,
                background: dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
                color: dark ? "#fff" : "#000",
                fontSize: 16,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0
              }}
            >
              {dark ? "🌙" : "☀️"}
            </button>
          </div>
        </div>

        {activeDeck && (
          <>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginTop: 14,
                gap: 10
              }}
            >
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 10px",
                  borderRadius: 999,
                  fontSize: 12,
                  fontWeight: 900,
                  background: "rgba(76,175,80,0.14)",
                  border: "1px solid rgba(76,175,80,0.25)",
                  color: dark ? "#eaffea" : "#0b3d0b"
                }}
              >
                <span style={{ width: 8, height: 8, borderRadius: 999, background: "#4CAF50", display: "inline-block" }} />
                {activeDeck.name}
              </div>

              <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.9 }}>
                {getCognitiveLevel(averageStability)}
              </div>
            </div>

            <div style={{ marginTop: 10 }}>
              <div style={headerProgressBar}>
                <div style={headerProgressFill} />
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 12, opacity: 0.75 }}>
                <span>Meta diária</span>
                <span style={{ fontWeight: 900 }}>{todayCount}/{DAILY_GOAL}</span>
              </div>
            </div>
          </>
        )}
      </div>
      {/* Tabs (cara de app) */}
      {/* Tabs (cara de app) */}
      {!studyStarted && (
        <div
          ref={tabsBarRef}
          style={tabsBar}
          className="hide-scrollbar"
          onMouseDown={handleTabsMouseDown}
          onMouseMove={handleTabsMouseMove}
          onMouseUp={handleTabsMouseUp}
          onMouseLeave={handleTabsMouseLeave}
        >
          <button
            onClick={() => setTab("today")}
            style={{ ...tabBtn, ...(tab === "today" ? tabBtnActive : {}) }}
          >
            {t("today")}
          </button>

          <button
            onClick={() => setTab("decks")}
            style={{ ...tabBtn, ...(tab === "decks" ? tabBtnActive : {}) }}
          >
            {t("decks")}
          </button>

          <button
            onClick={() => setTab("add")}
            style={{ ...tabBtn, ...(tab === "add" ? tabBtnActive : {}) }}
          >
            {t("add")}
          </button>

          <button
            onClick={() => setTab("notes")}
            style={{ ...tabBtn, ...(tab === "notes" ? tabBtnActive : {}) }}
          >
            Notas
          </button>

          <button
            onClick={() => setTab("stats")}
            style={{ ...tabBtn, ...(tab === "stats" ? tabBtnActive : {}) }}
          >
            {t("stats")}
          </button>

          <button
            onClick={() => setTab("premium")}
            style={{ ...tabBtn, ...(tab === "premium" ? tabBtnActive : {}) }}
          >
            ✨ {t("premium")}
          </button>
        </div>
      )}

      {/* Tema (mantive, mas agora fica numa “área” e não espalhado) */}

      {/* ABA: DECKS */}
      {tab === "decks" && (
        <>
          <div style={{ ...box, ...formContainer }}>
            <h3>{t("createDeck")}</h3>
            <input
              value={newDeck}
              onChange={e => setNewDeck(e.target.value)}
              placeholder={t("newDeckName")}
              style={inputStyle}
            />
            <input
              value={deckTopic}
              onChange={e => setDeckTopic(e.target.value)}
              placeholder="Tópico / grupo (ex: Inglês, Espanhol, Direito Penal)"
              style={inputStyle}
            />
            <button
              onClick={createDeck}
              style={{ ...button, background: "#2196F3", color: "#fff" }}
            >
              {t("createDeck")}
            </button>
          </div>

          <div style={box}>
            <h3>Decks</h3>
            <select
              value={activeDeckId || ""}
              onChange={e => setActiveDeckId(e.target.value || null)}
              style={{ width: "100%", padding: 10 }}
            >
              <option value="">Select Deck</option>
              {allDecks.map(d => (
                <option key={d.id} value={d.id}>
                  {d.isBuiltIn
                    ? `📦 ${d.name}`
                    : `👤 ${d.name}`
                  }
                </option>
              ))}
            </select>

            {activeDeck && (
              <div
                style={{
                  ...box,
                  marginTop: 14
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    gap: 12,
                    flexWrap: "wrap"
                  }}
                >
                  <div>
                    <h3 style={{ marginTop: 0, marginBottom: 8 }}>
                      {activeDeck.name}
                    </h3>

                    <p style={{ margin: "0 0 6px 0", opacity: 0.8, fontSize: 14 }}>
                      Tópico: <strong>{activeDeck.topic || "Geral"}</strong>
                    </p>

                    <p style={{ margin: 0, opacity: 0.8, fontSize: 14 }}>
                      {getDue(activeDeck.cards || []).length > 0
                        ? `${getDue(activeDeck.cards || []).length} para revisar`
                        : "Você está em dia — prática livre disponível"}
                    </p>
                  </div>

                  <button
                    onClick={() => startDeckStudy(activeDeck)}
                    style={{
                      ...button,
                      width: "auto",
                      padding: "12px 16px",
                      background: "linear-gradient(135deg, #7C5CFF, #5A8BFF)",
                      color: "#fff"
                    }}
                  >
                    ▶️ Estudar deck
                  </button>
                </div>
              </div>
            )}

            {activeDeck && !isPresetDeck && (
              <button
                onClick={() => deleteDeck(activeDeck.id)}
                style={{
                  ...button,
                  background: dark ? "rgba(255,255,255,0.06)" : "rgba(220,0,0,0.08)",
                  color: dark ? "#fff" : "#B00020",
                  border: dark
                    ? "1px solid rgba(255,255,255,0.08)"
                    : "1px solid rgba(176,0,32,0.18)"
                }}
              >
                🗑️ {t("deleteDeck")}
              </button>
            )}

            {!activeDeck && (
              <p style={{ marginTop: 10, opacity: 0.75 }}>
                Selecione um deck para estudar e adicionar cartas.
              </p>
            )}
          </div>
        </>
      )}

      {activeDeck && isPresetDeck && (
        <div
          style={{
            marginTop: 14,
            padding: 14,
            borderRadius: 16,
            background: dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
            border: isActiveDeckPremium
              ? "1px solid rgba(255, 215, 0, 0.28)"
              : dark
                ? "1px solid rgba(255,255,255,0.08)"
                : "1px solid rgba(0,0,0,0.06)"
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
              marginBottom: 8
            }}
          >
            <p style={{ marginTop: 0, marginBottom: 0, fontWeight: 800 }}>
              {activeDeck.name}
            </p>

            {isActiveDeckPremium && (
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 800,
                  padding: "4px 8px",
                  borderRadius: 999,
                  background: dark ? "rgba(255,215,0,0.12)" : "rgba(255,215,0,0.18)",
                  border: "1px solid rgba(255,215,0,0.32)",
                  color: dark ? "#FFD76A" : "#8A6300"
                }}
              >
                ✨ Premium
              </span>
            )}
          </div>

          {activeDeck.description && (
            <p
              style={{
                fontSize: 13,
                opacity: 0.75,
                marginTop: 0,
                marginBottom: isLockedPresetDeck ? 8 : 14,
                lineHeight: 1.5
              }}
            >
              {activeDeck.description}
            </p>
          )}

          {isLockedPresetDeck && (
            <div
              style={{
                marginBottom: 14,
                padding: 12,
                borderRadius: 14,
                background: dark ? "rgba(255,215,0,0.08)" : "rgba(255,215,0,0.12)",
                border: "1px solid rgba(255,215,0,0.22)"
              }}
            >
              <p
                style={{
                  fontSize: 13,
                  marginTop: 0,
                  marginBottom: 8,
                  lineHeight: 1.5,
                  color: dark ? "#FFD76A" : "#8A6300",
                  fontWeight: 700
                }}
              >
                Este deck faz parte da experiência Premium.
              </p>

              <button
                onClick={() => setTab("premium")}
                style={{
                  ...button,
                  background: "linear-gradient(135deg, #7C5CFF, #5A8BFF)",
                  color: "#fff",
                  boxShadow: "0 8px 24px rgba(124,92,255,0.22)"
                }}
              >
                ✨ Ver Premium
              </button>
            </div>
          )}

          <button
            onClick={addPresetDeckToAccount}
            disabled={loading}
            style={{
              ...button,
              background: isLockedPresetDeck
                ? dark
                  ? "rgba(255,255,255,0.08)"
                  : "rgba(0,0,0,0.08)"
                : "linear-gradient(135deg, #7C5CFF, #5A8BFF)",
              color: "#fff",
              boxShadow: isLockedPresetDeck
                ? "none"
                : "0 8px 30px rgba(124,92,255,0.25)",
              opacity: loading ? 0.7 : isLockedPresetDeck ? 0.9 : 1,
              cursor: loading ? "not-allowed" : "pointer"
            }}
          >
            {loading
              ? "Salvando..."
              : isLockedPresetDeck
                ? "🔒 Disponível no Premium"
                : "Adicionar à minha conta"}
          </button>
        </div>
      )}

      {tab === "settings" && (
        <div style={box}>
          <h3>⚙️ {t("settings")}</h3>

          <div
            style={{
              marginTop: 16,
              padding: 14,
              borderRadius: 16,
              background: dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
              border: dark ? "1px solid rgba(255,255,255,0.10)" : "1px solid rgba(0,0,0,0.08)"
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 800, opacity: 0.75 }}>
              🔔 {t("reminder")}
            </div>

            <div style={{ marginTop: 8, fontSize: 14, opacity: 0.8 }}>
              Receba um lembrete para entrar no app e estudar.
            </div>

            <input
              type="time"
              value={userData?.notifications?.time || "20:00"}
              onChange={(e) =>
                updateNotificationSettings({ time: e.target.value })
              }
              style={{
                ...input,
                marginTop: 10
              }}
            />

            {!userData?.notifications?.enabled ? (
              <button
                onClick={enableReminder}
                style={{
                  ...button,
                  marginTop: 10,
                  background: "linear-gradient(135deg, #7C5CFF, #5A8BFF)",
                  color: "#fff"
                }}
              >
                {t("activate")}
              </button>
            ) : (
              <button
                onClick={() =>
                  updateNotificationSettings({ enabled: false })
                }
                style={{
                  ...button,
                  marginTop: 10
                }}
              >
                {t("deactivate")}
              </button>
            )}
          </div>
          <div
            style={{
              marginTop: 20,
              padding: 14,
              borderRadius: 16,
              background: dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)"
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 800, opacity: 0.75 }}>
              🌍 Idioma
            </div>

            <select
              value={userData?.language || "pt"}
              onChange={async (e) => {
                const newLang = e.target.value;

                const userRef = doc(db, "users", user.uid);

                await updateDoc(userRef, {
                  language: newLang,
                  updatedAt: serverTimestamp()
                });

                setUserData(prev => ({
                  ...prev,
                  language: newLang
                }));
              }}
              style={{
                ...input,
                marginTop: 10,
                backgroundColor: dark ? "#23233A" : "#fff",
                color: dark ? "#fff" : "#111"
              }}
            >
              <option value="pt" style={{ color: "#111", backgroundColor: "#fff" }}>
                Português
              </option>
              <option value="en" style={{ color: "#111", backgroundColor: "#fff" }}>
                English
              </option>
            </select>
          </div>
        </div>
      )}

      {/* ABA: ADICIONAR */}
      {tab === "add" && (
        activeDeck ? (
          <div style={{ ...box, ...formContainer }}>
            <h3>➕ {t("addCardTitle")}</h3>

            <textarea
              value={front}
              onChange={e => setFront(e.target.value)}
              placeholder={t("question")}
              style={{ ...inputStyle, minHeight: 80, resize: "none" }}
            />

            <textarea
              value={back}
              onChange={e => setBack(e.target.value)}
              placeholder={t("answer")}
              style={{ ...inputStyle, minHeight: 80, resize: "none" }}
            />

            <button
              onClick={addCard}
              style={{ ...button, background: "#9C27B0", color: "#fff" }}
            >
              {t("addCard")}
            </button>
          </div>
        ) : (
          <div style={{ ...box, ...formContainer }}>
            <h3>➕ {t("addCardTitle")}</h3>

            <p style={{ marginTop: 0, opacity: 0.82, lineHeight: 1.6 }}>
              Nenhum deck foi selecionado ainda.
            </p>

            <div
              style={{
                marginTop: 14,
                padding: 14,
                borderRadius: 14,
                background: dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
                border: dark
                  ? "1px solid rgba(255,255,255,0.08)"
                  : "1px solid rgba(0,0,0,0.06)"
              }}
            >
              <p style={{ marginTop: 0, marginBottom: 8, fontWeight: 700 }}>
                Selecione um deck para começar
              </p>

              <p style={{ margin: 0, opacity: 0.8, lineHeight: 1.5 }}>
                Escolha um deck na aba de decks para adicionar cartas manualmente.
              </p>
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
              <button
                onClick={() => setTab("decks")}
                style={{
                  ...button,
                  width: "auto",
                  padding: "12px 16px"
                }}
              >
                Ir para Decks
              </button>
            </div>
          </div>
        )
      )}

      {/* ABA: NOTAS */}
      {tab === "notes" && (
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ ...box, ...formContainer }}>
            <h3 style={{ marginTop: 0 }}>
              {editingNoteId ? "✏️ Editar nota" : "📝 Nova nota"}
            </h3>

            <input
              value={newNoteTitle}
              onChange={e => setNewNoteTitle(e.target.value)}
              placeholder="Título da nota"
              style={inputStyle}
            />

            <input
              value={newNoteTopic}
              onChange={e => setNewNoteTopic(e.target.value)}
              placeholder="Tópico (ex: Inglês, Espanhol, Física)"
              style={inputStyle}
            />

            <select
              value={noteFont}
              onChange={e => setNoteFont(e.target.value)}
              style={inputStyle}
            >
              <option value="Inter">Inter</option>
              <option value="Roboto">Roboto</option>
              <option value="Georgia">Georgia</option>
              <option value="Courier New">Courier New</option>
              <option value="Poppins">Poppins</option>
              <option value="Montserrat">Montserrat</option>

              <option value="Caveat">Caveat</option>
              <option value="Patrick Hand">Patrick Hand</option>
              <option value="Dancing Script">Dancing Script</option>
            </select>

            <textarea
              value={newNoteContent}
              onChange={e => setNewNoteContent(e.target.value)}
              placeholder="Escreva sua nota aqui..."
              style={{
                ...inputStyle,
                minHeight: 160,
                resize: "vertical",
                fontFamily: noteFont
              }}
            />

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                onClick={editingNoteId ? updateNoteItem : createNote}
                disabled={!editingNoteId && hasReachedNotesLimit}
                style={{
                  ...button,
                  background: "linear-gradient(135deg, #7C5CFF, #5A8BFF)",
                  color: "#fff",
                  width: "auto",
                  padding: "12px 16px",
                  opacity: !editingNoteId && hasReachedNotesLimit ? 0.5 : 1,
                  cursor: !editingNoteId && hasReachedNotesLimit ? "not-allowed" : "pointer"
                }}
              >
                {editingNoteId
                  ? "Salvar alterações"
                  : hasReachedNotesLimit
                    ? "Limite atingido"
                    : "Criar nota"}
              </button>

              {editingNoteId && (
                <button
                  onClick={cancelNoteEditing}
                  style={{
                    ...button,
                    width: "auto",
                    padding: "12px 16px"
                  }}
                >
                  Cancelar
                </button>
              )}
            </div>

            {/* indicador de uso */}
            {!isPremium && (
              <div style={{ fontSize: 12, opacity: 0.6, marginTop: 6 }}>
                {notes.length}/{FREE_NOTES_LIMIT} notas usadas
              </div>
            )}
            {hasReachedNotesLimit && !isPremium && (
              <div
                style={{
                  marginTop: 12,
                  padding: 12,
                  borderRadius: 12,
                  background: "rgba(124,92,255,0.1)",
                  border: "1px solid rgba(124,92,255,0.2)",
                  fontSize: 13
                }}
              >
                Você atingiu o limite de notas do plano gratuito.
                <br />
                <strong>Desbloqueie notas ilimitadas no Premium.</strong>
              </div>
            )}
          </div>

          <div style={box}>
            <h3 style={{ marginTop: 0 }}>📚 Suas notas</h3>

            {notesLoading ? (
              <p style={{ opacity: 0.8 }}>Carregando notas...</p>
            ) : notes.length === 0 ? (
              <p style={{ opacity: 0.8, lineHeight: 1.6 }}>
                Você ainda não criou nenhuma nota. Use essa área para organizar ideias
                e depois transformar isso em cards.
              </p>
            ) : (
              <div style={{ display: "grid", gap: 12 }}>
                {notes.map(note => (
                  <div
                    key={note.id}
                    onClick={() => setOpenedNote(note)}
                    style={{
                      padding: 14,
                      borderRadius: 16,
                      cursor: "pointer",
                      userSelect: "none", // 👈 evita cursor de texto
                      background: dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
                      border: dark
                        ? "1px solid rgba(255,255,255,0.08)"
                        : "1px solid rgba(0,0,0,0.06)"
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        gap: 12,
                        flexWrap: "wrap"
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 800, marginBottom: 6 }}>
                          {note.title}
                        </div>

                        <div style={{ fontSize: 13, opacity: 0.72, marginBottom: 8 }}>
                          Tópico: {note.topic || "Geral"}
                        </div>

                        <div
                          style={{
                            fontSize: 14,
                            opacity: 0.86,
                            lineHeight: 1.5,
                            whiteSpace: "pre-wrap",
                            fontFamily: note.font || "Inter",
                            letterSpacing: note.font === "Courier New" ? 0.5 : 0
                          }}
                        >
                          {note.content.length > 220
                            ? `${note.content.slice(0, 220)}...`
                            : note.content}
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            startEditNote(note);
                          }}
                          style={{
                            ...button,
                            width: "auto",
                            padding: "10px 12px"
                          }}
                        >
                          Editar
                        </button>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteNoteItem(note.id);
                          }}
                          style={{
                            ...button,
                            width: "auto",
                            padding: "10px 12px"
                          }}
                        >
                          Excluir
                        </button>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            showToast("Transformar em cards com IA será o próximo passo", "success");
                          }}
                          style={{
                            ...button,
                            width: "auto",
                            padding: "10px 12px",
                            background: "linear-gradient(135deg, #7C5CFF, #5A8BFF)",
                            color: "#fff"
                          }}
                        >
                          Gerar cards com IA
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {openedNote && (
        <div
          onClick={() => {
            setOpenedNote(null);
            setIsEditingOpenedNote(false);
            setEditedOpenedNoteTitle("");
            setEditedOpenedNoteContent("");
            setEditedOpenedNoteTopic("");
          }}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            zIndex: 10000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="hide-scrollbar"
            style={{
              width: "100%",
              maxWidth: 760,
              maxHeight: "88vh",
              overflowY: "auto",
              borderRadius: 24,
              padding: 24,
              background: dark ? "#1b1b1f" : "#ffffff",
              color: dark ? "#fff" : "#111",
              border: dark
                ? "1px solid rgba(255,255,255,0.08)"
                : "1px solid rgba(0,0,0,0.06)",
              boxShadow: "0 20px 60px rgba(0,0,0,0.35)"
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: 12,
                marginBottom: 18,
                flexWrap: "wrap"
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                {!isEditingOpenedNote ? (
                  <>
                    <h2
                      style={{
                        margin: 0,
                        marginBottom: 8,
                        fontSize: 28,
                        fontWeight: 900,
                        lineHeight: 1.15
                      }}
                    >
                      {openedNote.title}
                    </h2>

                    <div
                      style={{
                        fontSize: 13,
                        opacity: 0.72,
                        display: "flex",
                        gap: 10,
                        flexWrap: "wrap"
                      }}
                    >
                      <span>Tópico: {openedNote.topic || "Geral"}</span>
                      <span>Fonte: {openedNote.font || "Inter"}</span>
                    </div>
                  </>
                ) : (
                  <div style={{ display: "grid", gap: 10 }}>
                    <input
                      value={editedOpenedNoteTitle}
                      onChange={(e) => setEditedOpenedNoteTitle(e.target.value)}
                      placeholder="Título da nota"
                      style={{
                        width: "100%",
                        padding: "14px 16px",
                        borderRadius: 14,
                        border: dark
                          ? "1px solid rgba(255,255,255,0.12)"
                          : "1px solid rgba(0,0,0,0.10)",
                        background: dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
                        color: dark ? "#fff" : "#111",
                        fontSize: 16,
                        fontWeight: 700,
                        outline: "none"
                      }}
                    />

                    <input
                      value={editedOpenedNoteTopic}
                      onChange={(e) => setEditedOpenedNoteTopic(e.target.value)}
                      placeholder="Tópico"
                      style={{
                        width: "100%",
                        padding: "12px 16px",
                        borderRadius: 14,
                        border: dark
                          ? "1px solid rgba(255,255,255,0.12)"
                          : "1px solid rgba(0,0,0,0.10)",
                        background: dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
                        color: dark ? "#fff" : "#111",
                        fontSize: 14,
                        outline: "none"
                      }}
                    />

                    <div
                      style={{
                        fontSize: 13,
                        opacity: 0.72
                      }}
                    >
                      Fonte: {openedNote.font || "Inter"}
                    </div>
                  </div>
                )}
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  onClick={() => {
                    setOpenedNote(null);
                    setIsEditingOpenedNote(false);
                    setEditedOpenedNoteTitle("");
                    setEditedOpenedNoteContent("");
                    setEditedOpenedNoteTopic("");
                  }}
                  style={{
                    ...button,
                    width: "auto",
                    padding: "10px 14px"
                  }}
                >
                  Fechar
                </button>

                {!isEditingOpenedNote ? (
                  <button
                    onClick={() => setIsEditingOpenedNote(true)}
                    style={{
                      ...button,
                      width: "auto",
                      padding: "10px 14px",
                      background: "linear-gradient(135deg, #7C5CFF, #5A8BFF)",
                      color: "#fff"
                    }}
                  >
                    Editar nota
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => {
                        setIsEditingOpenedNote(false);
                        setEditedOpenedNoteTitle(openedNote?.title || "");
                        setEditedOpenedNoteContent(openedNote?.content || "");
                        setEditedOpenedNoteTopic(openedNote?.topic || "");
                      }}
                      style={{
                        ...button,
                        width: "auto",
                        padding: "10px 14px"
                      }}
                    >
                      Cancelar
                    </button>

                    <button
                      onClick={handleSaveOpenedNote}
                      style={{
                        ...button,
                        width: "auto",
                        padding: "10px 14px",
                        background: "linear-gradient(135deg, #7C5CFF, #5A8BFF)",
                        color: "#fff"
                      }}
                    >
                      Salvar
                    </button>
                  </>
                )}
              </div>
            </div>

            <div
              style={{
                padding: 22,
                borderRadius: 20,
                background: dark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.025)",
                border: dark
                  ? "1px solid rgba(255,255,255,0.06)"
                  : "1px solid rgba(0,0,0,0.05)"
              }}
            >
              {!isEditingOpenedNote ? (
                <div
                  style={{
                    fontSize: 17,
                    lineHeight: 1.8,
                    whiteSpace: "pre-wrap",
                    fontFamily: openedNote.font || "Inter"
                  }}
                >
                  {openedNote.content}
                </div>
              ) : (
                <textarea
                  value={editedOpenedNoteContent}
                  onChange={(e) => setEditedOpenedNoteContent(e.target.value)}
                  placeholder="Conteúdo da nota"
                  style={{
                    width: "100%",
                    minHeight: 360,
                    border: "none",
                    outline: "none",
                    resize: "vertical",
                    background: "transparent",
                    color: dark ? "#fff" : "#111",
                    fontSize: 16,
                    lineHeight: 1.8,
                    fontFamily: openedNote.font || "Inter"
                  }}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* ABA: HOJE */}
      {tab === "today" && (
        <>
          <div style={box}>
            <h3>🔥 {t("todayTitle")}</h3>

            {!hasUserDecks && (
              <div
                style={{
                  marginTop: 14,
                  padding: 14,
                  borderRadius: 16,
                  background: dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
                  border: dark ? "1px solid rgba(255,255,255,0.10)" : "1px solid rgba(0,0,0,0.08)"
                }}
              >
                <div style={{ fontWeight: 800, marginBottom: 8 }}>
                  📚 Nenhum deck ainda
                </div>

                <div style={{ fontSize: 14, opacity: 0.8, lineHeight: 1.5 }}>
                  Crie seu primeiro deck ou copie um deck pronto para começar a estudar.
                </div>

                <button
                  onClick={() => setTab("decks")}
                  style={{
                    ...button,
                    marginTop: 12,
                    background: "linear-gradient(135deg, #7C5CFF, #5A8BFF)",
                    color: "#fff"
                  }}
                >
                  Ir para Decks
                </button>
              </div>
            )}

            {/* Dashboard 2x2 */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
                marginTop: 12,
                marginBottom: 10
              }}
            >
              {/* Para revisar */}
              <div
                style={{
                  padding: 14,
                  borderRadius: 16,
                  background: dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
                  border: dark ? "1px solid rgba(255,255,255,0.10)" : "1px solid rgba(0,0,0,0.08)"
                }}
              >
                <div style={{ fontSize: 12, opacity: 0.75, fontWeight: 800 }}>
                  📚 {t("toReview")}
                </div>
                <div style={{ fontSize: 26, fontWeight: 900, marginTop: 6 }}>
                  {todayDueCount}
                </div>
              </div>

              {/* Cartas novas */}
              <div
                style={{
                  padding: 14,
                  borderRadius: 16,
                  background: dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
                  border: dark ? "1px solid rgba(255,255,255,0.10)" : "1px solid rgba(0,0,0,0.08)"
                }}
              >
                <div style={{ fontSize: 12, opacity: 0.75, fontWeight: 800 }}>
                  🆕 {t("newCards")}
                </div>
                <div style={{ fontSize: 26, fontWeight: 900, marginTop: 6 }}>
                  {todayNewCardsCount}
                </div>
              </div>

              {/* Meta diária */}
              <div
                style={{
                  padding: 14,
                  borderRadius: 16,
                  background: dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
                  border: dark ? "1px solid rgba(255,255,255,0.10)" : "1px solid rgba(0,0,0,0.08)"
                }}
              >
                <div style={{ fontSize: 12, opacity: 0.75, fontWeight: 800 }}>
                  🎯 {t("dailyGoal")}
                </div>
                <div style={{ fontSize: 18, fontWeight: 900, marginTop: 8 }}>
                  {todayCount}/{DAILY_GOAL}
                </div>
                <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>
                  {Math.round(progressPercent)}% concluído
                </div>
              </div>

              {/* Streak + medalha */}
              {canUseStreakArea ? (
                <div
                  style={{
                    padding: 14,
                    borderRadius: 16,
                    background: dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
                    border: dark ? "1px solid rgba(255,255,255,0.10)" : "1px solid rgba(0,0,0,0.08)"
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                      flexWrap: "wrap"
                    }}
                  >
                    <div style={{ fontSize: 12, opacity: 0.75, fontWeight: 800 }}>
                      🔥 {t("streak")}
                    </div>

                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 800,
                        padding: "4px 8px",
                        borderRadius: 999,
                        background: dark ? "rgba(255,215,0,0.12)" : "rgba(255,215,0,0.18)",
                        border: "1px solid rgba(255,215,0,0.32)",
                        color: dark ? "#FFD76A" : "#8A6300"
                      }}
                    >
                      ✨ Premium
                    </span>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      justifyContent: "space-between",
                      marginTop: 6
                    }}
                  >
                    <div style={{ fontSize: 26, fontWeight: 900 }}>{streak}</div>
                    <div style={{ fontSize: 12, opacity: 0.75, fontWeight: 800 }}>
                      {streakMedal.next ? `Próx: ${streakMedal.next}` : "Topo!"}
                    </div>
                  </div>

                  <div style={{ fontSize: 12, opacity: 0.85, marginTop: 8, lineHeight: 1.2 }}>
                    <strong>Medalha:</strong> {streakMedal.medal}
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    padding: 14,
                    borderRadius: 16,
                    background: dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
                    border: "1px solid rgba(255,215,0,0.22)"
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                      flexWrap: "wrap"
                    }}
                  >
                    <div style={{ fontSize: 12, opacity: 0.75, fontWeight: 800 }}>
                      🔥 Streak
                    </div>

                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 800,
                        padding: "4px 8px",
                        borderRadius: 999,
                        background: dark ? "rgba(255,215,0,0.12)" : "rgba(255,215,0,0.18)",
                        border: "1px solid rgba(255,215,0,0.32)",
                        color: dark ? "#FFD76A" : "#8A6300"
                      }}
                    >
                      ✨ Premium
                    </span>
                  </div>

                  <p style={{ marginTop: 10, marginBottom: 8, fontSize: 14, lineHeight: 1.5, opacity: 0.82 }}>
                    Desbloqueie sua sequência de estudos e acompanhe medalhas por consistência ao longo do tempo.
                  </p>

                  <div style={{ fontSize: 13, opacity: 0.85, lineHeight: 1.4 }}>
                    <div>• Dias consecutivos de estudo</div>
                    <div>• Próxima medalha</div>
                    <div>• Medalhas por marcos</div>
                  </div>

                  <button
                    onClick={() => setTab("premium")}
                    style={{
                      ...button,
                      marginTop: 12,
                      background: "linear-gradient(135deg, #7C5CFF, #5A8BFF)",
                      color: "#fff",
                      boxShadow: "0 8px 24px rgba(124,92,255,0.22)"
                    }}
                  >
                    ✨ Ver Premium
                  </button>
                </div>
              )}
            </div>

            {dueByTopic.length > 0 && (
              <div style={{ ...box, marginTop: 14 }}>
                <h3 style={{ marginTop: 0, marginBottom: 12 }}>📚 Revisões por tópico</h3>

                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {dueByTopic.map(group => (
                    <div
                      key={group.topic}
                      style={{
                        padding: 14,
                        borderRadius: 16,
                        background: dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
                        border: dark
                          ? "1px solid rgba(255,255,255,0.08)"
                          : "1px solid rgba(0,0,0,0.06)"
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: 12,
                          flexWrap: "wrap"
                        }}
                      >
                        <div>
                          <p style={{ margin: 0, fontWeight: 800 }}>
                            {group.topic}
                          </p>

                          <p style={{ margin: "6px 0 0 0", opacity: 0.78, fontSize: 14 }}>
                            {group.count} carta{group.count > 1 ? "s" : ""} para revisar
                          </p>
                        </div>

                        <button
                          onClick={() => startTopicSession(group)}
                          style={{
                            ...button,
                            width: "auto",
                            padding: "10px 14px",
                            background: "linear-gradient(135deg, #7C5CFF, #5A8BFF)",
                            color: "#fff"
                          }}
                        >
                          Estudar
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Barra de progresso */}
            <div
              style={{
                height: 12,
                background: "#ccc",
                borderRadius: 10,
                overflow: "hidden",
                marginTop: 8
              }}
            >
              <div
                style={{
                  width: `${progressPercent}%`,
                  height: "100%",
                  background: "#4CAF50",
                  transition: "0.3s"
                }}
              />
            </div>

            <button
              onClick={startSession}
              style={{
                ...button,
                background: "#4CAF50",
                color: "#fff",
                marginTop: 14
              }}
            >
              ▶️ {t("startStudy")}
            </button>
          </div>
        </>
      )}


      {/* ABA: STATS */}
      {tab === "stats" && (
        <>
          {canUseAdvancedStats ? (
            <div style={box}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  flexWrap: "wrap",
                  marginBottom: 10
                }}
              >
                <h3 style={{ margin: 0 }}>🧠 {t("cognitiveEvolution")}</h3>

                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 800,
                    padding: "4px 8px",
                    borderRadius: 999,
                    background: dark ? "rgba(255,215,0,0.12)" : "rgba(255,215,0,0.18)",
                    border: "1px solid rgba(255,215,0,0.32)",
                    color: dark ? "#FFD76A" : "#8A6300"
                  }}
                >
                  ✨ Premium
                </span>
              </div>

              <p style={{ marginTop: 0, opacity: 0.82, lineHeight: 1.6 }}>
                {activeDeck
                  ? "Esses dados mostram como sua memória está evoluindo com base nas suas revisões."
                  : "Esses dados mostram sua evolução geral no app, mesmo sem um deck selecionado no momento."}
              </p>

              <p>
                🏆 {t("level")}: <strong>{getCognitiveLevel(averageStability)}</strong>
              </p>
              <p>🧠 {t("averageStability")}: {averageStability.toFixed(2)}</p>
              <p>📊 {t("averageRetention")}: {(averageRetention * 100).toFixed(1)}%</p>
              <p>⚡ {t("averageResponseTime")}: {averageResponseTime.toFixed(2)}s</p>

              <hr
                style={{
                  border: "none",
                  borderTop: dark
                    ? "1px solid rgba(255,255,255,0.10)"
                    : "1px solid rgba(0,0,0,0.08)",
                  margin: "14px 0"
                }}
              />

              <div
                style={{
                  fontSize: 13,
                  lineHeight: 1.4,
                  opacity: 0.9
                }}
              >
                <strong>{t("insight")}:</strong> {insightText}
              </div>
            </div>
          ) : (
            <div
              style={{
                ...box,
                position: "relative",
                overflow: "hidden"
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  flexWrap: "wrap",
                  marginBottom: 10
                }}
              >
                <h3 style={{ margin: 0 }}>🧠 Evolução Cognitiva</h3>

                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 800,
                    padding: "4px 8px",
                    borderRadius: 999,
                    background: dark ? "rgba(255,215,0,0.12)" : "rgba(255,215,0,0.18)",
                    border: "1px solid rgba(255,215,0,0.32)",
                    color: dark ? "#FFD76A" : "#8A6300"
                  }}
                >
                  ✨ Premium
                </span>
              </div>

              {/* Conteúdo realçado, mas bloqueado */}
              <div
                style={{
                  filter: "blur(5px)",
                  opacity: 0.55,
                  pointerEvents: "none",
                  userSelect: "none"
                }}
              >
                <p style={{ marginTop: 0 }}>
                  🏆 Nível: <strong>Avançado 🧠</strong>
                </p>
                <p>🧠 Estabilidade média: 12.84</p>
                <p>📊 Retenção média: 87.3%</p>
                <p>⚡ Tempo médio de resposta: 2.14s</p>

                <hr
                  style={{
                    border: "none",
                    borderTop: dark
                      ? "1px solid rgba(255,255,255,0.10)"
                      : "1px solid rgba(0,0,0,0.08)",
                    margin: "14px 0"
                  }}
                />

                <div
                  style={{
                    fontSize: 13,
                    lineHeight: 1.4,
                    opacity: 0.9
                  }}
                >
                  <strong>Insight:</strong> Sua retenção está consistente, mas o tempo de resposta indica que algumas revisões ainda exigem mais esforço mental.
                </div>
              </div>

              {/* Overlay */}
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  textAlign: "center",
                  padding: 20,
                  backdropFilter: "blur(2px)"
                }}
              >
                <div style={{ fontSize: 24, marginBottom: 8 }}>🔒</div>

                <p style={{ margin: 0, fontWeight: 800, fontSize: 16 }}>
                  Estatísticas avançadas
                </p>

                <p style={{ marginTop: 8, marginBottom: 0, opacity: 0.82, lineHeight: 1.5 }}>
                  Desbloqueie análises profundas da sua memória, desempenho e evolução cognitiva.
                </p>

                <button
                  onClick={() => setTab("premium")}
                  style={{
                    ...button,
                    marginTop: 14,
                    background: "linear-gradient(135deg, #7C5CFF, #5A8BFF)",
                    color: "#fff",
                    boxShadow: "0 8px 24px rgba(124,92,255,0.22)",
                    width: "auto",
                    padding: "12px 18px"
                  }}
                >
                  ✨ Ver Premium
                </button>
              </div>
            </div>
          )}

          {canUseAdvancedStats && (activeDeck || weeklyData?.some(d => d.count > 0)) && (
            <div style={box}>
              <h3>📈 Semana</h3>
              <div style={{ display: "flex", alignItems: "flex-end", height: 120 }}>
                {weeklyData.map((d, i) => (
                  <div key={i} style={{ flex: 1, textAlign: "center" }}>
                    <small style={{ display: "block", marginBottom: 6, opacity: 0.75 }}>
                      {d.count}
                    </small>

                    <div
                      style={{
                        height: d.count > 0 ? `${maxWeekly > 0 ? (d.count / maxWeekly) * 100 : 0}%` : 0,
                        minHeight: d.count > 0 ? 8 : 0,
                        background: "linear-gradient(180deg, #7C5CFF, #5A8BFF)",
                        margin: "0 4px",
                        borderRadius: 6,
                        transition: "0.3s"
                      }}
                    />

                    <small>{d.label}</small>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {tab === "premium" && (
        <div style={{ display: "grid", gap: 16 }}>
          <div style={premiumHero}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
              <div>
                <div style={premiumBadge}>
                  ✨ {currentPlan === "premium" ? "Você já é Premium" : "Upgrade disponível"}
                </div>

                <h2 style={{ marginTop: 14, marginBottom: 10, fontSize: 28, lineHeight: 1.1 }}>
                  Leve sua memória para outro nível
                </h2>

                <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, opacity: 0.82, maxWidth: 700 }}>
                  Transforme seu estudo em um sistema inteligente.
                  Gere decks com IA, acompanhe sua evolução cognitiva e estude com mais consistência — sem perder tempo criando tudo do zero.
                </p>
              </div>

              <div
                style={{
                  padding: 14,
                  borderRadius: 18,
                  minWidth: 180,
                  background: dark ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.45)",
                  border: dark ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(0,0,0,0.06)"
                }}
              >
                <p style={{ marginTop: 0, marginBottom: 6, fontSize: 12, opacity: 0.7 }}>
                  Plano atual
                </p>
                <p style={{ margin: 0, fontSize: 22, fontWeight: 900 }}>
                  {currentPlan === "premium" ? "Premium" : "Free"}
                </p>

                {!isPremium && (
                  <>
                    <p style={{ marginTop: 10, marginBottom: 4, fontSize: 12, opacity: 0.6 }}>
                      Assinatura
                    </p>
                    <p style={{ margin: 0, fontSize: 20, fontWeight: 900 }}>
                      R$ 19,90<span style={{ fontSize: 12, fontWeight: 400 }}>/mês</span>
                    </p>
                  </>
                )}
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gap: 10,
                marginTop: 18
              }}
            >
              {!isPremium ? (
                <button
                  onClick={async () => {
                    try {
                      const createCheckoutSession = httpsCallable(functions, "createCheckoutSession");
                      const res = await createCheckoutSession();

                      const url = res.data?.url;

                      if (!url) {
                        showToast("Não foi possível iniciar o pagamento.");
                        return;
                      }

                      window.location.href = url;
                    } catch (error) {
                      console.error("Erro ao abrir checkout:", error);
                      showToast("Erro ao iniciar pagamento.");
                    }
                  }}
                  style={{
                    ...button,
                    width: "100%",
                    background: "linear-gradient(135deg, #7C5CFF, #5A8BFF)",
                    color: "#fff",
                    boxShadow: "0 8px 30px rgba(124,92,255,0.25)"
                  }}
                >
                  ✨ Assinar Premium — R$ 19,90/mês
                </button>
              ) : null}

              {!isPremium && (
                <p style={{
                  textAlign: "center",
                  fontSize: 12,
                  opacity: 0.6,
                  marginTop: 6
                }}>
                  Cancele a qualquer momento.
                </p>
              )}
              {isPremium && (
                <>
                  <button
                    style={{
                      ...button,
                      width: "100%",
                      background: "linear-gradient(135deg, #4CAF50, #43A047)",
                      color: "#fff"
                    }}
                  >
                    🚀 Premium ativo
                  </button>

                  {isCancelScheduled && (
                    <p style={{
                      fontSize: 12,
                      opacity: 0.7,
                      textAlign: "center",
                      marginTop: 6
                    }}>
                      Seu plano será encerrado no fim do período atual.
                    </p>
                  )}

                  {isPaymentIssue && (
                    <p style={{
                      fontSize: 12,
                      color: "#ff6b6b",
                      textAlign: "center",
                      marginTop: 6
                    }}>
                      Problema no pagamento. Atualize sua forma de pagamento.
                    </p>
                  )}

                  <button
                    onClick={() =>
                      showToast("O gerenciamento da assinatura será liberado em breve.")
                    }
                    style={{
                      ...button,
                      width: "100%",
                      background: dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)",
                      color: dark ? "#fff" : "#111"
                    }}
                  >
                    {isCancelScheduled ? "Cancelamento agendado" : "Gerenciar assinatura"}
                  </button>
                </>
              )}
              <button
                onClick={() => setTab("decks")}
                style={{
                  ...button,
                  width: "100%",
                  background: dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)",
                  color: dark ? "#fff" : "#111"
                }}
              >
                Ver decks
              </button>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 14
            }}
          >
            <div style={premiumFeatureCard}>
              <p style={{ marginTop: 0, marginBottom: 8, fontWeight: 800 }}>🧠 IA integrada</p>
              <p style={{ margin: 0, fontSize: 14, opacity: 0.78, lineHeight: 1.5 }}>
                Use IA para acelerar criação de conteúdo, melhorar cards e evoluir seu aprendizado.
              </p>
            </div>

            <div style={premiumFeatureCard}>
              <p style={{ marginTop: 0, marginBottom: 8, fontWeight: 800 }}>🔊 Áudio inteligente</p>
              <p style={{ margin: 0, fontSize: 14, opacity: 0.78, lineHeight: 1.5 }}>
                Ouça a pronúncia correta das frases e acelere seu aprendizado de idiomas.
              </p>
            </div>

            <div style={premiumFeatureCard}>
              <p style={{ marginTop: 0, marginBottom: 8, fontWeight: 800 }}>📊 Stats avançadas</p>
              <p style={{ margin: 0, fontSize: 14, opacity: 0.78, lineHeight: 1.5 }}>
                Visualize evolução cognitiva, retenção, estabilidade e métricas mais profundas de aprendizado.
              </p>
            </div>

            <div style={premiumFeatureCard}>
              <p style={{ marginTop: 0, marginBottom: 8, fontWeight: 800 }}>🔥 Sequência de estudos</p>
              <p style={{ margin: 0, fontSize: 14, opacity: 0.78, lineHeight: 1.5 }}>
                Mantenha sua consistência diária com streaks e acompanhamento do seu ritmo real.
              </p>
            </div>

            <div style={premiumFeatureCard}>
              <p style={{ marginTop: 0, marginBottom: 8, fontWeight: 800 }}>🏅 Medalhas e progresso</p>
              <p style={{ margin: 0, fontSize: 14, opacity: 0.78, lineHeight: 1.5 }}>
                Desbloqueie medalhas por consistência e transforme seu estudo em uma jornada recompensadora.
              </p>
            </div>

            <div style={premiumFeatureCard}>
              <p style={{ marginTop: 0, marginBottom: 8, fontWeight: 800 }}>📚 Decks mais completos</p>
              <p style={{ margin: 0, fontSize: 14, opacity: 0.78, lineHeight: 1.5 }}>
                Acesse decks intermediários e avançados já organizados para estudar sem perder tempo.
              </p>
            </div>

            <div style={premiumFeatureCard}>
              <p style={{ marginTop: 0, marginBottom: 8, fontWeight: 800 }}>🚀 Futuras features</p>
              <p style={{ margin: 0, fontSize: 14, opacity: 0.78, lineHeight: 1.5 }}>
                Tudo o que entrar como recurso premium no futuro já se encaixa nessa camada.
              </p>
            </div>
          </div>

          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            <div style={premiumCompareCard}>
              <p style={{ marginTop: 0, marginBottom: 12, fontWeight: 900, fontSize: 18 }}>
                Free
              </p>

              <div style={{ display: "grid", gap: 10, fontSize: 14 }}>
                <p style={{ margin: 0 }}>✅ Criar decks</p>
                <p style={{ margin: 0 }}>✅ Adicionar cartas</p>
                <p style={{ margin: 0 }}>✅ Estudar normalmente</p>
                <p style={{ margin: 0 }}>✅ Acesso aos decks iniciantes</p>
                <p style={{ margin: 0, opacity: 0.55 }}>— Stats avançadas</p>
                <p style={{ margin: 0, opacity: 0.55 }}>— Sequência e medalhas</p>
                <p style={{ margin: 0, opacity: 0.55 }}>— IA integrada</p>
              </div>
            </div>

            <div
              style={{
                ...premiumCompareCard,
                border: "1px solid rgba(124,92,255,0.30)",
                boxShadow: "0 10px 30px rgba(124,92,255,0.12)"
              }}
            >
              <p style={{ marginTop: 0, marginBottom: 12, fontWeight: 900, fontSize: 18 }}>
                Premium ✨
              </p>

              <div style={{ display: "grid", gap: 10, fontSize: 14 }}>
                <p style={{ margin: 0 }}>✅ Tudo do Free</p>
                <p style={{ margin: 0 }}>✅ Stats avançadas</p>
                <p style={{ margin: 0 }}>✅ Sequência de estudos</p>
                <p style={{ margin: 0 }}>✅ Medalhas e progresso</p>
                <p style={{ margin: 0 }}>✅ Decks intermediários e avançados</p>
                <p style={{ margin: 0 }}>✅ IA integrada</p>
                <p style={{ margin: 0 }}>✅ Novos recursos premium no futuro</p>
              </div>
            </div>
          </div>

          <div
            style={{
              padding: 16,
              borderRadius: 18,
              background: dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
              border: dark ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(0,0,0,0.06)"
            }}
          >
            <p style={{ marginTop: 0, marginBottom: 8, fontWeight: 800 }}>
              Por que o Premium existe?
            </p>

            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, opacity: 0.8 }}>
              Porque estudar não é só revisar cartas. É manter consistência, entender a própria evolução,
              economizar tempo com conteúdo pronto e usar ferramentas mais inteligentes para aprender melhor.
            </p>
          </div>
        </div>
      )}



      {showSettings && (
        <div
          onClick={() => setShowSettings(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            zIndex: 9998
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              height: "100%",
              width: "85%",
              maxWidth: 360,
              background: dark ? "#17172A" : "#fff",
              padding: 20,
              borderRight: dark
                ? "1px solid rgba(255,255,255,0.08)"
                : "1px solid rgba(0,0,0,0.06)",
              boxShadow: "0 10px 40px rgba(0,0,0,0.2)",
              animation: "slideInLeft 0.25s ease",
              overflowY: "auto"
            }}
            className="hide-scrollbar"
          >
            <h3 style={{ marginTop: 0 }}>⚙️ {t("settings")}</h3>

            <div
              style={{
                marginTop: 16,
                padding: 14,
                borderRadius: 16,
                background: dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
                border: dark ? "1px solid rgba(255,255,255,0.10)" : "1px solid rgba(0,0,0,0.08)"
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 800, opacity: 0.75 }}>
                🔔 {t("reminder")}
              </div>

              <div style={{ marginTop: 8, fontSize: 14, opacity: 0.8, lineHeight: 1.5 }}>
                {t("reminderDescription")}
              </div>

              <input
                type="time"
                value={userData?.notifications?.time || "20:00"}
                onChange={(e) =>
                  updateNotificationSettings({ time: e.target.value })
                }
                style={{
                  ...input,
                  marginTop: 10,
                  width: "100%",
                  maxWidth: "100%",
                  minWidth: 0,
                  boxSizing: "border-box",
                  display: "block"
                }}
              />

              {!userData?.notifications?.enabled ? (
                <button
                  onClick={enableReminder}
                  style={{
                    ...button,
                    marginTop: 10,
                    background: "linear-gradient(135deg, #7C5CFF, #5A8BFF)",
                    color: "#fff"
                  }}
                >
                  {t("activate")}
                </button>
              ) : (
                <button
                  onClick={() =>
                    updateNotificationSettings({ enabled: false })
                  }
                  style={{
                    ...button,
                    marginTop: 10
                  }}
                >
                  {t("deactivate")}
                </button>
              )}
            </div>

            <div
              style={{
                marginTop: 16,
                padding: 14,
                borderRadius: 16,
                background: dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
                border: dark ? "1px solid rgba(255,255,255,0.10)" : "1px solid rgba(0,0,0,0.08)"
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 800, opacity: 0.75 }}>
                🌍 {t("language")}
              </div>

              <div style={{ marginTop: 8, fontSize: 14, opacity: 0.8, lineHeight: 1.5 }}>
                {t("languageDescription")}
              </div>

              <select
                value={userData?.language || "pt"}
                onChange={async (e) => {
                  const newLang = e.target.value;

                  if (!user) return;

                  try {
                    const userRef = doc(db, "users", user.uid);

                    await updateDoc(userRef, {
                      language: newLang,
                      updatedAt: serverTimestamp()
                    });

                    setUserData(prev => ({
                      ...prev,
                      language: newLang
                    }));

                    showToast(
                      newLang === "pt" ? "Idioma atualizado" : "Language updated",
                      "success"
                    );
                  } catch (error) {
                    console.error("Erro ao atualizar idioma:", error);
                    showToast("Erro ao atualizar idioma");
                  }
                }}
                style={{
                  ...input,
                  marginTop: 10,
                  backgroundColor: "#fff",
                  color: "#111",
                  border: "1px solid rgba(0,0,0,0.10)",
                  colorScheme: "light"
                }}
              >
                <option value="pt">Português</option>
                <option value="en">English</option>
              </select>
            </div>

            <div
              style={{
                marginTop: 16,
                padding: 14,
                borderRadius: 16,
                background: dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
                border: dark ? "1px solid rgba(255,255,255,0.10)" : "1px solid rgba(0,0,0,0.08)"
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 800, opacity: 0.75 }}>
                👤 Conta
              </div>

              <div style={{ marginTop: 8, fontSize: 14, opacity: 0.8, lineHeight: 1.5 }}>
                Gerencie as informações da sua conta.
              </div>

              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.7, marginBottom: 6 }}>
                  Email logado
                </div>

                <div
                  style={{
                    ...input,
                    marginTop: 0,
                    background: dark ? "rgba(255,255,255,0.03)" : "#fff",
                    color: dark ? "#fff" : "#111",
                    border: dark
                      ? "1px solid rgba(255,255,255,0.08)"
                      : "1px solid rgba(0,0,0,0.08)",
                    wordBreak: "break-word",
                    display: "flex",
                    alignItems: "center"
                  }}
                >
                  {user?.email || "—"}
                </div>
              </div>

              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.7, marginBottom: 6 }}>
                  Tipo de conta
                </div>

                <div
                  style={{
                    ...input,
                    marginTop: 0,
                    background: dark ? "rgba(255,255,255,0.03)" : "#fff",
                    color: dark ? "#fff" : "#111",
                    border: dark
                      ? "1px solid rgba(255,255,255,0.08)"
                      : "1px solid rgba(0,0,0,0.08)",
                    display: "flex",
                    alignItems: "center"
                  }}
                >
                  Plano: <strong style={{ marginLeft: 4 }}>{currentPlan}</strong>
                  <span style={{ opacity: 0.6, margin: "0 6px" }}>|</span>
                  Status: <strong style={{ marginLeft: 4 }}>{subscriptionStatus}</strong>
                </div>
              </div>

              <button
                onClick={handleLogout}
                style={{
                  ...button,
                  marginTop: 12,
                  background: dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
                  color: dark ? "#fff" : "#111",
                  border: dark
                    ? "1px solid rgba(255,255,255,0.08)"
                    : "1px solid rgba(0,0,0,0.08)",
                  boxShadow: "none"
                }}
              >
                Sair da conta
              </button>
            </div>
          </div>
        </div>
      )}

      {showPremiumWelcome && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
            overflowY: "auto",
            zIndex: 9999
          }}
        >
          <div
            className="premium-modal"
            style={{
              width: "100%",
              maxWidth: 560,
              maxHeight: "calc(100vh - 40px)",
              overflowY: "auto",
              scrollbarWidth: "none",
              msOverflowStyle: "none",
              borderRadius: 24,
              padding: 22,
              background: dark ? "#17172A" : "#ffffff",
              border: dark
                ? "1px solid rgba(255,255,255,0.08)"
                : "1px solid rgba(0,0,0,0.06)",
              boxShadow: dark
                ? "0 18px 50px rgba(0,0,0,0.45)"
                : "0 18px 50px rgba(0,0,0,0.14)"
            }}
          >
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 12px",
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 800,
                background: dark ? "rgba(255,215,0,0.12)" : "rgba(255,215,0,0.18)",
                border: "1px solid rgba(255,215,0,0.32)",
                color: dark ? "#FFD76A" : "#8A6300"
              }}
            >
              ✨ Bem-vindo ao Premium
            </div>

            <h2 style={{ marginTop: 16, marginBottom: 10, fontSize: 28, lineHeight: 1.1 }}>
              Agora o Don&apos;t Forget It ficou ainda mais inteligente
            </h2>

            <p style={{ marginTop: 0, marginBottom: 18, fontSize: 15, lineHeight: 1.65, opacity: 0.82 }}>
              Você desbloqueou a camada mais poderosa do app: análise avançada,
              sequência de estudos, medalhas, decks mais completos e a base para
              ferramentas inteligentes que vão evoluir com o tempo.
            </p>

            <div
              style={{
                display: "grid",
                gap: 12,
                marginBottom: 18
              }}
            >
              <div
                style={{
                  padding: 14,
                  borderRadius: 16,
                  background: dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
                  border: dark ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(0,0,0,0.06)"
                }}
              >
                <strong>📊 Stats avançadas</strong>
                <div style={{ marginTop: 6, fontSize: 14, opacity: 0.8, lineHeight: 1.5 }}>
                  Entenda sua retenção, estabilidade, tempo de resposta e evolução cognitiva.
                </div>
              </div>

              <div
                style={{
                  padding: 14,
                  borderRadius: 16,
                  background: dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
                  border: dark ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(0,0,0,0.06)"
                }}
              >
                <strong>🔥 Sequência e medalhas</strong>
                <div style={{ marginTop: 6, fontSize: 14, opacity: 0.8, lineHeight: 1.5 }}>
                  Transforme consistência em progresso real com marcos e recompensas visuais.
                </div>
              </div>

              <div
                style={{
                  padding: 14,
                  borderRadius: 16,
                  background: dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
                  border: dark ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(0,0,0,0.06)"
                }}
              >
                <strong>📚 Conteúdo premium</strong>
                <div style={{ marginTop: 6, fontSize: 14, opacity: 0.8, lineHeight: 1.5 }}>
                  Estude com decks mais completos e, no futuro, com recursos inteligentes integrados.
                </div>
              </div>

              <div
                style={{
                  padding: 14,
                  borderRadius: 16,
                  background: dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
                  border: dark ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(0,0,0,0.06)"
                }}
              >
                <strong>🧠 Por que isso funciona?</strong>

                <div style={{ marginTop: 8, fontSize: 14, opacity: 0.85, lineHeight: 1.6 }}>
                  Nosso sistema é baseado em pesquisas clássicas sobre memória, iniciadas por
                  <strong> Hermann Ebbinghaus</strong>, que demonstraram que esquecemos grande parte do que aprendemos em poucas horas ou dias — um fenômeno conhecido como <strong>curva do esquecimento</strong>.
                  <br /><br />
                  Para combater isso, o Don’t Forget It utiliza <strong>repetição espaçada</strong>, uma técnica comprovada que agenda revisões exatamente no momento em que você está prestes a esquecer. Isso reduz drasticamente a perda de informação ao longo do tempo.
                  <br /><br />
                  Além disso, o sistema utiliza <strong>recuperação ativa</strong> — ou seja, você não apenas relê, mas precisa lembrar ativamente da resposta. Esse processo fortalece as conexões neurais de forma muito mais eficiente do que leitura passiva.
                  <br /><br />
                  Combinando esses princípios com análise do seu desempenho (tempo de resposta, acertos e dificuldade), o app adapta o estudo ao seu cérebro — criando um processo mais eficiente, consistente e de longo prazo.
                </div>
              </div>
            </div>

            <div style={{ display: "grid", gap: 10 }}>
              <button
                onClick={() => {
                  completePremiumOnboarding();
                  setTab("premium");
                }}
                style={{
                  ...button,
                  width: "100%",
                  background: "linear-gradient(135deg, #7C5CFF, #5A8BFF)",
                  color: "#fff",
                  boxShadow: "0 8px 30px rgba(124,92,255,0.25)"
                }}
              >
                ✨ Explorar meu Premium
              </button>

              <button
                onClick={() => {
                  completePremiumOnboarding();
                  setTab("stats");
                }}
                style={{
                  ...button,
                  width: "100%",
                  background: dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)",
                  color: dark ? "#fff" : "#111"
                }}
              >
                📊 Ir para Stats avançadas
              </button>

              <button
                onClick={dismissPremiumWelcome}
                style={{
                  ...button,
                  width: "100%",
                  background: "transparent",
                  color: dark ? "rgba(255,255,255,0.72)" : "rgba(0,0,0,0.65)",
                  border: dark
                    ? "1px solid rgba(255,255,255,0.08)"
                    : "1px solid rgba(0,0,0,0.06)"
                }}
              >
                Ver isso depois
              </button>
            </div>
          </div>
        </div>
      )}
      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: 30,
            left: "50%",
            transform: "translateX(-50%)",
            background:
              toast.type === "success"
                ? "linear-gradient(135deg, #7C5CFF, #5A8BFF)"
                : "rgba(0,0,0,0.85)",
            color: "#fff",
            padding: "14px 20px",
            borderRadius: 14,
            fontSize: 14,
            fontWeight: 600,
            boxShadow: "0 12px 40px rgba(0,0,0,0.3)",
            zIndex: 9999,

            // ✨ ANIMAÇÃO
            opacity: 1,
            animation: "fadeInUp 0.4s ease"
          }}
        >
          {toast.message}
        </div>
      )}

      <button
        onClick={() => {
          setAiError("");
          setAiPreview(null);
          setAiOpen(true);
          loadAIUsage();
        }}
        title="Abrir IA"
        style={{
          position: "fixed",
          right: 20,
          bottom: 90,
          width: 58,
          height: 58,
          borderRadius: "50%",
          border: "none",
          background: dark ? "#7c5cff" : "#6d4aff",
          color: "#fff",
          fontWeight: 900,
          fontSize: 18,
          letterSpacing: 0.5,
          cursor: "pointer",
          boxShadow: dark
            ? "0 10px 30px rgba(124,92,255,0.35)"
            : "0 10px 30px rgba(109,74,255,0.28)",
          zIndex: 9999,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        AI
      </button>
      {aiOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            zIndex: 10000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
          onClick={() => setAiOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: 520,
              maxHeight: "85vh",
              overflowY: "auto",
              borderRadius: 24,
              padding: 20,
              background: dark ? "#181818" : "#fff",
              color: dark ? "#fff" : "#111",
              boxShadow: dark
                ? "0 20px 60px rgba(0,0,0,0.45)"
                : "0 20px 60px rgba(0,0,0,0.15)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 style={{ margin: 0 }}>✨ Gerar cartas com IA</h3>
              <button
                onClick={() => setAiOpen(false)}
                style={{
                  border: "none",
                  background: "transparent",
                  color: dark ? "#fff" : "#111",
                  fontSize: 22,
                  cursor: "pointer",
                }}
              >
                ×
              </button>
            </div>

            <div style={{ display: "grid", gap: 12 }}>
              <input
                value={aiTheme}
                onChange={(e) => setAiTheme(e.target.value)}
                placeholder="Ex: Espanhol para iniciantes"
                style={{
                  width: "100%",
                  padding: 14,
                  borderRadius: 14,
                  border: dark
                    ? "1px solid rgba(255,255,255,0.10)"
                    : "1px solid rgba(0,0,0,0.10)",
                  background: dark ? "#232323" : "#fff",
                  color: dark ? "#fff" : "#111",
                  outline: "none",
                  fontSize: 15,
                }}
              />

              <input
                type="number"
                min="1"
                max="30"
                value={aiAmount}
                onChange={(e) => setAiAmount(Number(e.target.value))}
                style={{
                  width: "100%",
                  padding: 14,
                  borderRadius: 14,
                  border: dark
                    ? "1px solid rgba(255,255,255,0.10)"
                    : "1px solid rgba(0,0,0,0.10)",
                  background: dark ? "#232323" : "#fff",
                  color: dark ? "#fff" : "#111",
                  outline: "none",
                  fontSize: 15,
                }}
              />

              <button
                onClick={handleGenerateCardsAI}
                disabled={aiLoading || aiLimitReached}
                style={{
                  border: "none",
                  borderRadius: 14,
                  padding: "14px 16px",
                  fontWeight: 800,
                  cursor: aiLoading || aiLimitReached ? "not-allowed" : "pointer",
                  background: aiLimitReached ? "#777" : "#7c5cff",
                  color: "#fff",
                  opacity: aiLoading || aiLimitReached ? 0.7 : 1,
                }}
              >
                {aiLoading
                  ? "Gerando..."
                  : aiLimitReached
                    ? "Limite atingido"
                    : "Gerar cartas"}
              </button>
              {aiUsageInfo && (
                <div
                  style={{
                    marginTop: 10,
                    padding: "12px 14px",
                    borderRadius: 14,
                    background: aiLimitReached
                      ? dark
                        ? "rgba(255, 193, 7, 0.10)"
                        : "rgba(255, 193, 7, 0.12)"
                      : dark
                        ? "rgba(124,92,255,0.12)"
                        : "rgba(124,92,255,0.08)",
                    border: aiLimitReached
                      ? "1px solid rgba(255, 193, 7, 0.25)"
                      : "1px solid rgba(124,92,255,0.16)",
                  }}
                >
                  <p
                    style={{
                      margin: 0,
                      fontSize: 13,
                      lineHeight: 1.5,
                      fontWeight: 700,
                      color: dark ? "#fff" : "#111",
                    }}
                  >
                    {aiLimitReached
                      ? "⚠️ Você já usou todas as gerações disponíveis deste mês."
                      : aiUsageInfo.remaining === 1
                        ? "Você ainda tem 1 geração disponível neste mês."
                        : `Você ainda tem ${aiUsageInfo.remaining} gerações disponíveis neste mês.`}
                  </p>

                  {aiLimitReached && (
                    <p
                      style={{
                        margin: "6px 0 0 0",
                        fontSize: 12,
                        lineHeight: 1.5,
                        opacity: 0.85,
                      }}
                    >
                      Faça upgrade para continuar criando decks com IA e estudar sem travar seu ritmo.
                    </p>
                  )}
                </div>
              )}
              <p
                style={{
                  marginTop: 10,
                  marginBottom: 0,
                  fontSize: 13,
                  opacity: 0.8,
                  lineHeight: 1.6,
                }}
              >
                Free: 1 geração por mês com até 15 cartas por deck.
                <br />
                ✨ Premium: até 30 gerações por mês com até 30 cartas por deck.
              </p>
              <button
                onClick={() => {
                  setAiOpen(false);
                  setTab("premium");
                }}
                style={{
                  marginTop: 12,
                  width: "100%",
                  padding: "12px",
                  borderRadius: 12,
                  border: "none",
                  fontWeight: 800,
                  cursor: "pointer",
                  background: "linear-gradient(90deg,#7c5cff,#9c27b0)",
                  color: "#fff",
                  fontSize: 14,
                }}
              >
                {aiLimitReached
                  ? "✨ Desbloquear mais gerações com IA"
                  : "✨ Quero mais gerações com IA"}
              </button>
            </div>

            {aiError && (
              <div
                style={{
                  marginTop: 16,
                  padding: 12,
                  borderRadius: 14,
                  background: dark ? "#2a1616" : "#fff5f5",
                  color: "#d92d20",
                  border: "1px solid rgba(217,45,32,0.2)",
                  fontWeight: 600,
                }}
              >
                {aiError}
              </div>
            )}

            {aiPreview && (
              <div style={{ marginTop: 20 }}>
                <h4 style={{ marginBottom: 6 }}>{aiPreview.title}</h4>
                <p style={{ opacity: 0.75, marginTop: 0 }}>
                  {aiPreview.description}
                </p>

                <div style={{ display: "grid", gap: 12, marginTop: 14 }}>
                  {aiPreview.cards.map((card, index) => (
                    <div
                      key={index}
                      style={{
                        padding: 14,
                        borderRadius: 16,
                        border: dark
                          ? "1px solid rgba(255,255,255,0.08)"
                          : "1px solid rgba(0,0,0,0.08)",
                        background: dark ? "#202020" : "#fafafa",
                      }}
                    >
                      <div style={{ fontWeight: 700, marginBottom: 8 }}>
                        {index + 1}. {card.front}
                      </div>
                      <div style={{ opacity: 0.85 }}>{card.back}</div>
                    </div>
                  ))}
                </div>
                <button
                  onClick={handleSaveAIDeck}
                  style={{
                    marginTop: 20,
                    width: "100%",
                    padding: "14px",
                    borderRadius: 14,
                    border: "none",
                    fontWeight: 800,
                    cursor: "pointer",
                    background: "#00c853",
                    color: "#fff",
                  }}
                >
                  💾 Salvar novo deck
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}