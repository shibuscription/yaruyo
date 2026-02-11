import { FieldValue } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";
import { db, SERVER_TIMESTAMP } from "./firestore.js";
export async function getUserFamilyId(uid) {
    const snap = await db.doc(`users/${uid}`).get();
    if (!snap.exists) {
        return null;
    }
    return snap.data()?.familyId ?? null;
}
export function eventDisplayName(user, fallback) {
    const appDisplayName = typeof user?.appDisplayName === "string" ? user.appDisplayName : null;
    const lineDisplayName = typeof user?.lineDisplayName === "string" ? user.lineDisplayName : null;
    return appDisplayName || lineDisplayName || fallback;
}
export function assertSingleFamily(familyId) {
    if (familyId) {
        throw new HttpsError("failed-precondition", "User already belongs to a family.");
    }
}
export async function ensureMembership(params) {
    const memberRef = db.doc(`families/${params.familyId}/members/${params.uid}`);
    const data = {
        role: params.role,
        status: "active",
        joinedAt: SERVER_TIMESTAMP,
        createdAt: SERVER_TIMESTAMP,
        updatedAt: SERVER_TIMESTAMP,
    };
    if (params.tx) {
        params.tx.set(memberRef, data);
        return;
    }
    await memberRef.set(data);
}
export function mergeUpdatedAt(data) {
    return { ...data, updatedAt: SERVER_TIMESTAMP };
}
export function asTimestampOrNull(value) {
    if (value == null) {
        return null;
    }
    if (typeof value === "object" && value instanceof FieldValue) {
        return null;
    }
    return value;
}
