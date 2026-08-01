/**
 * Splitting a right-click menu into sections.
 *
 * Both menus grew past the point where a flat list is readable - the object
 * menu alone gains three entries for every other body in the document - so the
 * menu shows section names first and the actions in a panel beside them.
 */

interface Groupable {
  group?: string
}

/**
 * Bucket actions by their section.
 *
 * `order` names the sections in the order they should appear. The section list
 * sits in a fixed column that the user reads every single time, so it has to be
 * in the same place on every open; ordering by whichever action happened to be
 * built first would shuffle it about as the selection changed. Anything not
 * named in `order` falls in behind, in the order it first appears.
 */
export function groupActions<T extends Groupable>(
  actions: T[],
  order?: string[],
): Array<[string, T[]]> {
  const buckets = new Map<string, T[]>()
  for (const action of actions) {
    const key = action.group ?? 'Other'
    const list = buckets.get(key)
    if (list) list.push(action)
    else buckets.set(key, [action])
  }
  if (!order) return [...buckets.entries()]

  const ranked = [...buckets.entries()]
  const rank = (name: string) => {
    const i = order.indexOf(name)
    return i === -1 ? order.length : i
  }
  // Stable, so unranked sections keep the order they were built in.
  return ranked
    .map((entry, i) => ({ entry, i }))
    .sort((a, b) => rank(a.entry[0]) - rank(b.entry[0]) || a.i - b.i)
    .map((x) => x.entry)
}

/**
 * Whether the section list is worth drawing. With one section there is nothing
 * to choose between, and making the user pick it before seeing the two things
 * underneath is a click spent on nothing.
 */
export function showHeadings<T extends Groupable>(actions: T[]): boolean {
  const seen = new Set(actions.map((a) => a.group ?? 'Other'))
  return seen.size > 1
}
