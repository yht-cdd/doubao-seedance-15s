// background.js - Chrome 扩展后台服务（MV3 Service Worker）
// 负责去水印规则管理和扩展生命周期

const PLUGIN_ID = 'doubao-seedance-enhancer';

chrome.runtime.onInstalled.addListener(() => {
  console.log(`[${PLUGIN_ID}] 扩展已安装/更新，去水印规则已加载`);

  // 初始化默认配置
  chrome.storage.local.get(['doubao-seedance-enhancer_enabled', 'doubao-seedance-enhancer_duration'], (res) => {
    if (res['doubao-seedance-enhancer_enabled'] === undefined) {
      chrome.storage.local.set({ 'doubao-seedance-enhancer_enabled': 'on' });
    }
    if (res['doubao-seedance-enhancer_duration'] === undefined) {
      chrome.storage.local.set({ 'doubao-seedance-enhancer_duration': '15s' });
    }
  });
});

// 监听来自 content.js 和 popup.js 的消息
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'get-status') {
    chrome.storage.local.get(['doubao-seedance-enhancer_enabled', 'doubao-seedance-enhancer_duration'], (res) => {
      sendResponse({
        enabled: res['doubao-seedance-enhancer_enabled'] !== 'off',
        duration: res['doubao-seedance-enhancer_duration'] || '15s'
      });
    });
    return true;
  }

  if (msg.type === 'toggle-enabled') {
    const newState = msg.enabled ? 'on' : 'off';
    chrome.storage.local.set({ 'doubao-seedance-enhancer_enabled': newState });
    console.log(`[${PLUGIN_ID}] 插件${msg.enabled ? '启用' : '禁用'}`);
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === 'set-duration') {
    chrome.storage.local.set({ 'doubao-seedance-enhancer_duration': msg.duration });
    console.log(`[${PLUGIN_ID}] 时长设置为: ${msg.duration}`);
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === 'download-video' && msg.url) {
    chrome.downloads.download({
      url: msg.url,
      filename: 'doubao_15s_uw_' + Date.now() + '.mp4',
      saveAs: false
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error(`[${PLUGIN_ID}] 下载失败:`, chrome.runtime.lastError.message);
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
      } else {
        console.log(`[${PLUGIN_ID}] 下载已开始, ID: ${downloadId}`);
        sendResponse({ ok: true, downloadId: downloadId });
      }
    });
    return true;
  }
});
