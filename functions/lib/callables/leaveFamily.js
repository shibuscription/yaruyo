import { onCall } from "firebase-functions/v2/https";
import { assertAuth, assertCondition, toInternalError } from "../lib/errors.js";
import { db, SERVER_TIMESTAMP } from "../lib/firestore.js";
import { ensureUserDoc } from "../lib/auth.js";
export const leaveFamily = onCall({ region: "asia-northeast1" }, async (request) => {
    try {
        const uid = assertAuth(request.auth?.uid);
        await ensureUserDoc(uid);
        const userRef = db.doc(`users/${uid}`);
        const userSnap = await userRef.get();
        assertCondition(userSnap.exists, "failed-precondition", "User profile is missing.");
        const familyIdRaw = userSnap.data()?.familyId ?? null;
        const familyId = typeof familyIdRaw === "string" ? familyIdRaw.trim() : "";
        assertCondition(familyId.length > 0, "failed-precondition", "User does not belong to a family.");
        const familyRef = db.doc(`families/${familyId}`);
        const familySnap = await familyRef.get();
        assertCondition(familySnap.exists, "not-found", "Family not found.");
        const memberRef = db.doc(`families/${familyId}/members/${uid}`);
        const memberSnap = await memberRef.get();
        assertCondition(memberSnap.exists, "not-found", "Membership not found.");
        const role = memberSnap.data()?.role;
        if (role === "parent") {
            const activeParentSnap = await db
                .collection(`families/${familyId}/members`)
                .where("role", "==", "parent")
                .where("status", "==", "active")
                .limit(2)
                .get();
            assertCondition(activeParentSnap.size > 1, "failed-precondition", "最後の親は家族をぬけられません");
        }
        const batch = db.batch();
        batch.delete(memberRef);
        batch.set(userRef, {
            familyId: null,
            updatedAt: SERVER_TIMESTAMP,
        }, { merge: true });
        await batch.commit();
        return { ok: true };
    }
    catch (error) {
        throw toInternalError(error);
    }
});
