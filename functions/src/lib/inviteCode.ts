import { db, SERVER_TIMESTAMP } from "./firestore.js";

const MAX_RETRY = 10;

function generate6DigitCode(): string {
  return String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
}

export async function createInviteCode(
  familyId: string,
  role: "parent" | "child",
  createdBy: string,
): Promise<string> {
  for (let i = 0; i < MAX_RETRY; i += 1) {
    const code = generate6DigitCode();
    const ref = db.doc(`families/${familyId}/inviteCodes/${code}`);
    const snap = await ref.get();
    if (snap.exists) {
      continue;
    }
    await ref.set({
      code,
      role,
      active: true,
      createdBy,
      createdAt: SERVER_TIMESTAMP,
      updatedAt: SERVER_TIMESTAMP,
    });
    return code;
  }
  throw new Error("Failed to create unique invite code");
}
