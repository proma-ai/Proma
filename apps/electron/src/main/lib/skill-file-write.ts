import { openSync, closeSync, fstatSync, ftruncateSync, writeFileSync } from 'node:fs'

/** 编辑已有资源，不允许保存时重建被外部删除/重命名的旧路径。 */
export function writeExistingSkillFile(path: string, content: string): void {
  // r+ 不带 O_CREAT；即使 renderer 核验后发生删除，也不会意外重建路径。
  const fd = openSync(path, 'r+')
  try {
    if (!fstatSync(fd).isFile()) throw new Error('目标不是文件，无法保存 Skill 资源')
    writeFileSync(fd, content, 'utf-8')
    ftruncateSync(fd, Buffer.byteLength(content, 'utf-8'))
  } finally {
    closeSync(fd)
  }
}
