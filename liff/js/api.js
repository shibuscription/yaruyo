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

export async function upsertMyUserProfile(uid, payload) {
  await setDoc(doc(db, "users", uid), payload, { merge: true });
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
