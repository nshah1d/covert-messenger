import { h, icon, replace } from '../lib/dom.js';
import { IDENTITY_MAP } from '../config/identities.js';
import { uploadFile } from './upload.js';
import { acquireMedia, mediaKind } from './media.js';

const EXT_ICONS = {
  PDF: { color: '#ff4d4d', icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6' },
  ZIP: { color: '#ffcc00', icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M12 18v-2 M12 13v-2' },
  RAR: { color: '#ffcc00', icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M12 18v-2 M12 13v-2' },
  MP3: { color: '#33ccff', icon: 'M9 18V5l12-2v13 M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0z M21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z' },
  WAV: { color: '#33ccff', icon: 'M9 18V5l12-2v13 M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0z M21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z' },
  AVI: { color: '#ff3399', icon: 'M23 7l-7 5 7 5V7z M1 5h15v14H1z' },
  MOV: { color: '#ff3399', icon: 'M23 7l-7 5 7 5V7z M1 5h15v14H1z' },
  MP4: { color: '#ff3399', icon: 'M23 7l-7 5 7 5V7z M1 5h15v14H1z' },
  DOC: { color: '#3366ff', icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6' },
  DOCX: { color: '#3366ff', icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6' },
  TXT: { color: '#888', icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6' },
  MD: { color: 'var(--user-a)', icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6' },
};

export function createComposer({ request, outbox, onSend, onError }) {
  const pending = [];
  let replyingTo = null;
  let sending = false;
  let uploading = false;
  let uploadController = null;
  let barTimer = null;

  const replyBox = h('div', { class: 'reply-compose', hidden: true });
  const minis = h('div', { class: 'attachment-previews', hidden: true });
  const bar = h('div', { class: 'upload-progress-container', hidden: true });
  const barFill = h('div', { class: 'upload-progress-bar', style: { width: '0%' } });
  const barLabel = h('span', { class: 'upload-progress-label' });
  const barCancel = h('button', { class: 'reply-compose__cancel', title: 'Cancel upload', onClick: () => uploadController && uploadController.abort() },
    icon(14, [['line', { x1: 18, y1: 6, x2: 6, y2: 18 }], ['line', { x1: 6, y1: 6, x2: 18, y2: 18 }]]));
  bar.append(barFill, barLabel, barCancel);

  const dropzone = h('div', { class: 'upload-dropzone', hidden: true }, h('div', { class: 'dropzone-inner' }, h('span', null, 'Drop files to upload')));
  const fileInput = h('input', { type: 'file', multiple: true, style: { display: 'none' } });
  const attach = h('button', { class: 'upload-trigger', title: 'Attach files', onClick: () => fileInput.click() },
    icon(20, [['path', { d: 'M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48' }]]));

  const textarea = h('textarea', { class: 'chat-input', placeholder: 'Message...', rows: 1, enterkeyhint: 'enter', autocorrect: 'off', autocapitalize: 'sentences' });
  const spinner = icon(18, [['path', { d: 'M12 2a10 10 0 0 1 10 10', 'stroke-linecap': 'round' }]], { style: { animation: 'spinSend 0.7s linear infinite' } });
  const sendButton = h('button', { class: 'touch-target send-action' }, 'Send');

  const dock = h('div', { class: 'chat-dock' }, replyBox, dropzone, bar, attach, fileInput,
    h('div', { class: 'input-container' }, minis, textarea), sendButton);

  const body = () => textarea.value.replace(/\r\n/g, '\n').trim();

  function autosize() {
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
    textarea.style.overflowY = textarea.clientHeight < textarea.scrollHeight ? 'auto' : 'hidden';
  }

  function syncSend() {
    sendButton.disabled = sending || uploading || (!body() && pending.length === 0);
    replace(sendButton, sending ? spinner : 'Send');
  }

  function paintReply() {
    replyBox.hidden = !replyingTo;
    if (!replyingTo) return;
    const m = replyingTo;
    const cls = m.sender_identity === 'user-a' ? 'user-a' : 'user-b';
    let snippet = m.is_deleted ? 'Message deleted' : (m.message_body || (m.attachments || []).map((a) => a.original_name).join(', ')).replace(/\s*\n\s*/g, ' ');
    const long = !m.is_deleted && snippet.length > 50;
    if (long) snippet = snippet.slice(0, 50);
    replace(replyBox,
      h('div', { class: 'reply-compose__content' },
        h('div', { class: 'reply-compose__label' }, 'Replying to ', h('span', { class: cls }, IDENTITY_MAP[m.sender_identity] ?? m.sender_identity)),
        h('div', { class: 'reply-compose__snippet' }, snippet, long ? h('span', { class: 'reply-ellipsis' }, '...') : null)),
      h('button', { class: 'reply-compose__cancel', title: 'Cancel reply', onClick: () => { replyingTo = null; paintReply(); } },
        icon(16, [['line', { x1: 18, y1: 6, x2: 6, y2: 18 }], ['line', { x1: 6, y1: 6, x2: 18, y2: 18 }]])));
  }

  function mini(attachment) {
    const kind = mediaKind(attachment.mime_type, attachment.original_name);
    const name = attachment.original_name || 'Attachment';
    const holder = h('div', { class: 'attachment-mini', title: name });
    let lease = null;
    if (kind === 'image') {
      holder.append(h('div', { class: 'mini-loader' }));
      lease = acquireMedia(attachment.id);
      lease.ready.then((entry) => { holder.firstChild.replaceWith(h('img', { src: entry.url, alt: '' })); }).catch(() => {});
    } else {
      const ext = name.split('.').pop().toUpperCase();
      const config = EXT_ICONS[ext] || EXT_ICONS.TXT;
      holder.append(h('div', { class: 'mini-doc-fallback', style: { borderTop: `2px solid ${config.color}` } },
        icon(20, [['path', { d: config.icon }]], { stroke: config.color }),
        h('span', { class: 'mini-ext-label', style: { color: config.color } }, ext)));
    }
    holder.append(h('button', { class: 'mini-remove', onClick: () => {
      const index = pending.findIndex((p) => p.id === attachment.id);
      if (index !== -1) pending.splice(index, 1);
      if (lease) lease.release();
      request(`/api/media.php?id=${attachment.id}`, { method: 'DELETE' }).catch(() => {});
      paintMinis();
      syncSend();
    } }, '×'));
    return holder;
  }

  function paintMinis() {
    minis.hidden = pending.length === 0;
    replace(minis, pending.map(mini));
  }

  function showBar(state, text) {
    clearTimeout(barTimer);
    bar.hidden = false;
    bar.classList.toggle('is-error', state === 'error');
    barCancel.hidden = state !== 'uploading';
    barLabel.textContent = text;
    if (state === 'complete') barTimer = setTimeout(() => { bar.hidden = true; }, 2000);
    if (state === 'error') barTimer = setTimeout(() => { bar.hidden = true; }, 5000);
  }

  const guardUnload = (e) => { e.preventDefault(); e.returnValue = ''; };

  async function uploadAll(files) {
    if (!files.length || uploading) return;
    uploading = true;
    syncSend();
    uploadController = new AbortController();
    window.addEventListener('beforeunload', guardUnload);
    try {
      for (let i = 0; i < files.length; i++) {
        barFill.style.width = '0%';
        showBar('uploading', `File ${i + 1} of ${files.length}: 0%`);
        const attachment = await uploadFile(files[i], {
          request,
          signal: uploadController.signal,
          onProgress: (p) => {
            barFill.style.width = `${p}%`;
            barLabel.textContent = `File ${i + 1} of ${files.length}: ${p}%`;
          },
        });
        pending.push(attachment);
        paintMinis();
      }
      showBar('complete', 'All uploads complete');
    } catch (error) {
      showBar('error', error.name === 'AbortError' ? 'Upload cancelled' : `Upload of ${files.length > 1 ? 'a file' : files[0].name} failed`);
      if (error.name !== 'AbortError') onError(error);
    } finally {
      window.removeEventListener('beforeunload', guardUnload);
      uploading = false;
      uploadController = null;
      syncSend();
    }
  }

  async function send() {
    const text = body();
    if (sending || uploading || (!text && pending.length === 0)) return;
    const attachmentIds = pending.map((p) => p.id);
    const replyTo = replyingTo ? replyingTo.id : null;
    const clientId = outbox.requestIdFor({ body: text, attachmentIds, replyTo });
    const backup = textarea.value;
    sending = true;
    textarea.value = '';
    autosize();
    syncSend();
    try {
      const message = await request('/api/messages.php', {
        method: 'POST',
        body: { message_body: text, attachment_ids: attachmentIds, session_nonce: sessionStorage.getItem('session_nonce'), reply_to_id: replyTo, client_id: clientId },
      });
      outbox.confirmed();
      pending.length = 0;
      replyingTo = null;
      paintMinis();
      paintReply();
      await onSend(message);
    } catch (error) {
      // The text comes back unless something new was typed, and the draft keeps
      // its request ID, so sending it again cannot post it twice.
      if (!textarea.value) textarea.value = backup;
      autosize();
      onError(error);
    } finally {
      sending = false;
      syncSend();
    }
  }

  textarea.addEventListener('input', () => { autosize(); syncSend(); });
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      send();
    }
  });
  sendButton.addEventListener('click', send);
  fileInput.addEventListener('change', () => {
    const files = Array.from(fileInput.files || []);
    fileInput.value = '';
    uploadAll(files);
  });

  const onDragOver = (e) => { e.preventDefault(); dropzone.hidden = false; };
  const onDragLeave = (e) => { e.preventDefault(); if (e.relatedTarget === null) dropzone.hidden = true; };
  const onDrop = (e) => {
    e.preventDefault();
    dropzone.hidden = true;
    uploadAll(Array.from(e.dataTransfer ? e.dataTransfer.files : []));
  };
  window.addEventListener('dragover', onDragOver);
  window.addEventListener('dragleave', onDragLeave);
  window.addEventListener('drop', onDrop);

  syncSend();

  return {
    node: dock,
    replyTo(message) {
      replyingTo = message;
      paintReply();
      textarea.focus();
    },
    destroy() {
      clearTimeout(barTimer);
      if (uploadController) uploadController.abort();
      window.removeEventListener('beforeunload', guardUnload);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    },
  };
}
