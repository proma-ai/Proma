import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_HTTP_IDLE_TIMEOUT_MS,
  resolvePiRequestProxyTimeoutMs,
} from './pi-request-proxy'

describe('Pi 请求代理超时', () => {
  test('默认给长时模型流保留 20 分钟空闲窗口', () => {
    expect(DEFAULT_HTTP_IDLE_TIMEOUT_MS).toBe(1_200_000)
    expect(resolvePiRequestProxyTimeoutMs()).toBe(1_200_000)
  })

  test('保留用户显式超时和禁用超时的语义', () => {
    expect(resolvePiRequestProxyTimeoutMs(60_000)).toBe(60_000)
    expect(resolvePiRequestProxyTimeoutMs(0)).toBe(0)
    expect(resolvePiRequestProxyTimeoutMs(Number.NaN)).toBe(0)
  })
})
