import {
  AIStream,
  type AIStreamCallbacks,
  type AIStreamParserOptions
} from './ai-stream'

// function parseAnthropicStream({
//   data,
//   controller,
//   counter,
//   encoder
// }: AIStreamParserOptions): void {
//   try {
//     const json = JSON.parse(data as string) as {
//       completion: string
//       stop: string | null
//       stop_reason: string | null
//       truncated: boolean
//       log_id: string
//       model: string
//       exception: string | null
//     }
//     const text = json.completion
//     if (counter < 2 && (/\n/.exec(text) || []).length) {
//       return
//     }

//     const queue = encoder.encode(`${JSON.stringify(text)}\n`)
//     controller.enqueue(queue)

//     counter++
//   } catch (e) {
//     controller.error(e)
//   }
// }

// export function AnthropicStream(
//   res: Response,
//   cb?: AIStreamCallbacks
// ): ReadableStream {
//   return AIStream(res, parseAnthropicStream, cb)
// }

export function AnthropicStream(callbacks?: AIStreamCallbacks) {
  const stream = new TransformStream()
  const encoder = new TextEncoder()
  const writer = stream.writable.getWriter()
  const decoder = new TextDecoder()
  let fullResponse = ''
  const forkedStream = new TransformStream({
    start: async (): Promise<void> => {
      if (callbacks?.onStart) {
        await callbacks.onStart()
      }
    },
    transform: async (chunk, controller): Promise<void> => {
      controller.enqueue(chunk)
      const item = decoder.decode(chunk)
      const value = JSON.parse(item.split('\n')[0])
      if (callbacks?.onToken) {
        await callbacks.onToken(value as string)
      }
      fullResponse += value
    },
    flush: async (controller): Promise<void> => {
      if (callbacks?.onCompletion) {
        await callbacks.onCompletion(fullResponse)
      }
      controller.terminate()
    }
  })
  return {
    stream: stream.readable.pipeThrough(forkedStream),
    handlers: {
      onUpdate: async (completion: string) => {
        await writer.ready
        await writer.write(encoder.encode(`${JSON.stringify(completion)}\n`))
      }
    }
  }
}
