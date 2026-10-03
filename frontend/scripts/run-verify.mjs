// 规则校验运行器：用 esbuild（vite 自带）把 TS 校验脚本打包成 CJS 后在 Node 中执行。
import { build } from 'esbuild'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outfile = resolve(root, 'scripts/.verify-rules.cjs')

await build({
  entryPoints: [resolve(root, 'scripts/verify-rules.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile,
  alias: { '@': resolve(root, 'src') },
  logLevel: 'warning',
})

const result = spawnSync(process.execPath, [outfile], { stdio: 'inherit' })
process.exit(result.status ?? 1)
