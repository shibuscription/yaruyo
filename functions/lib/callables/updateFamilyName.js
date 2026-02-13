import { HttpsError } from "firebase-functions/https";
import { onCall } from "firebase-functions/v2/https";
import { assertAuth, assertCondition, toInternalError } from "../lib/errors.js";
import { db, SERVER_TIMESTAMP } from "../lib/firestore.js";
import { ensureUserDoc } from "../lib/auth.js";
export const updateFamilyName = onCall({ region: "asia-northeast1" }, async (request) => {
    try {
        const uid = assertAuth(request.auth?.uid);
        const body = request.data;
        const name = typeof body?.name === "string" ? body.name.trim() : "";
        assertCondition(name.length >= 1 && name.length <= 20, "invalid-argument", "name must be 1..20 chars.");
        await ensureUserDoc(uid);
        const userSnap = await db.doc(`users/${uid}`).get();
        assertCondition(userSnap.exists, "failed-precondition", "User profile is missing.");
        const familyIdRaw = userSnap.data()?.familyId ?? null;
        const familyId = typeof familyIdRaw === "string" ? familyIdRaw.trim() : "";
        assertCondition(familyId.length > 0, "failed-precondition", "User does not belong to a family.");
        const familyRef = db.doc(`families/${familyId}`);
        const familySnap = await familyRef.get();
        assertCondition(familySnap.exists, "not-found", "Family not found.");
        const memberSnap = await db.doc(`families/${familyId}/members/${uid}`).get();
        assertCondition(memberSnap.exists, "not-found", "Membership not found.");
        const role = memberSnap.data()?.role;
        if (role !== "parent") {
            throw new HttpsError("permission-denied", "Only parent can update family name.");
        }
        await familyRef.set({
            name,
            updatedAt: SERVER_TIMESTAMP,
        }, { merge: true });
        return { ok: true, name };
    }
    catch (error) {
        throw toInternalError(error);
    }
});
