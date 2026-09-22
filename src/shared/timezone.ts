function getZonedParts(date: Date, timeZone: string) {
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
    if (part.type !== "literal") {
      partMap[part.type] = parseInt(part.value, 10);
    }
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

function localToUtcMidnight(
  year: number,
  month: number,
  day: number,
  timeZone: string,
): Date {
  const guessUtc = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  const zoned = getZonedParts(guessUtc, timeZone);
  const zonedAsUtc = Date.UTC(
    zoned.year,
    zoned.month - 1,
    zoned.day,
    zoned.hour,
    zoned.minute,
    zoned.second,
  );
  const offsetMs = zonedAsUtc - guessUtc.getTime();
  return new Date(guessUtc.getTime() - offsetMs);
}

export function getLocalDayRange(
  date: Date = new Date(),
  timeZone: string = "UTC",
): { start: Date; end: Date } {
  const zoned = getZonedParts(date, timeZone);
  const start = localToUtcMidnight(
    zoned.year,
    zoned.month,
    zoned.day,
    timeZone,
  );

  // Next calendar day in target timezone
  const nextDay = new Date(
    Date.UTC(zoned.year, zoned.month - 1, zoned.day + 1),
  );
  const nextZoned = {
    year: nextDay.getUTCFullYear(),
    month: nextDay.getUTCMonth() + 1,
    day: nextDay.getUTCDate(),
  };
  const nextStart = localToUtcMidnight(
    nextZoned.year,
    nextZoned.month,
    nextZoned.day,
    timeZone,
  );

  const end = new Date(nextStart.getTime() - 1);
  return { start, end };
}
