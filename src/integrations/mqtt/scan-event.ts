export interface ScanEvent {
  eventId: string;
  epc: string;
  readerId: string;
  observedAt: string;
  antennaId?: string | number;
  rssi?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseScanEvent(payload: Buffer): ScanEvent {
  let value: unknown;
  try {
    value = JSON.parse(payload.toString("utf8"));
  } catch {
    throw new Error("Scan event is not valid JSON");
  }

  if (!isRecord(value)) {
    throw new Error("Scan event must be a JSON object");
  }

  const { eventId, epc, readerId, observedAt, antennaId, rssi } = value;
  if (
    typeof eventId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      eventId,
    )
  ) {
    throw new Error("eventId must be a UUID");
  }
  if (
    typeof epc !== "string" ||
    epc.length < 4 ||
    epc.length > 128 ||
    epc.length % 2 !== 0 ||
    !/^[0-9a-f]+$/i.test(epc)
  ) {
    throw new Error("epc must contain 2 to 64 bytes encoded as hexadecimal");
  }
  if (
    typeof readerId !== "string" ||
    readerId.trim().length === 0 ||
    readerId.length > 140
  ) {
    throw new Error("readerId must be a non-empty string of at most 140 characters");
  }
  if (
    typeof observedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(observedAt) ||
    Number.isNaN(Date.parse(observedAt))
  ) {
    throw new Error("observedAt must be an ISO 8601 timestamp with a timezone");
  }
  if (
    antennaId !== undefined &&
    !(
      (typeof antennaId === "string" &&
        antennaId.trim().length > 0 &&
        antennaId.length <= 140) ||
      (typeof antennaId === "number" &&
        Number.isSafeInteger(antennaId) &&
        antennaId >= 0)
    )
  ) {
    throw new Error("antennaId must be a non-empty string or non-negative integer");
  }
  if (
    rssi !== undefined &&
    (typeof rssi !== "number" ||
      !Number.isFinite(rssi) ||
      rssi < -200 ||
      rssi > 100)
  ) {
    throw new Error("rssi must be a finite number between -200 and 100");
  }

  return {
    eventId,
    epc: epc.toUpperCase(),
    readerId: readerId.trim(),
    observedAt: new Date(observedAt).toISOString(),
    ...(antennaId === undefined ? {} : { antennaId }),
    ...(rssi === undefined ? {} : { rssi }),
  };
}
