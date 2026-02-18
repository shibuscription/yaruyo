export function roundTo5MinutesJst(iso: string): { roundedIso: string; startSlot: string } {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid startAt ISO format");
  }

  const jstOffsetMs = 9 * 60 * 60 * 1000;
  const jstTime = new Date(date.getTime() + jstOffsetMs);

  const minutes = jstTime.getUTCMinutes();
  const floorMinutes = Math.floor(minutes / 5) * 5;
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

export function currentWindowSlotJst(now = new Date()): { windowSlot: string } {
  const { startSlot } = roundTo5MinutesJst(now.toISOString());
  return { windowSlot: startSlot };
}

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

function toJstDate(date: Date): Date {
  return new Date(date.getTime() + JST_OFFSET_MS);
}

export function formatJstDateTime(value: Date): string {
  const jst = toJstDate(value);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(jst.getUTCDate()).padStart(2, "0");
  const hh = String(jst.getUTCHours()).padStart(2, "0");
  const mm = String(jst.getUTCMinutes()).padStart(2, "0");
  return `${y}/${m}/${d} ${hh}:${mm}`;
}

export function startSlotFromDateJst(date: Date): string {
  const jst = toJstDate(date);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(jst.getUTCDate()).padStart(2, "0");
  const hh = String(jst.getUTCHours()).padStart(2, "0");
  const mm = String(jst.getUTCMinutes()).padStart(2, "0");
  return `${y}${m}${d}${hh}${mm}`;
}

export function startSlotRangeWithBufferJst(now = new Date(), bufferMinutes = 5): { fromSlot: string; toSlot: string } {
  const from = new Date(now.getTime() - bufferMinutes * 60 * 1000);
  const to = new Date(now.getTime() + bufferMinutes * 60 * 1000);
  return {
    fromSlot: startSlotFromDateJst(from),
    toSlot: startSlotFromDateJst(to),
  };
}

export function formatStartSlotJst(startSlot: string): string {
  if (!/^\d{12}$/.test(startSlot)) {
    return startSlot;
  }
  return `${startSlot.slice(0, 4)}/${startSlot.slice(4, 6)}/${startSlot.slice(6, 8)} ${startSlot.slice(8, 10)}:${startSlot.slice(10, 12)}`;
}

export function formatStartSlotTimeJst(startSlot: string): string {
  if (!/^\d{12}$/.test(startSlot)) {
    return startSlot;
  }
  return `${startSlot.slice(8, 10)}:${startSlot.slice(10, 12)}`;
}
