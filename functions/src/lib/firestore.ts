import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { ensureAdminApp } from "./admin.js";

ensureAdminApp();
export const db = getFirestore();

export const SERVER_TIMESTAMP = FieldValue.serverTimestamp();

export type UserDoc = {
  lineDisplayName: string;
  pictureUrl: string | null;
  appDisplayName: string | null;
  notifyActivityPlan: boolean;
  notifyActivityRecord: boolean;
  familyId: string | null;
  createdAt: FirebaseFirestore.FieldValue | FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.FieldValue | FirebaseFirestore.Timestamp;
};

export const DEFAULT_USER_FLAGS = {
  notifyActivityPlan: true,
  notifyActivityRecord: true,
} as const;
