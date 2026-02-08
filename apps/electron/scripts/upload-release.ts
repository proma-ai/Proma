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
 *   │   ├── Proma-{version}-arm64-mac.zip
 *   │   └── Proma-{version}-arm64.dmg
 *   ├── mac-x64/
 *   │   ├── latest-mac.yml
 *   │   ├── Proma-{version}-mac.zip
 *   │   └── Proma-{version}-x64.dmg
 *   └── win-x64/
 *       ├── latest.yml
 *       └── Proma-{version}-setup.exe
 */

import OSS from "ali-oss"
import fs from "node:fs"
import path from "node:path"

// 项目根目录（scripts/ 的上级）
const ROOT_DIR = path.join(import.meta.dir, "..")
const OUT_DIR = path.join(ROOT_DIR, "out")
const PACKAGE_JSON_PATH = path.join(ROOT_DIR, "package.json")
const RELEASES_PREFIX = "releases"

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

type PlatformDir = "mac-arm64" | "mac-x64" | "win-x64"

interface FileConfig {
  /** 文件后缀匹配模式 */
  suffix: string
  /** OSS 平台子目录 */
  platformDir: PlatformDir
  /** 对应的更新清单文件名 */
  ymlFile: string
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
  { suffix: "-arm64.dmg", platformDir: "mac-arm64", ymlFile: "latest-mac.yml" },
  // macOS x64（electron-builder x64 zip 命名是 -mac.zip，无 -x64- 后缀）
  { suffix: "-mac.zip", platformDir: "mac-x64", ymlFile: "latest-mac.yml" },
  { suffix: "-x64.dmg", platformDir: "mac-x64", ymlFile: "latest-mac.yml" },
  // Windows x64
  { suffix: "-setup.exe", platformDir: "win-x64", ymlFile: "latest.yml" },
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

function createVersionMatcher(version: string) {
  const escaped = version.replace(/\./g, "\\.")
  return (suffix: string) =>
    new RegExp(`^proma-${escaped}${suffix.replace(/\./g, "\\.")}$`, "i")
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

  return new OSS({ accessKeyId, accessKeySecret, bucket, region })
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
  const matchVersion = createVersionMatcher(version)

  for (const file of files) {
    for (const config of FILE_CONFIGS) {
      if (matchVersion(config.suffix).test(file)) {
        artifacts.push({ file, config })
        break
      }
    }
  }

  return artifacts
}

// ============================================
// 上传逻辑
// ============================================

async function uploadFile(client: OSS, localPath: string, ossPath: string): Promise<boolean> {
  try {
    console.log(`  📤 上传: ${path.basename(localPath)}`)
    console.log(`     → ${ossPath}`)
    await client.put(ossPath, localPath)
    console.log(`  ✅ 完成`)
    return true
  } catch (error) {
    console.error(`  ❌ 失败: ${error}`)
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

  // 跟踪已上传的 yml，避免重复上传
  const uploadedYmls = new Set<string>()

  for (const { file, config } of artifacts) {
    const localPath = path.join(OUT_DIR, file)
    const ossPath = `${RELEASES_PREFIX}/${config.platformDir}/${file}`
    const success = await uploadFile(client, localPath, ossPath)
    results.push({ file, ossPath, success })

    // 上传对应的 yml 清单文件
    const ymlKey = `${config.platformDir}/${config.ymlFile}`
    if (!uploadedYmls.has(ymlKey)) {
      const ymlLocalPath = path.join(OUT_DIR, config.ymlFile)
      if (fs.existsSync(ymlLocalPath)) {
        const ymlOssPath = `${RELEASES_PREFIX}/${config.platformDir}/${config.ymlFile}`
        const ymlSuccess = await uploadFile(client, ymlLocalPath, ymlOssPath)
        results.push({ file: config.ymlFile, ossPath: ymlOssPath, success: ymlSuccess })
        uploadedYmls.add(ymlKey)
      } else {
        console.log(`  ⚠️  未找到 ${config.ymlFile}，跳过`)
      }
    }
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
    console.log(`   └── win-x64/   (latest.yml + exe)`)
  } catch (error) {
    console.error(`\n❌ 错误: ${error}`)
    process.exit(1)
  }
}

main()
