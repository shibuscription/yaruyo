import { randomUUID } from "node:crypto";
import { onCall } from "firebase-functions/v2/https";
import { assertAuth, assertCondition, toInternalError } from "../lib/errors.js";
import { db, SERVER_TIMESTAMP } from "../lib/firestore.js";
import { ensureUserDoc } from "../lib/auth.js";
import { eventDisplayName, getUserFamilyId } from "../lib/domain.js";
import { notifyRecipients } from "../lib/notification.js";
import { subjectsLabel } from "../lib/subjects.js";
import { formatStartSlotTimeJst, roundTo30MinutesJst } from "../lib/timeJst.js";

type AmountType = "time" | "page" | null;

type DeclarePlanRequest = {
  subjects: string[];
  startAt: string | null;
  amountType: AmountType;
  amountValue: number | null;
  contentMemo: string | null;
};

export const declarePlan = onCall({ region: "asia-northeast1" }, async (request) => {
  try {
    const uid = assertAuth(request.auth?.uid);
    const body = request.data as DeclarePlanRequest;
    assertCondition(Array.isArray(body?.subjects) && body.subjects.length > 0, "invalid-argument", "subjects is required");

    if (body.amountType !== null) {
      assertCondition(body.amountType === "time" || body.amountType === "page", "invalid-argument", "amountType is invalid");
    }
    if (body.amountValue !== null) {
      assertCondition(typeof body.amountValue === "number" && Number.isFinite(body.amountValue), "invalid-argument", "amountValue is invalid");
    }

    await ensureUserDoc(uid);
    const familyId = await getUserFamilyId(uid);
    assertCondition(!!familyId, "failed-precondition", "User does not belong to a family.");

    let startAtIso: string | null = null;
    let startSlot: string | null = null;
    if (body.startAt) {
      const rounded = roundTo30MinutesJst(body.startAt);
      startAtIso = rounded.roundedIso;
      startSlot = rounded.startSlot;
    }

    const planId = randomUUID();
    const eventId = `plan_declared_${planId}`;
    const userSnap = await db.doc(`users/${uid}`).get();
    const actorDisplayName = eventDisplayName(userSnap.data(), uid);

    await db.runTransaction(async (tx) => {
      tx.set(db.doc(`plans/${planId}`), {
        familyId,
        userId: uid,
        subjects: body.subjects,
        contentMemo: body.contentMemo ?? null,
        startAt: startAtIso ? new Date(startAtIso) : null,
        startSlot,
        amountType: body.amountType ?? null,
        amountValue: body.amountValue ?? null,
        status: "declared",
        cancelledAt: null,
        recordedAt: null,
        startReminderSentAt: null,
        createdAt: SERVER_TIMESTAMP,
        updatedAt: SERVER_TIMESTAMP,
      });

      tx.set(db.doc(`events/${eventId}`), {
        familyId,
        actorUserId: uid,
        type: "plan_declared",
        resourceId: planId,
        payloadForMessage: {
          actorDisplayName,
          subjects: body.subjects,
          startAt: startAtIso,
          startSlot,
          amountType: body.amountType ?? null,
          amountValue: body.amountValue ?? null,
        },
        createdAt: SERVER_TIMESTAMP,
        updatedAt: SERVER_TIMESTAMP,
      });
    });

    const membersSnap = await db
      .collection(`families/${familyId}/members`)
      .where("status", "==", "active")
      .get();
    const recipients: string[] = [];
    await Promise.all(
      membersSnap.docs.map(async (memberDoc) => {
        const userSnap = await db.doc(`users/${memberDoc.id}`).get();
        if (userSnap.data()?.notifyActivityPlan === true) {
          recipients.push(memberDoc.id);
        }
      }),
    );

    const subjectsText = subjectsLabel(body.subjects);
    const startTime = startSlot ? formatStartSlotTimeJst(startSlot) : null;
    const msg = startTime
      ? `${actorDisplayName}が${startTime}から「${subjectsText}」をやるよ ✏️`
      : `${actorDisplayName}が「${subjectsText}」をやるよ ✏️`;
    console.log("PLAN_NOTIFY_MESSAGE", msg, "subjects=", body.subjects, "startSlot=", startSlot);
    console.log("RECIPIENTS_CHECK", recipients);
    await notifyRecipients({
      familyId,
      eventId,
      type: "activity_plan",
      actorUserId: uid,
      recipientIds: recipients,
      messageBuilder: () => msg,
    });

    return {
      ok: true,
      planId,
      status: "declared",
      startAt: startAtIso,
      startSlot,
      createdAt: new Date().toISOString(),
    };
  } catch (error) {
    throw toInternalError(error);
  }
});
