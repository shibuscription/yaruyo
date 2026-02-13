import { randomUUID } from "node:crypto";
import { onCall } from "firebase-functions/v2/https";
import { assertAuth, toInternalError } from "../lib/errors.js";
import { db, SERVER_TIMESTAMP } from "../lib/firestore.js";
import { ensureUserDoc } from "../lib/auth.js";
import { assertSingleFamily, getUserFamilyId } from "../lib/domain.js";
import { createInviteCode } from "../lib/inviteCode.js";

export const createFamily = onCall({ region: "asia-northeast1" }, async (request) => {
  try {
    const uid = assertAuth(request.auth?.uid);
    await ensureUserDoc(uid);
    const currentFamilyId = await getUserFamilyId(uid);
    assertSingleFamily(currentFamilyId);

    const familyId = randomUUID();
    await db.runTransaction(async (tx) => {
      const userRef = db.doc(`users/${uid}`);
      const userSnap = await tx.get(userRef);
      const userFamilyId = (userSnap.data()?.familyId as string | null) ?? null;
      assertSingleFamily(userFamilyId);
      const userData = (userSnap.data() as Record<string, unknown>) ?? {};
      const displayName = typeof userData.displayName === "string" ? userData.displayName.trim() : "";
      const appDisplayName = typeof userData.appDisplayName === "string" ? userData.appDisplayName.trim() : "";
      const lineDisplayName = typeof userData.lineDisplayName === "string" ? userData.lineDisplayName.trim() : "";
      const createdByDisplayName = displayName || appDisplayName || lineDisplayName || uid;

      tx.set(db.doc(`families/${familyId}`), {
        name: `${createdByDisplayName}の家族`,
        createdBy: uid,
        createdAt: SERVER_TIMESTAMP,
        updatedAt: SERVER_TIMESTAMP,
      });
      tx.set(db.doc(`families/${familyId}/members/${uid}`), {
        role: "parent",
        status: "active",
        joinedAt: SERVER_TIMESTAMP,
        createdAt: SERVER_TIMESTAMP,
        updatedAt: SERVER_TIMESTAMP,
      });
      tx.set(
        userRef,
        {
          familyId,
          updatedAt: SERVER_TIMESTAMP,
        },
        { merge: true },
      );
    });

    const [parentCode, childCode] = await Promise.all([
      createInviteCode(familyId, "parent", uid),
      createInviteCode(familyId, "child", uid),
    ]);

    return {
      ok: true,
      familyId,
      myRole: "parent",
      inviteCodes: { parentCode, childCode },
      createdAt: new Date().toISOString(),
    };
  } catch (error) {
    throw toInternalError(error);
  }
});
