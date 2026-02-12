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
    const data = snap.data() ?? {};
    const patch: Record<string, unknown> = {
      updatedAt: SERVER_TIMESTAMP,
    };

    if (typeof data.notifyActivityPlan !== "boolean") {
      patch.notifyActivityPlan = DEFAULT_USER_FLAGS.notifyActivityPlan;
    }
    if (typeof data.notifyActivityRecord !== "boolean") {
      patch.notifyActivityRecord = DEFAULT_USER_FLAGS.notifyActivityRecord;
    }
    if (typeof data.notificationSettings?.startReminderEnabled !== "boolean") {
      patch.notificationSettings = {
        ...(data.notificationSettings ?? {}),
        startReminderEnabled: DEFAULT_USER_FLAGS.startReminderEnabled,
      };
    }

    await ref.set(patch, { merge: true });
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
