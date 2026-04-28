const { setGlobalOptions } = require("firebase-functions/v2");
const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const OpenAI = require("openai");
const Stripe = require("stripe");
const admin = require("firebase-admin");

setGlobalOptions({ maxInstances: 10 });

admin.initializeApp();

exports.generateCardsWithAI = onCall(
  {
    cors: true,
    secrets: ["OPENAI_API_KEY"],
  },
  async (request) => {
    try {
      const apiKey = process.env.OPENAI_API_KEY;

      if (!apiKey) {
        throw new HttpsError(
          "failed-precondition",
          "OPENAI_API_KEY não encontrada no ambiente."
        );
      }

      const openai = new OpenAI({ apiKey });

      const theme = (request.data?.theme || "").trim();
      const topic = (request.data?.topic || "").trim();
      const amount = Number(request.data?.amount || 10);
      const language = (request.data?.language || "pt-BR").trim();
      const level = (request.data?.level || "iniciante").trim();

      if (!theme) {
        throw new HttpsError(
          "invalid-argument",
          "O tema é obrigatório."
        );
      }

      if (amount < 1 || amount > 20) {
        throw new HttpsError(
          "invalid-argument",
          "A quantidade deve estar entre 1 e 20."
        );
      }

      const prompt = `
Você é um especialista em criação de flashcards educativos de alta qualidade.

Sua tarefa é gerar ${amount} flashcards sobre o tema:
"${theme}"

Contexto da geração:
- Idioma alvo da frente: ${language}
- Nível: ${level}

Objetivo:
Criar um deck realmente útil para estudo, com conteúdo claro, progressivo e sem repetição.

Regras obrigatórias:
1. Retorne SOMENTE JSON válido.
2. Não escreva explicações fora do JSON.
3. O título deve ser curto, natural e específico.
4. A descrição deve explicar em 1 frase o foco do deck.
5. Cada card deve ter exatamente estes campos:
   - front
   - back
   - frontLang
   - backLang
6. Os cards devem ser claros, objetivos e bons para revisão.
7. Evite repetições, variações inúteis e conteúdo genérico.
8. Mantenha consistência total com o tema pedido pelo usuário.
8.1. O campo front deve sempre representar o estímulo principal de estudo, e o campo back deve sempre representar a resposta correspondente.

9. Se o tema for idioma:
   - Cada carta deve conter exatamente dois lados
   - Se for um deck de tradução:
     - front = frase no idioma alvo
     - back = tradução em português do Brasil
     - frontLang = "${language}"
     - backLang = "pt-BR"
     - nunca inverta essa ordem
   - Se for um deck no mesmo idioma:
     - front e back devem permanecer no mesmo idioma
     - frontLang e backLang devem refletir corretamente esse idioma
     - o back deve complementar, explicar ou responder o front sem traduzir para português
   - Nunca misture idiomas no mesmo campo
   - Use apenas um idioma por campo
   - As frases devem ser naturais, úteis e contextualizadas
   - Evite palavras soltas — sempre use frases completas
   - Mantenha consistência em todo o deck
   - Prefira frases usadas na vida real
   - Evite frases artificiais ou traduções literais demais

10. Se o tema for estudo teórico:
   - priorize pergunta e resposta objetivas
   - foque nos conceitos mais importantes
   - frontLang e backLang devem refletir corretamente o idioma usado em cada lado

11. Organize mentalmente as cartas do mais básico para o mais útil, quando fizer sentido.

12. Não invente contexto fora do tema pedido.

13. Use apenas estes códigos de idioma quando aplicável:
   - pt-BR
   - en-US
   - es-ES
   - fr-FR
   - de-DE
   - it-IT
   - zh-CN
   - ko-KR
   - ja-JP
   - ar-SA

14. Nunca omita frontLang ou backLang.

15. Nunca retorne markdown, comentários ou texto fora do JSON.

Formato obrigatório:
{
  "title": "string",
  "description": "string",
  "cards": [
    {
      "front": "string",
      "back": "string",
      "frontLang": "string",
      "backLang": "string"
    }
  ]
}
`.trim();

      const response = await openai.responses.create({
        model: "gpt-5.4-mini",
        input: prompt,
        max_output_tokens: 4000,
      });

      const text = response.output_text;

      let parsed;

      try {
        parsed = JSON.parse(text);
      } catch (parseError) {
        logger.error("Erro ao converter JSON da IA:", parseError);
        logger.error("Resposta original da IA:", text);

        throw new HttpsError(
          "internal",
          "A IA retornou um formato inválido."
        );
      }

      if (
        !parsed ||
        !parsed.title ||
        !parsed.description ||
        !Array.isArray(parsed.cards)
      ) {
        throw new HttpsError(
          "internal",
          "A IA retornou dados incompletos."
        );
      }

      logger.info("Cartas geradas com sucesso.", {
        theme,
        amount,
        language,
        level,
      });

      function detectLangSimple(text) {
        if (!text || typeof text !== "string") return "unknown";

        const normalized = text.toLowerCase().trim();

        // Espanhol
        if (
          /[¿¡ñ]/i.test(normalized) ||
          /\b(el|la|los|las|un|una|del|al|cómo|dónde|cuándo|por qué|gracias|hola|quiero|puedo|ustedes|nosotros)\b/i.test(normalized)
        ) {
          return "es-ES";
        }

        // Português
        if (
          /[ãõç]/i.test(normalized) ||
          /\b(o|a|os|as|um|uma|do|da|dos|das|você|vocês|não|obrigado|olá|quero|posso)\b/i.test(normalized)
        ) {
          return "pt-BR";
        }

        // Francês
        if (
          /\b(le|la|les|un|une|des|avec|bonjour|merci|comment|pourquoi|je|vous)\b/i.test(normalized)
        ) {
          return "fr-FR";
        }

        // Alemão
        if (
          /[äöüß]/i.test(normalized) ||
          /\b(der|die|das|und|mit|ich|nicht|danke)\b/i.test(normalized)
        ) {
          return "de-DE";
        }

        // Inglês
        if (
          /\b(the|and|with|from|through|about|how|what|when|where|why|i|you|we|they|keep|clear|changes)\b/i.test(normalized)
        ) {
          return "en-US";
        }

        return "unknown";
      }

      function normalizeReturnedLang(lang, fallback = "unknown") {
        const value = String(lang || "").trim().toLowerCase();

        if (!value) return fallback;

        if (value === "pt" || value === "pt-br" || value === "pt-pt") return "pt-BR";
        if (value === "en" || value === "en-us" || value === "en-gb") return "en-US";
        if (value === "es" || value === "es-es" || value === "es-mx") return "es-ES";
        if (value === "fr" || value === "fr-fr") return "fr-FR";
        if (value === "de" || value === "de-de") return "de-DE";

        return lang;
      }

      const parsedWithLang = {
        ...parsed,
        language,
        topic,
        cards: parsed.cards.map((card) => ({
          ...card,
          frontLang: language,
          backLang: language === "pt-BR" ? "pt-BR" : "pt-BR",
        })),
      };

      return {
        ok: true,
        content: parsedWithLang,
      };
    } catch (error) {
      logger.error("Erro em generateCardsWithAI:", error);

      if (error instanceof HttpsError) {
        throw error;
      }

      throw new HttpsError(
        "internal",
        error?.message || "Erro ao gerar cartas com IA."
      );
    }
  }
);
exports.generateSpeech = onCall(
  {
    cors: true,
    secrets: ["OPENAI_API_KEY"],
  },
  async (request) => {
    try {
      const text = request.data?.text;
      const lang = request.data?.lang;

      if (!text) {
        throw new HttpsError("invalid-argument", "Texto não fornecido.");
      }

      const apiKey = process.env.OPENAI_API_KEY;

      if (!apiKey) {
        throw new HttpsError(
          "failed-precondition",
          "OPENAI_API_KEY não encontrada no ambiente."
        );
      }

      const openai = new OpenAI({ apiKey });

      const response = await openai.audio.speech.create({
        model: "gpt-4o-mini-tts",
        voice: "alloy",
        input: text,
      });

      const audioBuffer = Buffer.from(await response.arrayBuffer());

      return {
        ok: true,
        audioBase64: audioBuffer.toString("base64"),
      };
    } catch (error) {
      console.error("Erro TTS:", error);

      if (error instanceof HttpsError) {
        throw error;
      }

      throw new HttpsError(
        "internal",
        error?.message || "Erro ao gerar áudio"
      );
    }
  }
);
exports.createCheckoutSession = onCall(
  {
    cors: true,
    secrets: ["STRIPE_SECRET_KEY"],
  },
  async (request) => {
    try {
      const uid = request.auth?.uid;
      const email = request.auth?.token?.email;

      if (!uid || !email) {
        throw new HttpsError(
          "unauthenticated",
          "Usuário não autenticado."
        );
      }

      const stripeKey = process.env.STRIPE_SECRET_KEY;

      if (!stripeKey) {
        throw new HttpsError(
          "failed-precondition",
          "STRIPE_SECRET_KEY não encontrada no ambiente."
        );
      }

      const stripe = new Stripe(stripeKey);

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer_email: email,
        line_items: [
          {
            price: "price_1TIKjAL4aYADZfLHqYQqCNV6",
            quantity: 1,
          },
        ],
        success_url: "https://dont-forget-it-khaki.vercel.app/?checkout=success",
        cancel_url: "https://dont-forget-it-khaki.vercel.app/?checkout=cancel",
        metadata: {
          uid,
          email,
        },
      });

      return {
        ok: true,
        url: session.url,
      };
    } catch (error) {
      logger.error("Erro em createCheckoutSession:", error);

      if (error instanceof HttpsError) {
        throw error;
      }

      throw new HttpsError(
        "internal",
        error?.message || "Erro ao criar sessão de checkout."
      );
    }
  }
);

exports.stripeWebhook = onRequest(
  {
    cors: false,
    secrets: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
  },
  async (req, res) => {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!stripeKey) {
      logger.error("STRIPE_SECRET_KEY não configurada.");
      res.status(500).send("Webhook não configurado.");
      return;
    }

    if (!webhookSecret) {
      logger.error("STRIPE_WEBHOOK_SECRET ainda não configurada.");
      res.status(500).send("Webhook secret ausente.");
      return;
    }

    const stripe = new Stripe(stripeKey);

    let event;

    try {
      const signature = req.headers["stripe-signature"];

      event = stripe.webhooks.constructEvent(
        req.rawBody,
        signature,
        webhookSecret
      );
    } catch (err) {
      logger.error("Assinatura do webhook inválida:", err?.message || err);
      res.status(400).send(`Webhook Error: ${err.message}`);
      return;
    }

    try {
      if (event.type === "checkout.session.completed") {
        const session = event.data.object;

        const uid = session.metadata?.uid;
        const email = session.metadata?.email;
        const customerId = session.customer || null;
        const subscriptionId = session.subscription || null;

        if (!uid) {
          logger.error("UID ausente na metadata da Checkout Session.", {
            sessionId: session.id,
            email,
          });
          res.status(400).send("UID ausente.");
          return;
        }

        const userRef = admin.firestore().collection("users").doc(uid);

        await userRef.set(
          {
            plan: "premium",
            subscription: {
              plan: "premium",
              status: "active",
              source: "stripe",
              customerEmail: email || null,
              stripeCustomerId: customerId,
              stripeSubscriptionId: subscriptionId,
              stripeCheckoutSessionId: session.id || null,
              cancelAtPeriodEnd: false,
              currentPeriodEnd: null,
              lastInvoiceStatus: "paid",
              updatedAt: new Date().toISOString(),
            },
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        logger.info("Usuário ativado como premium com sucesso.", {
          uid,
          email,
          sessionId: session.id,
          customerId,
          subscriptionId,
        });
      }

      if (event.type === "customer.subscription.updated") {
        const subscription = event.data.object;

        const subscriptionId = subscription.id;
        const customerId = subscription.customer || null;
        const status = subscription.status || "inactive";
        const cancelAtPeriodEnd = !!subscription.cancel_at_period_end;
        const currentPeriodEnd = subscription.current_period_end
          ? new Date(subscription.current_period_end * 1000).toISOString()
          : null;

        const usersSnapshot = await admin
          .firestore()
          .collection("users")
          .where("subscription.stripeSubscriptionId", "==", subscriptionId)
          .limit(1)
          .get();

        if (usersSnapshot.empty) {
          logger.warn("Usuário não encontrado para subscription.updated", {
            subscriptionId,
            customerId,
          });
        } else {
          const userDoc = usersSnapshot.docs[0];
          const userRef = userDoc.ref;

          const isActiveLike =
            status === "active" ||
            status === "trialing" ||
            status === "past_due";

          await userRef.set(
            {
              plan: isActiveLike ? "premium" : "free",
              subscription: {
                plan: isActiveLike ? "premium" : "free",
                status,
                source: "stripe",
                stripeCustomerId: customerId,
                stripeSubscriptionId: subscriptionId,
                cancelAtPeriodEnd,
                currentPeriodEnd,
                updatedAt: new Date().toISOString(),
              },
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
          );

          logger.info("Assinatura atualizada com sucesso.", {
            uid: userDoc.id,
            subscriptionId,
            status,
            cancelAtPeriodEnd,
            currentPeriodEnd,
          });
        }
      }

      if (event.type === "customer.subscription.deleted") {
        const subscription = event.data.object;

        const subscriptionId = subscription.id;
        const customerId = subscription.customer || null;

        const usersSnapshot = await admin
          .firestore()
          .collection("users")
          .where("subscription.stripeSubscriptionId", "==", subscriptionId)
          .limit(1)
          .get();

        if (usersSnapshot.empty) {
          logger.warn("Usuário não encontrado para subscription.deleted", {
            subscriptionId,
            customerId,
          });
        } else {
          const userDoc = usersSnapshot.docs[0];
          const userRef = userDoc.ref;

          await userRef.set(
            {
              plan: "free",
              subscription: {
                plan: "free",
                status: "inactive",
                source: "stripe",
                stripeCustomerId: customerId,
                stripeSubscriptionId: subscriptionId,
                cancelAtPeriodEnd: false,
                currentPeriodEnd: null,
                updatedAt: new Date().toISOString(),
              },
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
          );

          logger.info("Assinatura removida com sucesso.", {
            uid: userDoc.id,
            subscriptionId,
          });
        }
      }

      if (event.type === "invoice.payment_failed") {
        const invoice = event.data.object;

        const subscriptionId = invoice.subscription || null;
        const customerId = invoice.customer || null;

        if (subscriptionId) {
          const usersSnapshot = await admin
            .firestore()
            .collection("users")
            .where("subscription.stripeSubscriptionId", "==", subscriptionId)
            .limit(1)
            .get();

          if (usersSnapshot.empty) {
            logger.warn("Usuário não encontrado para invoice.payment_failed", {
              subscriptionId,
              customerId,
            });
          } else {
            const userDoc = usersSnapshot.docs[0];
            const userRef = userDoc.ref;

            await userRef.set(
              {
                subscription: {
                  status: "past_due",
                  source: "stripe",
                  stripeCustomerId: customerId,
                  stripeSubscriptionId: subscriptionId,
                  lastInvoiceStatus: "payment_failed",
                  updatedAt: new Date().toISOString(),
                },
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              },
              { merge: true }
            );

            logger.info("Falha de pagamento registrada.", {
              uid: userDoc.id,
              subscriptionId,
            });
          }
        }
      }

      res.status(200).send("Evento recebido com sucesso.");
    } catch (err) {
      logger.error("Erro ao processar webhook:", err);
      res.status(500).send("Erro interno no webhook.");
    }
  }
);
exports.createCustomerPortalSession = onCall(
  {
    cors: true,
    secrets: ["STRIPE_SECRET_KEY"],
  },
  async (request) => {
    const uid = request.auth?.uid;

    if (!uid) {
      throw new HttpsError("unauthenticated", "Usuário não autenticado.");
    }

    const userDoc = await admin.firestore().collection("users").doc(uid).get();
    const userData = userDoc.data();

    const customerId = userData?.subscription?.stripeCustomerId;

    if (!customerId) {
      throw new HttpsError("failed-precondition", "Cliente Stripe não encontrado.");
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: "https://dont-forget-it-khaki.vercel.app/",
    });

    return { url: session.url };
  }
);