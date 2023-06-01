// ./app/api/chat/route.ts
import { AI_PROMPT, Client, HUMAN_PROMPT } from '@anthropic-ai/sdk'
import { AnthropicStream, StreamingTextResponse } from 'ai-connector'

// Create an OpenAI API client (that's edge friendly!)
const client = new Client(process.env.ANTHROPIC_API_KEY!)
// IMPORTANT! Set the runtime to edge
export const runtime = 'edge'

export async function POST(req: Request) {
  // Extract the `prompt` from the body of the request
  const { messages } = await req.json()

  // Ask OpenAI for a streaming chat completion given the prompt
  const fullResponse = await client.completeStream(
    {
      prompt: `${HUMAN_PROMPT} How many toes do dogs have?${AI_PROMPT}`,
      stop_sequences: [HUMAN_PROMPT],
      max_tokens_to_sample: 200,
      model: 'claude-v1'
    },
    {
      onOpen: response => {
        console.log('Opened stream, HTTP status code', response.status)
      },
      onUpdate: completion => {
        console.log(completion.completion)
      }
    }
  )

  // Convert the response into a friendly text-stream
  // const stream = AnthropicStream(fullResponse)
  // Respond with the stream
  return new Response(fullResponse.completion)
}
