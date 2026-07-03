// content.js - 内容脚本（Chrome 版）
// 注入 15s 菜单项，验证/重新安装 fetch hook，监听媒体元素

(function () {
  'use strict';

  const PLUGIN_ID = 'doubao-seedance-enhancer';
  let isEnabled = true;
  let targetDuration = 15;

  console.log(`[${PLUGIN_ID}] content.js 已加载`);

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

  // ========== 5. 媒体 URL 监听 ==========
  function extractMediaFromResponse(data) {
    try {
      const str = JSON.stringify(data);
      const imgMatches = str.match(/https?:\/\/[^"]*byteimg\.com[^"]*\.(?:jpg|jpeg|png|webp)/g);
      if (imgMatches) {
        imgMatches.forEach(url => {
          // stored for potential use
        });
      }
    } catch (e) {}
  }

  // ========== 6. 监听来自 popup 的消息 ==========
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'dbx-seed-toggle') {
      syncDurationConfig();
      reinstallFetchHook();
      sendResponse({ ok: true });
    }
    return true;
  });

  console.log(`[${PLUGIN_ID}] content.js 初始化完成`);
})();
