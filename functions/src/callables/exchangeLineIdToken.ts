import { onCall } from "firebase-functions/v2/https";
import { exchangeLineIdTokenCore } from "../lib/lineIdTokenExchange.js";

export const exchangeLineIdToken = onCall({ region: "asia-northeast1", minInstances: 1 }, async (request) => {
  return exchangeLineIdTokenCore(request.data);
});
