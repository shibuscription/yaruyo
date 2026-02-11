import { logger } from "firebase-functions";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { db, SERVER_TIMESTAMP } from "../lib/firestore.js";
import { logDocIdFromDedupeKey, sendLinePush, writeNotificationLogIdempotent } from "../lib/notification.js";
import { currentWindowSlotJst } from "../lib/timeJst.js";

export const reminderScheduler = onSchedule(
  {
    region: "asia-northeast1",
    schedule: "every 30 minutes",
    timeZone: "Asia/Tokyo",
  },
  async () => {
    const { windowSlot } = currentWindowSlotJst();
    const plansSnap = await db
      .collection("plans")
      .where("status", "==", "declared")
      .where("startSlot", "==", windowSlot)
      .get();

    for (const planDoc of plansSnap.docs) {
      const plan = planDoc.data();
      const recipientId = plan.userId as string;
      const familyId = plan.familyId as string;
      const planId = planDoc.id;
      const dedupeKey = `reminder:${recipientId}:${planId}:${windowSlot}:${windowSlot}`;
      const logId = logDocIdFromDedupeKey(dedupeKey);

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
        const subjects = Array.isArray(plan.subjects) ? (plan.subjects as string[]) : [];
        const subjectLabel = subjects.length > 0 ? subjects.join(", ") : "study";
        await sendLinePush({
          to: recipientId,
          message: `Reminder: ${subjectLabel}`,
        });
        await db.doc(`notificationLogs/${logId}`).set(
          { status: "sent", sentAt: SERVER_TIMESTAMP, updatedAt: SERVER_TIMESTAMP },
          { merge: true },
        );
      } catch (error) {
        logger.error("Reminder send failed", { planId, error });
        await db.doc(`notificationLogs/${logId}`).set(
          { status: "failed", updatedAt: SERVER_TIMESTAMP },
          { merge: true },
        );
      }
    }
  },
);
