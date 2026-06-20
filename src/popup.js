// popup.js - 弹窗控制逻辑（Chrome 版）

const PLUGIN_ID = 'doubao-seedance-enhancer';

document.addEventListener('DOMContentLoaded', () => {
  const toggleEnabled = document.getElementById('toggle-enabled');
  const statusBar = document.getElementById('status-bar');
  const statusText = document.getElementById('status-text');
  const durationBtns = document.querySelectorAll('.duration-btn');

  // 加载当前状态
  chrome.runtime.sendMessage({ type: 'get-status' }, (res) => {
    if (res) {
      toggleEnabled.checked = res.enabled;
      updateStatusUI(res.enabled);

      // 设置当前时长按钮
      durationBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.duration === res.duration);
      });
    }
  });

  // 切换启用/禁用
  toggleEnabled.addEventListener('change', () => {
    const enabled = toggleEnabled.checked;
    chrome.runtime.sendMessage({ type: 'toggle-enabled', enabled });
    updateStatusUI(enabled);

    // 通知 content.js 刷新
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'dbx-seed-toggle' }).catch(() => {});
      }
    });
  });

  // 时长选择
  durationBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const duration = btn.dataset.duration;
      chrome.runtime.sendMessage({ type: 'set-duration', duration });

      durationBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // 通知 content.js 刷新
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
          chrome.tabs.sendMessage(tabs[0].id, { type: 'dbx-seed-toggle' }).catch(() => {});
        }
      });
    });
  });

  function updateStatusUI(enabled) {
    statusBar.className = `status-bar ${enabled ? 'active' : 'inactive'}`;
    statusText.textContent = enabled ? '插件运行中' : '插件已禁用';
  }
});
