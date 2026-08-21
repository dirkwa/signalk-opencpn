import { describe, expect, it } from 'vitest'
import { TAG_AMD64, TAG_ARM64, resolveTag } from '../src/arch.js'

describe('resolveTag', () => {
  it('picks the pi tag on arm64', () => {
    expect(resolveTag('auto', 'arm64')).toBe(TAG_ARM64)
  })

  it('picks the x86 tag on x64', () => {
    expect(resolveTag('auto', 'x64')).toBe(TAG_AMD64)
  })

  it('falls back to x86 for unknown architectures', () => {
    // Better to attempt a pull that fails loudly than to invent a tag.
    expect(resolveTag('auto', 'riscv64')).toBe(TAG_AMD64)
  })

  it('passes an explicit tag through untouched', () => {
    expect(resolveTag('pi', 'x64')).toBe('pi')
    expect(resolveTag('x86', 'arm64')).toBe('x86')
  })

  it('does not treat "latest" specially (the image has no such tag)', () => {
    expect(resolveTag('latest', 'x64')).toBe('latest')
  })
})
