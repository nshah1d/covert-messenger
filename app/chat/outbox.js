function draftKey({ body, attachmentIds = [], replyTo = null }) {
  return JSON.stringify([body, [...attachmentIds].sort((a, b) => a - b), replyTo]);
}

/**
 * Holds the request ID of the draft being sent.
 *
 * Sending the same text, attachments and reply again reuses the ID, so after a
 * lost response the server returns the message it already stored instead of a
 * duplicate. Any change to the draft gets a new ID, and confirmed() clears it.
 *
 * @param {() => string} newId Generates a 32-character hex ID.
 */
export function createOutbox(newId) {
  let pending = null;

  return {
    requestIdFor(draft) {
      const key = draftKey(draft);
      if (pending && pending.key === key) return pending.id;
      pending = { key, id: newId() };
      return pending.id;
    },
    confirmed() {
      pending = null;
    },
    hasPending() {
      return pending !== null;
    },
  };
}
