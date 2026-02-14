import { onCall } from "firebase-functions/v2/https";
import { ensureUserDoc } from "../lib/auth.js";
import { eventDisplayName } from "../lib/domain.js";
import { assertAuth, assertCondition, toInternalError } from "../lib/errors.js";
import { db, SERVER_TIMESTAMP } from "../lib/firestore.js";
import { logDocIdFromDedupeKey, sendLinePush } from "../lib/notification.js";
function isValidTargetType(value) {
    return value === "plan" || value === "record";
}
function normalizeTargetIds(value) {
    if (!Array.isArray(value))
        return [];
    return value
        .filter((id) => typeof id === "string")
        .map((id) => id.trim())
        .filter((id) => id.length > 0);
}
function reactionDocId(targetType, targetId, uid) {
    return `${targetType}_${targetId}_${uid}`;
}
async function getUserFamilyId(uid) {
    const userSnap = await db.doc(`users/${uid}`).get();
    const familyId = userSnap.data()?.familyId ?? null;
    assertCondition(typeof familyId === "string" && familyId.trim().length > 0, "failed-precondition", "User has no family.");
    return familyId.trim();
}
async function getTargetInfo(targetType, targetId) {
    const targetPath = targetType === "plan" ? `plans/${targetId}` : `records/${targetId}`;
    const targetSnap = await db.doc(targetPath).get();
    assertCondition(targetSnap.exists, "not-found", "Target not found.");
    const target = targetSnap.data() ?? {};
    const familyId = target.familyId ?? null;
    const targetUserId = target.userId ?? null;
    assertCondition(typeof familyId === "string" && familyId.trim().length > 0, "failed-precondition", "Target family is invalid.");
    assertCondition(typeof targetUserId === "string" && targetUserId.trim().length > 0, "failed-precondition", "Target user is invalid.");
    return { familyId: familyId.trim(), targetUserId: targetUserId.trim() };
}
async function notifyTargetUserLikeOnce(params) {
    if (params.targetUserId === params.fromUid) {
        return;
    }
    const actorSnap = await db.doc(`users/${params.fromUid}`).get();
    const actorName = eventDisplayName(actorSnap.data(), params.fromUid);
    const targetLabel = params.targetType === "plan" ? "やるよ" : "やったよ";
    const dedupeKey = `reaction_like:${params.targetUserId}:${params.targetType}:${params.targetId}:${params.fromUid}`;
    const logId = logDocIdFromDedupeKey(dedupeKey);
    const logRef = db.doc(`notificationLogs/${logId}`);
    const created = await db.runTransaction(async (tx) => {
        const snap = await tx.get(logRef);
        if (snap.exists) {
            return false;
        }
        tx.set(logRef, {
            dedupeKey,
            type: "reaction_like",
            recipientId: params.targetUserId,
            familyId: params.familyId,
            eventId: null,
            status: "skipped",
            sentAt: null,
            createdAt: SERVER_TIMESTAMP,
            updatedAt: SERVER_TIMESTAMP,
        });
        return true;
    });
    if (!created) {
        return;
    }
    try {
        await sendLinePush({
            to: params.targetUserId,
            message: `${actorName}があなたの「${targetLabel}」に👍しました`,
        });
        await logRef.set({ status: "sent", sentAt: SERVER_TIMESTAMP, updatedAt: SERVER_TIMESTAMP }, { merge: true });
    }
    catch {
        await logRef.set({ status: "failed", updatedAt: SERVER_TIMESTAMP }, { merge: true });
    }
}
export const toggleReactionLike = onCall({ region: "asia-northeast1" }, async (request) => {
    try {
        const uid = assertAuth(request.auth?.uid);
        const body = (request.data ?? {});
        assertCondition(isValidTargetType(body?.targetType), "invalid-argument", "targetType is invalid.");
        assertCondition(typeof body?.targetId === "string" && body.targetId.trim().length > 0, "invalid-argument", "targetId is required.");
        const targetType = body.targetType;
        const targetId = body.targetId.trim();
        await ensureUserDoc(uid);
        const [userFamilyId, targetInfo] = await Promise.all([
            getUserFamilyId(uid),
            getTargetInfo(targetType, targetId),
        ]);
        assertCondition(userFamilyId === targetInfo.familyId, "failed-precondition", "Family mismatch.");
        const reactionRef = db.doc(`reactions/${reactionDocId(targetType, targetId, uid)}`);
        const reactionCreated = await db.runTransaction(async (tx) => {
            const snap = await tx.get(reactionRef);
            if (snap.exists) {
                return false;
            }
            const reactionType = "like";
            tx.set(reactionRef, {
                familyId: userFamilyId,
                targetType,
                targetId,
                fromUid: uid,
                type: reactionType,
                createdAt: SERVER_TIMESTAMP,
            });
            return true;
        });
        if (reactionCreated) {
            await notifyTargetUserLikeOnce({
                familyId: userFamilyId,
                targetType,
                targetId,
                targetUserId: targetInfo.targetUserId,
                fromUid: uid,
            });
        }
        return { liked: true };
    }
    catch (error) {
        throw toInternalError(error);
    }
});
export const listMyReactionsForTargets = onCall({ region: "asia-northeast1" }, async (request) => {
    try {
        const uid = assertAuth(request.auth?.uid);
        const body = (request.data ?? {});
        assertCondition(isValidTargetType(body?.targetType), "invalid-argument", "targetType is invalid.");
        const targetIds = normalizeTargetIds(body?.targetIds);
        assertCondition(targetIds.length <= 10, "invalid-argument", "targetIds must be <= 10.");
        if (targetIds.length === 0) {
            return { likedTargetIds: [] };
        }
        await ensureUserDoc(uid);
        const snap = await db
            .collection("reactions")
            .where("fromUid", "==", uid)
            .where("targetType", "==", body.targetType)
            .where("targetId", "in", targetIds)
            .where("type", "==", "like")
            .get();
        const likedTargetIds = snap.docs
            .map((doc) => doc.data()?.targetId ?? null)
            .filter((id) => typeof id === "string" && id.length > 0);
        return { likedTargetIds };
    }
    catch (error) {
        throw toInternalError(error);
    }
});
