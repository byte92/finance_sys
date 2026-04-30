export async function safeReadJsonBody<T>(request: Request): Promise<
  | { ok: true; body: T }
  | { ok: false; error: string; status: number }
> {
  const raw = await request.text()
  if (!raw.trim()) {
    return { ok: false, error: '请求体为空，请重试。', status: 400 }
  }

  try {
    return { ok: true, body: JSON.parse(raw) as T }
  } catch {
    return { ok: false, error: '请求体不是有效 JSON，请刷新页面后重试。', status: 400 }
  }
}
