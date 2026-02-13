import { onCall } from "firebase-functions/v2/https";
import { assertAuth, assertCondition, toInternalError } from "../lib/errors.js";
import { db, SERVER_TIMESTAMP } from "../lib/firestore.js";
import { ensureUserDoc } from "../lib/auth.js";

const BATCH_LIMIT = 400;

async function commitInChunks(
  refs: FirebaseFirestore.DocumentReference[],
  apply: (batch: FirebaseFirestore.WriteBatch, ref: FirebaseFirestore.DocumentReference) => void,
) {
  for (let i = 0; i < refs.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    const chunk = refs.slice(i, i + BATCH_LIMIT);
    chunk.forEach((ref) => apply(batch, ref));
    await batch.commit();
  }
}

export const closeFamily = onCall({ region: "asia-northeast1" }, async (request) => {
  try {
    const uid = assertAuth(request.auth?.uid);
    await ensureUserDoc(uid);

    const userRef = db.doc(`users/${uid}`);
    const userSnap = await userRef.get();
    assertCondition(userSnap.exists, "failed-precondition", "User profile is missing.");
    const familyIdRaw = (userSnap.data()?.familyId as string | null | undefined) ?? null;
    const familyId = typeof familyIdRaw === "string" ? familyIdRaw.trim() : "";
    assertCondition(familyId.length > 0, "failed-precondition", "User does not belong to a family.");

    const familyRef = db.doc(`families/${familyId}`);
    const familySnap = await familyRef.get();
    assertCondition(familySnap.exists, "not-found", "Family not found.");
    const familyStatus = (familySnap.data()?.status as string | undefined) ?? "active";
    if (familyStatus === "closed") {
      return { ok: true, alreadyClosed: true };
    }

    const myMemberRef = db.doc(`families/${familyId}/members/${uid}`);
    const myMemberSnap = await myMemberRef.get();
    assertCondition(myMemberSnap.exists, "not-found", "Membership not found.");
    assertCondition(myMemberSnap.data()?.role === "parent", "failed-precondition", "Only parent can close family.");

    await familyRef.set(
      {
        status: "closed",
        closedAt: SERVER_TIMESTAMP,
        closedBy: uid,
        updatedAt: SERVER_TIMESTAMP,
      },
      { merge: true },
    );

    const membersSnap = await db.collection(`families/${familyId}/members`).get();
    const memberRefs = membersSnap.docs.map((docSnap) => docSnap.ref);
    const memberUserRefs = membersSnap.docs.map((docSnap) => db.doc(`users/${docSnap.id}`));

    const inviteSnap = await db.collection(`families/${familyId}/inviteCodes`).get();
    const inviteRefs = inviteSnap.docs.map((docSnap) => docSnap.ref);

    await commitInChunks(memberUserRefs, (batch, ref) => {
      batch.set(
        ref,
        {
          familyId: null,
          updatedAt: SERVER_TIMESTAMP,
        },
        { merge: true },
      );
    });

    await commitInChunks(inviteRefs, (batch, ref) => {
      batch.set(
        ref,
        {
          active: false,
          updatedAt: SERVER_TIMESTAMP,
        },
        { merge: true },
      );
    });

    await commitInChunks(memberRefs, (batch, ref) => {
      batch.delete(ref);
    });

    return { ok: true };
  } catch (error) {
    throw toInternalError(error);
  }
});
