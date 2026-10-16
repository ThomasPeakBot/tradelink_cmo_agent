export class PayloadTooLarge extends Error {}
/** Bound streamed bodies before decoding/parsing, including requests without Content-Length. */
export async function readJson(request: Request, limit: number): Promise<unknown> {
  if (Number(request.headers.get('content-length') || 0) > limit) throw new PayloadTooLarge();
  if (!request.body) throw new SyntaxError('Missing request body');
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new PayloadTooLarge();
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return JSON.parse(text);
}
