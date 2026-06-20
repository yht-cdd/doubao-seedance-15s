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
      targetDuration = parseInt(durationStr) || 15;

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
  // 这是关键的后备机制：即使 inject.js 的 hook 被页面覆盖，
  // content.js 也可以通过注入 script 标签重新安装 hook
  function reinstallFetchHook() {
    const dur = targetDuration;
    const script = document.createElement('script');

    // 使用 Function 构造器避免模板字面量转义地狱
    // 传入 duration 和 plugin ID 作为参数
    script.textContent = '(' + function(dur, pluginId) {
      var realFetch = window.__doubao_real_fetch || window.fetch;

      // 检查当前 fetch 是否已经被 defineProperty 保护（即 hook 仍在）
      try {
        var desc = Object.getOwnPropertyDescriptor(window, 'fetch');
        if (desc && !desc.configurable && !desc.writable) {
          console.log('[' + pluginId + '-REHOOK] fetch hook 仍然活跃，跳过重装');
          return;
        }
      } catch(e) {}

      // hook 不在了，重新安装
      var hookedFetch = function() {
        var args = Array.from(arguments);
        try {
          var input = args[0];
          var init = args[1] || {};
          var url = typeof input === 'string' ? input : (input && input.url);
          if (url && url.indexOf('/chat/completion') !== -1 && init && init.body) {
            if (typeof init.body === 'string' && init.body.indexOf('ability_param') !== -1) {
              console.log('[' + pluginId + '-REHOOK] 捕获到请求');
              // 正确的正则：反斜杠在引号之前（\"duration\":10）
              // 匹配 \"duration\":10, "duration":10, \\"duration\\":10 等
              var origBody = init.body;
              args[1].body = init.body.replace(
                /(\\*)"duration(\\*)"\s*:\s*(\d+)/g,
                function(m, l, r, n) { return l + '"duration' + r + '":' + dur; }
              );
              if (args[1].body !== origBody) {
                console.log('[' + pluginId + '-REHOOK] ✓ 修改 duration -> ' + dur + 's');
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
  // 页面可能在任意时刻覆盖 fetch，所以定期检查
  let hookCheckCount = 0;
  const MAX_HOOK_CHECKS = 60; // 检查 60 次（30 秒）
  let hookVerified = false;

  function checkAndReinstallHook() {
    hookCheckCount++;
    if (hookCheckCount > MAX_HOOK_CHECKS && hookVerified) {
      // 超过 30 秒且已确认 hook 活跃，停止检查
      return;
    }

    // 通过 postMessage 查询 inject.js 的 hook 状态
    window.postMessage({ type: 'seedance_check_hook' }, '*');
  }

  // 监听 inject.js 的 hook 状态回复
  window.addEventListener('message', (e) => {
    if (e.data?.type === 'seedance_hook_status') {
      if (e.data.active) {
        hookVerified = true;
        // hook 活跃，减少检查频率
      } else {
        console.log(`[${PLUGIN_ID}] 检测到 hook 不活跃，重新安装...`);
        reinstallFetchHook();
      }
    }
  });

  // 启动定期检查（前 30 秒每 500ms 检查一次）
  const hookChecker = setInterval(() => {
    if (hookCheckCount >= MAX_HOOK_CHECKS) {
      clearInterval(hookChecker);
      // 之后每 5 秒检查一次（低频）
      setInterval(checkAndReinstallHook, 5000);
      return;
    }
    checkAndReinstallHook();
  }, 500);

  // 首次安装：等一小段时间让 inject.js 先执行，然后验证
  setTimeout(reinstallFetchHook, 100);

  // 监听页面导航（SPA 路由变化），重新安装 hook
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

  // ========== 4. 注入 15s 菜单项 ==========
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

    if (!durationMenu) return;
    if (durationMenu.querySelector('.seedance-15s-injected')) return;

    const items = durationMenu.querySelectorAll('[role="menuitem"]');
    let template = null;
    for (const item of items) {
      if (item.textContent.trim() === '10s') {
        template = item;
        break;
      }
    }
    if (!template) return;

    const option15s = template.cloneNode(true);
    option15s.classList.add('seedance-15s-injected');

    const walker = document.createTreeWalker(option15s, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      if (walker.currentNode.textContent.trim() === '10s') {
        walker.currentNode.textContent = '15s';
        break;
      }
    }

    const svgs = option15s.querySelectorAll('svg');
    svgs.forEach(svg => {
      const parent = svg.parentElement;
      if (parent && parent.children.length === 1) {
        parent.remove();
      }
    });

    option15s.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();

      const allItems = durationMenu.querySelectorAll('[role="menuitem"]');
      for (const item of allItems) {
        if (item.textContent.trim() === '10s') {
          item.click();
          break;
        }
      }

      chrome.storage.local.set({ 'doubao-seedance-enhancer_duration': '15s' });
      console.log(`[${PLUGIN_ID}] 用户选择 15s，将在请求时修改 duration`);
    });

    durationMenu.appendChild(option15s);
    console.log(`[${PLUGIN_ID}] ✓ 15s 选项已注入菜单`);
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
