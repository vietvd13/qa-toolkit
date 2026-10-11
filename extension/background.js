// Bấm icon extension → mở bộ công cụ (nếu đã mở thì chuyển tới tab đó)
chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL('hub.html');
  const [tab] = await chrome.tabs.query({ url: url + '*' });
  if (tab) {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
});
