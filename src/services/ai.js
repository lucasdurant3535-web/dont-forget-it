import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";

const generateCardsFn = httpsCallable(functions, "generateCardsWithAI");

export async function generateCardsWithAI(payload) {
  const result = await generateCardsFn(payload);
  return result.data;
}