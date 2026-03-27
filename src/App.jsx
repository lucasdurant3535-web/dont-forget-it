import React, { useState, useRef, useEffect } from "react";
import { presetDecks } from "./data/presetDecks"
import { auth, db } from "./firebase";
import { collection, doc, setDoc, getDoc, getDocs, updateDoc, serverTimestamp } from "firebase/firestore";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "firebase/auth";
import { deleteDoc } from "firebase/firestore";
import { FEATURES, hasAccess } from "./features";

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

  const currentPlan = userData?.subscription?.plan || userData?.plan || "free";
  const subscriptionStatus = userData?.subscription?.status || "inactive";
  const isPremium = currentPlan === "premium" && subscriptionStatus === "active";

  const activeDeck = allDecks.find(d => String(d.id) === String(activeDeckId));
  const isPresetDeck = !!activeDeck?.isBuiltIn;
  const isActiveDeckPremium = !!activeDeck?.premium;
  const isLockedPresetDeck = isPresetDeck && isActiveDeckPremium && !isPremium;

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

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async currentUser => {
      setUser(currentUser);

      if (!currentUser) {
        setUserData(null);
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

        setUserData(loadedUserData);
      } catch (error) {
        console.error("Erro ao carregar dados do usuário:", error);
      } finally {
        setUserDataLoading(false);
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

  async function updateMyPlan(newPlan) {
    if (!user) {
      showToast("Você precisa estar logado");
      return;
    }

    try {
      const userRef = doc(db, "users", user.uid);

      const nextSubscription = {
        plan: newPlan,
        status: newPlan === "premium" ? "active" : "inactive",
        source: "manual",
        startedAt: newPlan === "premium" ? new Date().toISOString() : null,
        expiresAt: null
      };
      const nextPremiumOnboarding =
        newPlan === "premium"
          ? {
            welcomeSeen: false,
            completed: false,
            completedAt: null
          }
          : (userData?.premiumOnboarding || {
            welcomeSeen: false,
            completed: false,
            completedAt: null
          });

      await updateDoc(userRef, {
        plan: newPlan,
        subscription: nextSubscription,
        premiumOnboarding: nextPremiumOnboarding,
        updatedAt: serverTimestamp()
      });

      setUserData(prev => ({
        ...prev,
        plan: newPlan,
        subscription: nextSubscription,
        premiumOnboarding: nextPremiumOnboarding
      }));

      showToast(`Plano alterado para ${newPlan}`, "success");
    } catch (error) {
      console.error("Erro ao atualizar plano:", error);
      showToast("Erro ao atualizar plano");
    }
  }

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
    if (!email || !password) return;

    try {
      await signInWithEmailAndPassword(auth, email, password);
      showToast("Login realizado", "success");
      setEmail("");
      setPassword("");
    } catch (error) {
      console.error("Erro no login:", error);
      showToast("Erro ao fazer login");
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

  async function updateCards(cards) {
    if (!activeDeckId) return;

    if (isPresetDeck) {
      showToast("Este é um deck padrão. Adicione-o à sua conta para salvar progresso");
      return;
    }

    if (!user) return;

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
    } catch (error) {
      console.error("Erro ao atualizar cartas:", error);
      showToast("Erro ao salvar cartas");
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

  function rate(quality) {
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

    const updated = activeDeck.cards.map(c =>
      c.id === card.id ? updatedCard : c
    );

    updateCards(updated);
    setTodayCount(prev => prev + 1);

    // 🔥 Atualiza streak quando faz pelo menos 1 review no dia
    updateStreak();

    if (index + 1 < session.length) {
      nextCard(index + 1);
    } else {
      setSession([]);
      setStudyStarted(false);
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

  const allReviews = cards.flatMap(c => c.reviewHistory || []);

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

  function getWeeklyData() {
    const today = new Date();
    const data = [];

    for (let i = 6; i >= 0; i--) {
      const day = new Date();
      day.setDate(today.getDate() - i);
      const dayString = day.toISOString().slice(0, 10);

      const count = allReviews.filter(r =>
        r.date.slice(0, 10) === dayString
      ).length;

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
    fontFamily: "sans-serif",
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
    outline: "none"
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
    padding: 20,
    borderRadius: 20,

    background: dark
      ? "linear-gradient(135deg, #1e1e1e, #121212)"
      : "linear-gradient(135deg, #ffffff, #f3f4f6)",

    border: dark
      ? "1px solid rgba(255,255,255,0.08)"
      : "1px solid rgba(0,0,0,0.06)",

    boxShadow: dark
      ? "0 20px 50px rgba(0,0,0,0.4)"
      : "0 20px 50px rgba(0,0,0,0.08)",

    backdropFilter: "blur(8px)"
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
          <div style={{ fontSize: 46, marginBottom: 10 }}>🧠</div>

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
            onClick={handleLogin}
            style={{
              ...button,
              background: "linear-gradient(135deg, #7C5CFF, #5A8BFF)",
              color: "#fff",
              width: "100%",
              marginTop: 8,
              boxShadow: "0 8px 30px rgba(124,92,255,0.25)"
            }}
          >
            Entrar
          </button>

          <button
            onClick={handleRegister}
            style={{
              ...button,
              background: "rgba(255,255,255,0.06)",
              color: "#fff",
              border: "1px solid rgba(255,255,255,0.08)",
              width: "100%",
              marginTop: 10
            }}
          >
            Criar conta
          </button>
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

            <div style={{ fontWeight: 900, fontSize: 22, opacity: 0.8 }}>
              {index + 1}/{session.length}
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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div>
            <h1
              style={{
                fontSize: 30,
                margin: 0,
                fontWeight: 900,
                letterSpacing: -0.5,
                color: dark ? "#fff" : "#111"
              }}
            >
              Don't Forget It
            </h1>
            <p
              style={{
                opacity: 0.72,
                marginTop: 6,
                marginBottom: 0,
                fontSize: 13,
                color: dark ? "#ccc" : "#555"
              }}
            >
              Treine sua mente. Evolua todos os dias.
            </p>
          </div>

          <button
            onClick={() => setShowSettings(true)}
            style={{
              border: "none",
              background: "transparent",
              fontSize: 20,
              cursor: "pointer"
            }}
          >
            ⚙️
          </button>


          <button
            onClick={() => setDark(!dark)}
            style={{
              border: "none",
              cursor: "pointer",
              borderRadius: 14,
              padding: "10px 12px",
              fontWeight: 900,
              fontSize: 12,
              background: dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
              color: dark ? "#fff" : "#000"
            }}
          >
            {dark ? "🌙" : "☀️"}
          </button>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14, gap: 12 }}>
          <p style={{ margin: 0, opacity: 0.8, fontSize: 13 }}>
            <strong>{user.email}</strong>
          </p>

          <button
            onClick={handleLogout}
            style={{
              ...button,
              background: dark
                ? "rgba(255,255,255,0.06)"
                : "rgba(0,0,0,0.04)",
              color: dark ? "#fff" : "#111",
              border: dark
                ? "1px solid rgba(255,255,255,0.08)"
                : "1px solid rgba(0,0,0,0.08)",
              boxShadow: dark
                ? "none"
                : "0 6px 20px rgba(0,0,0,0.06)",
              width: "auto",
              padding: "10px 14px"
            }}
          >
            Sair
          </button>
        </div>

        {user && (
          <div style={{ marginTop: 20, fontSize: 14, opacity: 0.8 }}>
            Plano atual: <strong>{currentPlan}</strong> | Status: <strong>{subscriptionStatus}</strong>
          </div>
        )}

        {user && (
          <div
            style={{
              marginTop: 16,
              padding: 14,
              borderRadius: 16,
              background: dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
              border: dark ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(0,0,0,0.06)"
            }}
          >
            <p style={{ marginTop: 0, marginBottom: 10, fontWeight: 800 }}>
              Teste de Plano
            </p>

            <p style={{ marginTop: 0, marginBottom: 12, fontSize: 14, opacity: 0.8 }}>
              Plano: <strong>{currentPlan}</strong> | Status: <strong>{subscriptionStatus}</strong>
            </p>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                onClick={() => updateMyPlan("free")}
                style={{
                  ...button,
                  background: currentPlan === "free"
                    ? "linear-gradient(135deg, #4CAF50, #43A047)"
                    : dark
                      ? "rgba(255,255,255,0.06)"
                      : "rgba(0,0,0,0.06)",
                  color: "#fff"
                }}
              >
                Free
              </button>

              <button
                onClick={() => updateMyPlan("premium")}
                style={{
                  ...button,
                  background: currentPlan === "premium"
                    ? "linear-gradient(135deg, #7C5CFF, #5A8BFF)"
                    : dark
                      ? "rgba(255,255,255,0.06)"
                      : "rgba(0,0,0,0.06)",
                  color: "#fff"
                }}
              >
                Premium
              </button>
            </div>
          </div>
        )}


        {activeDeck && (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 14, gap: 10 }}>
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
            Hoje
          </button>

          <button
            onClick={() => setTab("study")}
            style={{ ...tabBtn, ...(tab === "study" ? tabBtnActive : {}) }}
          >
            Study
          </button>

          <button
            onClick={() => setTab("decks")}
            style={{ ...tabBtn, ...(tab === "decks" ? tabBtnActive : {}) }}
          >
            Decks
          </button>

          <button
            onClick={() => setTab("add")}
            style={{ ...tabBtn, ...(tab === "add" ? tabBtnActive : {}) }}
          >
            Carta
          </button>

          <button
            onClick={() => setTab("stats")}
            style={{ ...tabBtn, ...(tab === "stats" ? tabBtnActive : {}) }}
          >
            Stats
          </button>

          <button
            onClick={() => setTab("premium")}
            style={{ ...tabBtn, ...(tab === "premium" ? tabBtnActive : {}) }}
          >
            ✨ Premium
          </button>
        </div>
      )}

      {/* Tema (mantive, mas agora fica numa “área” e não espalhado) */}

      {/* ABA: DECKS */}
      {tab === "decks" && (
        <>
          <div style={{ ...box, ...formContainer }}>
            <h3>Criar Deck</h3>
            <input
              value={newDeck}
              onChange={e => setNewDeck(e.target.value)}
              placeholder="Nome do novo deck"
              style={inputStyle}
            />
            <button
              onClick={createDeck}
              style={{ ...button, background: "#2196F3", color: "#fff" }}
            >
              Criar Deck
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

            {activeDeck && !isPresetDeck && (
              <button
                onClick={() => deleteDeck(activeDeck.id)}
                style={{
                  ...button,
                  marginTop: 10,
                  background: "rgba(255,255,255,0.06)",
                  color: "#fff",
                  border: "1px solid rgba(255,255,255,0.08)"
                }}
              >
                🗑️ Excluir deck
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
          <h3>⚙️ Configurações</h3>

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
              🔔 Lembrete diário
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
                Ativar lembrete
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
                Desativar
              </button>
            )}
          </div>
        </div>
      )}

      {/* ABA: ADICIONAR */}
      {activeDeck && tab === "add" && (
        <div style={{ ...box, ...formContainer }}>
          <h3>➕ Adicionar Carta</h3>
          <textarea
            value={front}
            onChange={e => setFront(e.target.value)}
            placeholder="Pergunta"
            style={{ ...inputStyle, minHeight: 80, resize: "none" }}
          />
          <textarea
            value={back}
            onChange={e => setBack(e.target.value)}
            placeholder="Resposta"
            style={{ ...inputStyle, minHeight: 80, resize: "none" }}
          />
          <button
            onClick={addCard}
            style={{ ...button, background: "#9C27B0", color: "#fff" }}
          >
            Adicionar Carta
          </button>
        </div>
      )}

      {/* ABA: HOJE */}
      {activeDeck && tab === "today" && (
        <>
          <div style={box}>
            <h3>🔥 Seu Dia</h3>

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
                  📚 Para revisar
                </div>
                <div style={{ fontSize: 26, fontWeight: 900, marginTop: 6 }}>
                  {dueCount}
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
                  🆕 Cartas novas
                </div>
                <div style={{ fontSize: 26, fontWeight: 900, marginTop: 6 }}>
                  {newCardsCount}
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
                  🎯 Meta diária
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
              ▶️ Começar Estudo
            </button>
          </div>
        </>
      )}

      {/* ABA: STUDY */}
      {activeDeck && tab === "study" && (
        <div style={box}>
          <h3>Study</h3>

          <div
            style={{
              textAlign: "center",
              padding: "20px 10px",
              opacity: 0.9
            }}
          >
            {dueCount === 0 ? (
              <>
                <div style={{ fontSize: 40, marginBottom: 10 }}>✅</div>
                <h4 style={{ margin: 0, marginBottom: 6 }}>
                  Você está em dia!
                </h4>
                <p style={{ fontSize: 13, opacity: 0.7 }}>
                  Nenhuma carta precisa ser revisada agora.
                </p>
              </>
            ) : (
              <>
                <div style={{ fontSize: 40, marginBottom: 10 }}>🧠</div>
                <h4 style={{ margin: 0, marginBottom: 6 }}>
                  Pronto para estudar?
                </h4>
                <p style={{ fontSize: 13, opacity: 0.7, marginBottom: 16 }}>
                  Existem <strong>{dueCount}</strong> cartas esperando por você.
                </p>

                <button
                  onClick={startSession}
                  style={{
                    ...button,
                    background: "linear-gradient(135deg, #7C5CFF, #5A8BFF)",
                    color: "#fff",
                    boxShadow: "0 8px 30px rgba(124,92,255,0.25)"
                  }}
                >
                  ▶️ Começar sessão
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ABA: STATS */}
      {activeDeck && tab === "stats" && (
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

              <p>
                🏆 Nível: <strong>{getCognitiveLevel(averageStability)}</strong>
              </p>
              <p>🧠 Estabilidade média: {averageStability.toFixed(2)}</p>
              <p>📊 Retenção média: {(averageRetention * 100).toFixed(1)}%</p>
              <p>⚡ Tempo médio resposta: {averageResponseTime.toFixed(2)}s</p>

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
                <strong>Insight:</strong> {insightText}
              </div>
            </div>
          ) : (
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

              <p style={{ marginTop: 0, opacity: 0.82, lineHeight: 1.6 }}>
                Desbloqueie análises mais profundas sobre sua memória e seu desempenho
                com métricas cognitivas avançadas.
              </p>

              <div
                style={{
                  marginTop: 14,
                  padding: 12,
                  borderRadius: 14,
                  background: dark ? "rgba(255,215,0,0.08)" : "rgba(255,215,0,0.12)",
                  border: "1px solid rgba(255,215,0,0.22)"
                }}
              >
                <p
                  style={{
                    marginTop: 0,
                    marginBottom: 8,
                    fontSize: 14,
                    fontWeight: 700,
                    color: dark ? "#FFD76A" : "#8A6300"
                  }}
                >
                  Inclui no Premium:
                </p>

                <p style={{ margin: "4px 0", fontSize: 14 }}>• Nível cognitivo</p>
                <p style={{ margin: "4px 0", fontSize: 14 }}>• Estabilidade média</p>
                <p style={{ margin: "4px 0", fontSize: 14 }}>• Retenção média</p>
                <p style={{ margin: "4px 0", fontSize: 14 }}>• Tempo médio de resposta</p>
                <p style={{ margin: "4px 0", fontSize: 14 }}>• Insight automático</p>
              </div>

              <button
                onClick={() => setTab("premium")}
                style={{
                  ...button,
                  marginTop: 14,
                  background: "linear-gradient(135deg, #7C5CFF, #5A8BFF)",
                  color: "#fff",
                  boxShadow: "0 8px 24px rgba(124,92,255,0.22)"
                }}
              >
                ✨ Ver Premium
              </button>
            </div>
          )}

          <div style={box}>
            <h3>📈 Semana</h3>
            <div style={{ display: "flex", alignItems: "flex-end", height: 120 }}>
              {weeklyData.map((d, i) => (
                <div key={i} style={{ flex: 1, textAlign: "center" }}>
                  <div
                    style={{
                      height: `${maxWeekly > 0 ? (d.count / maxWeekly) * 100 : 0}%`,
                      background: "#FF9800",
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
                  O Premium desbloqueia a camada mais poderosa do Don&apos;t Forget It:
                  análise avançada, sequência de estudos, medalhas, decks mais completos,
                  IA integrada e tudo o que vier nas próximas evoluções.
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
                  onClick={() => updateMyPlan("premium")}
                  style={{
                    ...button,
                    width: "100%",
                    background: "linear-gradient(135deg, #7C5CFF, #5A8BFF)",
                    color: "#fff",
                    boxShadow: "0 8px 30px rgba(124,92,255,0.25)"
                  }}
                >
                  ✨ Desbloquear Premium
                </button>
              ) : (
                <>
                  <button
                    onClick={() => showToast("Você já está no Premium ✨", "success")}
                    style={{
                      ...button,
                      width: "100%",
                      background: "linear-gradient(135deg, #4CAF50, #43A047)",
                      color: "#fff"
                    }}
                  >
                    ✅ Premium ativo
                  </button>

                  <button
                    onClick={cancelPremium}
                    style={{
                      ...button,
                      width: "100%",
                      background: dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)",
                      color: dark ? "#fff" : "#111"
                    }}
                  >
                    Cancelar
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
              <p style={{ marginTop: 0, marginBottom: 8, fontWeight: 800 }}>🧠 IA integrada</p>
              <p style={{ margin: 0, fontSize: 14, opacity: 0.78, lineHeight: 1.5 }}>
                Use IA para acelerar criação de conteúdo, melhorar cards e evoluir seu aprendizado.
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

      {user && (
        <div
          style={{
            marginTop: 16,
            padding: 14,
            borderRadius: 16,
            background: dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
            border: dark ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(0,0,0,0.06)"
          }}
        >
          <p style={{ marginTop: 0, marginBottom: 10, fontWeight: 800 }}>
            Permissões do Plano
          </p>

          <p style={{ margin: "4px 0", fontSize: 14 }}>
            Criar decks: <strong>{canUseCreateDecks ? "Sim" : "Não"}</strong>
          </p>

          <p style={{ margin: "4px 0", fontSize: 14 }}>
            Adicionar cartas: <strong>{canUseAddCards ? "Sim" : "Não"}</strong>
          </p>

          <p style={{ margin: "4px 0", fontSize: 14 }}>
            Study: <strong>{canUseStudy ? "Sim" : "Não"}</strong>
          </p>

          <p style={{ margin: "4px 0", fontSize: 14 }}>
            Streak: <strong>{canUseStreak ? "Sim" : "Não"}</strong>
          </p>

          <p style={{ margin: "4px 0", fontSize: 14 }}>
            Medalhas: <strong>{canUseMedals ? "Sim" : "Não"}</strong>
          </p>

          <p style={{ margin: "4px 0", fontSize: 14 }}>
            Stats avançadas: <strong>{canUseAdvancedStats ? "Sim" : "Não"}</strong>
          </p>

          <p style={{ margin: "4px 0", fontSize: 14 }}>
            IA: <strong>{canUseAiTools ? "Sim" : "Não"}</strong>
          </p>
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
              animation: "slideInLeft 0.25s ease"
            }}
          >
            <h3 style={{ marginTop: 0 }}>⚙️ Configurações</h3>

            {/* NOTIFICAÇÕES */}
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
                🔔 Lembrete diário
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
                  Ativar lembrete
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
                  Desativar
                </button>
              )}
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
    </div>
  );
}