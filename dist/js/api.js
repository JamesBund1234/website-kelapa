// Same-origin Function client. Never renders raw server text.
class ApiError extends Error {
  constructor(message, code, status = 0, uncertain = false) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.uncertain = uncertain;
  }
}

const MESSAGES = {
  login_required: 'Silakan login admin terlebih dahulu.',
  invalid_credentials: 'Kata sandi salah. Coba lagi.',
  rate_limited: 'Terlalu banyak percobaan. Coba lagi nanti.',
  invalid_input: 'Input tidak valid. Periksa kembali isian Anda.',
  not_found: 'Data tidak ditemukan atau sudah dihapus.',
  invalid_upload: 'Hanya foto JPG, PNG, atau WebP maksimal 5 MB.',
  upload_pending: 'Unggahan belum selesai. Coba lagi.',
  storage_unavailable: 'Penyimpanan sedang tidak tersedia.',
  database_not_configured: 'Data belum dikonfigurasi.',
  database_credential_rejected: 'Layanan data sedang bermasalah.',
  service_unavailable: 'Layanan sedang sibuk. Coba beberapa saat lagi.',
  network_error: 'Koneksi terputus. Periksa jaringan Anda.',
  invalid_response: 'Layanan mengembalikan hasil yang tidak dikenali.',
  request_failed: 'Permintaan gagal. Coba lagi.',
};

export async function requestJson(path, init = {}) {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  let response;
  try {
    response = await fetch(`/functions/v1/app${path}`, {
      ...init,
      headers,
      credentials: 'same-origin',
      signal: init.signal ?? AbortSignal.timeout(20000),
    });
  } catch (e) {
    if (e?.name === 'AbortError' || e?.name === 'TimeoutError') throw new ApiError('Waktu permintaan habis.', 'network_error', 0, true);
    throw new ApiError('Koneksi terputus.', 'network_error', 0, true);
  }
  if (response.status === 401 || response.status === 403) {
    throw new ApiError(MESSAGES[response.status === 401 ? 'login_required' : 'request_failed'], response.status === 401 ? 'login_required' : 'access_denied', response.status);
  }
  let body = null;
  try { body = await response.json(); } catch { /* non-JSON */ }
  const obj = body && typeof body === 'object' ? body : null;
  const code = typeof obj?.error === 'string' ? obj.error : (!response.ok ? 'request_failed' : null);
  if (!response.ok || code) {
    throw new ApiError(MESSAGES[code] ?? MESSAGES.request_failed, code ?? 'request_failed', response.status, response.status >= 500 || response.status === 408);
  }
  return obj;
}

export function errorMessage(err) {
  return err instanceof ApiError ? err.message : 'Terjadi kesalahan. Coba lagi.';
}

export function formatRp(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return 'Rp 0';
  return 'Rp ' + num.toLocaleString('id-ID');
}
