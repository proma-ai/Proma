export interface ImageClipboardResult {
  success: boolean
  message?: string
}

type ImageClipboardWriter = (dataUrl: string) => Promise<ImageClipboardResult>
type ImageDataUrlLoader = (src: string) => Promise<string>

async function fetchImageAsDataUrl(src: string): Promise<string> {
  const response = await fetch(src)
  if (!response.ok) throw new Error(`图片读取失败（${response.status}）`)

  const blob = await response.blob()
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error('图片转换失败'))
    }, { once: true })
    reader.addEventListener('error', () => reject(new Error('图片转换失败')), { once: true })
    reader.addEventListener('abort', () => reject(new Error('图片转换已取消')), { once: true })
    reader.readAsDataURL(blob)
  })
}

export async function copyImageSourceToClipboard(
  src: string,
  writeImage: ImageClipboardWriter,
  loadDataUrl: ImageDataUrlLoader = fetchImageAsDataUrl,
): Promise<ImageClipboardResult> {
  if (!src) return { success: false, message: '无效的图片数据' }

  try {
    const dataUrl = src.startsWith('data:') ? src : await loadDataUrl(src)
    const result = await writeImage(dataUrl)
    return result.success ? result : { success: false, message: result.message ?? '复制失败' }
  } catch {
    return { success: false, message: '复制失败，请检查图片是否可访问' }
  }
}
