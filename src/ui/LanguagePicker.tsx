import { setLanguage, t, useLanguage, type Language } from '../i18n'

export function LanguagePicker() {
  const language = useLanguage()
  return (
    <label className="theme-picker language-picker" title={t('Interface language')}>
      <select
        aria-label={t('Interface language')}
        value={language}
        onChange={(event) => setLanguage(event.target.value as Language)}
      >
        <option value="en" lang="en">
          English
        </option>
        <option value="ru" lang="ru">
          Русский
        </option>
      </select>
    </label>
  )
}
