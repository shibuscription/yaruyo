import type { Request, Response } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { logger } from "firebase-functions";
import { onRequest } from "firebase-functions/v2/https";
import { eventDisplayName } from "../lib/domain.js";
import { db, SERVER_TIMESTAMP } from "../lib/firestore.js";
import { sendLinePush } from "../lib/notification.js";

type LineEvent = {
  type?: string;
  replyToken?: string;
  source?: { userId?: string };
  message?: { type?: string; text?: string };
  postback?: { data?: string };
};

type DraftTxResult =
  | { status: "sent"; familyId: string; fromUid: string; text: string }
  | { status: "already_sent" | "already_cancelled" | "cancelled" | "not_found" };

function channelAccessToken(): string {
  return process.env.LINE_CHANNEL_ACCESS_TOKEN ?? "";
}

function channelSecret(): string {
  return process.env.LINE_CHANNEL_SECRET ?? "";
}

function verifySignature(req: Request): boolean {
  const signature = req.get("x-line-signature") ?? "";
  const secret = channelSecret();
  if (!signature || !secret) return false;
  const rawBodyValue = (req as Request & { rawBody?: Buffer | string }).rawBody;
  const rawBody =
    rawBodyValue instanceof Buffer
      ? rawBodyValue
      : Buffer.from(typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {}), "utf8");
  const expected = createHmac("sha256", secret).update(rawBody).digest("base64");
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function normalizeText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length <= 200) return trimmed;
  return `${trimmed.slice(0, 199)}…`;
}

async function replyMessage(replyToken: string, messages: Array<Record<string, unknown>>): Promise<void> {
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

async function replyText(replyToken: string | undefined, text: string): Promise<void> {
  if (!replyToken) return;
  await replyMessage(replyToken, [{ type: "text", text }]);
}

async function replyConfirm(replyToken: string | undefined, draftId: string, text: string): Promise<void> {
  if (!replyToken) return;
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

async function handleTextMessage(event: LineEvent): Promise<void> {
  const replyToken = event.replyToken;
  const fromUid = event.source?.userId?.trim() ?? "";
  if (!fromUid) return;

  const normalized = normalizeText(event.message?.text);
  if (!normalized) {
    await replyText(replyToken, "テキストだけ送れるよ。文字で送ってね。");
    return;
  }

  const userSnap = await db.doc(`users/${fromUid}`).get();
  const familyId = (userSnap.data()?.familyId as string | null | undefined) ?? null;
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

function parsePostback(data: string | undefined): { action: string; draftId: string } {
  const params = new URLSearchParams(data ?? "");
  return {
    action: params.get("action") ?? "",
    draftId: params.get("draftId") ?? "",
  };
}

async function confirmDraft(draftId: string, fromUid: string): Promise<DraftTxResult> {
  const draftRef = db.doc(`messageDrafts/${draftId}`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(draftRef);
    if (!snap.exists) return { status: "not_found" };
    const data = snap.data() ?? {};
    const draftFromUid = (data.fromUid as string | null | undefined) ?? "";
    if (draftFromUid !== fromUid) return { status: "not_found" };
    if (data.sentAt) return { status: "already_sent" };
    if (data.cancelledAt) return { status: "already_cancelled" };
    const familyId = (data.familyId as string | null | undefined) ?? "";
    const text = (data.text as string | null | undefined) ?? "";
    if (!familyId || !text) return { status: "not_found" };
    tx.set(draftRef, { sentAt: SERVER_TIMESTAMP, updatedAt: SERVER_TIMESTAMP }, { merge: true });
    return { status: "sent", familyId, fromUid: draftFromUid, text };
  });
}

async function cancelDraft(draftId: string, fromUid: string): Promise<DraftTxResult> {
  const draftRef = db.doc(`messageDrafts/${draftId}`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(draftRef);
    if (!snap.exists) return { status: "not_found" };
    const data = snap.data() ?? {};
    const draftFromUid = (data.fromUid as string | null | undefined) ?? "";
    if (draftFromUid !== fromUid) return { status: "not_found" };
    if (data.sentAt) return { status: "already_sent" };
    if (data.cancelledAt) return { status: "already_cancelled" };
    tx.set(draftRef, { cancelledAt: SERVER_TIMESTAMP, updatedAt: SERVER_TIMESTAMP }, { merge: true });
    return { status: "cancelled" };
  });
}

async function broadcastToFamily(params: { familyId: string; fromUid: string; text: string }): Promise<void> {
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

async function handlePostback(event: LineEvent): Promise<void> {
  const replyToken = event.replyToken;
  const fromUid = event.source?.userId?.trim() ?? "";
  if (!fromUid) return;
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

async function handleEvent(event: LineEvent): Promise<void> {
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

export const lineWebhook = onRequest({ region: "asia-northeast1" }, async (req: Request, res: Response) => {
  if (req.method !== "POST") {
    res.status(405).send("method-not-allowed");
    return;
  }
  if (!verifySignature(req)) {
    res.status(401).send("invalid-signature");
    return;
  }

  const events = Array.isArray(req.body?.events) ? (req.body.events as LineEvent[]) : [];
  for (const event of events) {
    try {
      await handleEvent(event);
    } catch (error) {
      logger.error("lineWebhook event handling failed", { error, eventType: event?.type });
    }
  }
  res.status(200).json({ ok: true });
});
