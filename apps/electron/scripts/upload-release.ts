/**
 * 上传构建产物到阿里云 OSS
 *
 * Usage:
 *   生产环境: bun run scripts/upload-release.ts
 *   测试环境: bun run scripts/upload-release.ts --staging
 *
 * 环境变量（Bun 自动加载 .env）:
 * - OSS_ACCESS_KEY_ID
 * - OSS_ACCESS_KEY_SECRET
 * - OSS_REGION
 * - OSS_RELEASES_BUCKET（生产 bucket）
 * - OSS_STAGING_BUCKET（测试 bucket，默认 "dev-release"）
 *
 * OSS 目录结构（匹配后端 API）:
 * releases/
 *   ├── mac-arm64/
 *   │   ├── latest-mac.yml
 *   │   ├── Proma-{version}-arm64-mac.zip(.blockmap)
 *   │   └── Proma-{version}-arm64.dmg
 *   ├── mac-x64/
 *   │   ├── latest-mac.yml
 *   │   ├── Proma-{version}-mac.zip(.blockmap)
 *   │   └── Proma-{version}-x64.dmg
 *   ├── win-x64/
 *   │   ├── latest.yml
 *   │   └── Proma-{version}-setup.exe(.blockmap)
 *   └── linux-x64/
 *       ├── latest-linux.yml
 *       ├── Proma-{version}.AppImage(.blockmap)
 *       └── proma_{version}_amd64.deb
 */

import OSS from "ali-oss"
import fs from "node:fs"
import path from "node:path"

// 项目根目录（scripts/ 的上级）
const ROOT_DIR = path.join(import.meta.dir, "..")
const OUT_DIR = path.join(ROOT_DIR, "out")
const PACKAGE_JSON_PATH = path.join(ROOT_DIR, "package.json")
const RELEASES_PREFIX = "releases"
// Bucket-level transfer acceleration is enabled in OSS. ali-oss prepends the
// configured bucket, producing https://<bucket>.oss-accelerate.aliyuncs.com.
const OSS_ACCELERATE_ENDPOINT = "oss-accelerate.aliyuncs.com"
const OSS_TIMEOUT_MS = 5 * 60 * 1000
const OSS_REQUEST_RETRIES = 2
const UPLOAD_ATTEMPTS = 3
const MULTIPART_PART_SIZE = 8 * 1024 * 1024
const MULTIPART_PARALLEL = 2
const CHECKPOINT_DIR = path.join(OUT_DIR, ".oss-upload-checkpoints")

// 解析命令行参数
const args = process.argv.slice(2)
const isStaging = args.includes("--staging") || args.includes("-s")

// ============================================
// 类型定义
// ============================================

interface EnvConfig {
  name: string
  bucket: string
}

type PlatformDir = "mac-arm64" | "mac-x64" | "win-x64" | "linux-x64"

interface FileConfig {
  /** 文件后缀匹配模式 */
  suffix: string
  /** OSS 平台子目录 */
  platformDir: PlatformDir
  /** 对应的更新清单文件名 */
  ymlFile: string
  /** Debian 工件用下划线分隔版本号，其他 Electron 工件用连字符。 */
  versionSeparator?: "-" | "_"
}

interface UploadResult {
  file: string
  ossPath: string
  success: boolean
  error?: string
}

// ============================================
// 产物匹配配置
// ============================================

const FILE_CONFIGS: FileConfig[] = [
  // macOS arm64
  { suffix: "-arm64-mac.zip", platformDir: "mac-arm64", ymlFile: "latest-mac.yml" },
  { suffix: "-arm64-mac.zip.blockmap", platformDir: "mac-arm64", ymlFile: "latest-mac.yml" },
  { suffix: "-arm64.dmg", platformDir: "mac-arm64", ymlFile: "latest-mac.yml" },
  // macOS x64（electron-builder x64 zip 命名是 -mac.zip，无 -x64- 后缀）
  { suffix: "-mac.zip", platformDir: "mac-x64", ymlFile: "latest-mac.yml" },
  { suffix: "-mac.zip.blockmap", platformDir: "mac-x64", ymlFile: "latest-mac.yml" },
  { suffix: "-x64.dmg", platformDir: "mac-x64", ymlFile: "latest-mac.yml" },
  // Windows x64（即使 differentialPackage: false，electron-updater 客户端仍会探测 .blockmap）
  { suffix: "-setup.exe", platformDir: "win-x64", ymlFile: "latest.yml" },
  { suffix: "-setup.exe.blockmap", platformDir: "win-x64", ymlFile: "latest.yml" },
  // Linux x64：AppImage 供 electron-updater 自动更新；deb 供手动安装。
  { suffix: ".AppImage", platformDir: "linux-x64", ymlFile: "latest-linux.yml" },
  { suffix: ".AppImage.blockmap", platformDir: "linux-x64", ymlFile: "latest-linux.yml" },
  { suffix: "_amd64.deb", platformDir: "linux-x64", ymlFile: "latest-linux.yml", versionSeparator: "_" },
]

// ============================================
// 工具函数
// ============================================

function getEnvConfig(): EnvConfig {
  if (isStaging) {
    return {
      name: "staging",
      bucket: process.env.OSS_STAGING_BUCKET || "dev-release",
    }
  }
  return {
    name: "production",
    bucket: process.env.OSS_RELEASES_BUCKET || "",
  }
}

function getVersion(): string {
  const packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, "utf-8"))
  return packageJson.version
}

function createVersionMatcher(version: string, separator: "-" | "_" = "-") {
  const escaped = version.replace(/\./g, "\\.")
  return (suffix: string) =>
    new RegExp(`^proma${separator}${escaped}${suffix.replace(/\./g, "\\.")}$`, "i")
}

function getOSSClient(envConfig: EnvConfig): OSS {
  const accessKeyId = process.env.OSS_ACCESS_KEY_ID
  const accessKeySecret = process.env.OSS_ACCESS_KEY_SECRET
  const region = process.env.OSS_REGION
  const { bucket } = envConfig

  if (!accessKeyId || !accessKeySecret || !bucket || !region) {
    throw new Error(
      `缺少 OSS 配置 (${envConfig.name})，需要: OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET, OSS_REGION, bucket`
    )
  }

  console.log(`🌍 环境: ${envConfig.name.toUpperCase()}`)
  console.log(`📦 Bucket: ${bucket}`)

  return new OSS({
    accessKeyId,
    accessKeySecret,
    bucket,
    region,
    endpoint: OSS_ACCELERATE_ENDPOINT,
    secure: true,
    timeout: OSS_TIMEOUT_MS,
    // @types/ali-oss does not yet declare these SDK-supported options.
    retryMax: OSS_REQUEST_RETRIES,
  } as OSS.Options & { retryMax: number })
}

// ============================================
// 产物查找
// ============================================

function findArtifacts(version: string): Array<{ file: string; config: FileConfig }> {
  if (!fs.existsSync(OUT_DIR)) {
    console.error(`❌ 输出目录不存在: ${OUT_DIR}`)
    return []
  }

  const files = fs.readdirSync(OUT_DIR)
  const artifacts: Array<{ file: string; config: FileConfig }> = []
  for (const file of files) {
    for (const config of FILE_CONFIGS) {
      const matchVersion = createVersionMatcher(version, config.versionSeparator)
      if (matchVersion(config.suffix).test(file)) {
        artifacts.push({ file, config })
        break
      }
    }
  }

  return artifacts
}

// 大文件阈值：超过 10MB 使用分片上传
const MULTIPART_THRESHOLD = 10 * 1024 * 1024

// 文件扩展名 → Content-Type 映射
const MIME_TYPES: Record<string, string> = {
  ".exe": "application/octet-stream",
  ".dmg": "application/octet-stream",
  ".zip": "application/zip",
  ".deb": "application/vnd.debian.binary-package",
  ".AppImage": "application/octet-stream",
  ".yml": "text/yaml",
}

// ============================================
// 上传逻辑
// ============================================

function checkpointPathFor(ossPath: string): string {
  return path.join(CHECKPOINT_DIR, `${ossPath.replace(/[^a-zA-Z0-9._-]/g, "_")}.json`)
}

function loadCheckpoint(checkpointPath: string, ossPath: string, localSize: number): OSS.Checkpoint | undefined {
  if (!fs.existsSync(checkpointPath)) return undefined
  try {
    const checkpoint = JSON.parse(fs.readFileSync(checkpointPath, "utf-8")) as OSS.Checkpoint
    if (checkpoint.name === ossPath && checkpoint.fileSize === localSize && checkpoint.partSize === MULTIPART_PART_SIZE) {
      return checkpoint
    }
  } catch {
    // A corrupted checkpoint must never prevent a fresh upload.
  }
  fs.rmSync(checkpointPath, { force: true })
  return undefined
}

function saveCheckpoint(checkpointPath: string, checkpoint: OSS.Checkpoint): void {
  fs.mkdirSync(CHECKPOINT_DIR, { recursive: true })
  fs.writeFileSync(checkpointPath, JSON.stringify(checkpoint))
}

function formatError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

async function withUploadRetry<T>(label: string, action: () => Promise<T>): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= UPLOAD_ATTEMPTS; attempt += 1) {
    try {
      return await action()
    } catch (error) {
      lastError = error
      if (attempt === UPLOAD_ATTEMPTS) break
      const delayMs = 1_000 * 2 ** (attempt - 1)
      console.warn(`  ⚠️ ${label} 第 ${attempt} 次失败 (${formatError(error)})，${delayMs / 1_000}s 后重试...`)
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs))
    }
  }
  throw lastError
}

async function uploadFile(client: OSS, localPath: string, ossPath: string): Promise<boolean> {
  try {
    const fileName = path.basename(localPath)
    const localSize = fs.statSync(localPath).size
    const ext = path.extname(localPath).toLowerCase()
    const mime = MIME_TYPES[ext] || "application/octet-stream"

    console.log(`  📤 上传: ${fileName} (${(localSize / 1024 / 1024).toFixed(1)} MB)`)
    console.log(`     → ${ossPath}`)

    if (localSize > MULTIPART_THRESHOLD) {
      const checkpointPath = checkpointPathFor(ossPath)
      let checkpoint = loadCheckpoint(checkpointPath, ossPath, localSize)
      if (checkpoint) console.log("     ↳ 发现断点，将继续未完成的分片")

      await withUploadRetry(fileName, async () => {
        await client.multipartUpload(ossPath, localPath, {
          headers: { "Content-Type": mime },
          timeout: OSS_TIMEOUT_MS,
          partSize: MULTIPART_PART_SIZE,
          parallel: MULTIPART_PARALLEL,
          checkpoint,
          progress: (progress: number, nextCheckpoint: OSS.Checkpoint) => {
            checkpoint = nextCheckpoint
            saveCheckpoint(checkpointPath, nextCheckpoint)
            process.stdout.write(`\r     进度: ${(progress * 100).toFixed(1)}%`)
          },
        })
      })
      fs.rmSync(checkpointPath, { force: true })
      console.log("") // 换行
    } else {
      await withUploadRetry(fileName, () => client.put(ossPath, localPath, {
        headers: { "Content-Type": mime },
        timeout: OSS_TIMEOUT_MS,
      }))
    }

    // 校验 OSS 文件大小；短暂 HEAD 失败同样不应让已完成上传白白失败。
    const head = await withUploadRetry(`${fileName} 校验`, () => client.head(ossPath, { timeout: OSS_TIMEOUT_MS }))
    const remoteSize = Number(head.res.headers["content-length"])
    if (remoteSize !== localSize) {
      console.error(`  ❌ 大小不匹配！本地: ${localSize}, OSS: ${remoteSize}`)
      return false
    }

    console.log(`  ✅ 完成 (校验通过)`)
    return true
  } catch (error) {
    console.error(`  ❌ 失败: ${formatError(error)}`)
    return false
  }
}

async function uploadArtifacts(envConfig: EnvConfig): Promise<UploadResult[]> {
  const client = getOSSClient(envConfig)
  const version = getVersion()
  const artifacts = findArtifacts(version)
  const results: UploadResult[] = []

  console.log(`\n📦 版本: ${version}`)
  console.log(`📁 找到 ${artifacts.length} 个产物\n`)

  if (artifacts.length === 0) {
    console.log(`⚠️  没有找到匹配的产物，请先运行打包命令`)
    return results
  }

  // latest*.yml 是客户端发现更新的入口，必须作为最后一步发布：在它可见前，
  // 本版本的所有安装包和 blockmap 都必须已经上传并通过 HEAD 校验。
  const manifests = new Map<string, FileConfig>()
  for (const { config } of artifacts) {
    manifests.set(`${config.platformDir}/${config.ymlFile}`, config)
  }

  // 在上传任何不可变工件前先验证所有清单均存在。这样不会出现某个平台已
  // 切换到新版、随后才发现另一平台缺少清单的可避免半发布状态；各平台的
  // manifest 上传失败仍保持该平台的上一版本，对已发布平台没有错误引用。
  for (const config of manifests.values()) {
    const ymlLocalPath = path.join(OUT_DIR, config.ymlFile)
    if (!fs.existsSync(ymlLocalPath)) {
      const ymlOssPath = `${RELEASES_PREFIX}/${config.platformDir}/${config.ymlFile}`
      console.error(`  ❌ 未找到 ${config.ymlFile}，取消本次发布`)
      results.push({ file: config.ymlFile, ossPath: ymlOssPath, success: false, error: 'manifest not found' })
    }
  }
  if (results.some((result) => !result.success)) {
    return results
  }

  for (const { file, config } of artifacts) {
    const localPath = path.join(OUT_DIR, file)
    const ossPath = `${RELEASES_PREFIX}/${config.platformDir}/${file}`
    const success = await uploadFile(client, localPath, ossPath)
    results.push({ file, ossPath, success })
  }

  if (results.some((result) => !result.success)) {
    console.error('\n❌ 工件上传或校验失败，保留现有 latest manifest，不发布不完整版本')
    return results
  }

  console.log('\n📄 所有工件已校验，开始发布更新清单...')
  for (const config of manifests.values()) {
    const ymlLocalPath = path.join(OUT_DIR, config.ymlFile)
    const ymlOssPath = `${RELEASES_PREFIX}/${config.platformDir}/${config.ymlFile}`
    const success = await uploadFile(client, ymlLocalPath, ymlOssPath)
    results.push({ file: config.ymlFile, ossPath: ymlOssPath, success })
  }

  return results
}

// ============================================
// 主流程
// ============================================

async function main() {
  const envConfig = getEnvConfig()
  console.log("🚀 开始上传发布产物...\n")

  try {
    const results = await uploadArtifacts(envConfig)

    const successful = results.filter((r) => r.success).length
    const failed = results.filter((r) => !r.success).length

    console.log(`\n📊 汇总:`)
    console.log(`   ✅ 成功: ${successful}`)
    console.log(`   ❌ 失败: ${failed}`)

    if (failed > 0) {
      process.exit(1)
    }

    console.log(`\n✨ 上传完成!`)
    console.log(`\n📋 OSS 结构 (${envConfig.name}):`)
    console.log(`   releases/`)
    console.log(`   ├── mac-arm64/ (latest-mac.yml + zip + dmg)`)
    console.log(`   ├── mac-x64/   (latest-mac.yml + zip + dmg)`)
    console.log(`   ├── win-x64/   (latest.yml + exe)`)
    console.log(`   └── linux-x64/ (latest-linux.yml + AppImage + deb)`)
  } catch (error) {
    console.error(`\n❌ 错误: ${error}`)
    process.exit(1)
  }
}

main()
