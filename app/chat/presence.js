// The other person polls every 4 seconds while the chat is open, so 15 seconds
// allows for a few slow polls before they count as away.
export const PRESENT_WITHIN_SECONDS = 15;

/**
 * The header dot's tone and label: connecting, error when polling fails,
 * together when the other person polled recently, otherwise alone.
 */
export function presenceState(pollStatus, presence) {
  if (pollStatus === 'error') {
    return { tone: 'error', label: 'Connection issue' };
  }
  if (pollStatus !== 'live') {
    return { tone: 'connecting', label: 'Connecting...' };
  }
  const age = presence ? presence.other_age_seconds : null;
  if (age !== null && age !== undefined && age <= PRESENT_WITHIN_SECONDS) {
    return { tone: 'together', label: 'Both here' };
  }
  return { tone: 'alone', label: 'Connected' };
}
