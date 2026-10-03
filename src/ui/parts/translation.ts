import { getLanguage } from '../../i18n'
import { partSummaries, familySummaries } from '../../i18n/catalogue'
import { isUserPart, type CataloguePart, type PartFamily } from '../../catalogue'

export function partSummary(part: CataloguePart): string {
  return getLanguage() === 'ru' && !isUserPart(part.id)
    ? (partSummaries[part.id] ?? part.summary)
    : part.summary
}

export function familySummary(family: PartFamily): string {
  return getLanguage() === 'ru' ? (familySummaries[family.id] ?? family.summary) : family.summary
}
