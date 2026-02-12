import { logger } from "firebase-functions";
import { db, SERVER_TIMESTAMP } from "./firestore.js";

type EventType = "activity_plan" | "activity_record" | "reminder";

type SendPushInput = {
  to: string;
  message: string;
};

function getLineEnv() {
  return {
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN ?? "",
    channelSecret: process.env.LINE_CHANNEL_SECRET ?? "",
  };
}

export function logDocIdFromDedupeKey(dedupeKey: string): string {
  return dedupeKey.replace(/\//g, "_");
}

export async function sendLinePush({ to, message }: SendPushInput): Promise<void> {
  const { channelAccessToken } = getLineEnv();
  if (!channelAccessToken) {
    logger.warn("LINE_CHANNEL_ACCESS_TOKEN is not set. Skip push.", { to, message });
    return;
  }

  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${channelAccessToken}`,
    },
    body: JSON.stringify({
      to,
      messages: [{ type: "text", text: message }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LINE push failed: ${res.status} ${body}`);
  }
}

export async function writeNotificationLogIdempotent(params: {
  dedupeKey: string;
  type: EventType;
  recipientId: string;
  familyId: string;
  eventId: string | null;
  status: "sent" | "skipped" | "failed";
}): Promise<boolean> {
  const logId = logDocIdFromDedupeKey(params.dedupeKey);
  const ref = db.doc(`notificationLogs/${logId}`);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) {
      return false;
    }
    tx.set(ref, {
      ...params,
      sentAt: params.status === "sent" ? SERVER_TIMESTAMP : null,
      createdAt: SERVER_TIMESTAMP,
      updatedAt: SERVER_TIMESTAMP,
    });
    return true;
  });
}

export async function notifyRecipients(params: {
  familyId: string;
  eventId: string;
  type: EventType;
  actorUserId: string;
  recipientIds: string[];
  messageBuilder: (recipientId: string) => string;
}): Promise<void> {
  for (const recipientId of params.recipientIds) {
    const dedupeKey = `${params.type}:${recipientId}:${params.eventId}`;
    const created = await writeNotificationLogIdempotent({
      dedupeKey,
      type: params.type,
      recipientId,
      familyId: params.familyId,
      eventId: params.eventId,
      status: "skipped",
    });
    if (!created) {
      continue;
    }

    try {
      await sendLinePush({ to: recipientId, message: params.messageBuilder(recipientId) });
      await db.doc(`notificationLogs/${logDocIdFromDedupeKey(dedupeKey)}`).set(
        { status: "sent", sentAt: SERVER_TIMESTAMP, updatedAt: SERVER_TIMESTAMP },
        { merge: true },
      );
    } catch (error) {
      logger.error("Failed to send activity notification", { recipientId, error });
      await db.doc(`notificationLogs/${logDocIdFromDedupeKey(dedupeKey)}`).set(
        { status: "failed", updatedAt: SERVER_TIMESTAMP },
        { merge: true },
      );
    }
  }
}
