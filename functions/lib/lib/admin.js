import { getApps, initializeApp } from "firebase-admin/app";
let initialized = false;
export function ensureAdminApp() {
    if (initialized) {
        return;
    }
    if (getApps().length === 0) {
        initializeApp();
    }
    initialized = true;
}
