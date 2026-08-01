/**
 * Splitting a right-click menu into labelled sections.
 *
 * Both menus grew past the point where a flat list is readable - the object
 * menu alone gains three entries for every other body in the document - and a
 * long undifferentiated list is slower to read than a grouped one even when it
 * is shorter overall.
 */

interface Groupable {
  group?: string
}

/**
 * Bucket actions by their group, keeping the order the groups first appear in.
 * Ordering by first appearance rather than alphabetically means the sections
 * follow the order the actions were built in, which is already arranged with
 * the most-used things first.
 */
export function groupActions<T extends Groupable>(actions: T[]): Array<[string, T[]]> {
  const buckets = new Map<string, T[]>()
  for (const action of actions) {
    const key = action.group ?? 'Other'
    const list = buckets.get(key)
    if (list) list.push(action)
    else buckets.set(key, [action])
  }
  return [...buckets.entries()]
}

/**
 * Headings only earn their space once there is more than one section. On a
 * two-item menu a heading is just noise above the thing you already wanted.
 */
export function showHeadings<T extends Groupable>(actions: T[]): boolean {
  const seen = new Set(actions.map((a) => a.group ?? 'Other'))
  return seen.size > 1
}
