declare module 'ws' {
  import { EventEmitter } from 'node:events'

  export default class WebSocket extends EventEmitter {
    static readonly OPEN: number
    readonly readyState: number
    constructor(url: string, options?: { headers?: Record<string, string> })
    send(data: Buffer | ArrayBuffer | Uint8Array): void
    close(code?: number, reason?: string): void
    terminate(): void
  }
}
