/** External FastVideo HTTP fixture exercised through the real client and headless Session tool loop. */
import { once } from 'node:events'
import { createServer } from 'node:http'
import { createMcpToolDefinition } from '@deepseek-ai/dsh-mcp-client'
import DvFastvideoGeneration from '../../../packages/dv/fastvideo-generation-client/src/index.ts'

export const inject = ['tools', 'attachments']

/** Own the backend listener and register one deterministic adapter probe. */
export async function apply(ctx) {
  const modelFacts = {
    modelId: 'snapshot-video', aspectRatios: ['16:9'], resolutions: ['480p'],
    minSegmentDurationSec: 5, maxSegmentDurationSec: 5, maxReferences: 2,
    referenceMediaTypes: { image: { maxCount: 2 } }, frameSizes: { '16:9': { '480p': [832, 480] } },
    numFramesByDurationSec: { 5: 124 },
  }
  const requests = []
  const server = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null
    requests.push({ path: request.url, body })
    if (request.url === '/v1/model_info') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ served_model_name: modelFacts.modelId }))
    } else if (request.url === '/v1/videos/sync') {
      if (body.prompt === 'Failure') {
        response.writeHead(500, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: { message: `Traceback (most recent call last):\n${'  internal frame\n'.repeat(5000)}RuntimeError: fixture generation failed` } }))
        return
      }
      response.writeHead(200, { 'content-type': 'video/mp4', 'x-inference-time-s': '1.25' })
      response.end('VIDEO')
    } else {
      response.writeHead(404)
      response.end()
    }
  })
  ctx.effect(() => async () => {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const client = new DvFastvideoGeneration(ctx.isolate('dvFastvideoGeneration'), {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    openai: { modelFacts, ffmpegPath: 'unused-for-no-last-frame' },
  })
  ctx.effect(() => ctx.tools.register(createMcpToolDefinition(ctx, {
    name: 'mcp__fixture__fastvideo', rawName: 'fastvideo', description: 'Generate one deterministic FastVideo segment.',
    inputSchema: { type: 'object', properties: {} },
    call: async () => {
      const facts = await client.model()
      const events = []
      for await (const event of client.generateSegment({
        prompt: 'A lake', task: 'fl2va', frameWidth: 832, frameHeight: 480, numFrames: 124,
        references: [
          { mediaType: 'image', mimeType: 'image/png', bytes: Buffer.from('FIRST') },
          { mediaType: 'image', mimeType: 'image/jpeg', bytes: Buffer.from('LAST') },
        ], returnLastFrame: false,
      })) events.push(event.kind === 'chunk' ? { kind: event.kind, bytes: event.bytes.length } : event)
      let failure
      try {
        for await (const event of client.generateSegment({
          prompt: 'Failure', frameWidth: 832, frameHeight: 480, numFrames: 124, references: [], returnLastFrame: false,
        })) events.push(event)
      } catch (error) {
        failure = error.message
      }
      return { content: [{ type: 'text', text: JSON.stringify({ model: facts.modelId, requests, events, failure }) }] }
    },
  })))
}
