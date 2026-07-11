// content.js - 内容脚本（Chrome 版）
// 注入 15s 菜单项，验证/重新安装 fetch hook，监听媒体元素

(function () {
  'use strict';

  const PLUGIN_ID = 'doubao-seedance-enhancer';
  let isEnabled = true;
  let targetDuration = 15;

  console.log(`[${PLUGIN_ID}] content.js 已加载 (v7.7.1)`);

  // ========== 1. 同步时长配置到 inject.js ==========
  function syncDurationConfig() {
    chrome.storage.local.get(['doubao-seedance-enhancer_enabled', 'doubao-seedance-enhancer_duration'], (res) => {
      isEnabled = res['doubao-seedance-enhancer_enabled'] !== 'off';
      const durationStr = res['doubao-seedance-enhancer_duration'] || '15s';
      const newDuration = parseInt(durationStr) || 15;

      // 从 15s 切换到其他时长时，清除按钮 patch
      if (targetDuration === 15 && newDuration !== 15) {
        clearDurationButtonPatch();
      }

      targetDuration = newDuration;

      window.postMessage({
        type: 'seedance_set_duration',
        payload: { duration: targetDuration, enabled: isEnabled }
      }, '*');
    });
  }
  syncDurationConfig();

  chrome.storage.onChanged.addListener((changes) => {
    if (changes['doubao-seedance-enhancer_enabled']) {
      isEnabled = changes['doubao-seedance-enhancer_enabled'].newValue !== 'off';
      syncDurationConfig();
    }
    if (changes['doubao-seedance-enhancer_duration']) {
      syncDurationConfig();
    }
  });

  // ========== 2. 重新安装 fetch hook（注入 script 标签到 MAIN 世界） ==========
  function reinstallFetchHook() {
    const dur = targetDuration;
    const script = document.createElement('script');

    script.textContent = '(' + function(dur, pluginId) {
      var realFetch = window.__doubao_real_fetch || window.fetch;

      try {
        var desc = Object.getOwnPropertyDescriptor(window, 'fetch');
        if (desc && !desc.configurable && !desc.writable) {
          console.log('[' + pluginId + '-REHOOK] fetch hook 仍然活跃，跳过重装');
          return;
        }
      } catch(e) {}

      var hookedFetch = function() {
        var args = Array.from(arguments);
        try {
          var input = args[0];
          var init = args[1] || {};
          var url = typeof input === 'string' ? input : (input && input.url);
          if (url && url.indexOf('/chat/completion') !== -1 && init && init.body) {
            if (typeof init.body === 'string' && init.body.indexOf('ability_param') !== -1) {
              console.log('[' + pluginId + '-REHOOK] 捕获到请求');
              var origBody = init.body;
              args[1].body = init.body.replace(
                /(\\*)"duration(\\*)"\s*:\s*(\d+)/g,
                function(m, l, r, n) { return l + '"duration' + r + '":' + dur; }
              );
              if (args[1].body !== origBody) {
                console.log('[' + pluginId + '-REHOOK] 修改 duration -> ' + dur + 's');
              } else {
                console.log('[' + pluginId + '-REHOOK] 未匹配到 duration 格式');
              }
            }
          }
        } catch(e) {
          console.warn('[' + pluginId + '-REHOOK] 修改失败:', e);
        }
        return realFetch.apply(this, args);
      };
      hookedFetch.toString = function() { return realFetch.toString(); };
      hookedFetch.name = 'fetch';

      try {
        Object.defineProperty(window, 'fetch', {
          value: hookedFetch, writable: false, configurable: false, enumerable: true
        });
        console.log('[' + pluginId + '-REHOOK] fetch hook 已重新安装 (defineProperty)');
      } catch(e) {
        window.fetch = hookedFetch;
        console.log('[' + pluginId + '-REHOOK] fetch hook 已重新安装 (赋值)');
      }
    } + ')(' + dur + ',"' + PLUGIN_ID + '");';

    (document.head || document.documentElement).appendChild(script);
    script.remove();
  }

  // ========== 3. 定期验证 hook 状态 ==========
  let hookCheckCount = 0;
  const MAX_HOOK_CHECKS = 60;
  let hookVerified = false;

  function checkAndReinstallHook() {
    hookCheckCount++;
    if (hookCheckCount > MAX_HOOK_CHECKS && hookVerified) {
      return;
    }
    window.postMessage({ type: 'seedance_check_hook' }, '*');
  }

  window.addEventListener('message', (e) => {
    if (e.data?.type === 'seedance_hook_status') {
      if (e.data.active) {
        hookVerified = true;
      } else {
        console.log(`[${PLUGIN_ID}] 检测到 hook 不活跃，重新安装...`);
        reinstallFetchHook();
      }
    }
    // 接收 inject.js 提取的无水印 URL 并存入 chrome.storage
    if (e.data?.type === 'seedance_urls_extracted' && e.data.urls) {
      var urls = e.data.urls;
      var keys = Object.keys(urls);
      if (keys.length > 0) {
        chrome.storage.local.get(['seedance_extracted_urls'], (res) => {
          var existing = res.seedance_extracted_urls || {};
          // 合并新 URL，添加时间戳
          for (var k of keys) {
            existing[Date.now() + '_' + k] = {
              url: urls[k],
              key: k,
              time: new Date().toLocaleString(),
              site: location.hostname
            };
          }
          // 只保留最近 50 条
          var allKeys = Object.keys(existing);
          if (allKeys.length > 50) {
            allKeys.sort((a, b) => parseInt(b) - parseInt(a));
            var trimmed = {};
            for (var i = 0; i < 50; i++) trimmed[allKeys[i]] = existing[allKeys[i]];
            existing = trimmed;
          }
          chrome.storage.local.set({ seedance_extracted_urls: existing });
          console.log(`[${PLUGIN_ID}] 已存储 ${keys.length} 个无水印 URL`);
        });
      }
    }
  });

  const hookChecker = setInterval(() => {
    if (hookCheckCount >= MAX_HOOK_CHECKS) {
      clearInterval(hookChecker);
      setInterval(checkAndReinstallHook, 5000);
      return;
    }
    checkAndReinstallHook();
  }, 500);

  setTimeout(reinstallFetchHook, 100);

  // 水印替换逻辑已移到 inject.js（MAIN 世界直接执行），无需从 ISOLATED 世界注入

  // 监听页面导航（SPA 路由变化）
  let lastUrl = location.href;
  const urlObserver = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      console.log(`[${PLUGIN_ID}] 检测到页面导航，重新安装 hook`);
      setTimeout(reinstallFetchHook, 500);
    }
  });
  if (document.body) {
    urlObserver.observe(document.body, { childList: true, subtree: true });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      urlObserver.observe(document.body, { childList: true, subtree: true });
    });
  }

  // ========== 4. 注入 15s 菜单项 + 维护 UI 显示 ==========
  function inject15sOption() {
    if (!isEnabled) return;

    const menus = document.querySelectorAll('[role="menu"]');
    let durationMenu = null;

    for (const menu of menus) {
      const items = menu.querySelectorAll('[role="menuitem"]');
      const texts = Array.from(items).map(i => i.textContent.trim());
      if (texts.includes('5s') && texts.includes('10s')) {
        durationMenu = menu;
        break;
      }
    }

    if (!durationMenu) {
      patchDurationButton();
      return;
    }

    const menuItems = durationMenu.querySelectorAll('[role="menuitem"]');

    // 给原生选项绑定点击监听器（只绑定一次）
    menuItems.forEach(item => {
      const text = item.textContent.trim();
      if (text === '5s' || text === '10s') {
        if (item.dataset.seedanceNativeBound) return;
        item.dataset.seedanceNativeBound = 'true';
        item.addEventListener('click', () => {
          const d = text;
          chrome.storage.local.set({ 'doubao-seedance-enhancer_duration': d });
          targetDuration = parseInt(d) || 10;
          console.log(`[${PLUGIN_ID}] 用户选择原生 ${d}`);
          clearDurationButtonPatch();
        });
      }
    });

    if (durationMenu.querySelector('.seedance-15s-injected')) {
      syncMenuCheckmark(durationMenu);
      patchDurationButton();
      return;
    }

    let template = null;
    for (const item of menuItems) {
      if (item.textContent.trim() === '10s') {
        template = item;
        break;
      }
    }
    if (!template) {
      patchDurationButton();
      return;
    }

    const option15s = template.cloneNode(true);
    option15s.classList.add('seedance-15s-injected');

    const walker = document.createTreeWalker(option15s, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      if (walker.currentNode.textContent.trim() === '10s') {
        walker.currentNode.textContent = '15s';
        break;
      }
    }

    // 只移除 svg 勾选标记本身，保留父容器结构
    option15s.querySelectorAll('svg').forEach(svg => svg.remove());

    option15s.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();

      for (const item of menuItems) {
        if (item.textContent.trim() === '10s') {
          item.click();
          break;
        }
      }

      chrome.storage.local.set({ 'doubao-seedance-enhancer_duration': '15s' });
      targetDuration = 15;
      console.log(`[${PLUGIN_ID}] 用户选择 15s，将在请求时修改 duration`);
      patchDurationButton();
    });

    durationMenu.appendChild(option15s);
    console.log(`[${PLUGIN_ID}] 15s 选项已注入菜单`);
    syncMenuCheckmark(durationMenu);
    patchDurationButton();
  }

  // 同步菜单勾选：如果设置是15s，勾选打在15s上
  function syncMenuCheckmark(menu) {
    if (targetDuration !== 15) return;

    const items = menu.querySelectorAll('[role="menuitem"]');
    let item10s = null;
    let item15s = null;

    for (const item of items) {
      const text = item.textContent.trim();
      if (text === '10s') item10s = item;
      if (text === '15s') item15s = item;
    }

    if (!item10s || !item15s) return;

    const check10s = item10s.querySelector('svg');
    const check15s = item15s.querySelector('svg');

    if (check10s && !check15s) {
      function getPath(el, root) {
        const path = [];
        while (el && el !== root) {
          const parent = el.parentElement;
          if (!parent) break;
          const index = Array.from(parent.children).indexOf(el);
          path.unshift(index);
          el = parent;
        }
        return path;
      }

      function getElByPath(root, path) {
        let el = root;
        for (const idx of path) {
          if (!el.children[idx]) return null;
          el = el.children[idx];
        }
        return el;
      }

      const svgPath = getPath(check10s, item10s);
      if (svgPath.length >= 2) {
        const targetParent = getElByPath(item15s, svgPath.slice(0, -1));
        if (targetParent) {
          targetParent.appendChild(check10s.cloneNode(true));
          check10s.remove();
          console.log(`[${PLUGIN_ID}] 勾选已同步到 15s`);
          return;
        }
      }

      item15s.appendChild(check10s.cloneNode(true));
      check10s.remove();
      console.log(`[${PLUGIN_ID}] 勾选已同步到 15s (兜底)`);
    }
  }

  // 修正时长按钮显示（菜单关闭后的按钮文字）
  function patchDurationButton() {
    if (targetDuration !== 15) return;
    if (!document.body) return;

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        if (node.textContent.trim() === '10s') return NodeFilter.FILTER_ACCEPT;
        return NodeFilter.FILTER_REJECT;
      }
    });

    let node;
    while ((node = walker.nextNode())) {
      const el = node.parentElement;
      if (!el) continue;
      if (el.closest('[role="menu"]') || el.closest('[role="menuitem"]')) continue;
      if (el.dataset.seedancePatched === '15s') continue;

      node.textContent = '15s';
      el.dataset.seedancePatched = '15s';
      console.log(`[${PLUGIN_ID}] 按钮文字已修正为 15s`);
    }
  }

  // 清除按钮 patch 标记（切换回非15s时调用）
  function clearDurationButtonPatch() {
    document.querySelectorAll('[data-seedance-patched="15s"]').forEach(el => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
      while (walker.nextNode()) {
        if (walker.currentNode.textContent.trim() === '15s') {
          walker.currentNode.textContent = '10s';
          break;
        }
      }
      delete el.dataset.seedancePatched;
    });
  }

  const domObserver = new MutationObserver(() => {
    if (isEnabled) inject15sOption();
  });
  domObserver.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  setTimeout(inject15sOption, 2000);

  // ========== 5. 媒体 URL 监听 & 下载功能 ==========
  const DOWNLOAD_CDN_PATTERNS = [
    'byteimg.com', 'ibyteimg.com', 'tiktokcdn.com', 'ciciai.com', 'douyin.com'
  ];

  function isGeneratedImageUrl(url) {
    if (!url) return false;
    return DOWNLOAD_CDN_PATTERNS.some(pattern => url.includes(pattern));
  }

  function getRawImageUrl(imgEl) {
    // data-seedance-raw 由 inject.js (MAIN 世界) 设置
    if (imgEl.dataset.seedanceRaw) return imgEl.dataset.seedanceRaw;
    const src = imgEl.src || imgEl.currentSrc;
    if (!src) return src;
    return src;
  }

  function addDownloadButton(imgEl) {
    if (imgEl.dataset.seedanceDlBtn) return;
    imgEl.dataset.seedanceDlBtn = 'attached';

    imgEl.style.position = 'relative';
    const parent = imgEl.parentElement;
    if (!parent) return;
    if (parent.querySelector('.seedance-dl-btn')) return;

    const btn = document.createElement('div');
    btn.className = 'seedance-dl-btn';
    btn.innerHTML = '⬇';
    Object.assign(btn.style, {
      position: 'absolute', bottom: '8px', right: '8px', zIndex: '9999',
      width: '32px', height: '32px', borderRadius: '50%',
      background: 'rgba(0,0,0,0.6)', color: '#fff', cursor: 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: '16px', opacity: '0', transition: 'opacity 0.2s',
      userSelect: 'none'
    });

    parent.style.position = 'relative';
    parent.addEventListener('mouseenter', () => btn.style.opacity = '1');
    parent.addEventListener('mouseleave', () => btn.style.opacity = '0');

    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      btn.innerHTML = '⏳';
      try {
        const imgUrl = getRawImageUrl(imgEl);
        if (!imgUrl) return;

        const resp = await fetch(imgUrl, { mode: 'cors' });
        const blob = await resp.blob();
        const ext = blob.type.split('/')[1] || 'png';
        const filename = `dola-image-${Date.now()}.${ext}`;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        btn.innerHTML = '✓';
        setTimeout(() => { btn.innerHTML = '⬇'; }, 1500);
      } catch (err) {
        console.error(`[${PLUGIN_ID}] 下载失败:`, err);
        btn.innerHTML = '✗';
        setTimeout(() => { btn.innerHTML = '⬇'; }, 2000);
      }
    });

    parent.appendChild(btn);
  }

  // ========== 视频下载按钮 ==========
  function getRawVideoUrl(videoEl) {
    if (videoEl.dataset.seedanceRaw) return videoEl.dataset.seedanceRaw;
    const src = videoEl.src || videoEl.currentSrc;
    return src || null;
  }

  function addVideoDownloadButton(videoEl) {
    if (videoEl.dataset.seedanceDlBtn) return;
    videoEl.dataset.seedanceDlBtn = 'attached';

    const target = videoEl.closest('[class*="video-player-wrapper"]') || videoEl.parentElement;
    if (target.querySelector('.seedance-dl-btn-video')) return;

    const btn = document.createElement('div');
    btn.className = 'seedance-dl-btn-video';
    btn.innerHTML = '⬇';
    Object.assign(btn.style, {
      position: 'absolute', bottom: '8px', right: '8px', zIndex: '9999',
      width: '32px', height: '32px', borderRadius: '50%',
      background: 'rgba(0,0,0,0.6)', color: '#fff', cursor: 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: '16px', opacity: '0', transition: 'opacity 0.2s',
      userSelect: 'none'
    });

    target.style.position = 'relative';
    target.addEventListener('mouseenter', () => btn.style.opacity = '1');
    target.addEventListener('mouseleave', () => btn.style.opacity = '0');

    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      btn.innerHTML = '⏳';
      try {
        const videoUrl = getRawVideoUrl(videoEl);
        if (!videoUrl) return;

        const resp = await fetch(videoUrl, { mode: 'cors' });
        const blob = await resp.blob();
        const ext = blob.type.split('/')[1] || 'mp4';
        const filename = `dola-video-${Date.now()}.${ext}`;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        btn.innerHTML = '✓';
        setTimeout(() => { btn.innerHTML = '⬇'; }, 1500);
      } catch (err) {
        console.error(`[${PLUGIN_ID}] 视频下载失败:`, err);
        btn.innerHTML = '✗';
        setTimeout(() => { btn.innerHTML = '⬇'; }, 2000);
      }
    });

    target.appendChild(btn);
  }

  function scanForGeneratedVideos() {
    const videos = document.querySelectorAll('video');
    videos.forEach(v => {
      const src = v.src || v.currentSrc;
      if (src && src.indexOf('dola.com') >= 0 && v.readyState >= 2) {
        addVideoDownloadButton(v);
      }
    });
  }
  function scanForGeneratedImages() {
    const imgs = document.querySelectorAll('img');
    imgs.forEach(img => {
      const src = img.src || img.currentSrc;
      if (isGeneratedImageUrl(src)) {
        if (img.complete && img.naturalWidth > 100) {
          addDownloadButton(img);
        } else if (!img.dataset.seedanceDlLoading) {
          img.dataset.seedanceDlLoading = '1';
          img.addEventListener('load', () => {
            if (img.naturalWidth > 100 && img.naturalHeight > 100) {
              addDownloadButton(img);
            }
          });
        }
      }
    });
    scanForGeneratedVideos();
  }

  // 下载按钮样式注入
  const dlStyle = document.createElement('style');
  dlStyle.textContent = `
    .seedance-dl-btn:hover { background: rgba(0,87,255,0.8) !important; opacity: 1 !important; }
    .seedance-dl-btn:active { transform: scale(0.9); }
    .seedance-dl-btn-video { all: unset; }
    .seedance-dl-btn-video:hover { background: rgba(0,87,255,0.8) !important; opacity: 1 !important; }
    .seedance-dl-btn-video:active { transform: scale(0.9); }
  `;
  (document.head || document.documentElement).appendChild(dlStyle);

  // 扩展 MutationObserver 以检测新图片
  const originalObserve = domObserver.observe.bind(domObserver);
  let dlCheckTimer = null;
  const dlObserver = new MutationObserver(() => {
    clearTimeout(dlCheckTimer);
    dlCheckTimer = setTimeout(scanForGeneratedImages, 500);
  });
  dlObserver.observe(document.documentElement, { childList: true, subtree: true, attributes: false });

  setTimeout(scanForGeneratedImages, 3000);

  // ========== 6. 监听来自 inject.js 和 popup 的下载请求 ==========
  window.addEventListener('message', (e) => {
    if (e.data?.type === 'seedance_download_video' && e.data.url) {
      console.log(`[${PLUGIN_ID}] 收到下载请求: ${e.data.url.substring(0, 80)}`);
      downloadWithHeaders(e.data.url);
    }
  });

  // 下载函数（带 Referer 头）
  async function downloadWithHeaders(url) {
    try {
      const resp = await fetch(url, {
        headers: { 'Referer': 'https://www.doubao.com/' }
      });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const blob = await resp.blob();
      const ext = blob.type.includes('mp4') ? 'mp4' : (blob.type.includes('png') ? 'png' : 'mp4');
      const filename = 'doubao_uw_' + Date.now() + '.' + ext;
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl; a.download = filename;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
      console.log(`[${PLUGIN_ID}] 下载完成: ${filename}`);
    } catch(e) {
      console.error(`[${PLUGIN_ID}] 下载失败:`, e.message);
    }
  }

  // ========== 7. 监听来自 popup 的消息 ==========
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'dbx-seed-toggle') {
      syncDurationConfig();
      reinstallFetchHook();
      sendResponse({ ok: true });
    }
    // Thread 页面解析
    if (msg.type === 'parse-thread') {
      console.log(`[${PLUGIN_ID}] 收到 thread 解析请求`);
      window.postMessage({ type: 'seedance_parse_thread' }, '*');
      const handler = (e) => {
        if (e.data?.type === 'seedance_thread_parsed') {
          window.removeEventListener('message', handler);
          if (e.data.data && e.data.data.results && e.data.data.results.length > 0) {
            sendResponse({ ok: true, count: e.data.data.results.length });
          } else if (e.data.error) {
            sendResponse({ ok: false, error: '解析异常: ' + e.data.error });
          } else {
            sendResponse({ ok: false, error: '未找到视频数据' });
          }
        }
      };
      window.addEventListener('message', handler);
      setTimeout(() => {
        window.removeEventListener('message', handler);
        sendResponse({ ok: false, error: '超时' });
      }, 10000);
      return true;
    }
    // 下载视频（带 Referer 头）
    if (msg.type === 'download-video' && msg.url) {
      console.log(`[${PLUGIN_ID}] 收到 popup 下载请求: ${msg.url.substring(0, 80)}`);
      downloadWithHeaders(msg.url).then(() => {
        sendResponse({ ok: true });
      }).catch((e) => {
        sendResponse({ ok: false, error: e.message });
      });
      return true;
    }
    return true;
  });

  console.log(`[${PLUGIN_ID}] content.js 初始化完成`);
})();
