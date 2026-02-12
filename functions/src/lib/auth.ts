import { UserRecord, getAuth } from "firebase-admin/auth";
import { DEFAULT_USER_FLAGS, SERVER_TIMESTAMP, UserDoc, db } from "./firestore.js";

export async function getAuthUser(uid: string): Promise<UserRecord | null> {
  try {
    return await getAuth().getUser(uid);
  } catch {
    return null;
  }
}

export async function ensureUserDoc(uid: string): Promise<void> {
  const ref = db.doc(`users/${uid}`);
  const snap = await ref.get();
  if (snap.exists) {
    await ref.update({ updatedAt: SERVER_TIMESTAMP });
    return;
  }

  const authUser = await getAuthUser(uid);
  const data: UserDoc = {
    lineDisplayName: authUser?.displayName ?? "",
    pictureUrl: authUser?.photoURL ?? null,
    appDisplayName: null,
    notifyActivityPlan: DEFAULT_USER_FLAGS.notifyActivityPlan,
    notifyActivityRecord: DEFAULT_USER_FLAGS.notifyActivityRecord,
    notificationSettings: {
      startReminderEnabled: DEFAULT_USER_FLAGS.startReminderEnabled,
    },
    familyId: null,
    createdAt: SERVER_TIMESTAMP,
    updatedAt: SERVER_TIMESTAMP,
  };
  await ref.set(data);
}
