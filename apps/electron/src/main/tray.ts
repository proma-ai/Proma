import { Tray, Menu, app, nativeImage, BrowserWindow } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'

let tray: Tray | null = null

/**
 * 获取托盘图标路径
 * 所有平台统一使用 Template 图标
 */
function getTrayIconPath(): string {
  // resources 在 build:resources 阶段被复制到 dist/ 下，与 main.cjs 同级
  const resourcesDir = join(__dirname, 'resources/proma-logos')
  return join(resourcesDir, 'iconTemplate.png')
}

/** 显示主窗口并恢复 Dock 图标 */
function showMainWindow(): void {
  const windows = BrowserWindow.getAllWindows()
  if (windows.length === 0) return
  const mainWindow = windows[0]
  // macOS 需要先恢复 Dock 图标，否则窗口可能无法正常显示
  if (process.platform === 'darwin') {
    app.dock?.show()
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }
  mainWindow.show()
  mainWindow.focus()
}

/**
 * 创建系统托盘图标和菜单
 */
export function createTray(): Tray | null {
  const iconPath = getTrayIconPath()

  if (!existsSync(iconPath)) {
    console.warn('Tray icon not found at:', iconPath)
    return null
  }

  try {
    const image = nativeImage.createFromPath(iconPath)

    // macOS: 标记为 Template 图像
    // Template 图像必须是单色的，使用 alpha 通道定义形状
    // 系统会自动根据菜单栏主题填充颜色
    if (process.platform === 'darwin') {
      image.setTemplateImage(true)
    }

    tray = new Tray(image)

    // 设置 tooltip
    tray.setToolTip('Proma')

    // 创建右键菜单
    const contextMenu = Menu.buildFromTemplate([
      {
        label: '显示 Proma',
        click: () => showMainWindow()
      },
      {
        type: 'separator'
      },
      {
        label: '退出 Proma',
        click: () => {
          app.quit()
        }
      }
    ])

    tray.setContextMenu(contextMenu)

    // 点击行为：显示/隐藏窗口
    tray.on('click', () => {
      const windows = BrowserWindow.getAllWindows()
      if (windows.length > 0) {
        const mainWindow = windows[0]
        if (mainWindow.isVisible()) {
          mainWindow.hide()
          if (process.platform === 'darwin') {
            app.dock?.hide()
          }
        } else {
          showMainWindow()
        }
      }
    })

    console.log('System tray created')
    return tray
  } catch (error) {
    console.error('Failed to create system tray:', error)
    return null
  }
}

/**
 * 销毁系统托盘
 */
export function destroyTray(): void {
  if (tray) {
    tray.destroy()
    tray = null
  }
}

/**
 * 获取当前托盘实例
 */
export function getTray(): Tray | null {
  return tray
}
