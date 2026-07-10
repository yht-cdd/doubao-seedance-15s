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

    // 修改 duration 为 targetDuration
    const durationRegex = /(\\*)"duration(\\*)"\s*:\s*(\d+)/g;
    let matched = false;
    var result = bodyStr.replace(durationRegex, (match, leftBS, rightBS, num) => {
      matched = true;
      const replacement = `${leftBS}"duration${rightBS}":${targetDuration}`;
      console.log(`[${PLUGIN_ID}] duration: "${match}" -> "${replacement}"`);
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
              var modified = modifyBody(fullText);
              var stream = new ReadableStream({
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

      if (url && (url.includes('/chat/completion') || url.includes('/im/message/send_rate_limit') || url.includes('/im/chain/single'))) {
        console.log(`[${PLUGIN_ID}] 捕获到 API 请求: ${url.substring(0, 80)}`);
        if (init.body && url.includes('/chat/completion')) {
          const bodyType = init.body?.constructor?.name || typeof init.body;
          console.log(`[${PLUGIN_ID}] body类型: ${bodyType}`);

          // FormData/文件上传请求直接跳过，不拦截
          if (init.body instanceof FormData || init.body instanceof Blob || init.body instanceof ArrayBuffer) {
            console.log(`[${PLUGIN_ID}] 跳过文件上传请求 (${bodyType})`);
            return originalFetch.apply(thisArg, args);
          }

          if (typeof init.body === 'string' && init.body.includes('ability_param')) {
            console.log(`[${PLUGIN_ID}] 拦截到包含 ability_param 的 fetch 请求`);
            let modified = modifyBody(init.body);
            args[1].body = modified;
            return interceptResponse(originalFetch, thisArg, args);
          }
          // FormData/Blob/ReadableStream 等非 string body 直接透传，不读取不拦截
          if (typeof init.body !== 'string') {
            return originalFetch.apply(thisArg, args);
          }
        }
        return interceptResponse(originalFetch, thisArg, args);
      }
    } catch (err) {
      console.warn(`[${PLUGIN_ID}] Fetch修改失败:`, err);
    }
    return originalFetch.apply(thisArg, args);
  }

  // ========== 解析 SSE，提取原始媒体 URL 映射 ==========
  function extractRawUrlsFromSSE(sseText) {
    const events = sseText.split('\n\n');
    const urlMap = {};
    
    for (const event of events) {
      if (!event.includes('creation_block')) continue;
      
      const dataMatch = event.match(/data:\s*(\{.*)/);
      if (!dataMatch) continue;
      
      try {
        const data = JSON.parse(dataMatch[1]);
        const patchOps = data.patch_op || [];
        for (const op of patchOps) {
          const blocks = op.patch_value?.content_block || [];
          for (const block of blocks) {
            const creations = block.content?.creation_block?.creations || [];
            for (const creation of creations) {
              // 图片：image_thumb -> image_ori_raw
              const thumbUrl = creation.image?.image_thumb?.url;
              const rawUrl = creation.image?.image_ori_raw?.url;
              if (thumbUrl && rawUrl) {
                urlMap[thumbUrl] = rawUrl;
              }
              // 视频：video_thumb -> video_ori_raw
              const videoThumbUrl = creation.video?.video_thumb?.url;
              const videoRawUrl = creation.video?.video_ori_raw?.url;
              if (videoThumbUrl && videoRawUrl) {
                urlMap[videoThumbUrl] = videoRawUrl;
              }
            }
          }
        }
      } catch(e) {}
    }
    return urlMap;
  }

  // ========== 从 chain/single 响应中提取无水印视频 URL ==========
  function extractVideoUrlsFromChain(jsonText) {
    var urlMap = {};
    try {
      // 匹配 \"main_url\":\"BASE64\" 格式（单转义）
      var mainUrlRegex = /\\"main_url\\"\s*:\s*\\"([A-Za-z0-9+/=]{100,})\\"/g;
      var match;
      var idx = 0;
      while ((match = mainUrlRegex.exec(jsonText)) !== null) {
        try {
          var decoded = atob(match[1]);
          if (decoded.indexOf('unwatermarked') >= 0) {
            // 使用 __video_ 前缀作为 key，避免与图片 URL 冲突
            urlMap['__video_' + idx] = decoded;
            idx++;
          }
        } catch(e) {}
      }
    } catch(e) {}
    return urlMap;
  }

  // ========== 合并 URL 到种子地图（不覆盖已有条目） ==========
  function mergeUrlMap(newMap) {
    if (!newMap || typeof newMap !== 'object') return;
    if (!window.__seedance_raw_url_map) window.__seedance_raw_url_map = {};
    var keys = Object.keys(newMap);
    for (var k = 0; k < keys.length; k++) {
      var key = keys[k];
      if (!window.__seedance_raw_url_map[key]) {
        window.__seedance_raw_url_map[key] = newMap[key];
      }
    }
    console.log('[' + PLUGIN_ID + '] 合并 ' + keys.length + ' 个 URL 到地图');
    return true;
  }
  function interceptResponse(originalFetch, thisArg, args) {
    var input = args[0];
    var url = typeof input === 'string' ? input : (input && input.url);
    var isChainSingle = url && url.includes('/im/chain/single');
    
    var result = originalFetch.apply(thisArg, args);
    return result.then(async (response) => {
      try {
        var clone = response.clone();
        var text;
        if (isChainSingle) {
          // REST API: 直接读取 JSON
          text = await clone.text();
          var videoMap = extractVideoUrlsFromChain(text);
          var vKeys = Object.keys(videoMap);
          if (vKeys.length > 0) {
            mergeUrlMap(videoMap);
            console.log('[' + PLUGIN_ID + '] 从历史对话提取到 ' + vKeys.length + ' 个无水印视频 URL');
            window.postMessage({ type: 'seedance_urls_extracted', urls: videoMap }, '*');
          }
        } else {
          // SSE: 带超时的 stream 读取（视频生成可能需要 3 分钟）
          text = await Promise.race([
            clone.text(),
            new Promise(function(_, reject) { setTimeout(function() { reject(new Error('stream timeout')); }, 180000); })
          ]);
          var urlMap = extractRawUrlsFromSSE(text);
          var keys = Object.keys(urlMap);
          console.log('[' + PLUGIN_ID + '] SSE 响应长度: ' + text.length + ', 提取到 ' + keys.length + ' 个 URL');
          if (text.length < 500) console.log('[' + PLUGIN_ID + '] SSE 内容: ' + text.substring(0, 500));
          if (keys.length > 0) {
            mergeUrlMap(urlMap);
            console.log('[' + PLUGIN_ID + '] 提取到 ' + keys.length + ' 个原图 URL 映射');
            // 通知 content.js 存储无水印 URL
            window.postMessage({ type: 'seedance_urls_extracted', urls: urlMap }, '*');
          }
        }
      } catch(e) {
        if (e.message === 'stream timeout') {
          console.log('[' + PLUGIN_ID + '] SSE stream timeout, skipping');
        }
      }
      return response;
    });
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

      // 直接赋值（脚本在 document_start 运行，页面脚本还没执行，无需保护）
      window.fetch = hookedFetch;

      hookActive = true;
      console.log(`[${PLUGIN_ID}] fetch hook 已安装`);
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
        this._doubao_request_url = typeof url === 'string' ? url : (url ? '' + url : '');
        return originalXhrOpen.apply(this, arguments);
      };

      XMLHttpRequest.prototype.send = function (body) {
        try {
          var url = this._doubao_request_url || '';

          // 拦截 /chat/completion 请求修改 duration
          if (url.indexOf('/chat/completion') >= 0) {
            if (typeof body === 'string' && body.indexOf('ability_param') >= 0) {
              console.log('[' + PLUGIN_ID + '] 拦截到包含 ability_param 的 XHR 请求');
              arguments[0] = modifyBody(body);
            }
          }

          // 拦截 /im/chain/single 和 send_rate_limit 响应
          if (url.indexOf('/im/chain/single') >= 0 || url.indexOf('/im/message/send_rate_limit') >= 0) {
            var self = this;
            var originalLoad = self.onload;
            self.onload = function () {
              try {
                if (self.readyState === 4 && self.status === 200) {
                  var respText = self.responseText || '';
                  if (respText.length > 0) {
                    var urlMap = null;
                    if (url.indexOf('/im/chain/single') >= 0) {
                      urlMap = extractVideoUrlsFromChain(respText);
                    } else {
                      urlMap = extractRawUrlsFromSSE(respText);
                    }
                    if (urlMap) {
                      var keys = Object.keys(urlMap);
                      if (keys.length > 0) {
                        mergeUrlMap(urlMap);
                        console.log('[' + PLUGIN_ID + '] XHR 提取到 ' + keys.length + ' 个无水印 URL');
                      }
                    }
                  }
                }
              } catch(e) {}
              if (originalLoad) originalLoad.apply(self, arguments);
            };
            // 也监听 addEventListener('load')
            self.addEventListener('load', function() {
              try {
                if (self.readyState === 4 && self.status === 200 && !window.__seedance_raw_url_map) {
                  var respText = self.responseText || '';
                  if (respText.length > 0) {
                    var urlMap = url.indexOf('/im/chain/single') >= 0
                      ? extractVideoUrlsFromChain(respText)
                      : extractRawUrlsFromSSE(respText);
                    var keys = Object.keys(urlMap || {});
                    if (keys.length > 0) {
                      window.__seedance_raw_url_map = urlMap;
                      console.log('[' + PLUGIN_ID + '] XHR(addListener) 提取到 ' + keys.length + ' 个无水印 URL');
                    }
                  }
                }
              } catch(e) {}
            });
          }
        } catch (err) {
          console.warn('[' + PLUGIN_ID + '] XHR修改失败:', err);
        }
        return originalXhrSend.apply(this, arguments);
      };
      console.log('[' + PLUGIN_ID + '] XHR hook 已安装（含视频 URL 拦截）');
    } catch (err) {
      console.error('[' + PLUGIN_ID + '] XHR hook 安装失败:', err);
    }
  }

  // ========== 水印替换器（MAIN 世界直接运行） ==========
  function startWatermarkReplacer() {
    setInterval(function() {
      if (!watermarkRemovalEnabled) return;
      var map = window.__seedance_raw_url_map;
      if (!map) return;
      // 图片替换
      var imgs = document.querySelectorAll('img');
      for (var i = 0; i < imgs.length; i++) {
        var img = imgs[i];
        if (img.dataset.seedanceRaw) continue;
        var src = img.src || img.currentSrc;
        if (!src || src.indexOf('ibyteimg') < 0) continue;
        if (src.indexOf('watermark') < 0 && src.indexOf('downsize') < 0) continue;
        for (var key in map) {
          var parts = key.split('?')[0];
          if (src.indexOf(parts) >= 0) {
            img.src = map[key];
            img.dataset.seedanceRaw = map[key];
            break;
          }
        }
      }
      // 视频替换
      var videos = document.querySelectorAll('video');
      for (var i = 0; i < videos.length; i++) {
        var v = videos[i];
        if (v.dataset.seedanceRaw) continue;
        var _vsrc = v.src || v.currentSrc;
        if (!_vsrc) continue;
        // 豆包 doubao.com：直接替换 lr 参数去除水印
        if (_vsrc.indexOf('douyinvod.com') >= 0 && _vsrc.indexOf('lr=video_gen_watermark') >= 0) {
          var _cleanUrl = _vsrc.replace(/lr=video_gen_watermark(?:_dyn)?/g, 'lr=video_gen_no_watermark');
          v.src = _cleanUrl;
          v.dataset.seedanceRaw = _cleanUrl;
          if (!window.__seedance_raw_url_map) window.__seedance_raw_url_map = {};
          window.__seedance_raw_url_map['__video_doubao'] = _cleanUrl;
          window.postMessage({ type: 'seedance_urls_extracted', urls: { '__video_doubao': _cleanUrl } }, '*');
          v.load();
          console.log('[' + PLUGIN_ID + '] 豆包视频水印已去除 (lr -> video_gen_no_watermark)');
          continue;
        }
        // Dola.com：替换水印参数
        if (_vsrc.indexOf('dola.com') >= 0 && (_vsrc.indexOf('lr=watermark') >= 0 || _vsrc.indexOf('lr=video_gen_watermark') >= 0)) {
          var _dolaClean = _vsrc.replace(/lr=video_gen_watermark(?:_dyn)?/g, 'lr=unwatermarked').replace(/lr=watermark(?:_dyn)?/g, 'lr=unwatermarked');
          v.src = _dolaClean;
          v.dataset.seedanceRaw = _dolaClean;
          v.load();
          console.log('[' + PLUGIN_ID + '] Dola 视频水印已去除');
          window.postMessage({ type: 'seedance_urls_extracted', urls: { '__video_dola': _dolaClean } }, '*');
          continue;
        }
        // Dola.com：也处理带 ibyteimg 水印的视频
        if (_vsrc && _vsrc.indexOf('dola.com') >= 0 && _vsrc.indexOf('downsize_watermark') >= 0) {
          var _dolaClean2 = _vsrc.replace(/downsize_watermark_[^&]+/g, 'downsize');
          v.src = _dolaClean2;
          v.dataset.seedanceRaw = _dolaClean2;
          v.load();
          console.log('[' + PLUGIN_ID + '] Dola ibyteimg 水印已去除');
          continue;
        }
        // 检查 __video_ 前缀的 key（来自 chain/single API）
        var videoUrl = null;
        for (var key in map) {
          if (key.indexOf('__video_') === 0) {
            videoUrl = map[key];
            break;
          }
        }
        if (videoUrl) {
          v.src = videoUrl;
          v.dataset.seedanceRaw = videoUrl;
          v.load();
          continue;
        }
        // 方法1: 通过同级的封面图匹配（SSE 路径）
        var container = v.parentElement?.parentElement;
        if (container) {
          var cover = container.querySelector('img[class*="cover"]');
          if (cover) {
            var coverSrc = cover.src || '';
            if (coverSrc.indexOf('ibyteimg') >= 0) {
              for (var key in map) {
                var parts = key.split('?')[0];
                if (coverSrc.indexOf(parts) >= 0) {
                  var newSrc = map[key];
                  if (newSrc && (newSrc.indexOf('dola.com') >= 0 || newSrc.indexOf('video') >= 0)) {
                    v.src = newSrc;
                    v.dataset.seedanceRaw = newSrc;
                    v.load();
                    break;
                  }
                }
              }
            }
          }
        }
        // 方法2: 直接匹配 video src
        if (v.dataset.seedanceRaw) continue;
        var vsrc = v.src || v.currentSrc;
        if (!vsrc) {
          var sources = v.querySelectorAll('source');
          for (var s = 0; s < sources.length; s++) {
            if (sources[s].dataset.seedanceRaw) continue;
            var ssrc = sources[s].src || sources[s].getAttribute('src') || '';
            if (ssrc && ssrc.indexOf('dola.com') >= 0) {
              for (var key in map) {
                if (map[key].indexOf('dola.com') >= 0) {
                  sources[s].src = map[key];
                  sources[s].dataset.seedanceRaw = map[key];
                  v.load();
                  v.dataset.seedanceRaw = map[key];
                  break;
                }
              }
            }
          }
        }
        if (vsrc && vsrc.indexOf('dola.com') >= 0) {
          for (var key in map) {
            if (map[key].indexOf('dola.com') >= 0) {
              v.src = map[key];
              v.dataset.seedanceRaw = map[key];
              v.load();
              break;
            }
          }
        }
      }
    }, 500);
    console.log('[' + PLUGIN_ID + '] 水印替换器已启动（图片+视频）');
  }

  // ========== 15s 时长选项注入 ==========
  function startDurationOptionInjector() {
    setInterval(function() {
      // 查找时长选择按钮（包含 "10s" 文本的按钮）
      var btns = document.querySelectorAll('button');
      var durationBtn = null;
      for (var i = 0; i < btns.length; i++) {
        if (btns[i].textContent.trim() === '10s') {
          durationBtn = btns[i];
          break;
        }
      }
      if (!durationBtn) return;

      // 检查是否已注入过15s按钮
      var parent = durationBtn.parentElement;
      if (!parent) return;
      var existing15s = parent.querySelector('[data-seedance-15s]');
      if (existing15s) return;

      // 检查是否已经有15s选项（页面原生）
      var allBtns = parent.querySelectorAll('button');
      for (var j = 0; j < allBtns.length; j++) {
        if (allBtns[j].textContent.trim() === '15s') return;
      }

      // 创建15s按钮
      var btn15s = document.createElement('button');
      btn15s.textContent = '15s';
      btn15s.setAttribute('data-seedance-15s', 'true');
      btn15s.setAttribute('type', 'button');
      btn15s.className = durationBtn.className;
      btn15s.style.cssText = 'margin-left:4px;';

      // 点击15s按钮：设置 targetDuration = 15，并高亮
      btn15s.onclick = function(e) {
        e.preventDefault();
        e.stopPropagation();
        targetDuration = 15;
        // 高亮15s，取消10s高亮
        btn15s.style.background = 'var(--dbx-fill-trans-10-hover)';
        btn15s.style.color = 'var(--dbx-text-primary)';
        durationBtn.style.background = '';
        durationBtn.style.color = '';
        // 通知 content.js 更新配置
        window.postMessage({ type: 'seedance_set_duration', payload: { duration: 15, enabled: true } }, '*');
        console.log('[' + PLUGIN_ID + '] 手动选择 15s 时长');
      };

      // 点击10s按钮：恢复 targetDuration = 10
      durationBtn.onclick = function(e) {
        e.preventDefault();
        e.stopPropagation();
        targetDuration = 10;
        durationBtn.style.background = 'var(--dbx-fill-trans-10-hover)';
        durationBtn.style.color = 'var(--dbx-text-primary)';
        btn15s.style.background = '';
        btn15s.style.color = '';
        window.postMessage({ type: 'seedance_set_duration', payload: { duration: 10, enabled: true } }, '*');
        console.log('[' + PLUGIN_ID + '] 手动选择 10s 时长');
      };

      // 插入15s按钮到10s按钮后面
      parent.appendChild(btn15s);

      // 如果默认是15s，高亮15s按钮
      if (targetDuration === 15) {
        btn15s.style.background = 'var(--dbx-fill-trans-10-hover)';
        btn15s.style.color = 'var(--dbx-text-primary)';
        durationBtn.style.background = '';
        durationBtn.style.color = '';
      }

      console.log('[' + PLUGIN_ID + '] 已注入 15s 时长选项');
    }, 1000);
  }

  // ========== 去水印开关按钮注入 ==========
  let watermarkRemovalEnabled = true;

  function startWatermarkToggleInjector() {
    setInterval(function() {
      // 查找底部工具栏容器
      var btns = document.querySelectorAll('button');
      var durationBtn = null;
      for (var i = 0; i < btns.length; i++) {
        if (btns[i].textContent.trim() === '10s') {
          durationBtn = btns[i];
          break;
        }
      }
      if (!durationBtn) return;

      var toolbar = durationBtn.parentElement;
      if (!toolbar) return;

      // 检查是否已注入
      var existing = toolbar.querySelector('[data-seedance-wm-toggle]');
      if (existing) return;

      // 创建去水印开关按钮
      var wmBtn = document.createElement('button');
      wmBtn.setAttribute('data-seedance-wm-toggle', 'true');
      wmBtn.setAttribute('type', 'button');
      wmBtn.style.cssText = 'display:flex;align-items:center;gap:4px;margin-left:8px;padding:4px 8px;border-radius:6px;font-size:13px;cursor:pointer;border:none;background:' +
        (watermarkRemovalEnabled ? 'rgba(34,197,94,0.15)' : 'rgba(128,128,128,0.15)') +
        ';color:' + (watermarkRemovalEnabled ? '#22c55e' : '#888') + ';transition:all 0.2s;';

      // 图标 + 文字
      wmBtn.innerHTML = '<span style="font-size:14px;">' + (watermarkRemovalEnabled ? '✓' : '✕') + '</span><span>去水印</span>';

      wmBtn.onmouseenter = function() { wmBtn.style.opacity = '0.8'; };
      wmBtn.onmouseleave = function() { wmBtn.style.opacity = '1'; };

      wmBtn.onclick = function(e) {
        e.preventDefault();
        e.stopPropagation();
        watermarkRemovalEnabled = !watermarkRemovalEnabled;
        // 更新样式
        wmBtn.style.background = watermarkRemovalEnabled ? 'rgba(34,197,94,0.15)' : 'rgba(128,128,128,0.15)';
        wmBtn.style.color = watermarkRemovalEnabled ? '#22c55e' : '#888';
        wmBtn.innerHTML = '<span style="font-size:14px;">' + (watermarkRemovalEnabled ? '✓' : '✕') + '</span><span>去水印</span>';
        // 通知 content.js
        window.postMessage({
          type: 'seedance_watermark_toggle',
          enabled: watermarkRemovalEnabled
        }, '*');
        console.log('[' + PLUGIN_ID + '] 去水印: ' + (watermarkRemovalEnabled ? '开启' : '关闭'));
      };

      toolbar.appendChild(wmBtn);
      console.log('[' + PLUGIN_ID + '] 已注入去水印开关按钮');
    }, 1000);
  }

  // ========== 执行安装 ==========
  installFetchHook();
  installXhrHook();
  startWatermarkReplacer();
  startDurationOptionInjector();
  startWatermarkToggleInjector();
  console.log(`[${PLUGIN_ID}] 所有 hook 已安装完成`);
})();
