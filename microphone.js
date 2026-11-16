// Temporary permission holder only. The offscreen document owns the actual recorder.
let requesting = false;
async function authorizeAndStart() {
  if (requesting) return;
  const result = document.getElementById('result');
  const button = document.getElementById('allow');
  const id = new URLSearchParams(location.search).get('id');
  if (!id) { result.textContent = 'Open the extension and click Start recording to request microphone access.'; return; }
  requesting = true; button.hidden = true;
  let permissionStream, started = false;
  try {
    result.textContent = 'Approve Chrome’s microphone prompt to start background recording…';
    permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    // Keep this stream alive until the hidden recorder has acquired its OWN stream.
    // This preserves a one-time microphone grant during the handoff.
    result.textContent = 'Starting the background recorder…';
    const response = await chrome.runtime.sendMessage({ target: 'background', command: 'finishMicrophoneSetup', id });
    if (!response || response.error) throw new Error(response?.error || 'Background recorder did not respond.');
    if (!response.state?.active) throw new Error('Recording did not start. Return to the extension and create a new conversation if this one already has saved audio.');
    started = true;
    result.textContent = 'Recording in the background. You can switch tabs. This window is closing.';
  } catch (error) {
    result.textContent = ['NotAllowedError', 'PermissionDeniedError'].includes(error.name)
      ? 'Microphone access was not granted. Allow it in Chrome’s site controls and your computer’s privacy settings, then retry.'
      : `Could not start background recording: ${error.message}`;
    button.hidden = false;
  } finally {
    permissionStream?.getTracks().forEach(track => track.stop());
    requesting = false;
  }
  if (started) setTimeout(() => window.close(), 500);
}
document.getElementById('allow').onclick = authorizeAndStart;
authorizeAndStart();
