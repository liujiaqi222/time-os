/** Show sub-minute effort honestly instead of rounding it to a minute. */
export function durationLabel(
  seconds: number,
  precision: "seconds" | "minutes" = "seconds",
): string {
  if (precision === "minutes") seconds = Math.floor(seconds / 60) * 60;
  if (precision === "minutes" && seconds === 0) return "0 分钟";
  if (seconds < 60) return `${seconds} 秒`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return [
    hours ? `${hours} 小时` : "",
    minutes ? `${minutes} 分钟` : "",
    rest ? `${rest} 秒` : "",
  ]
    .filter(Boolean)
    .join(" ");
}
