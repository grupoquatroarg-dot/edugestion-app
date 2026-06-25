export const BUSINESS_TIME_ZONE = "America/Argentina/Buenos_Aires";

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const zonedPartsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

const getZonedParts = (date: Date) => {
  const parts = zonedPartsFormatter.formatToParts(date);
  const values: Record<string, number> = {};

  for (const part of parts) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
};

const pad = (value: number, length = 2) => String(value).padStart(length, "0");

export const getBusinessDate = (value: Date = new Date()) => {
  const parts = getZonedParts(value);
  return `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}`;
};

const localBusinessDateTimeToUtc = (
  dateValue: string,
  hour: number,
  minute: number,
  second: number,
  millisecond: number,
) => {
  const [year, month, day] = dateValue.split("-").map(Number);
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  let candidate = new Date(localAsUtc);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const zoned = getZonedParts(candidate);
    const representedAsUtc = Date.UTC(
      zoned.year,
      zoned.month - 1,
      zoned.day,
      zoned.hour,
      zoned.minute,
      zoned.second,
      millisecond,
    );
    const adjustment = localAsUtc - representedAsUtc;
    if (adjustment === 0) break;
    candidate = new Date(candidate.getTime() + adjustment);
  }

  return candidate.toISOString();
};

export const normalizeBusinessDateForStorage = (value?: unknown) => {
  const raw = String(value ?? "").trim();
  const dateValue = DATE_ONLY_PATTERN.test(raw) ? raw : getBusinessDate();
  return localBusinessDateTimeToUtc(dateValue, 12, 0, 0, 0);
};

export const businessDayStartIso = (dateValue: string) =>
  localBusinessDateTimeToUtc(dateValue, 0, 0, 0, 0);

export const businessDayEndIso = (dateValue: string) =>
  localBusinessDateTimeToUtc(dateValue, 23, 59, 59, 999);

export const toStoredDateOnly = (value: unknown) => {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  const raw = String(value).trim();
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] || "";
};

export const toBusinessDateKey = (value: unknown) => {
  if (!value) return "";
  const raw = String(value).trim();
  if (DATE_ONLY_PATTERN.test(raw)) return raw;

  const date = value instanceof Date ? value : new Date(raw);
  if (Number.isNaN(date.getTime())) return toStoredDateOnly(value);
  return getBusinessDate(date);
};
