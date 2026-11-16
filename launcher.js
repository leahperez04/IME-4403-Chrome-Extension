const button = document.getElementById('open-dropdown');
const result = document.getElementById('result');
if (!globalThis.chrome?.runtime?.id) {
  button.disabled = true;
  result.textContent = 'Load this folder as an unpacked extension at chrome://extensions, then click 4403 Project in Chrome’s toolbar.';
}
button.onclick = async () => {
  button.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({ target: 'background', command: 'openOnGoogle' });
    if (response?.error) throw new Error(response.error);
    result.textContent = 'The dropdown is open over Google. Use the toolbar icon to reopen it on any tab.';
  } catch (error) {
    result.textContent = `Could not open the dropdown: ${error.message}. Reload 4403 Project at chrome://extensions, then click its toolbar icon.`;
  } finally { button.disabled = false; }
};
