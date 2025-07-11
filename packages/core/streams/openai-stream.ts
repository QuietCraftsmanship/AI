
import { CreateMessage, JSONValue } from '../shared/types'
import { getStreamString } from '../shared/utils'

import { formatStreamPart } from '../shared/stream-parts';
import {
  CreateMessage,
  FunctionCall,
  JSONValue,
  ToolCall,
} from '../shared/types';
import { createChunkDecoder } from '../shared/utils';


import {
  AIStream,
  trimStartOfStreamHelper,

  type AIStreamCallbacks,
  FunctionCallPayload
} from './ai-stream'

export type OpenAIStreamCallbacks = AIStreamCallbacks & {

  type AIStreamCallbacksAndOptions,
  FunctionCallPayload,
  readableFromAsyncIterable,
  createCallbacksTransformer,
  ToolCallPayload,
} from './ai-stream';
import { AzureChatCompletions } from './azure-openai-types';
import { createStreamDataTransformer } from './stream-data';

export type OpenAIStreamCallbacks = AIStreamCallbacksAndOptions & {

  /**
   * @example
   * ```js
   * const response = await openai.chat.completions.create({
   *   model: 'gpt-3.5-turbo-0613',
   *   stream: true,
   *   messages,
   *   functions,
   * })
   *
   * const stream = OpenAIStream(response, {
   *   experimental_onFunctionCall: async (functionCallPayload, createFunctionCallMessages) => {
   *     // ... run your custom logic here
   *     const result = await myFunction(functionCallPayload)
   *
   *     // Ask for another completion, or return a string to send to the client as an assistant message.
   *     return await openai.chat.completions.create({
   *       model: 'gpt-3.5-turbo-0613',
   *       stream: true,
   *       // Append the relevant "assistant" and "function" call messages
   *       messages: [...messages, ...createFunctionCallMessages(result)],
   *       functions,
   *     })
   *   }
   * })
   * ```
   */
  experimental_onFunctionCall?: (
    functionCallPayload: FunctionCallPayload,
    createFunctionCallMessages: (
      functionCallResult: JSONValue,
    ) => CreateMessage[],
  ) => Promise<
    Response | undefined | void | string | AsyncIterableOpenAIStreamReturnTypes
  >;
  /**
   * @example
   * ```js
   * const response = await openai.chat.completions.create({
   *   model: 'gpt-3.5-turbo-1106', // or gpt-4-1106-preview
   *   stream: true,
   *   messages,
   *   tools,
   *   tool_choice: "auto", // auto is default, but we'll be explicit
   * })
   *
   * const stream = OpenAIStream(response, {
   *   experimental_onToolCall: async (toolCallPayload, appendToolCallMessages) => {
   *    let messages: CreateMessage[] = []
   *    //   There might be multiple tool calls, so we need to iterate through them
   *    for (const tool of toolCallPayload.tools) {
   *     // ... run your custom logic here
   *     const result = await myFunction(tool.function)
   *    // Append the relevant "assistant" and "tool" call messages
   *     appendToolCallMessage({tool_call_id:tool.id, function_name:tool.function.name, tool_call_result:result})
   *    }
   *     // Ask for another completion, or return a string to send to the client as an assistant message.
   *     return await openai.chat.completions.create({
   *       model: 'gpt-3.5-turbo-1106', // or gpt-4-1106-preview
   *       stream: true,
   *       // Append the results messages, calling appendToolCallMessage without
   *       // any arguments will jsut return the accumulated messages
   *       messages: [...messages, ...appendToolCallMessage()],
   *       tools,
   *        tool_choice: "auto", // auto is default, but we'll be explicit
   *     })
   *   }
   * })
   * ```
   */
  experimental_onToolCall?: (
    toolCallPayload: ToolCallPayload,
    appendToolCallMessage: (result?: {
      tool_call_id: string;
      function_name: string;
      tool_call_result: JSONValue;
    }) => CreateMessage[],
  ) => Promise<
    Response | undefined | void | string | AsyncIterableOpenAIStreamReturnTypes
  >;
};

// https://github.com/openai/openai-node/blob/07b3504e1c40fd929f4aae1651b83afc19e3baf8/src/resources/chat/completions.ts#L28-L40
interface ChatCompletionChunk {
  id: string;
  choices: Array<ChatCompletionChunkChoice>;
  created: number;
  model: string;
  object: string;
}

// https://github.com/openai/openai-node/blob/07b3504e1c40fd929f4aae1651b83afc19e3baf8/src/resources/chat/completions.ts#L43-L49
// Updated for https://github.com/openai/openai-node/commit/f10c757d831d90407ba47b4659d9cd34b1a35b1d
// Updated to https://github.com/openai/openai-node/commit/84b43280089eacdf18f171723591856811beddce
interface ChatCompletionChunkChoice {
  delta: ChoiceDelta;
  finish_reason:
    | 'stop'
    | 'length'
    | 'tool_calls'
    | 'content_filter'
    | 'function_call'
    | null;
  index: number;
}

// https://github.com/openai/openai-node/blob/07b3504e1c40fd929f4aae1651b83afc19e3baf8/src/resources/chat/completions.ts#L123-L139
// Updated to https://github.com/openai/openai-node/commit/84b43280089eacdf18f171723591856811beddce
interface ChoiceDelta {
  /**
   * The contents of the chunk message.
   */
  content?: string | null;

  /**
   * The name and arguments of a function that should be called, as generated by the
   * model.
   */
  function_call?: FunctionCall;

  /**
   * The role of the author of this message.
   */
  role?: 'system' | 'user' | 'assistant' | 'tool';

  tool_calls?: Array<DeltaToolCall>;
}

// From https://github.com/openai/openai-node/blob/master/src/resources/chat/completions.ts
// Updated to https://github.com/openai/openai-node/commit/84b43280089eacdf18f171723591856811beddce
interface DeltaToolCall {
  index: number;

  /**
   * The ID of the tool call.
   */
  id?: string;

  /**
   * The function that the model called.
   */
  function?: ToolCallFunction;

  /**
   * The type of the tool. Currently, only `function` is supported.
   */
  type?: 'function';
}

// From https://github.com/openai/openai-node/blob/master/src/resources/chat/completions.ts
// Updated to https://github.com/openai/openai-node/commit/84b43280089eacdf18f171723591856811beddce
interface ToolCallFunction {
  /**
   * The arguments to call the function with, as generated by the model in JSON
   * format. Note that the model does not always generate valid JSON, and may
   * hallucinate parameters not defined by your function schema. Validate the
   * arguments in your code before calling your function.
   */
  arguments?: string;

  /**
   * The name of the function to call.
   */
  name?: string;
}

/**
 * https://github.com/openai/openai-node/blob/3ec43ee790a2eb6a0ccdd5f25faa23251b0f9b8e/src/resources/completions.ts#L28C1-L64C1
 * Completions API. Streamed and non-streamed responses are the same.
 */
interface Completion {
  /**
   * A unique identifier for the completion.
   */
  id: string;

  /**
   * The list of completion choices the model generated for the input prompt.
   */
  choices: Array<CompletionChoice>;

  /**
   * The Unix timestamp of when the completion was created.
   */
  created: number;

  /**
   * The model used for completion.
   */
  model: string;

  /**
   * The object type, which is always "text_completion"
   */
  object: string;

  /**
   * Usage statistics for the completion request.
   */
  usage?: CompletionUsage;
}

interface CompletionChoice {
  /**
   * The reason the model stopped generating tokens. This will be `stop` if the model
   * hit a natural stop point or a provided stop sequence, or `length` if the maximum
   * number of tokens specified in the request was reached.
   */
  finish_reason: 'stop' | 'length' | 'content_filter';

  index: number;

  // edited: Removed CompletionChoice.logProbs and replaced with any
  logprobs: any | null;

  text: string;
}

export interface CompletionUsage {
  /**
   * Usage statistics for the completion request.
   */

  /**
   * Number of tokens in the generated completion.
   */
  completion_tokens: number;

  /**
   * Number of tokens in the prompt.
   */
  prompt_tokens: number;

  /**
   * Total number of tokens used in the request (prompt + completion).
   */
  total_tokens: number;
}

/**
 * Creates a parser function for processing the OpenAI stream data.
 * The parser extracts and trims text content from the JSON data. This parser
 * can handle data for chat or completion models.
 *
 * @return {(data: string) => string | void| { isText: false; content: string }}
 * A parser function that takes a JSON string as input and returns the extracted text content,
 * a complex object with isText: false for function/tool calls, or nothing.
 */
function parseOpenAIStream(): (
  data: string,
) => string | void | { isText: false; content: string } {
  const extract = chunkToText();
  return data => extract(JSON.parse(data) as OpenAIStreamReturnTypes);
}

/**
 * Reads chunks from OpenAI's new Streamable interface, which is essentially
 * the same as the old Response body interface with an included SSE parser
 * doing the parsing for us.
 */
async function* streamable(stream: AsyncIterableOpenAIStreamReturnTypes) {
  const extract = chunkToText();

  for await (let chunk of stream) {
    // convert chunk if it is an Azure chat completion. Azure does not expose all
    // properties in the interfaces, and also uses camelCase instead of snake_case
    if ('promptFilterResults' in chunk) {
      chunk = {
        id: chunk.id,
        created: chunk.created.getDate(),
        object: (chunk as any).object, // not exposed by Azure API
        model: (chunk as any).model, // not exposed by Azure API
        choices: chunk.choices.map(choice => ({
          delta: {
            content: choice.delta?.content,
            function_call: choice.delta?.functionCall,
            role: choice.delta?.role as any,
            tool_calls: choice.delta?.toolCalls?.length
              ? choice.delta?.toolCalls?.map((toolCall, index) => ({
                  index,
                  id: toolCall.id,
                  function: toolCall.function,
                  type: toolCall.type,
                }))
              : undefined,
          },
          finish_reason: choice.finishReason as any,
          index: choice.index,
        })),
      } satisfies ChatCompletionChunk;
    }

    const text = extract(chunk);

    if (text) yield text;
  }
}

function chunkToText(): (
  chunk: OpenAIStreamReturnTypes,
) => string | { isText: false; content: string } | void {
  const trimStartOfStream = trimStartOfStreamHelper();
  let isFunctionStreamingIn: boolean;
  return json => {
    if (isChatCompletionChunk(json)) {
      const delta = json.choices[0]?.delta;
      if (delta.function_call?.name) {
        isFunctionStreamingIn = true;
        return {
          isText: false,
          content: `{"function_call": {"name": "${delta.function_call.name}", "arguments": "`,
        };
      } else if (delta.tool_calls?.[0]?.function?.name) {
        isFunctionStreamingIn = true;
        const toolCall = delta.tool_calls[0];
        if (toolCall.index === 0) {
          return {
            isText: false,
            content: `{"tool_calls":[ {"id": "${toolCall.id}", "type": "function", "function": {"name": "${toolCall.function?.name}", "arguments": "`,
          };
        } else {
          return {
            isText: false,
            content: `"}}, {"id": "${toolCall.id}", "type": "function", "function": {"name": "${toolCall.function?.name}", "arguments": "`,
          };
        }
      } else if (delta.function_call?.arguments) {
        return {
          isText: false,
          content: cleanupArguments(delta.function_call?.arguments),
        };
      } else if (delta.tool_calls?.[0]?.function?.arguments) {
        return {
          isText: false,
          content: cleanupArguments(delta.tool_calls?.[0]?.function?.arguments),
        };
      } else if (
        isFunctionStreamingIn &&
        (json.choices[0]?.finish_reason === 'function_call' ||
          json.choices[0]?.finish_reason === 'stop')
      ) {
        isFunctionStreamingIn = false; // Reset the flag
        return {
          isText: false,
          content: '"}}',
        };
      } else if (
        isFunctionStreamingIn &&
        json.choices[0]?.finish_reason === 'tool_calls'
      ) {
        isFunctionStreamingIn = false; // Reset the flag
        return {
          isText: false,
          content: '"}}]}',
        };
      }
    }

    const text = trimStartOfStream(
      isChatCompletionChunk(json) && json.choices[0].delta.content
        ? json.choices[0].delta.content
        : isCompletion(json)
        ? json.choices[0].text
        : '',
    );

    return text;
  };

  function cleanupArguments(argumentChunk: string) {
    let escapedPartialJson = argumentChunk
      .replace(/\\/g, '\\\\') // Replace backslashes first to prevent double escaping
      .replace(/\//g, '\\/') // Escape slashes
      .replace(/"/g, '\\"') // Escape double quotes
      .replace(/\n/g, '\\n') // Escape new lines
      .replace(/\r/g, '\\r') // Escape carriage returns
      .replace(/\t/g, '\\t') // Escape tabs
      .replace(/\f/g, '\\f'); // Escape form feeds

    return `${escapedPartialJson}`;
  }
}

const __internal__OpenAIFnMessagesSymbol = Symbol(
  'internal_openai_fn_messages',
);

type AsyncIterableOpenAIStreamReturnTypes =
  | AsyncIterable<ChatCompletionChunk>
  | AsyncIterable<Completion>
  | AsyncIterable<AzureChatCompletions>;

type ExtractType<T> = T extends AsyncIterable<infer U> ? U : never;

type OpenAIStreamReturnTypes =
  ExtractType<AsyncIterableOpenAIStreamReturnTypes>;

function isChatCompletionChunk(
  data: OpenAIStreamReturnTypes,
): data is ChatCompletionChunk {
  return (
    'choices' in data &&
    data.choices &&
    data.choices[0] &&
    'delta' in data.choices[0]
  );
}

function isCompletion(data: OpenAIStreamReturnTypes): data is Completion {
  return (
    'choices' in data &&
    data.choices &&
    data.choices[0] &&
    'text' in data.choices[0]
  );
}

export function OpenAIStream(
  res: Response | AsyncIterableOpenAIStreamReturnTypes,
  callbacks?: OpenAIStreamCallbacks,
): ReadableStream {
  // Annotate the internal `messages` property for recursive function calls
  const cb:
    | undefined
    | (OpenAIStreamCallbacks & {
        [__internal__OpenAIFnMessagesSymbol]?: CreateMessage[];
      }) = callbacks;

  let stream: ReadableStream<Uint8Array>;
  if (Symbol.asyncIterator in res) {
    stream = readableFromAsyncIterable(streamable(res)).pipeThrough(
      createCallbacksTransformer(
        cb?.experimental_onFunctionCall || cb?.experimental_onToolCall
          ? {
              ...cb,
              onFinal: undefined,
            }
          : {
              ...cb,
            },
      ),
    );
  } else {
    stream = AIStream(
      res,
      parseOpenAIStream(),
      cb?.experimental_onFunctionCall || cb?.experimental_onToolCall
        ? {
            ...cb,
            onFinal: undefined,
          }
        : {
            ...cb,
          },
    );
  }

  if (cb && (cb.experimental_onFunctionCall || cb.experimental_onToolCall)) {
    const functionCallTransformer = createFunctionCallTransformer(cb);
    return stream.pipeThrough(functionCallTransformer);
  } else {
    return stream.pipeThrough(
      createStreamDataTransformer(cb?.experimental_streamData),
    );
  }
}

function createFunctionCallTransformer(
  callbacks: OpenAIStreamCallbacks & {
    [__internal__OpenAIFnMessagesSymbol]?: CreateMessage[];
  },
): TransformStream<Uint8Array, Uint8Array> {
  const textEncoder = new TextEncoder();
  let isFirstChunk = true;
  let aggregatedResponse = '';
  let aggregatedFinalCompletionResponse = '';
  let isFunctionStreamingIn = false;

  let functionCallMessages: CreateMessage[] =
    callbacks[__internal__OpenAIFnMessagesSymbol] || [];

  const isComplexMode = callbacks?.experimental_streamData;
  const decode = createChunkDecoder();

  return new TransformStream({
    async transform(chunk, controller): Promise<void> {
      const message = decode(chunk);
      aggregatedFinalCompletionResponse += message;

      const shouldHandleAsFunction =
        isFirstChunk &&
        (message.startsWith('{"function_call":') ||
          message.startsWith('{"tool_calls":'));

      if (shouldHandleAsFunction) {
        isFunctionStreamingIn = true;
        aggregatedResponse += message;
        isFirstChunk = false;
        return;
      }

      // Stream as normal
      if (!isFunctionStreamingIn) {
        controller.enqueue(
          isComplexMode
            ? textEncoder.encode(formatStreamPart('text', message))
            : chunk,
        );
        return;
      } else {
        aggregatedResponse += message;
      }
    },
    async flush(controller): Promise<void> {
      try {
        if (
          !isFirstChunk &&
          isFunctionStreamingIn &&
          (callbacks.experimental_onFunctionCall ||
            callbacks.experimental_onToolCall)
        ) {
          isFunctionStreamingIn = false;
          const payload = JSON.parse(aggregatedResponse);
          // Append the function call message to the list
          let newFunctionCallMessages: CreateMessage[] = [
            ...functionCallMessages,
          ];

          let functionResponse:
            | Response
            | undefined
            | void
            | string
            | AsyncIterableOpenAIStreamReturnTypes
            | undefined = undefined;
          // This callbacks.experimental_onFunctionCall check should not be necessary but TS complains
          if (callbacks.experimental_onFunctionCall) {
            // If the user is using the experimental_onFunctionCall callback, they should not be using tools
            // if payload.function_call is not defined by time we get here we must have gotten a tool response
            // and the user had defined experimental_onToolCall
            if (payload.function_call === undefined) {
              console.warn(
                'experimental_onFunctionCall should not be defined when using tools',
              );
            }

            const argumentsPayload = JSON.parse(
              payload.function_call.arguments,
            );

            functionResponse = await callbacks.experimental_onFunctionCall(
              {
                name: payload.function_call.name,
                arguments: argumentsPayload,
              },
              result => {
                // Append the function call request and result messages to the list
                newFunctionCallMessages = [
                  ...functionCallMessages,
                  {
                    role: 'assistant',
                    content: '',
                    function_call: payload.function_call,
                  },
                  {
                    role: 'function',
                    name: payload.function_call.name,
                    content: JSON.stringify(result),
                  },
                ];
                // Return it to the user
                return newFunctionCallMessages;
              },
            );
          }
          if (callbacks.experimental_onToolCall) {
            const toolCalls: ToolCallPayload = {
              tools: [],
            };
            for (const tool of payload.tool_calls) {
              toolCalls.tools.push({
                id: tool.id,
                type: 'function',
                func: {
                  name: tool.function.name,
                  arguments: tool.function.arguments,
                },
              });
            }
            let responseIndex = 0;
            try {
              functionResponse = await callbacks.experimental_onToolCall(
                toolCalls,
                result => {
                  if (result) {
                    const { tool_call_id, function_name, tool_call_result } =
                      result;
                    // Append the function call request and result messages to the list
                    newFunctionCallMessages = [
                      ...newFunctionCallMessages,
                      // Only append the assistant message if it's the first response
                      ...(responseIndex === 0
                        ? [
                            {
                              role: 'assistant' as const,
                              content: '',
                              tool_calls: payload.tool_calls.map(
                                (tc: ToolCall) => ({
                                  id: tc.id,
                                  type: 'function',
                                  function: {
                                    name: tc.function.name,
                                    // we send the arguments an object to the user, but as the API expects a string, we need to stringify it
                                    arguments: JSON.stringify(
                                      tc.function.arguments,
                                    ),
                                  },
                                }),
                              ),
                            },
                          ]
                        : []),
                      // Append the function call result message
                      {
                        role: 'tool',
                        tool_call_id,
                        name: function_name,
                        content: JSON.stringify(tool_call_result),
                      },
                    ];
                    responseIndex++;
                  }
                  // Return it to the user
                  return newFunctionCallMessages;
                },
              );
            } catch (e) {
              console.error('Error calling experimental_onToolCall:', e);
            }
          }

        )

        if (!functionResponse) {
          // The user didn't do anything with the function call on the server and wants
          // to either do nothing or run it on the client
          // so we just return the function call as a message
          controller.enqueue(
            textEncoder.encode(
              getStreamString('function_call', aggregatedResponse)
            )
          )
          return
        } else if (typeof functionResponse === 'string') {
          // The user returned a string, so we just return it as a message
          controller.enqueue(
            textEncoder.encode(getStreamString('text', functionResponse))
          )
          return
        }

        // Recursively:

        // We don't want to trigger onStart or onComplete recursively
        // so we remove them from the callbacks
        // see https://github.com/vercel-labs/ai/issues/351
        const filteredCallbacks: OpenAIStreamCallbacks = {
          ...callbacks,
          onStart: undefined,
          onCompletion: undefined
        }

        const openAIStream = OpenAIStream(functionResponse, {
          ...filteredCallbacks,
          [__internal__OpenAIFnMessagesSymbol]: newFunctionCallMessages
        } as AIStreamCallbacks)


          if (!functionResponse) {
            // The user didn't do anything with the function call on the server and wants
            // to either do nothing or run it on the client
            // so we just return the function call as a message
            controller.enqueue(
              textEncoder.encode(
                isComplexMode
                  ? formatStreamPart(
                      payload.function_call ? 'function_call' : 'tool_calls',
                      // parse to prevent double-encoding:
                      JSON.parse(aggregatedResponse),
                    )
                  : aggregatedResponse,
              ),
            );
            return;
          } else if (typeof functionResponse === 'string') {
            // The user returned a string, so we just return it as a message
            controller.enqueue(
              isComplexMode
                ? textEncoder.encode(formatStreamPart('text', functionResponse))
                : textEncoder.encode(functionResponse),
            );
            aggregatedFinalCompletionResponse = functionResponse;
            return;
          }

          // Recursively:

          // We don't want to trigger onStart or onComplete recursively
          // so we remove them from the callbacks
          // see https://github.com/vercel/ai/issues/351
          const filteredCallbacks: OpenAIStreamCallbacks = {
            ...callbacks,
            onStart: undefined,
          };
          // We only want onFinal to be called the _last_ time
          callbacks.onFinal = undefined;

          const openAIStream = OpenAIStream(functionResponse, {
            ...filteredCallbacks,
            [__internal__OpenAIFnMessagesSymbol]: newFunctionCallMessages,
          } as AIStreamCallbacksAndOptions);

          const reader = openAIStream.getReader();

          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              break;
            }
            controller.enqueue(value);
          }
        }
      } finally {
        if (callbacks.onFinal && aggregatedFinalCompletionResponse) {
          await callbacks.onFinal(aggregatedFinalCompletionResponse);
        }
      }
    },
  });
}
