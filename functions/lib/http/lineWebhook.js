import { createHmac, timingSafeEqual } from "node:crypto";
import { logger } from "firebase-functions";
import { onRequest } from "firebase-functions/v2/https";
import { eventDisplayName } from "../lib/domain.js";
import { db, SERVER_TIMESTAMP } from "../lib/firestore.js";
import { sendLinePush } from "../lib/notification.js";
function channelAccessToken() {
    return process.env.LINE_CHANNEL_ACCESS_TOKEN ?? "";
}
function channelSecret() {
    return process.env.LINE_CHANNEL_SECRET ?? "";
}
function verifySignature(req) {
    const signature = req.get("x-line-signature") ?? "";
    const secret = channelSecret();
    if (!signature || !secret)
        return false;
    const rawBodyValue = req.rawBody;
    const rawBody = rawBodyValue instanceof Buffer
        ? rawBodyValue
        : Buffer.from(typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {}), "utf8");
    const expected = createHmac("sha256", secret).update(rawBody).digest("base64");
    const left = Buffer.from(signature);
    const right = Buffer.from(expected);
    if (left.length !== right.length)
        return false;
    return timingSafeEqual(left, right);
}
function normalizeText(raw) {
    if (typeof raw !== "string")
        return null;
    const trimmed = raw.trim();
    if (trimmed.length === 0)
        return null;
    if (trimmed.length <= 200)
        return trimmed;
    return `${trimmed.slice(0, 199)}…`;
}
async function replyMessage(replyToken, messages) {
    const token = channelAccessToken();
    if (!token) {
        logger.warn("LINE_CHANNEL_ACCESS_TOKEN is not set. Skip reply.", { replyToken });
        return;
    }
    const res = await fetch("https://api.line.me/v2/bot/message/reply", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ replyToken, messages }),
    });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`LINE reply failed: ${res.status} ${body}`);
    }
}
async function replyText(replyToken, text) {
    if (!replyToken)
        return;
    await replyMessage(replyToken, [{ type: "text", text }]);
}
async function replyConfirm(replyToken, draftId, text) {
    if (!replyToken)
        return;
    await replyMessage(replyToken, [
        {
            type: "text",
            text: `家族全員におくる？\n「${text}」`,
            quickReply: {
                items: [
                    {
                        type: "action",
                        action: {
                            type: "postback",
                            label: "おくる",
                            displayText: "おくる",
                            data: `action=confirm&draftId=${encodeURIComponent(draftId)}`,
                        },
                    },
                    {
                        type: "action",
                        action: {
                            type: "postback",
                            label: "やめる",
                            displayText: "やめる",
                            data: `action=cancel&draftId=${encodeURIComponent(draftId)}`,
                        },
                    },
                ],
            },
        },
    ]);
}
async function handleTextMessage(event) {
    const replyToken = event.replyToken;
    const fromUid = event.source?.userId?.trim() ?? "";
    if (!fromUid)
        return;
    const normalized = normalizeText(event.message?.text);
    if (!normalized) {
        await replyText(replyToken, "テキストだけ送れるよ。文字で送ってね。");
        return;
    }
    const userSnap = await db.doc(`users/${fromUid}`).get();
    const familyId = userSnap.data()?.familyId ?? null;
    if (typeof familyId !== "string" || familyId.trim().length === 0) {
        await replyText(replyToken, "家族に参加していないみたい。アプリで家族登録してね。");
        return;
    }
    const draftRef = db.collection("messageDrafts").doc();
    await draftRef.set({
        familyId: familyId.trim(),
        fromUid,
        text: normalized,
        createdAt: SERVER_TIMESTAMP,
    });
    await replyConfirm(replyToken, draftRef.id, normalized);
}
function parsePostback(data) {
    const params = new URLSearchParams(data ?? "");
    return {
        action: params.get("action") ?? "",
        draftId: params.get("draftId") ?? "",
    };
}
async function confirmDraft(draftId, fromUid) {
    const draftRef = db.doc(`messageDrafts/${draftId}`);
    return db.runTransaction(async (tx) => {
        const snap = await tx.get(draftRef);
        if (!snap.exists)
            return { status: "not_found" };
        const data = snap.data() ?? {};
        const draftFromUid = data.fromUid ?? "";
        if (draftFromUid !== fromUid)
            return { status: "not_found" };
        if (data.sentAt)
            return { status: "already_sent" };
        if (data.cancelledAt)
            return { status: "already_cancelled" };
        const familyId = data.familyId ?? "";
        const text = data.text ?? "";
        if (!familyId || !text)
            return { status: "not_found" };
        tx.set(draftRef, { sentAt: SERVER_TIMESTAMP, updatedAt: SERVER_TIMESTAMP }, { merge: true });
        return { status: "sent", familyId, fromUid: draftFromUid, text };
    });
}
async function cancelDraft(draftId, fromUid) {
    const draftRef = db.doc(`messageDrafts/${draftId}`);
    return db.runTransaction(async (tx) => {
        const snap = await tx.get(draftRef);
        if (!snap.exists)
            return { status: "not_found" };
        const data = snap.data() ?? {};
        const draftFromUid = data.fromUid ?? "";
        if (draftFromUid !== fromUid)
            return { status: "not_found" };
        if (data.sentAt)
            return { status: "already_sent" };
        if (data.cancelledAt)
            return { status: "already_cancelled" };
        tx.set(draftRef, { cancelledAt: SERVER_TIMESTAMP, updatedAt: SERVER_TIMESTAMP }, { merge: true });
        return { status: "cancelled" };
    });
}
async function broadcastToFamily(params) {
    const [senderSnap, membersSnap] = await Promise.all([
        db.doc(`users/${params.fromUid}`).get(),
        db.collection(`families/${params.familyId}/members`).where("status", "==", "active").get(),
    ]);
    const senderName = eventDisplayName(senderSnap.data(), params.fromUid);
    const message = `${senderName}：${params.text}`;
    const recipients = membersSnap.docs
        .map((doc) => doc.id)
        .filter((uid) => uid !== params.fromUid);
    await Promise.all(recipients.map((uid) => sendLinePush({ to: uid, message })));
}
async function handlePostback(event) {
    const replyToken = event.replyToken;
    const fromUid = event.source?.userId?.trim() ?? "";
    if (!fromUid)
        return;
    const { action, draftId } = parsePostback(event.postback?.data);
    if (!draftId) {
        await replyText(replyToken, "やめたよ");
        return;
    }
    if (action === "confirm") {
        const result = await confirmDraft(draftId, fromUid);
        if (result.status === "sent") {
            await broadcastToFamily({ familyId: result.familyId, fromUid: result.fromUid, text: result.text });
            await replyText(replyToken, "おくったよ");
            return;
        }
        if (result.status === "already_cancelled") {
            await replyText(replyToken, "やめたよ");
            return;
        }
        await replyText(replyToken, "おくったよ");
        return;
    }
    if (action === "cancel") {
        const result = await cancelDraft(draftId, fromUid);
        if (result.status === "already_sent") {
            await replyText(replyToken, "おくったよ");
            return;
        }
        await replyText(replyToken, "やめたよ");
        return;
    }
    await replyText(replyToken, "やめたよ");
}
async function handleEvent(event) {
    if (event.type === "message") {
        if (event.message?.type !== "text") {
            await replyText(event.replyToken, "テキストだけ送れるよ。文字で送ってね。");
            return;
        }
        await handleTextMessage(event);
        return;
    }
    if (event.type === "postback") {
        await handlePostback(event);
    }
}
export const lineWebhook = onRequest({ region: "asia-northeast1" }, async (req, res) => {
    if (req.method !== "POST") {
        res.status(405).send("method-not-allowed");
        return;
    }
    if (!verifySignature(req)) {
        res.status(401).send("invalid-signature");
        return;
    }
    const events = Array.isArray(req.body?.events) ? req.body.events : [];
    for (const event of events) {
        try {
            await handleEvent(event);
        }
        catch (error) {
            logger.error("lineWebhook event handling failed", { error, eventType: event?.type });
        }
    }
    res.status(200).json({ ok: true });
});
