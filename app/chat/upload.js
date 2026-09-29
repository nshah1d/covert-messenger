/**
 * Uploads one file in the server's chunk size, one chunk at a time.
 *
 * Any failure or abort after the upload starts cancels it on the server, so no
 * staging directory is left behind.
 *
 * @param {File} file
 * @param {{request: Function, onProgress?: (percent: number) => void, signal?: AbortSignal}} options
 * @returns {Promise<object>} The pending attachment, ready to be sent with a message.
 */
export async function uploadFile(file, { request, onProgress = () => {}, signal } = {}) {
  const init = await request('/api/upload_init.php', { method: 'POST', body: { filename: file.name, file_size: file.size }, signal });
  let finished = false;
  try {
    for (let index = 0; index < init.total_chunks; index++) {
      const form = new FormData();
      form.append('upload_id', init.upload_id);
      form.append('chunk_index', String(index));
      form.append('chunk', file.slice(index * init.chunk_size, (index + 1) * init.chunk_size), 'chunk');
      await request('/api/upload_chunk.php', { method: 'POST', body: form, signal });
      onProgress(Math.round(((index + 1) / init.total_chunks) * 100));
    }
    const attachment = await request('/api/upload_complete.php', { method: 'POST', body: { upload_id: init.upload_id }, signal });
    finished = true;
    return attachment;
  } finally {
    if (!finished) {
      request('/api/upload_init.php', { method: 'DELETE', body: { upload_id: init.upload_id } }).catch(() => {});
    }
  }
}
