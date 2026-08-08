import {
  SLOPZ_PROTOCOL_VERSION,
  isHostRequest,
  isReadyMessage,
  type SlopzHostRequest,
  type SlopzHostResponse,
} from './protocol.js'

export type SlopzHostBrokerOptions = {
  readonly iframe: HTMLIFrameElement
  readonly gameId: string
  readonly gameOrigin: string
  readonly handleRequest: (request: SlopzHostRequest) => Promise<unknown>
}

export class SlopzHostBroker {
  private readonly options: SlopzHostBrokerOptions
  private port: MessagePort | null = null
  private readonly listener: (event: MessageEvent) => void

  constructor(options: SlopzHostBrokerOptions) {
    this.options = options
    this.listener = (event) => this.onWindowMessage(event)
    window.addEventListener('message', this.listener)
  }

  private onWindowMessage(event: MessageEvent): void {
    if (event.origin !== this.options.gameOrigin) return
    if (event.source !== this.options.iframe.contentWindow) return
    if (!isReadyMessage(event.data) || event.data.gameId !== this.options.gameId) return

    this.port?.close()
    const channel = new MessageChannel()
    this.port = channel.port1
    this.port.onmessage = (portEvent) => void this.onPortMessage(portEvent)
    this.port.start()
    this.options.iframe.contentWindow?.postMessage(
      {
        source: 'slopz-host',
        type: 'slopz:connect',
        version: SLOPZ_PROTOCOL_VERSION,
        gameId: this.options.gameId,
        nonce: event.data.nonce,
      },
      this.options.gameOrigin,
      [channel.port2],
    )
  }

  private async onPortMessage(event: MessageEvent): Promise<void> {
    if (!this.port || !isHostRequest(event.data)) return
    let response: SlopzHostResponse
    try {
      response = {
        type: 'slopz:response',
        requestId: event.data.requestId,
        result: await this.options.handleRequest(event.data),
      }
    } catch (error) {
      response = {
        type: 'slopz:response',
        requestId: event.data.requestId,
        error: error instanceof Error ? error.message : 'HOST_REQUEST_FAILED',
      }
    }
    this.port.postMessage(response)
  }

  dispose(): void {
    window.removeEventListener('message', this.listener)
    this.port?.close()
    this.port = null
  }
}

export type { SlopzHostRequest } from './protocol.js'
