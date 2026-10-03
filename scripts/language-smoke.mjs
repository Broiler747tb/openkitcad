import assert from 'node:assert/strict'
import { createServer, preview } from 'vite'
import { chromium } from 'playwright'

async function launch() {
  let failure
  for (const browser of [
    undefined,
    ...(process.env.OKC_TEST_BROWSER ?? 'msedge,chrome').split(','),
  ]) {
    try {
      return await chromium.launch(
        !browser ? {} : /[\\/]/.test(browser) ? { executablePath: browser } : { channel: browser },
      )
    } catch (error) {
      failure = error
    }
  }
  throw failure
}

const dev = await createServer({
  server: { host: '127.0.0.1', port: 4278, strictPort: true, open: false },
})
const production = await preview({
  preview: { host: '127.0.0.1', port: 4279, strictPort: true, open: false },
})
let browser
let lastPage
const crashes = []
let checked = 0
try {
  await dev.listen()
  browser = await launch()
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
  })
  const page = await context.newPage()
  lastPage = page
  page.on('pageerror', (error) => crashes.push(String(error)))
  await page.goto('http://127.0.0.1:4278/')
  await page.waitForFunction(() => window.__okc?.store.getState().kernelReady)
  const original = await page.evaluate(async () => {
    const { emptyDocument } = await import('/src/doc/types.ts')
    const { serialise } = await import('/src/doc/persist.ts')
    const doc = emptyDocument('Box — мой проект')
    doc.components[0].bodies = [{ id: 'solid', name: 'Box', visible: true, colour: '#e67e22' }]
    doc.timeline = [
      {
        id: 'box',
        name: 'Box',
        kind: 'box',
        componentId: 'root',
        plane: { kind: 'named', name: 'XY', offset: 0 },
        origin: [0, 0],
        width: 20,
        depth: 15,
        height: 10,
        result: { kind: 'newBody', bodyId: 'solid' },
      },
    ]
    window.__okc.store.getState().setDoc(doc)
    return serialise(doc)
  })
  await page.waitForFunction(() => !window.__okc.store.getState().building)
  await page.getByRole('combobox', { name: 'Interface language' }).selectOption('ru')
  await page.getByRole('button', { name: 'Поиск команд' }).waitFor()
  assert.equal(await page.locator('html').getAttribute('lang'), 'ru')
  assert.match(await page.locator('.document-tab').innerText(), /Box — мой проект/)
  assert.equal(await page.evaluate(() => localStorage.getItem('okc.language.v1')), 'ru')
  await page.locator('.group-trigger').filter({ hasText: 'СОЗДАТЬ' }).click()
  const dropdown = page.locator('.fusion-dropdown')
  await dropdown.waitFor()
  assert.ok(
    await dropdown.evaluate((menu) => {
      const box = menu.getBoundingClientRect()
      return (
        box.bottom > document.querySelector('.ribbon').getBoundingClientRect().bottom &&
        menu.contains(document.elementFromPoint(box.x + 20, box.bottom - 20))
      )
    }),
  )
  await page.keyboard.press('Escape')
  if (process.env.OKC_LANGUAGE_SCREENSHOT)
    await page.screenshot({ path: process.env.OKC_LANGUAGE_SCREENSHOT })
  checked++

  await page.getByRole('button', { name: 'Поиск команд' }).click()
  const search = page.getByRole('dialog', { name: 'Поиск команд' })
  await search.getByRole('textbox', { name: 'Поиск действий' }).fill('скругление')
  assert.ok(await search.getByRole('button').filter({ hasText: 'Скругление' }).count())
  await search.getByRole('textbox').fill('Fillet')
  assert.ok(await search.getByRole('button').filter({ hasText: 'Скругление' }).count())
  await page.keyboard.press('Escape')
  checked++

  await page.evaluate(async () => {
    const { startCommand } = await import('/src/ui/command/commands.ts')
    startCommand('box')
  })
  const command = page.locator('.okc-cmd')
  await command.getByRole('textbox', { name: 'Длина', exact: true }).fill('37.5')
  await command.getByRole('textbox', { name: 'Ширина', exact: true }).fill('0')
  await command.getByRole('alert').filter({ hasText: 'Должно быть больше 0' }).waitFor()
  await command.getByRole('textbox', { name: 'Ширина', exact: true }).fill('15')
  const session = await page.evaluate(
    async () => (await import('/src/ui/command/session.ts')).useCommand.getState().session.serial,
  )
  await page.getByRole('combobox', { name: 'Язык интерфейса' }).selectOption('en')
  assert.equal(
    await command.getByRole('textbox', { name: 'Length', exact: true }).inputValue(),
    '37.5',
  )
  assert.equal(
    await page.evaluate(
      async () => (await import('/src/ui/command/session.ts')).useCommand.getState().session.serial,
    ),
    session,
  )
  await page.getByRole('combobox', { name: 'Interface language' }).selectOption('ru')
  assert.equal(
    await command.getByRole('textbox', { name: 'Длина', exact: true }).inputValue(),
    '37.5',
  )
  await command.getByRole('button', { name: 'Отмена', exact: true }).click()
  assert.equal(
    await page.evaluate(async () =>
      (await import('/src/doc/persist.ts')).serialise(window.__okc.store.getState().doc),
    ),
    original,
  )
  checked++

  const translations = await page.evaluate(async () => {
    const { t, counted } = await import('/src/i18n/index.ts')
    const { searchEntries, CATALOGUE, upsertUserPart, removeUserPart, refreshUserParts } =
      await import('/src/catalogue/index.ts')
    const { partSummary } = await import('/src/ui/parts/translation.ts')
    const nano = CATALOGUE.find((part) => part.id === 'arduino-nano')
    const builtIn = partSummary(nano)
    const customPart = { ...nano, summary: 'Box — описание автора' }
    upsertUserPart(customPart)
    refreshUserParts()
    const ownSummary = partSummary(customPart)
    removeUserPart(customPart.id)
    refreshUserParts()
    return {
      names: t('Delete {0} and the steps that depend on it?', 'Box {1}'),
      message: t('Too big for the print bed: 250 x 300 mm against a 220 x 220 mm bed.'),
      whitespace: t(' and '),
      unknown: t('Unrecognised engine diagnostic'),
      builtIn,
      ownSummary,
      dollars: t('Open Dollar$&?'),
      plural: [1, 2, 5, 21, 22, 25].map((n) => counted(n, 'body', 'bodies')),
      catalogue: searchEntries(CATALOGUE, 'подшипник').length,
      custom: searchEntries([{ ...CATALOGUE[0], id: 'custom', name: 'Моя плата' }], 'моя плата')
        .length,
    }
  })
  assert.equal(translations.names, 'Удалить Box {1} и зависимые операции?')
  assert.equal(translations.message, 'Не помещается на стол: 250 × 300 мм, стол — 220 × 220 мм.')
  assert.equal(translations.whitespace, ' и ')
  assert.equal(translations.unknown, 'Unrecognised engine diagnostic')
  assert.deepEqual(translations.plural, [
    '1 тело',
    '2 тела',
    '5 тел',
    '21 тело',
    '22 тела',
    '25 тел',
  ])
  assert.ok(translations.catalogue > 0)
  assert.equal(translations.custom, 1)
  assert.match(translations.builtIn, /Плата/)
  assert.equal(translations.ownSummary, 'Box — описание автора')
  assert.equal(translations.dollars, 'Открыть Dollar$&?')
  checked++

  await page.reload()
  await page.getByRole('combobox', { name: 'Язык интерфейса' }).waitFor()
  assert.equal(await page.getByRole('combobox', { name: 'Язык интерфейса' }).inputValue(), 'ru')
  await page.waitForFunction(
    () => window.__okc?.store.getState().kernelReady && !window.__okc.store.getState().building,
  )
  await page.getByRole('button', { name: 'Поделиться', exact: true }).click()
  const share = page.getByRole('dialog', { name: 'Поделиться моделью' })
  const link = await share.getByRole('textbox', { name: 'Ссылка на модель' }).inputValue()
  await share.getByRole('button', { name: 'Закрыть', exact: true }).click()
  const viewer = await context.newPage()
  lastPage = viewer
  viewer.on('pageerror', (error) => crashes.push(String(error)))
  await viewer.goto('http://127.0.0.1:4278/' + new URL(link).hash)
  await viewer.getByText('Только просмотр', { exact: true }).waitFor()
  await viewer.getByRole('button', { name: 'Открыть копию', exact: true }).waitFor()
  assert.equal(await viewer.locator('.shared-title strong').innerText(), 'Box — мой проект')
  await viewer.getByRole('combobox', { name: 'Язык интерфейса' }).selectOption('en')
  await viewer.getByText('View only', { exact: true }).waitFor()
  checked++

  const russian = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: 'ru-RU',
  })
  const mobile = await russian.newPage()
  lastPage = mobile
  mobile.on('pageerror', (error) => crashes.push(String(error)))
  await mobile.goto('http://127.0.0.1:4279/')
  await mobile.getByRole('combobox', { name: 'Язык интерфейса' }).waitFor()
  assert.equal(await mobile.locator('html').getAttribute('lang'), 'ru')
  assert.equal(
    await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  )
  await mobile.getByRole('combobox', { name: 'Язык интерфейса' }).selectOption('en')
  await mobile.reload()
  await mobile.getByRole('combobox', { name: 'Interface language' }).waitFor()
  await mobile.goto('http://127.0.0.1:4279/#m=1.invalid')
  await mobile.getByRole('combobox', { name: 'Interface language' }).selectOption('ru')
  await mobile.getByRole('button', { name: 'Вернуться в CAD' }).waitFor()
  assert.equal(
    await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  )
  checked++
  assert.deepEqual(crashes, [])
  console.log(`${checked} language UI scenarios passed.`)
} catch (error) {
  if (lastPage)
    console.error(
      await lastPage.evaluate(() => ({
        width: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        overflow: [...document.querySelectorAll('body *')]
          .filter(
            (element) =>
              element.getBoundingClientRect().right > innerWidth &&
              element.getBoundingClientRect().width > 0,
          )
          .slice(0, 15)
          .map((element) => [
            element.tagName,
            element.className,
            element.getBoundingClientRect().right,
          ]),
      })),
    )
  if (lastPage)
    console.error(
      (
        await lastPage
          .locator('body')
          .innerText()
          .catch(() => '')
      ).slice(0, 6000),
    )
  throw error
} finally {
  await browser?.close()
  await dev.close()
  await production.close()
}
