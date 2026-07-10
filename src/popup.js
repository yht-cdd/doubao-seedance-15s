// popup.js - 全部使用 addEventListener，无内联事件

const PAGE_SIZE = 8;
let currentPage = 1;
let allUrls = {};
let currentFilter = 'all';
let sortNewest = true;

document.addEventListener('DOMContentLoaded', () => {
  // === 右侧主面板 ===
  const toggleEnabled = document.getElementById('toggle-enabled');
  const statusBar = document.getElementById('status-bar');
  const statusText = document.getElementById('status-text');
  const durationBtns = document.querySelectorAll('.duration-btn');
  const urlPanel = document.getElementById('urlPanel');
  const mainPanel = document.getElementById('mainPanel');

  // 面板展开
  document.getElementById('openUrlPanel').addEventListener('click', () => {
    urlPanel.classList.add('open');
    mainPanel.classList.add('shifted');
    refreshUrls();
  });

  // 面板关闭
  document.getElementById('closePanel').addEventListener('click', () => {
    urlPanel.classList.remove('open');
    mainPanel.classList.remove('shifted');
  });

  // 工具栏按钮
  document.getElementById('btnCopyAll').addEventListener('click', copyAllUrls);
  document.getElementById('btnRefresh').addEventListener('click', refreshUrls);
  document.getElementById('btnClear').addEventListener('click', clearAllUrls);
  document.getElementById('sortBtn').addEventListener('click', toggleSort);

  // 筛选按钮
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentFilter = btn.dataset.filter;
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentPage = 1;
      renderPage();
    });
  });

  // 翻页 - 事件委托
  document.getElementById('pagination').addEventListener('click', (e) => {
    const btn = e.target.closest('.page-btn');
    if (!btn || btn.disabled) return;
    const dir = btn.dataset.dir;
    if (dir === 'prev') currentPage--;
    if (dir === 'next') currentPage++;
    renderPage();
  });

  // 链接列表 - 事件委托
  document.getElementById('urlList').addEventListener('click', (e) => {
    const btn = e.target.closest('.url-card-actions .btn');
    if (!btn) return;
    const card = btn.closest('.url-card');
    const url = card?.dataset.url;
    const key = card?.dataset.key;
    if (!url) return;

    if (btn.classList.contains('btn-c')) {
      navigator.clipboard.writeText(url).then(() => showToast('已复制')).catch(() => showToast('复制失败'));
    } else if (btn.classList.contains('btn-o')) {
      chrome.tabs.create({ url: url });
    } else if (btn.classList.contains('btn-d')) {
      delete allUrls[key];
      chrome.storage.local.set({ seedance_extracted_urls: allUrls });
      updateStats();
      renderPage();
    }
  });

  // 加载状态
  chrome.runtime.sendMessage({ type: 'get-status' }, (res) => {
    if (res) {
      toggleEnabled.checked = res.enabled;
      updateStatusUI(res.enabled);
      durationBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.duration === res.duration);
      });
    }
  });

  toggleEnabled.addEventListener('change', () => {
    const enabled = toggleEnabled.checked;
    chrome.runtime.sendMessage({ type: 'set-enabled', enabled });
    updateStatusUI(enabled);
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) chrome.tabs.sendMessage(tabs[0].id, { type: 'dbx-seed-toggle' }).catch(() => {});
    });
  });

  durationBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'set-duration', duration: btn.dataset.duration });
      durationBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) chrome.tabs.sendMessage(tabs[0].id, { type: 'dbx-seed-toggle' }).catch(() => {});
      });
    });
  });

  function updateStatusUI(enabled) {
    statusBar.className = 'status-bar ' + (enabled ? 'active' : 'inactive');
    statusText.textContent = enabled ? '插件运行中' : '插件已禁用';
  }

  // 自动扫描
  scanCurrentPage();
});

// === 扫描当前页面 ===
function scanCurrentPage() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]?.id) return;
    const url = tabs[0].url || '';
    if (!url.includes('doubao.com') && !url.includes('dola.com')) return;

    chrome.scripting.executeScript({
      target: { tabId: tabs[0].id },
      func: () => {
        const results = [];
        document.querySelectorAll('video').forEach(v => {
          const src = v.src || v.currentSrc || '';
          if (src && src.length > 10) results.push({ type: 'video', src });
          v.querySelectorAll('source').forEach(s => {
            const ssrc = s.src || s.getAttribute('src') || '';
            if (ssrc && ssrc.length > 10) results.push({ type: 'video', src: ssrc });
          });
        });
        document.querySelectorAll('img').forEach(img => {
          const src = img.src || img.currentSrc || '';
          if (src && src.includes('ibyteimg') && src.length > 50) results.push({ type: 'image', src });
        });
        const rawMap = window.__seedance_raw_url_map || {};
        Object.keys(rawMap).forEach(key => {
          results.push({ type: key.includes('video') ? 'video' : 'image', src: rawMap[key], key });
        });
        // 从页面 HTML 中提取 creation_block 中的视频封面和 vid
        try {
          const html = document.documentElement.innerHTML;
          const cbIdx = html.indexOf('creation_block');
          if (cbIdx >= 0) {
            const block = html.substring(cbIdx, cbIdx + 5000);
            // 提取 vid
            const vidMatch = block.match(/vid[^a-zA-Z0-9]+([a-zA-Z0-9_]+)/);
            if (vidMatch) {
              results.push({ type: 'video', src: 'vid:' + vidMatch[1], key: 'vid_' + vidMatch[1] });
            }
            // 提取 image_thumb URL（含水印）
            const thumbMatch = block.match(/image_thumb[^}]{0,500}?url[^:]+:\s*"([^"]+)"/);
            if (thumbMatch) {
              const thumbUrl = thumbMatch[1].replace(/\\u002F/g, '/');
              results.push({ type: 'video', src: thumbUrl, key: 'cover_' + Date.now() });
            }
            // 提取 image_preview URL
            const prevMatch = block.match(/image_preview[^}]{0,500}?url[^:]+:\s*"([^"]+)"/);
            if (prevMatch) {
              const prevUrl = prevMatch[1].replace(/\\u002F/g, '/');
              results.push({ type: 'video', src: prevUrl, key: 'preview_' + Date.now() });
            }
          }
        } catch(e) {}
        return results;
      }
    }).then(injectionResults => {
      if (!injectionResults?.[0]?.result) return;
      const pageUrls = injectionResults[0].result;
      chrome.storage.local.get(['seedance_extracted_urls'], (res) => {
        let existing = res.seedance_extracted_urls || {};
        const now = Date.now();
        pageUrls.forEach((item, i) => {
          const key = now + '_' + i;
          if (!existing[key]) {
            existing[key] = { url: item.src, type: item.type, key: item.key || item.type, time: new Date().toLocaleString(), site: new URL(tabs[0].url).hostname };
          }
        });
        chrome.storage.local.set({ seedance_extracted_urls: existing });
      });
    }).catch(() => {});
  });
}

// === 刷新列表 ===
function refreshUrls() {
  scanCurrentPage();
  setTimeout(() => {
    chrome.storage.local.get(['seedance_extracted_urls'], (res) => {
      allUrls = res.seedance_extracted_urls || {};
      updateStats();
      renderPage();
    });
  }, 500);
}

function updateStats() {
  const keys = Object.keys(allUrls);
  let v = 0, img = 0;
  keys.forEach(k => {
    const item = allUrls[k];
    const isVid = item.type === 'video' || (item.url && (item.url.includes('video') || item.url.includes('.mp4') || item.url.includes('douyinvod')));
    isVid ? v++ : img++;
  });
  document.getElementById('totalCount').textContent = keys.length;
  document.getElementById('videoCount').textContent = v;
  document.getElementById('imageCount').textContent = img;
}

function toggleSort() {
  sortNewest = !sortNewest;
  document.getElementById('sortBtn').textContent = sortNewest ? '↓ 最新' : '↑ 最早';
  currentPage = 1;
  renderPage();
}

function renderPage() {
  let keys = Object.keys(allUrls);

  // 筛选
  if (currentFilter !== 'all') {
    keys = keys.filter(k => {
      const item = allUrls[k];
      const isVid = item.type === 'video' || (item.url && (item.url.includes('video') || item.url.includes('.mp4') || item.url.includes('douyinvod')));
      return currentFilter === 'video' ? isVid : !isVid;
    });
  }

  // 排序
  keys.sort((a, b) => sortNewest ? parseInt(b) - parseInt(a) : parseInt(a) - parseInt(b));

  const totalPages = Math.max(1, Math.ceil(keys.length / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageKeys = keys.slice(start, start + PAGE_SIZE);

  const listEl = document.getElementById('urlList');
  if (keys.length === 0) {
    listEl.innerHTML = '<div class="url-panel-empty"><div class="icon">📭</div><p>暂无' + (currentFilter === 'all' ? '' : (currentFilter === 'video' ? '视频' : '图片')) + '链接</p></div>';
    document.getElementById('pagination').innerHTML = '';
    return;
  }

  let html = '';
  pageKeys.forEach(k => {
    const item = allUrls[k];
    const isVid = item.type === 'video' || (item.url && (item.url.includes('video') || item.url.includes('.mp4') || item.url.includes('douyinvod')));
    const tag = isVid ? '<span class="url-card-tag video">视频</span>' : '<span class="url-card-tag image">图片</span>';
    const ext = isVid ? '.mp4' : '.png';
    const filename = (item.key || 'download').replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '_') + ext;
    const shortUrl = item.url.length > 80 ? item.url.substring(0, 80) + '...' : item.url;

    html += '<div class="url-card" data-url="' + item.url.replace(/"/g, '&quot;') + '" data-key="' + k + '">';
    html += '<div class="url-card-top">' + tag + '<span class="url-card-site">' + (item.site || '') + ' · ' + (item.time || '') + '</span></div>';
    html += '<div class="url-card-url"><a href="' + item.url + '" download="' + filename + '" target="_blank">' + shortUrl + '</a></div>';
    html += '<div class="url-card-actions">';
    html += '<button class="btn btn-c">📋 复制</button>';
    html += '<button class="btn btn-o">↗ 打开</button>';
    html += '<button class="btn btn-d">✕</button>';
    html += '</div></div>';
  });
  listEl.innerHTML = html;

  // 翻页
  let pagHtml = '<button class="page-btn" data-dir="prev"' + (currentPage <= 1 ? ' disabled' : '') + '>&lt;</button>';
  pagHtml += '<span class="page-info">' + currentPage + ' / ' + totalPages + '</span>';
  pagHtml += '<button class="page-btn" data-dir="next"' + (currentPage >= totalPages ? ' disabled' : '') + '>&gt;</button>';
  document.getElementById('pagination').innerHTML = pagHtml;
}

function goPage(p) { currentPage = p; renderPage(); }

function copyAllUrls() {
  const keys = Object.keys(allUrls);
  if (!keys.length) { showToast('没有链接'); return; }
  const text = keys.map(k => allUrls[k].url).join('\n');
  navigator.clipboard.writeText(text).then(() => showToast('已复制 ' + keys.length + ' 个链接')).catch(() => showToast('复制失败'));
}

function clearAllUrls() {
  chrome.storage.local.set({ seedance_extracted_urls: {} });
  allUrls = {};
  updateStats();
  renderPage();
  showToast('已清空');
}

function showToast(msg) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);background:#333;color:white;padding:8px 16px;border-radius:6px;font-size:12px;z-index:9999;opacity:0;transition:opacity 0.3s;pointer-events:none;';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = '1';
  setTimeout(() => { toast.style.opacity = '0'; }, 1500);
}
