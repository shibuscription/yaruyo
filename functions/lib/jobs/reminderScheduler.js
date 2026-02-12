import { logger } from "firebase-functions";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { db, SERVER_TIMESTAMP } from "../lib/firestore.js";
import { logDocIdFromDedupeKey, sendLinePush, writeNotificationLogIdempotent } from "../lib/notification.js";
import { formatStartSlotJst, startSlotRangeWithBufferJst } from "../lib/timeJst.js";
const BUFFER_MINUTES = 5;
function subjectText(plan) {
    if (typeof plan.subject === "string" && plan.subject.length > 0) {
        return plan.subject;
    }
    if (Array.isArray(plan.subjects) && plan.subjects.length > 0) {
        const labels = {
            en: "英語",
            math: "数学",
            jp: "国語",
            sci: "理科",
            soc: "社会",
            other: "その他",
        };
        return plan.subjects
            .map((v) => labels[v] ?? v)
            .join(", ");
    }
    return "勉強";
}
export const reminderScheduler = onSchedule({
    region: "asia-northeast1",
    schedule: "0,30 * * * *",
    timeZone: "Asia/Tokyo",
}, async () => {
    const { fromSlot, toSlot } = startSlotRangeWithBufferJst(new Date(), BUFFER_MINUTES);
    const plansSnap = await db
        .collection("plans")
        .where("status", "==", "declared")
        .where("startSlot", ">=", fromSlot)
        .where("startSlot", "<=", toSlot)
        .get();
    for (const planDoc of plansSnap.docs) {
        const plan = planDoc.data();
        if (plan.startReminderSentAt) {
            continue;
        }
        if (typeof plan.startSlot !== "string" || plan.startSlot.length !== 12) {
            continue;
        }
        const recipientId = plan.userId;
        const familyId = plan.familyId;
        const planId = planDoc.id;
        const dedupeKey = `start_reminder:${recipientId}:${planId}`;
        const logId = logDocIdFromDedupeKey(dedupeKey);
        const userSnap = await db.doc(`users/${recipientId}`).get();
        const startReminderEnabled = userSnap.data()?.notificationSettings?.startReminderEnabled !== false;
        if (!startReminderEnabled) {
            continue;
        }
        const created = await writeNotificationLogIdempotent({
            dedupeKey,
            type: "reminder",
            recipientId,
            familyId,
            eventId: null,
            status: "skipped",
        });
        if (!created) {
            continue;
        }
        try {
            const startAtText = formatStartSlotJst(plan.startSlot);
            const subjectLabel = subjectText(plan);
            await sendLinePush({
                to: recipientId,
                message: `⏰ やるよの時間です！\n\n${subjectLabel}\n${startAtText}\n\nそろそろ始めよう。`,
            });
            await Promise.all([
                db.doc(`notificationLogs/${logId}`).set({ status: "sent", sentAt: SERVER_TIMESTAMP, updatedAt: SERVER_TIMESTAMP }, { merge: true }),
                planDoc.ref.set({
                    startReminderSentAt: SERVER_TIMESTAMP,
                    updatedAt: SERVER_TIMESTAMP,
                }, { merge: true }),
            ]);
        }
        catch (error) {
            logger.error("Reminder send failed", { planId, error });
            await db.doc(`notificationLogs/${logId}`).set({ status: "failed", updatedAt: SERVER_TIMESTAMP }, { merge: true });
        }
    }
});
