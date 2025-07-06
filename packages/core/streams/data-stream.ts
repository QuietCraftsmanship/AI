import { JSONValue } from '../shared/types'
import { getStreamString } from '../shared/utils'

/**
 * A stream wrapper to send custom JSON-encoded data back to the client.
 */
export class Data {
  private encoder = new TextEncoder()
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null
  private stream: ReadableStream<Uint8Array>

  constructor() {
    this.stream = new ReadableStream({
      start: controller => {
        this.controller = controller
      }
    })
  }

  append(value: JSONValue, prefix: string = '0'): void {
    if (!this.controller) {
      throw new Error('Stream controller is not initialized.')
    }

    const textEncoder = new TextEncoder()
    this.controller.enqueue(
      textEncoder.encode(getStreamString('text', JSON.stringify(value)))
    )
  }

  close() {
    if (!this.controller) return

    this.controller.close()
    this.controller = null
  }
}
