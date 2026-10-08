import { sql, type SQL } from "drizzle-orm";

/** SQL equivalent of focusSecondsInRange; cumulative differences conserve seconds.
 * The alias is a trusted SQL table identifier, never a caller-provided string.
 * Shared by aggregate statistics and focus-intersection history pagination.
 */
export function focusSecondsSql(
  alias: SQL,
  start: SQL,
  end: SQL,
  now: Date,
): SQL {
  const before = (
    at: SQL,
  ) => sql`greatest(0, least(extract(epoch from (${alias}.ended_at - ${alias}.started_at)),
    extract(epoch from (least(${at}, ${now}::timestamptz) - ${alias}.started_at))))`;
  return sql`case when ${alias}.status = 'cancelled' then 0
    when ${alias}.time_basis = 'observed' then coalesce((
      select floor(sum(greatest(0, extract(epoch from (least(fi.ended_at, fi.deadline_at, ${now}::timestamptz, ${end}) - fi.started_at)))))
           - floor(sum(greatest(0, extract(epoch from (least(fi.ended_at, fi.deadline_at, ${now}::timestamptz, ${start}) - fi.started_at)))))
      from focus_intervals fi where fi.session_id = ${alias}.id and fi.phase = 'focus'
    ), 0)
    when ${alias}.ended_at > ${alias}.started_at then
      floor(${alias}.duration_seconds::numeric * ${before(end)} / extract(epoch from (${alias}.ended_at - ${alias}.started_at)))
      - floor(${alias}.duration_seconds::numeric * ${before(start)} / extract(epoch from (${alias}.ended_at - ${alias}.started_at)))
    else 0 end`;
}
