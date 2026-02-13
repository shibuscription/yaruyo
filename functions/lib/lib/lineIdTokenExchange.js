import { getAuth } from "firebase-admin/auth";
import { HttpsError } from "firebase-functions/v2/https";
export async function exchangeLineIdTokenCore(body) {
    if (typeof body?.idToken !== "string" || body.idToken.length === 0) {
        throw new HttpsError("invalid-argument", "idToken is required.");
    }
    if (typeof body?.channelId !== "string" || body.channelId.length === 0) {
        throw new HttpsError("invalid-argument", "channelId is required.");
    }
    const verifyBody = new URLSearchParams({
        id_token: body.idToken,
        client_id: body.channelId,
    });
    const res = await fetch("https://api.line.me/oauth2/v2.1/verify", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: verifyBody.toString(),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new HttpsError("unauthenticated", `LINE token verification failed: ${res.status} ${text}`);
    }
    const verified = (await res.json());
    if (!verified.sub) {
        throw new HttpsError("unauthenticated", "LINE token payload is invalid.");
    }
    if (verified.aud && verified.aud !== body.channelId) {
        throw new HttpsError("unauthenticated", "LINE token audience mismatch.");
    }
    const customToken = await getAuth().createCustomToken(verified.sub, {
        lineUserId: verified.sub,
    });
    return {
        ok: true,
        customToken,
        lineUserId: verified.sub,
        displayName: verified.name ?? null,
        pictureUrl: verified.picture ?? null,
    };
}
