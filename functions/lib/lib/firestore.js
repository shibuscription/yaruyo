import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { ensureAdminApp } from "./admin.js";
ensureAdminApp();
export const db = getFirestore();
export const SERVER_TIMESTAMP = FieldValue.serverTimestamp();
export const DEFAULT_USER_FLAGS = {
    notifyActivityPlan: true,
    notifyActivityRecord: true,
};
