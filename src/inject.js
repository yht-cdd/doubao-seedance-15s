// inject.js - MAIN 世界脚本（Chrome 版）
// 在页面所有脚本之前运行，劫持 fetch/XHR 修改视频生成 duration 参数
// 使用 Object.defineProperty + Proxy 防止页面脚本覆盖 hook

(function () {
  'use strict';

  const PLUGIN_ID = 'doubao-seedance-enhancer';
  let targetDuration = 15;
  let hookActive = false;

  console.log(`[${PLUGIN_ID}] inject.js MAIN 世界已加载`);

  // 监听来自 content.js 的时长配置消息
  window.addEventListener('message', (e) => {
    if (e.data?.type === 'seedance_set_duration') {
      targetDuration = e.data.payload.duration;
      console.log(`[${PLUGIN_ID}] 时长更新: ${targetDuration}s`);
    }
    // content.js 查询 hook 状态
    if (e.data?.type === 'seedance_check_hook') {
      window.postMessage({ type: 'seedance_hook_status', active: hookActive }, '*');
    }
  });

  // ========== 修改请求体中的 duration ==========
  function modifyBody(bodyStr) {
    if (!bodyStr.includes('ability_param')) return bodyStr;

    const idx = bodyStr.indexOf('ability_param');
    const snippet = bodyStr.substring(idx, idx + 300);
    console.log(`[${PLUGIN_ID}] ability_param 片段:`, snippet);

    // 正确匹配格式：[反斜杠]"duration[反斜杠]":数字
    // 在实际请求体中，转义引号是 \"duration\":10
    // 反斜杠在引号之前，不是在引号之间
    // (\\*) 匹配0个或多个反斜杠
    // 注意："duration" 中的引号属于匹配模式，后面的 (\\*)" 是转义的闭合引号
    const regex = /(\\*)"duration(\\*)"\s*:\s*(\d+)/g;
    let matched = false;
    const result = bodyStr.replace(regex, (match, leftBS, rightBS, num) => {
      matched = true;
      // 保留原始的反斜杠数量
      const replacement = `${leftBS}"duration${rightBS}":${targetDuration}`;
      console.log(`[${PLUGIN_ID}] 匹配到: "${match}" -> "${replacement}"`);
      return replacement;
    });

    if (matched) {
      console.log(`[${PLUGIN_ID}] ✓ 修改 duration -> ${targetDuration}s`);
      return result;
    }

    // 兜底：匹配 ability_param 值中任意位置的 duration 后面的数字
    // 使用 [^] 跨行匹配，找到 duration 后面的 :数字 部分
    console.log(`[${PLUGIN_ID}] 主正则未匹配，尝试兜底...`);
    const fallback = bodyStr.replace(
      /(ability_param[\s\S]*?duration\\*"\s*:\s*)(\d+)/g,
      `$1${targetDuration}`
    );
    if (fallback !== bodyStr) {
      console.log(`[${PLUGIN_ID}] ✓ 兜底修改 duration -> ${targetDuration}s`);
      return fallback;
    }

    console.log(`[${PLUGIN_ID}] 所有匹配方式均失败`);
    return bodyStr;
  }

  // ========== 处理 ReadableStream ==========
  function processStreamBody(body) {
    const [cloneStream] = body.tee();
    const reader = cloneStream.getReader();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();

    return new Promise((resolve) => {
      let fullText = '';
      function readChunk() {
        reader.read().then(({ value, done }) => {
          if (done) {
            if (fullText.includes('ability_param')) {
              const modified = modifyBody(fullText);
              const stream = new ReadableStream({
                start(controller) {
                  controller.enqueue(encoder.encode(modified));
                  controller.close();
                }
              });
              console.log(`[${PLUGIN_ID}] ✓ ReadableStream 修改完成`);
              resolve(stream);
            } else {
              // 重建原始流
              const stream = new ReadableStream({
                start(controller) {
                  controller.enqueue(encoder.encode(fullText));
                  controller.close();
                }
              });
              resolve(stream);
            }
            return;
          }
          fullText += decoder.decode(value, { stream: true });
          readChunk();
        });
      }
      readChunk();
    });
  }

  // ========== 核心 fetch 拦截逻辑 ==========
  function interceptFetch(originalFetch, thisArg, args) {
    try {
      const input = args[0];
      const init = args[1] || {};
      const url = typeof input === 'string' ? input : input?.url;

      if (url && url.includes('/chat/completion')) {
        console.log(`[${PLUGIN_ID}] 捕获到 /chat/completion 请求`);
        if (init.body) {
          const bodyType = init.body?.constructor?.name || typeof init.body;
          console.log(`[${PLUGIN_ID}] body类型: ${bodyType}`);

          if (typeof init.body === 'string' && init.body.includes('ability_param')) {
            console.log(`[${PLUGIN_ID}] 拦截到包含 ability_param 的 fetch 请求`);
            args[1].body = modifyBody(init.body);
          } else if (init.body instanceof ReadableStream) {
            return processStreamBody(init.body).then(modifiedBody => {
              args[1].body = modifiedBody;
              return originalFetch.apply(thisArg, args);
            });
          }
        }
      }
    } catch (err) {
      console.warn(`[${PLUGIN_ID}] Fetch修改失败:`, err);
    }
    return originalFetch.apply(thisArg, args);
  }

  // ========== 安装 fetch hook (使用 Object.defineProperty 保护) ==========
  function installFetchHook() {
    try {
      // 保存真正的原始 fetch
      const realFetch = window.__doubao_real_fetch || window.fetch;
      window.__doubao_real_fetch = realFetch;

      // 创建代理 fetch 函数
      const hookedFetch = function () {
        const args = Array.from(arguments);
        return interceptFetch(realFetch, this, args);
      };
      // 保留 toString 行为
      hookedFetch.toString = function () { return realFetch.toString(); };

      // 使用 Object.defineProperty 防止页面覆盖
      Object.defineProperty(window, 'fetch', {
        value: hookedFetch,
        writable: false,
        configurable: false,
        enumerable: true
      });

      hookActive = true;
      console.log(`[${PLUGIN_ID}] fetch hook 已安装 (Object.defineProperty 保护)`);
    } catch (err) {
      console.error(`[${PLUGIN_ID}] fetch hook 安装失败:`, err);
      // 降级：直接赋值
      try {
        const realFetch = window.__doubao_real_fetch || window.fetch;
        window.__doubao_real_fetch = realFetch;
        window.fetch = function () {
          const args = Array.from(arguments);
          return interceptFetch(realFetch, this, args);
        };
        hookActive = true;
        console.log(`[${PLUGIN_ID}] fetch hook 已安装 (降级模式)`);
      } catch (err2) {
        console.error(`[${PLUGIN_ID}] fetch hook 降级安装也失败:`, err2);
      }
    }
  }

  // ========== 安装 XHR hook ==========
  function installXhrHook() {
    try {
      const originalXhrOpen = XMLHttpRequest.prototype.open;
      const originalXhrSend = XMLHttpRequest.prototype.send;

      XMLHttpRequest.prototype.open = function (method, url) {
        this._doubao_request_url = url;
        return originalXhrOpen.apply(this, arguments);
      };

      XMLHttpRequest.prototype.send = function (body) {
        try {
          if (this._doubao_request_url?.includes('/chat/completion')) {
            if (typeof body === 'string' && body.includes('ability_param')) {
              console.log(`[${PLUGIN_ID}] 拦截到包含 ability_param 的 XHR 请求`);
              arguments[0] = modifyBody(body);
            }
          }
        } catch (err) {
          console.warn(`[${PLUGIN_ID}] XHR修改失败:`, err);
        }
        return originalXhrSend.apply(this, arguments);
      };
      console.log(`[${PLUGIN_ID}] XHR hook 已安装`);
    } catch (err) {
      console.error(`[${PLUGIN_ID}] XHR hook 安装失败:`, err);
    }
  }

  // ========== 执行安装 ==========
  installFetchHook();
  installXhrHook();
  console.log(`[${PLUGIN_ID}] 所有 hook 已安装完成`);
})();
