export interface LocalDateParts {
  year: number;
  month: number;
  day: number;
}

interface LocalDateTimeParts extends LocalDateParts {
  hour: number;
  minute: number;
  second: number;
}

export function getZonedParts(
  date: Date,
  timeZone: string,
): LocalDateTimeParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(date);
  const partMap: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== "literal") partMap[part.type] = Number(part.value);
  }
  return {
    year: partMap.year ?? date.getUTCFullYear(),
    month: partMap.month ?? date.getUTCMonth() + 1,
    day: partMap.day ?? date.getUTCDate(),
    hour: partMap.hour ?? date.getUTCHours(),
    minute: partMap.minute ?? date.getUTCMinutes(),
    second: partMap.second ?? date.getUTCSeconds(),
  };
}

/** Convert a wall-clock value in an IANA timezone to a real instant. */
export function zonedDateTimeToUtc(
  parts: LocalDateTimeParts,
  timeZone: string,
): Date {
  const targetAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  let candidate = targetAsUtc;

  // Offset iteration is needed when the first guess lands on the other side
  // of a DST transition. Midnight and the ordinary form values used by the
  // app converge in at most two iterations.
  for (let index = 0; index < 4; index += 1) {
    const observed = getZonedParts(new Date(candidate), timeZone);
    const observedAsUtc = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
      observed.second,
    );
    const adjustment = targetAsUtc - observedAsUtc;
    if (adjustment === 0) break;
    candidate += adjustment;
  }
  return new Date(candidate);
}

export function localDateStart(date: string, timeZone: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new RangeError("Date must use YYYY-MM-DD format.");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const calendarCheck = new Date(Date.UTC(year, month - 1, day));
  if (
    calendarCheck.getUTCFullYear() !== year ||
    calendarCheck.getUTCMonth() + 1 !== month ||
    calendarCheck.getUTCDate() !== day
  ) {
    throw new RangeError("Date is not a valid calendar day.");
  }
  return zonedDateTimeToUtc(
    {
      year,
      month,
      day,
      hour: 0,
      minute: 0,
      second: 0,
    },
    timeZone,
  );
}

export function parseLocalDateTime(value: string, timeZone: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(
    value,
  );
  if (!match)
    throw new RangeError("Date and time must use YYYY-MM-DDTHH:mm format.");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] ?? 0);
  const calendarCheck = new Date(Date.UTC(year, month - 1, day));
  if (
    calendarCheck.getUTCFullYear() !== year ||
    calendarCheck.getUTCMonth() + 1 !== month ||
    calendarCheck.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    throw new RangeError("Date and time are not valid.");
  }
  return zonedDateTimeToUtc(
    {
      year,
      month,
      day,
      hour,
      minute,
      second,
    },
    timeZone,
  );
}

export function localDateKey(date: Date, timeZone: string): string {
  const { year, month, day } = getZonedParts(date, timeZone);
  return `${year.toString().padStart(4, "0")}-${month
    .toString()
    .padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

export function addLocalDays(date: string, amount: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const moved = new Date(Date.UTC(year!, month! - 1, day! + amount));
  return `${moved.getUTCFullYear().toString().padStart(4, "0")}-${(
    moved.getUTCMonth() + 1
  )
    .toString()
    .padStart(2, "0")}-${moved.getUTCDate().toString().padStart(2, "0")}`;
}

/** Half-open local calendar day [start, end), safe across DST. */
export function getLocalDayInterval(
  date: Date = new Date(),
  timeZone: string = "UTC",
): { start: Date; end: Date } {
  const key = localDateKey(date, timeZone);
  return {
    start: localDateStart(key, timeZone),
    end: localDateStart(addLocalDays(key, 1), timeZone),
  };
}

/**
 * Backwards-compatible inclusive range for display callers. New database and
 * statistics queries should use getLocalDayInterval's half-open boundary.
 */
export function getLocalDayRange(
  date: Date = new Date(),
  timeZone: string = "UTC",
): { start: Date; end: Date } {
  const interval = getLocalDayInterval(date, timeZone);
  return { start: interval.start, end: new Date(interval.end.getTime() - 1) };
}

export function getLocalPeriodInterval(
  period: "today" | "week" | "month",
  now: Date,
  timeZone: string,
  weekStartsOn: 0 | 1,
): { start: Date; end: Date } {
  const key = localDateKey(now, timeZone);
  let startKey = key;
  let endKey = addLocalDays(key, 1);

  if (period === "week") {
    const [year, month, day] = key.split("-").map(Number);
    const weekday = new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay();
    const daysSinceStart = (weekday - weekStartsOn + 7) % 7;
    startKey = addLocalDays(key, -daysSinceStart);
    endKey = addLocalDays(startKey, 7);
  } else if (period === "month") {
    startKey = `${key.slice(0, 7)}-01`;
    const [year, month] = startKey.split("-").map(Number);
    const nextMonth = new Date(Date.UTC(year!, month!, 1));
    endKey = `${nextMonth.getUTCFullYear().toString().padStart(4, "0")}-${(
      nextMonth.getUTCMonth() + 1
    )
      .toString()
      .padStart(2, "0")}-01`;
  }

  return {
    start: localDateStart(startKey, timeZone),
    end: localDateStart(endKey, timeZone),
  };
}
