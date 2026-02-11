import { onCall } from "firebase-functions/v2/https";
import { assertAuth, assertCondition, toInternalError } from "../lib/errors.js";
import { db, SERVER_TIMESTAMP } from "../lib/firestore.js";
import { ensureUserDoc } from "../lib/auth.js";
import { getUserFamilyId } from "../lib/domain.js";

type JoinRequest = { code: string };

export const joinFamilyByCode = onCall({ region: "asia-northeast1" }, async (request) => {
  try {
    const uid = assertAuth(request.auth?.uid);
    const body = request.data as JoinRequest;
    assertCondition(
      typeof body?.code === "string" && /^\d{6}$/.test(body.code),
      "invalid-argument",
      "code must be 6 digit string",
    );

    await ensureUserDoc(uid);
    const currentFamilyId = await getUserFamilyId(uid);
    assertCondition(!currentFamilyId, "failed-precondition", "User already belongs to a family.");

    const inviteSnap = await db
      .collectionGroup("inviteCodes")
      .where("code", "==", body.code)
      .where("active", "==", true)
      .limit(1)
      .get();

    assertCondition(!inviteSnap.empty, "not-found", "Invite code not found or inactive.");

    const inviteDoc = inviteSnap.docs[0];
    const inviteData = inviteDoc.data();
    const familyRef = inviteDoc.ref.parent.parent;
    assertCondition(familyRef, "internal", "Family path resolution failed.");
    const familyId = familyRef.id;
    const role = inviteData.role as "parent" | "child";

    await db.runTransaction(async (tx) => {
      const userRef = db.doc(`users/${uid}`);
      const userSnap = await tx.get(userRef);
      const userFamilyId = (userSnap.data()?.familyId as string | null) ?? null;
      assertCondition(!userFamilyId, "failed-precondition", "User already belongs to a family.");

      const memberRef = db.doc(`families/${familyId}/members/${uid}`);
      const memberSnap = await tx.get(memberRef);
      if (!memberSnap.exists) {
        tx.set(memberRef, {
          role,
          status: "active",
          joinedAt: SERVER_TIMESTAMP,
          createdAt: SERVER_TIMESTAMP,
          updatedAt: SERVER_TIMESTAMP,
        });
      }

      tx.set(
        userRef,
        {
          familyId,
          updatedAt: SERVER_TIMESTAMP,
        },
        { merge: true },
      );
    });

    return {
      ok: true,
      familyId,
      role,
      joinedAt: new Date().toISOString(),
    };
  } catch (error) {
    throw toInternalError(error);
  }
});
