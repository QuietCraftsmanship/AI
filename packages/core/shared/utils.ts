import { customAlphabet } from 'nanoid/non-secure'
import { JSONValue } from './types'

// 7-character random string
export const nanoid = customAlphabet(
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
  7
)

export function createChunkDecoder() {
  const decoder = new TextDecoder()
  return function (chunk: Uint8Array | undefined): string {
    if (!chunk) return ''
    return decoder.decode(chunk, { stream: true })
  }
}

/**
 * The map of prefixes for data in the stream
 *
 * - 0: Text from the LLM response
 * - 1: (OpenAI) function_call responses
 * - 2: custom JSON added by the user using `Data`
 *
 * Example:
 * ```
 * 0:Vercel
 * 0:'s
 * 0: AI
 * 0: AI
 * 0: SDK
 * 0: is great
 * 0:!
 * 2: { "someJson": "value" }
 * 1: {"function_call": {"name": "get_current_weather", "arguments": "{\\n\\"location\\": \\"Charlottesville, Virginia\\",\\n\\"format\\": \\"celsius\\"\\n}"}}
 *```
 */
export const StreamStringPrefixes = {
  text: 0,
  function_call: 1,
  data: 2
} as const

/**
 * Prepends a string with a prefix from the `StreamChunkPrefixes`, JSON-ifies it, and appends a new line.
 */
export const getStreamString = (
  type: keyof typeof StreamStringPrefixes,
  value: JSONValue
): StreamString =>
  `${StreamStringPrefixes[type]}:${
    typeof value === 'string' ? value : JSON.stringify(value)
  }\n`

export type StreamString =
  `${(typeof StreamStringPrefixes)[keyof typeof StreamStringPrefixes]}:${string}\n`
