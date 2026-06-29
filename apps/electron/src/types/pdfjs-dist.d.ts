/**
 * pdfjs-dist legacy ESM 入口的最小类型声明。
 *
 * 项目只在主进程文档解析兜底中动态导入该入口，具体 API 用本地 interface 收窄。
 */
declare module 'pdfjs-dist/legacy/build/pdf.mjs' {
  export const getDocument: unknown
}
