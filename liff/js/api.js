import { initializeApp } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-app.js";
import {
  getAuth,
  connectAuthEmulator,
  onAuthStateChanged,
  signInAnonymously,
  signInWithCustomToken,
} from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";
import {
  getFunctions,
  httpsCallable,
  connectFunctionsEmulator,
} from "https://www.gstatic.com/firebasejs/11.1.0/firebase-functions.js";
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  startAfter,
  setDoc,
  updateDoc,
  where,
} from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAAtKF1zJnYtKVq5pWIaDb6VKtVbhFd_HA",
  authDomain: "yaruyo-dc015.firebaseapp.com",
  projectId: "yaruyo-dc015",
  storageBucket: "yaruyo-dc015.firebasestorage.app",
  messagingSenderId: "1020751568402",
  appId: "1:1020751568402:web:1cf789ca0847772be882cb",
  measurementId: "G-R8WN04Z2VP"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
const functions = getFunctions(app, "asia-northeast1");

// Local dev: use emulators only when `?mode=local` is present.
// Example: http://localhost:3000/liff/index.html?mode=local
const params = new URLSearchParams(location.search);
const isLocal = params.get("mode") === "local";

let emulatorsConnected = false;
if (isLocal && !emulatorsConnected) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099");
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  emulatorsConnected = true;
}

export async function ensureAnonymousAuth() {
  if (auth.currentUser) return auth.currentUser;
  await signInAnonymously(auth);
  return auth.currentUser;
}

export function waitAuth() {
  return new Promise((resolve) => {
    const off = onAuthStateChanged(auth, (user) => {
      off();
      resolve(user);
    });
  });
}

export async function devSignIn(customToken) {
  await signInWithCustomToken(auth, customToken);
}

export async function signInWithLineIdToken(idToken, channelId) {
  const res = await httpsCallable(functions, "exchangeLineIdToken")({ idToken, channelId });
  const customToken = res?.data?.customToken;
  if (!customToken) {
    throw new Error("LINE custom token exchange failed.");
  }
  await signInWithCustomToken(auth, customToken);
  return res.data;
}

export async function getMyUser(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data() : null;
}

export function subscribeMyUser(uid, callback) {
  return onSnapshot(doc(db, "users", uid), (snap) => {
    callback(snap.exists() ? snap.data() : null);
  });
}

export async function getPlanById(planId) {
  const snap = await getDoc(doc(db, "plans", planId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function upsertMyLineProfile(uid, { profile = null, decodedIdToken = null } = {}) {
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);

  const profileDisplayName = typeof profile?.displayName === "string" ? profile.displayName.trim() : "";
  const profilePictureUrl = typeof profile?.pictureUrl === "string" ? profile.pictureUrl.trim() : "";
  const profileUserId = typeof profile?.userId === "string" ? profile.userId.trim() : "";
  const tokenName = typeof decodedIdToken?.name === "string" ? decodedIdToken.name.trim() : "";
  const tokenPicture = typeof decodedIdToken?.picture === "string" ? decodedIdToken.picture.trim() : "";

  const lineDisplayName = profileDisplayName || tokenName || "";
  const pictureUrl = profilePictureUrl || tokenPicture || "";

  const payload = {
    updatedAt: serverTimestamp(),
  };

  if (!snap.exists()) {
    payload.createdAt = serverTimestamp();
  }
  if (lineDisplayName) {
    payload.lineDisplayName = lineDisplayName;
  }
  if (pictureUrl) {
    payload.pictureUrl = pictureUrl;
  }
  if (profileUserId) {
    payload.lineUserId = profileUserId;
  }

  console.log("LINE_PROFILE_UPSERT_PRE", {
    uid,
    profileDisplayName,
    profilePictureUrl,
    tokenName,
    tokenPicture,
    writeLineDisplayName: payload.lineDisplayName ?? null,
    writePictureUrl: payload.pictureUrl ?? null,
    isCreate: !snap.exists(),
  });
  await setDoc(ref, payload, { merge: true });
  console.log("LINE_PROFILE_UPSERT_DONE", {
    uid,
    docId: ref.id,
    updatedAt: "serverTimestamp",
  });
}

export async function createFamily() {
  return (await httpsCallable(functions, "createFamily")({})).data;
}

export async function joinFamilyByCode(code) {
  return (await httpsCallable(functions, "joinFamilyByCode")({ code })).data;
}

export async function declarePlan(payload) {
  return (await httpsCallable(functions, "declarePlan")(payload)).data;
}

export async function recordPlan(planId, result, memo = null) {
  return (await httpsCallable(functions, "recordPlan")({ planId, result, memo })).data;
}

export async function leaveFamily() {
  return (await httpsCallable(functions, "leaveFamily")({})).data;
}

export async function updateFamilyName(name) {
  return (await httpsCallable(functions, "updateFamilyName")({ name })).data;
}

export async function listPlans(familyId, uid, isParent, limitCount = 10) {
  const base = [where("familyId", "==", familyId), orderBy("createdAt", "desc"), limit(limitCount)];
  const q = isParent
    ? query(collection(db, "plans"), ...base)
    : query(collection(db, "plans"), where("userId", "==", uid), ...base);
  return (await getDocs(q)).docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function listRecords(familyId, uid, isParent, memberFilter = "all", limitCount = 10) {
  const filters = [where("familyId", "==", familyId)];
  if (!isParent || memberFilter !== "all") {
    filters.push(where("userId", "==", !isParent ? uid : memberFilter));
  }
  const q = query(collection(db, "records"), ...filters, orderBy("createdAt", "desc"), limit(limitCount));
  return (await getDocs(q)).docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function listRecordsPage({
  familyId,
  uid,
  isParent,
  memberFilter = "all",
  limitCount = 20,
  cursor = null,
}) {
  const filters = [where("familyId", "==", familyId)];
  if (!isParent || memberFilter !== "all") {
    filters.push(where("userId", "==", !isParent ? uid : memberFilter));
  }
  const constraints = [...filters, orderBy("createdAt", "desc"), limit(limitCount)];
  if (cursor) constraints.push(startAfter(cursor));
  const snap = await getDocs(query(collection(db, "records"), ...constraints));
  const docs = snap.docs;
  return {
    items: docs.map((d) => ({ id: d.id, ...d.data() })),
    cursor: docs.length > 0 ? docs[docs.length - 1] : null,
    hasMore: docs.length === limitCount,
  };
}

export async function listOpenPlansPage({
  familyId,
  uid,
  limitCount = 50,
  cursor = null,
}) {
  const constraints = [
    where("familyId", "==", familyId),
    where("userId", "==", uid),
    where("status", "==", "declared"),
    orderBy("startSlot", "asc"),
    orderBy("createdAt", "asc"),
    limit(limitCount),
  ];
  if (cursor) constraints.push(startAfter(cursor));
  const snap = await getDocs(query(collection(db, "plans"), ...constraints));
  const docs = snap.docs;
  return {
    items: docs.map((d) => ({ id: d.id, ...d.data() })),
    cursor: docs.length > 0 ? docs[docs.length - 1] : null,
    hasMore: docs.length === limitCount,
  };
}

export async function listFamilyMembers(familyId) {
  const q = query(collection(db, `families/${familyId}/members`), where("status", "==", "active"));
  const memberDocs = await getDocs(q);
  const members = await Promise.all(
    memberDocs.docs.map(async (m) => {
      const userSnap = await getDoc(doc(db, "users", m.id));
      return {
        userId: m.id,
        role: m.data().role,
        ...(userSnap.exists() ? userSnap.data() : {}),
      };
    }),
  );
  return members;
}

export async function getFamily(familyId) {
  const snap = await getDoc(doc(db, "families", familyId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function listInviteCodes(familyId) {
  const snap = await getDocs(collection(db, `families/${familyId}/inviteCodes`));
  const result = { parent: null, child: null };
  snap.docs.forEach((d) => {
    const data = d.data();
    if (data?.role === "parent") result.parent = d.id;
    if (data?.role === "child") result.child = d.id;
  });
  return result;
}

export async function updateMySettings(uid, payload) {
  await updateDoc(doc(db, "users", uid), payload);
}

export async function cancelPlan(planId) {
  await updateDoc(doc(db, "plans", planId), {
    status: "cancelled",
    cancelledAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function writeDebugLog(uid, payload) {
  const logId = `${uid}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await setDoc(doc(db, "debugLogs", logId), {
    uid,
    ...payload,
    createdAt: new Date(),
  });
}
