/**
 * 跨平台 sleep 命令
 * 用法: bun run scripts/sleep.ts <seconds>
 */
const seconds = Number(process.argv[2]) || 2
await new Promise((resolve) => setTimeout(resolve, seconds * 1000))
