import { HttpsError } from "firebase-functions/https";
export function assertAuth(uid) {
    if (!uid) {
        throw new HttpsError("unauthenticated", "Authentication required.");
    }
    return uid;
}
export function assertCondition(condition, code, message) {
    if (!condition) {
        throw new HttpsError(code, message);
    }
}
export function toInternalError(error) {
    if (error instanceof HttpsError) {
        return error;
    }
    const message = error instanceof Error ? error.message : "Unexpected internal error";
    return new HttpsError("internal", message);
}
