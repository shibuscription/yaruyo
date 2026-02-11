export function roundTo30MinutesJst(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
        throw new Error("Invalid startAt ISO format");
    }
    const jstOffsetMs = 9 * 60 * 60 * 1000;
    const jstTime = new Date(date.getTime() + jstOffsetMs);
    const minutes = jstTime.getUTCMinutes();
    const floorMinutes = minutes < 30 ? 0 : 30;
    jstTime.setUTCMinutes(floorMinutes, 0, 0);
    const y = jstTime.getUTCFullYear();
    const m = String(jstTime.getUTCMonth() + 1).padStart(2, "0");
    const d = String(jstTime.getUTCDate()).padStart(2, "0");
    const hh = String(jstTime.getUTCHours()).padStart(2, "0");
    const mm = String(jstTime.getUTCMinutes()).padStart(2, "0");
    const startSlot = `${y}${m}${d}${hh}${mm}`;
    const utcRounded = new Date(jstTime.getTime() - jstOffsetMs);
    return { roundedIso: utcRounded.toISOString(), startSlot };
}
export function currentWindowSlotJst(now = new Date()) {
    const { startSlot } = roundTo30MinutesJst(now.toISOString());
    return { windowSlot: startSlot };
}
