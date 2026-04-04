const { setGlobalOptions } = require("firebase-functions/v2");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const OpenAI = require("openai");


setGlobalOptions({ maxInstances: 10 });

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
- Idioma de resposta: ${language}
- Nível: ${level}

Objetivo:
Criar um deck realmente útil para estudo, com conteúdo claro, progressivo e sem repetição.

Regras obrigatórias:
1. Retorne SOMENTE JSON válido.
2. Não escreva explicações fora do JSON.
3. O título deve ser curto, natural e específico.
4. A descrição deve explicar em 1 frase o foco do deck.
5. Cada card deve ter apenas:
   - front
   - back
6. Os cards devem ser claros, objetivos e bons para revisão.
7. Evite repetições, variações inúteis e conteúdo genérico.
8. Mantenha consistência total com o tema pedido pelo usuário.
9. Se o tema for idioma:
   - Cada carta deve conter exatamente dois lados:
     - um no idioma alvo
     - outro na tradução
   - A tradução deve estar em um único idioma consistente (ex: português ou idioma nativo do usuário)
   - Nunca misture idiomas no mesmo campo
   - Nunca use palavras de outros idiomas ou alfabetos que não sejam relevantes
   - As frases devem ser naturais, úteis e contextualizadas
   - Evite palavras soltas — sempre use frases completas
   - Mantenha consistência em todo o deck (não ficar alternando formato sem lógica)
   - Prefira frases usadas na vida real (conversas, trabalho, viagem, etc.)
- Evite frases artificiais ou muito literais
10. Se o tema for estudo teórico:
   - priorize pergunta e resposta objetivas
   - foque nos conceitos mais importantes
11. Organize mentalmente as cartas do mais básico para o mais útil, quando fizer sentido.
12. Não invente contexto fora do tema pedido.

Formato obrigatório:
{
  "title": "string",
  "description": "string",
  "cards": [
    {
      "front": "string",
      "back": "string"
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

        const normalized = text.toLowerCase();

        if (/[ãõçâêôáéíóúà]/i.test(normalized)) return "pt-BR";
        if (/[ñ¿¡]/i.test(normalized)) return "es-ES";
        if (/[äöüß]/i.test(normalized)) return "de-DE";

        return "en-US";
      }

      const parsedWithLang = {
        ...parsed,
        cards: parsed.cards.map((card) => ({
          ...card,
          frontLang: detectLangSimple(card.front),
          backLang: detectLangSimple(card.back),
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