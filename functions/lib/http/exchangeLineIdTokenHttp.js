import { onRequest, HttpsError } from "firebase-functions/v2/https";
import { exchangeLineIdTokenCore } from "../lib/lineIdTokenExchange.js";
function setCors(res) {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
}
export const exchangeLineIdTokenHttp = onRequest({ region: "asia-northeast1" }, async (req, res) => {
    setCors(res);
    if (req.method === "OPTIONS") {
        res.status(204).send("");
        return;
    }
    if (req.method !== "POST") {
        res.status(405).json({ ok: false, error: "method-not-allowed" });
        return;
    }
    try {
        const result = await exchangeLineIdTokenCore(req.body ?? {});
        res.status(200).json(result);
    }
    catch (error) {
        if (error instanceof HttpsError) {
            res.status(400).json({ ok: false, error: error.code, message: error.message });
            return;
        }
        const message = error instanceof Error ? error.message : "internal";
        res.status(500).json({ ok: false, error: "internal", message });
    }
});
