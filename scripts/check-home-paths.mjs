#!/usr/bin/env node
/**
 * Mirrors Signal K's plugin-CI "Validate plugin package.json" step, which
 * fails on any `"/home/<user>/"` literal in source. It cannot tell a path
 * inside a container image from one on the host, so even a legitimate
 * in-image path — or an example of one in a comment — trips it.
 *
 * Running it locally turns a red CI matrix into an instant local failure.
 * Keep the regex identical to the upstream one.
 */
import fs from 'node:fs'
import path from 'node:path'

const RE = /["'`]\/home\/[a-zA-Z][a-zA-Z0-9_-]*\//g
const EXTS = /\.(ts|tsx|js|mjs|json)$/
const SKIP = /^(node_modules|\.git|plugin|public|dist)$/

let hits = 0
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP.test(entry.name)) walk(path.join(dir, entry.name))
      continue
    }
    if (!EXTS.test(entry.name)) continue
    const file = path.join(dir, entry.name)
    const match = fs.readFileSync(file, 'utf8').match(RE)
    if (match) {
      hits++
      console.error(`${file} contains hardcoded home directory path: ${match[0]}`)
    }
  }
}

for (const dir of ['src', 'test']) if (fs.existsSync(dir)) walk(dir)

if (hits > 0) {
  console.error(
    `\n${String(hits)} hardcoded home path(s). Signal K's plugin-CI rejects these.\n` +
      'Assemble the path from parts, or reword the comment.'
  )
  process.exit(1)
}
console.log('No hardcoded home paths.')
