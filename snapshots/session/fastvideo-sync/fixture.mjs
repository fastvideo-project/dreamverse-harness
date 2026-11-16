/** External FastVideo HTTP fixture exercised through the real client and headless Session tool loop. */
import { once } from 'node:events'
import { createServer } from 'node:http'
import { createMcpToolDefinition } from '@deepseek-ai/dsh-mcp-client'
import DvFastvideoGeneration from '../../../packages/dv/fastvideo-generation-client/src/index.ts'

export const inject = ['tools', 'attachments']

/** Own the backend listener and register one deterministic adapter probe. */
export async function apply(ctx) {
  const modelFacts = { modelId: 'snapshot-video', maxReferences: 0, referenceMediaTypes: {} }
  // The video_output_capabilities that a FastVideo main server publishes for FastH3 on GET /v1/model_info.
  const videoOutputCapabilities = {
    schema_version: 1, fps: 24, duration_seconds: { min: 5, max: 15 },
    num_frames_by_duration_seconds: { 5: 124, 6: 158, 7: 175, 8: 192, 9: 226, 10: 243, 11: 277, 12: 294, 13: 328, 14: 345, 15: 362 },
    recommended_frame_sizes: {
      '16:9': { '480p': [832, 480], '768p': [1344, 768] }, '21:9': { '480p': [960, 416], '768p': [1536, 672] },
      '3:2': { '480p': [704, 480], '768p': [1152, 768] }, '4:3': { '480p': [640, 480], '768p': [1024, 768] },
      '5:4': { '480p': [608, 480], '768p': [960, 768] }, '1:1': { '480p': [480, 480], '768p': [768, 768] },
      '4:5': { '480p': [480, 608], '768p': [768, 960] }, '3:4': { '480p': [480, 640], '768p': [768, 1024] },
      '2:3': { '480p': [480, 704], '768p': [768, 1152] }, '9:16': { '480p': [480, 832], '768p': [768, 1344] },
      '9:21': { '480p': [416, 960], '768p': [672, 1536] },
    },
    canvas_multiple: 32, tasks: [{ task: 't2va', image_references: 0 }, { task: 'ref2va' }],
    reference_limits: { images: 9, videos: 3, audios: 3, total: 12, continuation_video: true }, hardware_capacity_verified: false,
  }
  const requests = []
  const server = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null
    requests.push({ path: request.url, body })
    if (request.url === '/v1/model_info') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ served_model_name: modelFacts.modelId, video_output_capabilities: videoOutputCapabilities }))
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
    modelFacts,
  })
  ctx.effect(() => ctx.tools.register(createMcpToolDefinition(ctx, {
    name: 'mcp__fixture__fastvideo', rawName: 'fastvideo', description: 'Generate one deterministic FastVideo segment.',
    inputSchema: { type: 'object', properties: {} },
    call: async () => {
      const facts = await client.model()
      const { video, mime, timings } = await client.generateSegment({
        prompt: 'A lake', frameWidth: 832, frameHeight: 480, numFrames: 124, references: [],
      })
      let failure
      try {
        await client.generateSegment({ prompt: 'Failure', frameWidth: 832, frameHeight: 480, numFrames: 124, references: [] })
      } catch (error) {
        failure = error.message
      }
      const segment = { bytes: video.length, mime, timings }
      return { content: [{ type: 'text', text: JSON.stringify({ model: facts.modelId, requests, segment, failure }) }] }
    },
  })))
}
