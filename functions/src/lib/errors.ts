import { HttpsError } from "firebase-functions/https";

export function assertAuth(uid?: string): string {
  if (!uid) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }
  return uid;
}

export function assertCondition(
  condition: unknown,
  code: "invalid-argument" | "not-found" | "failed-precondition" | "internal",
  message: string,
): asserts condition {
  if (!condition) {
    throw new HttpsError(code, message);
  }
}

export function toInternalError(error: unknown): HttpsError {
  if (error instanceof HttpsError) {
    return error;
  }
  const message = error instanceof Error ? error.message : "Unexpected internal error";
  return new HttpsError("internal", message);
}
