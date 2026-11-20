export async function fetchJson(pathname, options = {}) {
  const baseUrl = typeof window !== 'undefined' ? '' : (process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000');
  const headers = new Headers(options.headers || {});

  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const body = options.body && typeof options.body === 'object' && !(options.body instanceof FormData)
    ? JSON.stringify(options.body)
    : options.body;

  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers,
    body,
  });

  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json')
    ? await response.json().catch(() => ({}))
    : await response.text().catch(() => '');

  if (!response.ok) {
    throw new Error(data.error || data || `Request failed with status ${response.status}`);
  }

  return data;
}
