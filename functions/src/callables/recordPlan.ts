import { onCall } from "firebase-functions/v2/https";
import { ensureUserDoc } from "../lib/auth.js";
import { eventDisplayName } from "../lib/domain.js";
import { assertAuth, assertCondition, toInternalError } from "../lib/errors.js";
import { db, SERVER_TIMESTAMP } from "../lib/firestore.js";
import { notifyRecipients } from "../lib/notification.js";
import { subjectsLabel } from "../lib/subjects.js";

type RecordResult = "light" | "as_planned" | "extra";
type RecordPlanRequest = { planId: string; result: RecordResult; memo?: string | null };

function isValidResult(result: unknown): result is RecordResult {
  return result === "light" || result === "as_planned" || result === "extra";
}

type TxResult = {
  ok: true;
  planId: string;
  recordId: string;
  eventId: string;
  recordedAt: string;
  familyId: string;
  memo: string | null;
};

export const recordPlan = onCall({ region: "asia-northeast1" }, async (request) => {
  try {
    const uid = assertAuth(request.auth?.uid);
    const body = request.data as RecordPlanRequest;
    assertCondition(typeof body?.planId === "string" && body.planId.length > 0, "invalid-argument", "planId is required.");
    assertCondition(isValidResult(body?.result), "invalid-argument", "result is invalid.");
    assertCondition(
      body?.memo == null || typeof body.memo === "string",
      "invalid-argument",
      "memo must be a string or null.",
    );
    const trimmedMemo = typeof body?.memo === "string" ? body.memo.trim() : "";
    assertCondition(trimmedMemo.length <= 200, "invalid-argument", "memo must be <= 200 chars.");
    const normalizedMemo: string | null = trimmedMemo.length > 0 ? trimmedMemo : null;

    await ensureUserDoc(uid);

    const planRef = db.doc(`plans/${body.planId}`);
    const recordRef = db.doc(`records/${body.planId}`);
    const eventId = `plan_recorded_${body.planId}`;
    const eventRef = db.doc(`events/${eventId}`);

    const txResult = await db.runTransaction<TxResult>(async (tx) => {
      const userRef = db.doc(`users/${uid}`);
      const [planSnap, recordSnap, userSnap] = await Promise.all([tx.get(planRef), tx.get(recordRef), tx.get(userRef)]);
      assertCondition(planSnap.exists, "not-found", "Plan not found.");
      assertCondition(userSnap.exists, "failed-precondition", "User profile is missing.");

      const plan = planSnap.data()!;
      const userFamilyId = (userSnap.data()?.familyId as string | null) ?? null;
      assertCondition(plan.userId === uid, "failed-precondition", "You can only record your own plan.");
      assertCondition(userFamilyId === plan.familyId, "failed-precondition", "Family mismatch.");

      if (recordSnap.exists) {
        const recordedAt = plan.recordedAt?.toDate?.()?.toISOString?.() ?? new Date().toISOString();
        const existingMemo = (recordSnap.data()?.memo as string | null | undefined) ?? null;
        return {
          ok: true,
          planId: body.planId,
          recordId: body.planId,
          eventId,
          recordedAt,
          familyId: plan.familyId as string,
          memo: existingMemo,
        };
      }

      assertCondition(plan.status === "declared", "failed-precondition", "Plan is not recordable.");

      tx.set(recordRef, {
        familyId: plan.familyId,
        userId: uid,
        planId: body.planId,
        result: body.result,
        memo: normalizedMemo,
        createdAt: SERVER_TIMESTAMP,
      });
      tx.update(planRef, {
        status: "recorded",
        recordedAt: SERVER_TIMESTAMP,
        updatedAt: SERVER_TIMESTAMP,
      });

      const actorDisplayName = eventDisplayName(userSnap.data(), uid);
      tx.set(eventRef, {
        familyId: plan.familyId,
        actorUserId: uid,
        type: "plan_recorded",
        resourceId: body.planId,
        payloadForMessage: {
          actorDisplayName,
          subjects: Array.isArray(plan.subjects) ? plan.subjects : [],
          result: body.result,
        },
        createdAt: SERVER_TIMESTAMP,
        updatedAt: SERVER_TIMESTAMP,
      });

      return {
        ok: true,
        planId: body.planId,
        recordId: body.planId,
        eventId,
        recordedAt: new Date().toISOString(),
        familyId: plan.familyId as string,
        memo: normalizedMemo,
      };
    });

    const membersSnap = await db
      .collection(`families/${txResult.familyId}/members`)
      .where("status", "==", "active")
      .get();

    const recipients: string[] = [];
    await Promise.all(
      membersSnap.docs.map(async (memberDoc) => {
        const recipientId = memberDoc.id;
        const userSnap = await db.doc(`users/${recipientId}`).get();
        if (userSnap.data()?.notifyActivityRecord === true) {
          recipients.push(recipientId);
        }
      }),
    );

    const eventSnap = await db.doc(`events/${txResult.eventId}`).get();
    const payload = (eventSnap.data()?.payloadForMessage ?? {}) as Record<string, unknown>;
    const actorDisplayName = typeof payload.actorDisplayName === "string" ? payload.actorDisplayName : uid;
    const subjects = Array.isArray(payload.subjects) ? (payload.subjects as string[]) : [];
    const subjectText = subjects.length > 0 ? subjectsLabel(subjects) : "勉強";
    const resultJa =
      body.result === "light" ? "軽めに" : body.result === "as_planned" ? "予定どおり" : "多めに";
    const baseMessage = `${actorDisplayName}が「${subjectText}」をやったよ！🏆\n（${resultJa}）`;
    let finalMessage = baseMessage;
    if (txResult.memo) {
      const trimmed = txResult.memo.slice(0, 30);
      const needsEllipsis = txResult.memo.length > 30;
      finalMessage = `${baseMessage}\n${trimmed}${needsEllipsis ? "…" : ""}`;
    }

    await notifyRecipients({
      familyId: txResult.familyId,
      eventId: txResult.eventId,
      type: "activity_record",
      actorUserId: uid,
      recipientIds: recipients,
      messageBuilder: () => finalMessage,
    });

    return {
      ok: true,
      planId: txResult.planId,
      recordId: txResult.recordId,
      eventId: txResult.eventId,
      recordedAt: txResult.recordedAt,
      memo: txResult.memo,
    };
  } catch (error) {
    throw toInternalError(error);
  }
});
