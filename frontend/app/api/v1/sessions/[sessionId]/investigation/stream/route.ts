export const dynamic = 'force-dynamic'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params

  const upstream = await fetch(
    `http://localhost:8000/api/v1/sessions/${sessionId}/investigation/stream`,
    { headers: { Accept: 'text/event-stream', 'Cache-Control': 'no-cache' } }
  )

  if (!upstream.ok || !upstream.body) {
    return new Response('upstream unavailable', { status: 502 })
  }

  return new Response(upstream.body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
