export const BUSINESS_TIME_ZONE = 'America/Argentina/Buenos_Aires';

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const businessDatePartsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const businessDateFormatter = new Intl.DateTimeFormat('es-AR', {
  timeZone: BUSINESS_TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const businessDateTimeFormatter = new Intl.DateTimeFormat('es-AR', {
  timeZone: BUSINESS_TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const businessTimeFormatter = new Intl.DateTimeFormat('es-AR', {
  timeZone: BUSINESS_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
});

const pad = (value: number, length = 2) => String(value).padStart(length, '0');

const toIsoFromParts = (date: Date) => {
  const parts = businessDatePartsFormatter.formatToParts(date);
  const values: Record<string, string> = {};
  parts.forEach((part) => {
    if (part.type !== 'literal') values[part.type] = part.value;
  });
  return `${values.year}-${values.month}-${values.day}`;
};

const parseDateOnly = (value: string) => new Date(`${value}T12:00:00-03:00`);

export const isDateOnlyValue = (value: unknown) => DATE_ONLY_PATTERN.test(String(value || '').trim());

export const getBusinessDateInputValue = (date: Date = new Date()) => toIsoFromParts(date);

export const addBusinessDays = (dateValue: string, days: number) => {
  const [year, month, day] = dateValue.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0));
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
};

export const getBusinessDateKey = (value: unknown) => {
  if (!value) return '';
  const raw = String(value).trim();
  if (DATE_ONLY_PATTERN.test(raw)) return raw;

  const date = value instanceof Date ? value : new Date(raw);
  if (Number.isNaN(date.getTime())) {
    const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
    return match?.[1] || '';
  }

  return toIsoFromParts(date);
};


export const differenceInBusinessCalendarDays = (fromValue: unknown, toValue: unknown = new Date()) => {
  const fromKey = getBusinessDateKey(fromValue);
  const toKey = getBusinessDateKey(toValue);
  if (!fromKey || !toKey) return 0;

  const [fromYear, fromMonth, fromDay] = fromKey.split('-').map(Number);
  const [toYear, toMonth, toDay] = toKey.split('-').map(Number);
  const fromUtc = Date.UTC(fromYear, fromMonth - 1, fromDay);
  const toUtc = Date.UTC(toYear, toMonth - 1, toDay);
  return Math.trunc((toUtc - fromUtc) / 86400000);
};

export const formatBusinessDate = (value: unknown, fallback = 'Sin fecha') => {
  if (!value) return fallback;
  const raw = String(value).trim();
  const date = DATE_ONLY_PATTERN.test(raw) ? parseDateOnly(raw) : value instanceof Date ? value : new Date(raw);
  return Number.isNaN(date.getTime()) ? fallback : businessDateFormatter.format(date);
};

export const formatBusinessDateTime = (value: unknown, fallback = 'Sin fecha') => {
  if (!value) return fallback;
  const raw = String(value).trim();
  if (DATE_ONLY_PATTERN.test(raw)) return formatBusinessDate(raw, fallback);

  const date = value instanceof Date ? value : new Date(raw);
  return Number.isNaN(date.getTime()) ? fallback : businessDateTimeFormatter.format(date);
};

export const formatBusinessTime = (value: unknown) => {
  if (!value || isDateOnlyValue(value)) return '';
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? '' : businessTimeFormatter.format(date);
};
