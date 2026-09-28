const { app, BrowserWindow, shell } = require('electron')
const path = require('node:path')

const APP_ID = 'com.broiler747tb.openkitcad'

function openOutside(url) {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url)
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#171b20',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  const home = path.join(app.getAppPath(), 'dist', 'index.html')
  window.webContents.setWindowOpenHandler(({ url }) => {
    openOutside(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).pathname === new URL(window.webContents.getURL()).pathname) return
    event.preventDefault()
    openOutside(url)
  })
  window.once('ready-to-show', () => window.show())
  window.loadFile(home)
}

app.setAppUserModelId(APP_ID)
app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
