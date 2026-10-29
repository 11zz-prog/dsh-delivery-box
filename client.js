/**
 * 「取件箱」Client 半边：侧栏入口 + 交付物缩略图网格 + 预览弹层。
 *
 * 数据来自 Host 半边注册的同源路由（文档相对路径）：
 *   GET  api/inbox/list
 *   GET  api/inbox/file?name=...
 *   POST api/inbox/copy / reveal / open / delete / open-folder
 * 面板每 5 秒自动拉一次列表；切回页面时也拉。
 *
 * 纯 JS，无构建：React 从页面模块表 require，样式用 --dsw-alias-* 主题令牌。
 */
window.__ModuleLoader__.load({
  id: 'dsh-delivery-box',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const PANEL_ID = 'inbox'
    const API = 'api/inbox'
    const REFRESH_MS = 5000
    const TEXT_PREVIEW_CHARS = 20000
    const TOAST_MS = 3400

    const STRINGS = {
      zh: {
        entry: '取件箱',
        title: '取件箱',
        sub: '点开预览；「复制」之后切到微信 Ctrl+V 就能发。',
        hint: '小提示：按「产出它的对话」分组；卡片可以直接拖进微信，拖不动就用「复制」按钮。',
        unlabeled: '未标注来源',
        unlabeledHint: '老文件没记来源；用 inbox.mjs tag 可以补标注。',
        subCategories: '按分类看：点开一个分类，才显示这个项目下各对话产出的文件。',
        categoriesCount: n => n + ' 个分类',
        backToCategories: '← 所有分类',
        catTalks: n => n + ' 个对话',
        latestPrefix: '最新 ',
        categoryEmpty: '这个分类里还没有文件',
        detailHint: '文件按产出它的对话分组；点卡片预览，点「复制」去微信 Ctrl+V。',
        refresh: '刷新',
        openFolder: '打开文件夹',
        loading: '正在读取取件箱…',
        retry: '重试',
        emptyTitle: '取件箱还空着',
        emptyHint: '以后我出完图片 / 文档 / 视频，会自动放进取件箱文件夹；你也可以直接把文件拖进那个文件夹，这里 5 秒内自己出现。',
        emptyOpen: '打开取件箱文件夹',
        copy: '复制',
        revealShort: '显示',
        copyImage: '复制图片',
        copyFile: '复制文件',
        copiedImage: '图片已复制，切到微信 Ctrl+V 就能发',
        copiedFile: '文件已复制，切到微信 Ctrl+V 就能发',
        reveal: '在文件夹中显示',
        open: '打开',
        del: '删除',
        delConfirm: '再点一次：确认删除',
        deleted: '已删到回收站',
        close: '关闭',
        prev: '上一个',
        next: '下一个',
        loadFailed: '读取失败',
        actionFailed: '操作失败：',
        newItems: n => '新到 ' + n + ' 件',
        justNow: '刚刚',
        minutesAgo: n => n + ' 分钟前',
        hoursAgo: n => n + ' 小时前',
        yesterday: hhmm => '昨天 ' + hhmm,
        tabAll: '全部',
        tabImage: '图片',
        tabVideo: '视频',
        tabAudio: '音频',
        tabDoc: '文档',
        tabOther: '其他',
        previewTruncated: '只读预览：只显示前 20000 字，完整内容请「打开」。',
        noPreview: '这类文件不做预览，直接「打开」看。',
        htmlHint: 'HTML 报告建议用「打开」在浏览器里看。',
        sizeLabel: '大小',
        whenLabel: '加入',
        countUnit: '件',
        openFailed: '打不开：',
      },
      en: {
        entry: 'Inbox',
        title: 'Inbox',
        sub: 'Click to preview. Hit Copy, then paste into WeChat with Ctrl+V.',
        hint: 'Tip: grouped by the conversation that produced it; drag a card into WeChat, or use Copy.',
        unlabeled: 'Unlabeled',
        unlabeledHint: 'Older items have no origin; add one with inbox.mjs tag.',
        subCategories: 'Browse by category; open one to see the files each conversation produced.',
        categoriesCount: n => n + ' categories',
        backToCategories: '← All categories',
        catTalks: n => n + ' chats',
        latestPrefix: 'latest ',
        categoryEmpty: 'No files in this category yet',
        detailHint: 'Files are grouped by the conversation that produced them.',
        refresh: 'Refresh',
        openFolder: 'Open folder',
        loading: 'Reading the inbox…',
        retry: 'Retry',
        emptyTitle: 'The inbox is empty',
        emptyHint: 'Deliverables land in the inbox folder automatically; you can also drop files into that folder and they show up here within 5 seconds.',
        emptyOpen: 'Open inbox folder',
        copy: 'Copy',
        revealShort: 'Show',
        copyImage: 'Copy image',
        copyFile: 'Copy file',
        copiedImage: 'Image copied — paste it into WeChat with Ctrl+V',
        copiedFile: 'File copied — paste it into WeChat with Ctrl+V',
        reveal: 'Show in folder',
        open: 'Open',
        del: 'Delete',
        delConfirm: 'Click again to delete',
        deleted: 'Moved to Recycle Bin',
        close: 'Close',
        prev: 'Previous',
        next: 'Next',
        loadFailed: 'Failed to read',
        actionFailed: 'Action failed: ',
        newItems: n => n + ' new item(s)',
        justNow: 'just now',
        minutesAgo: n => n + ' min ago',
        hoursAgo: n => n + ' h ago',
        yesterday: hhmm => 'yesterday ' + hhmm,
        tabAll: 'All',
        tabImage: 'Images',
        tabVideo: 'Videos',
        tabAudio: 'Audio',
        tabDoc: 'Docs',
        tabOther: 'Other',
        previewTruncated: 'Read-only preview: first 20000 characters only. Use Open for the full file.',
        noPreview: 'No inline preview for this type — use Open.',
        htmlHint: 'Open HTML reports in a browser.',
        sizeLabel: 'Size',
        whenLabel: 'Added',
        countUnit: 'items',
        openFailed: 'Cannot open: ',
      },
    }

    function pickLocale() {
      const lang = (document.documentElement.getAttribute('lang') || navigator.language || 'zh').toLowerCase()
      return lang.startsWith('en') ? 'en' : 'zh'
    }

    function pad2(value) {
      return (value < 10 ? '0' : '') + value
    }

    function formatBytes(bytes) {
      if (!Number.isFinite(bytes) || bytes < 0) return '—'
      if (bytes < 1024) return bytes + ' B'
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
      if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
      return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB'
    }

    function formatWhen(mtime, t) {
      const when = Number(mtime)
      if (!Number.isFinite(when) || when <= 0) return ''
      const diff = Math.max(0, Date.now() - when)
      if (diff < 60 * 1000) return t.justNow
      if (diff < 60 * 60 * 1000) return t.minutesAgo(Math.max(1, Math.floor(diff / 60000)))
      if (diff < 24 * 60 * 60 * 1000) return t.hoursAgo(Math.floor(diff / 3600000))
      const date = new Date(when)
      const hhmm = pad2(date.getHours()) + ':' + pad2(date.getMinutes())
      const today = new Date()
      const sameYear = date.getFullYear() === today.getFullYear()
      if (!sameYear) return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate()) + ' ' + hhmm
      const dayDiff = Math.floor((new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
        - new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()) / 86400000)
      if (dayDiff === 1) return t.yesterday(hhmm)
      return (date.getMonth() + 1) + '月' + date.getDate() + '日 ' + hhmm
    }

    const FILTER_OF = {
      image: 'image',
      video: 'video',
      audio: 'audio',
      pdf: 'doc',
      text: 'doc',
      doc: 'doc',
      archive: 'other',
      other: 'other',
    }

    function groupOf(item) {
      return FILTER_OF[item.kind] || 'other'
    }

    /** 来源分组配色（跟「项目」面板一样：每个来源一个色点，颜色由名字稳定算出）。 */
    const GROUP_COLORS = ['#4f8cff', '#22b07d', '#f59e0b', '#a855f7', '#ef4444', '#06b6d4', '#ec4899', '#84cc16', '#8b5cf6', '#f97316']
    function colorOfKey(key) {
      const text = String(key)
      let hash = 0
      for (let index = 0; index < text.length; index += 1) hash = (hash * 31 + text.charCodeAt(index)) >>> 0
      return GROUP_COLORS[hash % GROUP_COLORS.length]
    }

    function kindLabel(item, t) {
      switch (item.kind) {
        case 'image': return t.tabImage
        case 'video': return t.tabVideo
        case 'audio': return t.tabAudio
        case 'pdf': return 'PDF'
        case 'text': return String(item.ext || 'text').toUpperCase()
        case 'doc': return String(item.ext || 'doc').toUpperCase()
        case 'archive': return String(item.ext || 'zip').toUpperCase()
        default: return String(item.ext || 'FILE').toUpperCase().slice(0, 5)
      }
    }

    function dragMime(item) {
      switch (item.kind) {
        case 'image':
          if (item.ext === 'jpg' || item.ext === 'jpeg') return 'image/jpeg'
          if (item.ext === 'gif') return 'image/gif'
          if (item.ext === 'webp') return 'image/webp'
          if (item.ext === 'svg') return 'image/svg+xml'
          if (item.ext === 'bmp') return 'image/bmp'
          return 'image/png'
        case 'video': return item.ext === 'webm' ? 'video/webm' : 'video/mp4'
        case 'audio': return item.ext === 'wav' ? 'audio/wav' : 'audio/mpeg'
        case 'pdf': return 'application/pdf'
        case 'text': return 'text/plain'
        default: return 'application/octet-stream'
      }
    }

    const CSS = `
/* ---------- 底：磨砂玻璃底纹 + 主题令牌 ---------- */
.inbox-root{height:100%;min-height:0;display:flex;flex-direction:column;color:var(--dsw-alias-label-primary);background:
  radial-gradient(1100px 560px at 4% -12%, color-mix(in srgb, var(--dsw-alias-brand-primary) 30%, transparent), transparent 60%),
  radial-gradient(940px 500px at 112% 6%, color-mix(in srgb, var(--dsw-alias-state-success-primary) 20%, transparent), transparent 58%),
  radial-gradient(860px 480px at 44% 126%, color-mix(in srgb, var(--dsw-alias-state-warn-primary) 16%, transparent), transparent 62%),
  var(--dsw-alias-bg-base);}

/* ---------- 头部 ---------- */
.inbox-head{flex:0 0 auto;padding:18px 22px 6px;display:flex;flex-wrap:wrap;gap:10px;align-items:flex-start;}
.inbox-head-main{flex:1 1 260px;min-width:0;display:flex;flex-direction:column;gap:5px;}
.inbox-h1row{display:flex;align-items:center;gap:9px;flex-wrap:wrap;}
.inbox-h1{font-size:16px;font-weight:700;line-height:1.4;margin:0;letter-spacing:.01em;}
.inbox-count{font-size:11px;font-weight:700;color:var(--dsw-alias-brand-primary);border-radius:999px;padding:2px 9px;
  border:1px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 55%, transparent);
  background:color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent);}
.inbox-sub{font-size:12px;color:var(--dsw-alias-label-secondary);line-height:1.6;}
.inbox-tools{display:flex;gap:7px;flex-wrap:wrap;align-items:center;}

/* ---------- 玻璃按钮 / 标签 ---------- */
.inbox-btn{appearance:none;display:inline-flex;align-items:center;gap:6px;
  border:1px solid color-mix(in srgb, var(--dsw-alias-border-l1) 68%, transparent);
  background:color-mix(in srgb, var(--dsw-alias-bg-layer-1) 40%, transparent);
  backdrop-filter:blur(16px) saturate(1.5);-webkit-backdrop-filter:blur(16px) saturate(1.5);
  color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:1;padding:8px 12px;border-radius:10px;cursor:pointer;
  box-shadow:0 6px 16px color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent), inset 0 1px 0 color-mix(in srgb, var(--dsw-alias-label-primary) 7%, transparent);
  transition:color .15s ease,border-color .15s ease,transform .15s ease,background .15s ease;}
.inbox-btn:hover{color:var(--dsw-alias-label-primary);border-color:color-mix(in srgb, var(--dsw-alias-brand-primary) 55%, var(--dsw-alias-border-l1));}
.inbox-btn:active{transform:translateY(1px);}
.inbox-btn:disabled{opacity:.5;cursor:default;transform:none;}
.inbox-btn-primary{background:linear-gradient(135deg, color-mix(in srgb, var(--dsw-alias-brand-primary) 94%, transparent), color-mix(in srgb, var(--dsw-alias-brand-primary) 70%, transparent));
  border-color:color-mix(in srgb, var(--dsw-alias-brand-primary) 90%, transparent);color:var(--dsw-alias-bg-base);font-weight:700;
  box-shadow:0 8px 20px color-mix(in srgb, var(--dsw-alias-brand-primary) 32%, transparent);}
.inbox-btn-primary:hover{color:var(--dsw-alias-bg-base);}
.inbox-btn-danger:hover{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb, var(--dsw-alias-state-error-primary) 60%, transparent);}
.inbox-btn-danger[data-armed='true']{color:var(--dsw-alias-bg-base);background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 88%, transparent);border-color:var(--dsw-alias-state-error-primary);}

/* ---------- 分类标签 ---------- */
.inbox-tabs{flex:0 0 auto;display:flex;gap:6px;flex-wrap:wrap;padding:6px 22px 8px;}
.inbox-tab{appearance:none;border:1px solid color-mix(in srgb, var(--dsw-alias-border-l1) 62%, transparent);
  background:color-mix(in srgb, var(--dsw-alias-bg-layer-1) 32%, transparent);
  backdrop-filter:blur(14px) saturate(1.4);-webkit-backdrop-filter:blur(14px) saturate(1.4);
  color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;padding:6px 12px;border-radius:999px;cursor:pointer;
  display:inline-flex;align-items:center;gap:6px;
  transition:background .15s ease,color .15s ease,border-color .15s ease;}
.inbox-tab:hover{color:var(--dsw-alias-label-primary);border-color:color-mix(in srgb, var(--dsw-alias-border-l2) 80%, transparent);}
.inbox-tab[data-active='true']{background:color-mix(in srgb, var(--dsw-alias-brand-primary) 82%, transparent);
  border-color:color-mix(in srgb, var(--dsw-alias-brand-primary) 88%, transparent);color:var(--dsw-alias-bg-base);font-weight:700;}
.inbox-tab-n{font-size:10.5px;font-weight:700;opacity:.75;font-variant-numeric:tabular-nums;}

/* ---------- 主体 / 分类 / 分组 / 网格 ---------- */
.inbox-body{flex:1;min-height:0;overflow-y:auto;padding:4px 22px 30px;}
.inbox-cats{display:grid;grid-template-columns:repeat(auto-fill,minmax(212px,1fr));gap:12px;}
.inbox-cat{position:relative;display:flex;flex-direction:column;gap:9px;padding:13px 14px 12px;border-radius:15px;cursor:pointer;outline:none;
  background:color-mix(in srgb, var(--dsw-alias-bg-layer-2) 34%, transparent);
  backdrop-filter:blur(16px) saturate(1.45);-webkit-backdrop-filter:blur(16px) saturate(1.45);
  border:1px solid color-mix(in srgb, var(--dsw-alias-border-l1) 55%, transparent);
  box-shadow:0 8px 20px color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent);
  transition:border-color .16s ease,transform .16s ease,box-shadow .16s ease;}
.inbox-cat:hover,.inbox-cat:focus-visible{border-color:color-mix(in srgb, var(--dsw-alias-brand-primary) 48%, var(--dsw-alias-border-l2));
  transform:translateY(-2px);box-shadow:0 14px 30px color-mix(in srgb, var(--dsw-alias-label-primary) 14%, transparent);}
.inbox-cat:active{transform:translateY(0);}
.inbox-cat-top{display:flex;align-items:center;gap:8px;min-width:0;}
.inbox-cat-dot{width:10px;height:10px;border-radius:50%;flex:0 0 auto;}
.inbox-cat-name{flex:1;min-width:0;font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.inbox-cat-count{font-size:11px;font-weight:700;color:var(--dsw-alias-brand-primary);border-radius:999px;padding:2px 8px;
  border:1px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 45%, transparent);
  background:color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, transparent);flex:0 0 auto;}
.inbox-cat-meta{font-size:11px;color:var(--dsw-alias-label-secondary);display:flex;gap:9px;flex-wrap:wrap;font-variant-numeric:tabular-nums;}
.inbox-cat-kinds{display:flex;gap:5px;flex-wrap:wrap;}
.inbox-cat-kind{font-size:10px;line-height:1;padding:3px 7px;border-radius:999px;white-space:nowrap;
  color:var(--dsw-alias-label-secondary);
  background:color-mix(in srgb, var(--dsw-alias-bg-layer-2) 52%, transparent);
  border:1px solid color-mix(in srgb, var(--dsw-alias-border-l1) 56%, transparent);}
.inbox-cat-thumbs{display:flex;gap:5px;}
.inbox-cat-thumb{width:46px;height:46px;border-radius:9px;object-fit:cover;display:block;
  background:color-mix(in srgb, var(--dsw-alias-bg-layer-2) 60%, transparent);
  border:1px solid color-mix(in srgb, var(--dsw-alias-border-l1) 60%, transparent);}
.inbox-cat-hint{font-size:10.5px;color:var(--dsw-alias-label-secondary);opacity:.8;margin-top:-1px;}
.inbox-back{appearance:none;display:inline-flex;align-items:center;gap:6px;font:inherit;font-size:12px;line-height:1;
  padding:7px 11px;border-radius:10px;cursor:pointer;color:var(--dsw-alias-label-secondary);
  border:1px solid color-mix(in srgb, var(--dsw-alias-border-l1) 64%, transparent);
  background:color-mix(in srgb, var(--dsw-alias-bg-layer-1) 38%, transparent);
  backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);}
.inbox-back:hover{color:var(--dsw-alias-label-primary);border-color:color-mix(in srgb, var(--dsw-alias-brand-primary) 48%, transparent);}
.inbox-groups{display:flex;flex-direction:column;gap:18px;}
.inbox-group{display:flex;flex-direction:column;gap:10px;}
.inbox-group-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:0 2px;}
.inbox-group-dot{width:9px;height:9px;border-radius:50%;flex:0 0 auto;}
.inbox-group-title{font-size:12.5px;font-weight:700;letter-spacing:.01em;}
.inbox-group-sub{font-size:11px;color:var(--dsw-alias-label-secondary);border-radius:999px;padding:1px 7px;
  background:color-mix(in srgb, var(--dsw-alias-bg-layer-2) 46%, transparent);
  border:1px solid color-mix(in srgb, var(--dsw-alias-border-l1) 60%, transparent);}
.inbox-group-count{font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;margin-left:auto;}
.inbox-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:12px;}
.inbox-card{position:relative;display:flex;flex-direction:column;border-radius:14px;overflow:hidden;cursor:pointer;
  background:color-mix(in srgb, var(--dsw-alias-bg-layer-2) 34%, transparent);
  backdrop-filter:blur(16px) saturate(1.45);-webkit-backdrop-filter:blur(16px) saturate(1.45);
  border:1px solid color-mix(in srgb, var(--dsw-alias-border-l1) 55%, transparent);
  box-shadow:0 8px 20px color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent);
  transition:border-color .16s ease,transform .16s ease,box-shadow .16s ease;outline:none;}
.inbox-card:hover,.inbox-card:focus-visible{border-color:color-mix(in srgb, var(--dsw-alias-brand-primary) 48%, var(--dsw-alias-border-l2));
  transform:translateY(-2px);box-shadow:0 14px 30px color-mix(in srgb, var(--dsw-alias-label-primary) 14%, transparent);}
.inbox-card:active{transform:translateY(0);}
.inbox-thumb{position:relative;aspect-ratio:1 / 1;display:flex;align-items:center;justify-content:center;overflow:hidden;
  background:radial-gradient(120% 120% at 18% 8%, color-mix(in srgb, var(--dsw-alias-brand-primary) 16%, transparent), transparent 62%),
             color-mix(in srgb, var(--dsw-alias-bg-layer-2) 52%, transparent);}
.inbox-thumb img{width:100%;height:100%;object-fit:cover;display:block;}
.inbox-thumb-icon{display:flex;flex-direction:column;align-items:center;gap:7px;color:var(--dsw-alias-label-secondary);padding:10px;}
.inbox-ext{font-size:13px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--dsw-alias-label-primary);opacity:.8;}
.inbox-play{width:46px;height:46px;border-radius:50%;display:flex;align-items:center;justify-content:center;padding-left:3px;
  background:color-mix(in srgb, var(--dsw-alias-brand-primary) 22%, transparent);
  border:1px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 45%, transparent);
  color:var(--dsw-alias-brand-primary);font-size:15px;}
.inbox-kind{position:absolute;top:7px;left:7px;font-size:9.5px;font-weight:700;letter-spacing:.04em;padding:2px 7px;border-radius:999px;
  background:rgba(12,14,18,.5);color:#fff;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);max-width:70%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.inbox-quick{position:absolute;right:7px;bottom:7px;display:flex;gap:5px;opacity:0;transform:translateY(4px);transition:opacity .15s ease,transform .15s ease;}
.inbox-card:hover .inbox-quick,.inbox-card:focus-within .inbox-quick{opacity:1;transform:none;}
.inbox-quick-btn{appearance:none;border:1px solid rgba(255,255,255,.22);background:rgba(12,14,18,.58);color:#fff;
  font:inherit;font-size:10.5px;line-height:1;padding:6px 9px;border-radius:999px;cursor:pointer;
  backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);}
.inbox-quick-btn:hover{background:rgba(12,14,18,.78);}
.inbox-card-foot{padding:9px 11px 11px;display:flex;flex-direction:column;gap:3px;min-width:0;}
.inbox-name{font-size:12.5px;font-weight:600;line-height:1.36;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;
  overflow:hidden;word-break:break-all;}
.inbox-meta{font-size:10.5px;color:var(--dsw-alias-label-secondary);display:flex;gap:7px;flex-wrap:wrap;font-variant-numeric:tabular-nums;}

/* ---------- 空态 / 错误 ---------- */
.inbox-empty{margin:30px auto 0;max-width:560px;padding:26px 24px;border-radius:18px;text-align:center;
  display:flex;flex-direction:column;gap:11px;align-items:center;
  background:color-mix(in srgb, var(--dsw-alias-bg-layer-1) 46%, transparent);
  border:1px solid color-mix(in srgb, var(--dsw-alias-border-l1) 60%, transparent);
  backdrop-filter:blur(18px) saturate(1.4);-webkit-backdrop-filter:blur(18px) saturate(1.4);
  box-shadow:0 16px 38px color-mix(in srgb, var(--dsw-alias-label-primary) 10%, transparent);}
.inbox-empty h2{font-size:14px;margin:0;font-weight:700;}
.inbox-empty p{font-size:12px;line-height:1.8;color:var(--dsw-alias-label-secondary);margin:0;}
.inbox-loading{padding:26px 22px;font-size:12.5px;color:var(--dsw-alias-label-secondary);display:flex;align-items:center;gap:9px;}
.inbox-spinner{width:13px;height:13px;border-radius:50%;border:2px solid color-mix(in srgb, var(--dsw-alias-label-secondary) 35%, transparent);
  border-top-color:var(--dsw-alias-brand-primary);animation:inbox-spin .8s linear infinite;}
@keyframes inbox-spin{to{transform:rotate(360deg);}}

/* ---------- 提示条 ---------- */
.inbox-toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:1200;font-size:12.5px;line-height:1.4;
  padding:10px 16px;border-radius:999px;max-width:82vw;
  background:color-mix(in srgb, var(--dsw-alias-bg-layer-1) 88%, transparent);
  border:1px solid color-mix(in srgb, var(--dsw-alias-border-l2) 90%, transparent);
  color:var(--dsw-alias-label-primary);backdrop-filter:blur(20px) saturate(1.5);-webkit-backdrop-filter:blur(20px) saturate(1.5);
  box-shadow:0 18px 44px color-mix(in srgb, var(--dsw-alias-label-primary) 22%, transparent);animation:inbox-toast-in .18s ease both;}
.inbox-toast[data-tone='error']{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb, var(--dsw-alias-state-error-primary) 55%, transparent);}
@keyframes inbox-toast-in{from{opacity:0;transform:translate(-50%,8px);}to{opacity:1;transform:translate(-50%,0);}}

/* ---------- 预览弹层 ---------- */
.inbox-overlay{position:fixed;inset:0;z-index:1100;display:flex;align-items:center;justify-content:center;padding:26px;
  background:color-mix(in srgb, #05070b 62%, transparent);backdrop-filter:blur(12px) saturate(1.2);-webkit-backdrop-filter:blur(12px);}
.inbox-modal{width:fit-content;max-width:min(1120px,94vw);max-height:90vh;display:flex;flex-direction:column;border-radius:18px;overflow:hidden;
  background:color-mix(in srgb, var(--dsw-alias-bg-layer-1) 88%, var(--dsw-alias-bg-base));
  border:1px solid color-mix(in srgb, var(--dsw-alias-border-l2) 92%, transparent);
  box-shadow:0 34px 90px rgba(0,0,0,.5), inset 0 1px 0 color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent);}
.inbox-modal-head{display:flex;align-items:center;gap:10px;padding:12px 14px 12px 16px;border-bottom:1px solid color-mix(in srgb, var(--dsw-alias-border-l1) 70%, transparent);}
.inbox-modal-title{flex:1;min-width:0;font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.inbox-modal-sub{font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap;}
.inbox-x{appearance:none;border:1px solid color-mix(in srgb, var(--dsw-alias-border-l1) 70%, transparent);
  background:color-mix(in srgb, var(--dsw-alias-bg-layer-2) 50%, transparent);color:var(--dsw-alias-label-secondary);
  width:28px;height:28px;border-radius:9px;cursor:pointer;font:inherit;font-size:14px;line-height:1;display:inline-flex;align-items:center;justify-content:center;}
.inbox-x:hover{color:var(--dsw-alias-label-primary);border-color:color-mix(in srgb, var(--dsw-alias-brand-primary) 50%, transparent);}
.inbox-modal-body{flex:1;min-height:120px;display:flex;align-items:center;justify-content:center;overflow:auto;padding:16px;
  background:color-mix(in srgb, var(--dsw-alias-bg-layer-2) 36%, transparent);}
.inbox-modal-body img{max-width:100%;max-height:64vh;object-fit:contain;border-radius:10px;display:block;
  box-shadow:0 18px 50px rgba(0,0,0,.32);}
.inbox-modal-body video{max-width:100%;max-height:64vh;border-radius:10px;background:#000;}
.inbox-modal-body audio{width:min(560px,78vw);}
.inbox-pdf{width:min(980px,86vw);height:66vh;border:0;border-radius:10px;background:#fff;}
.inbox-text{margin:0;width:min(920px,86vw);max-height:62vh;overflow:auto;white-space:pre-wrap;word-break:break-word;
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:1.7;padding:14px 16px;border-radius:12px;
  background:color-mix(in srgb, var(--dsw-alias-bg-base) 72%, transparent);
  border:1px solid color-mix(in srgb, var(--dsw-alias-border-l1) 66%, transparent);color:var(--dsw-alias-label-primary);}
.inbox-preview-hint{display:flex;flex-direction:column;align-items:center;gap:12px;padding:26px 26px 30px;color:var(--dsw-alias-label-secondary);text-align:center;}
.inbox-preview-hint p{margin:0;font-size:12.5px;line-height:1.8;max-width:420px;}
.inbox-bigicon{width:82px;height:82px;border-radius:20px;display:flex;align-items:center;justify-content:center;
  background:color-mix(in srgb, var(--dsw-alias-brand-primary) 16%, transparent);
  border:1px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 34%, transparent);
  color:var(--dsw-alias-brand-primary);font-size:15px;font-weight:800;letter-spacing:.06em;}
.inbox-modal-foot{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:12px 16px;
  border-top:1px solid color-mix(in srgb, var(--dsw-alias-border-l1) 70%, transparent);}
.inbox-foot-spacer{flex:1;}
.inbox-nav{display:flex;gap:6px;}
.inbox-nav-btn{appearance:none;width:30px;height:30px;border-radius:9px;cursor:pointer;font:inherit;font-size:14px;line-height:1;
  border:1px solid color-mix(in srgb, var(--dsw-alias-border-l1) 66%, transparent);
  background:color-mix(in srgb, var(--dsw-alias-bg-layer-2) 44%, transparent);color:var(--dsw-alias-label-secondary);
  display:inline-flex;align-items:center;justify-content:center;}
.inbox-nav-btn:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:color-mix(in srgb, var(--dsw-alias-brand-primary) 50%, transparent);}
.inbox-nav-btn:disabled{opacity:.35;cursor:default;}
`

    function InboxIcon(props) {
      const size = props !== null && props !== undefined && props.size !== undefined ? props.size : 18
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 16 16',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.3,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
      },
        h('path', { d: 'M2.4 9.1h2.9l1.1 2.1h3.2l1.1-2.1h2.9' }),
        h('path', { d: 'M2.4 9.1V4.2c0-.6.4-1 1-1h9.2c.6 0 1 .4 1 1v4.9' }),
        h('path', { d: 'M2.4 9.1v2.7c0 .6.4 1 1 1h9.2c.6 0 1-.4 1-1V9.1' }),
        h('path', { d: 'M8 6.4V1.9' }),
        h('path', { d: 'M6.3 3.4 8 1.6l1.7 1.8' }))
    }

    /** 预览弹层：图片 / 视频 / 音频 / PDF / 文本，其余给提示。 */
    function PreviewModal(props) {
      const t = props.t
      const item = props.item
      const src = props.mediaUrl(item)
      const [textState, setTextState] = React.useState({ phase: 'idle', text: '' })
      const [armed, setArmed] = React.useState(false)

      React.useEffect(() => {
        setArmed(false)
      }, [item.name])

      React.useEffect(() => {
        if (item.kind !== 'text') {
          setTextState({ phase: 'idle', text: '' })
          return undefined
        }
        let cancelled = false
        setTextState({ phase: 'loading', text: '' })
        fetch(item.url)
          .then(response => response.text())
          .then(text => {
            if (cancelled) return
            const clipped = text.length > TEXT_PREVIEW_CHARS
            setTextState({ phase: 'ready', text: text.slice(0, TEXT_PREVIEW_CHARS) + (clipped ? '\n\n……' : '') })
          })
          .catch(error => {
            if (!cancelled) setTextState({ phase: 'error', text: String(error && error.message ? error.message : error) })
          })
        return () => { cancelled = true }
      }, [item.name, item.kind, item.url])

      React.useEffect(() => {
        const onKey = event => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            props.onClose()
          } else if (event.key === 'ArrowLeft') {
            props.onNav(-1)
          } else if (event.key === 'ArrowRight') {
            props.onNav(1)
          }
        }
        document.addEventListener('keydown', onKey, true)
        return () => document.removeEventListener('keydown', onKey, true)
      }, [props.onClose, props.onNav])

      let media
      if (item.kind === 'image') {
        media = h('img', { src, alt: item.name })
      } else if (item.kind === 'video') {
        media = h('video', { src, controls: true, autoPlay: true, playsInline: true, preload: 'metadata' })
      } else if (item.kind === 'audio') {
        media = h('audio', { src, controls: true, autoPlay: true })
      } else if (item.kind === 'pdf') {
        media = h('iframe', { className: 'inbox-pdf', src, title: item.name })
      } else if (item.kind === 'text') {
        if (textState.phase === 'ready') {
          media = h('pre', { className: 'inbox-text' }, textState.text)
        } else if (textState.phase === 'error') {
          media = h('div', { className: 'inbox-preview-hint' },
            h('div', { className: 'inbox-bigicon' }, String(item.ext || 'TXT').toUpperCase()),
            h('p', null, textState.text))
        } else {
          media = h('div', { className: 'inbox-preview-hint' },
            h('div', { className: 'inbox-spinner' }),
            h('p', null, t.loading))
        }
      } else {
        media = h('div', { className: 'inbox-preview-hint' },
          h('div', { className: 'inbox-bigicon' }, String(item.ext || 'FILE').toUpperCase().slice(0, 5)),
          h('p', null, item.kind === 'text' ? t.htmlHint : t.noPreview))
      }

      const copyLabel = item.kind === 'image' ? t.copyImage : t.copyFile
      return h('div', {
        className: 'inbox-overlay',
        onMouseDown: event => { if (event.target === event.currentTarget) props.onClose() },
      },
        h('div', { className: 'inbox-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': item.name },
          h('div', { className: 'inbox-modal-head' },
            h('div', { className: 'inbox-modal-title', title: item.name }, item.name),
            h('div', { className: 'inbox-modal-sub' }, formatBytes(item.size)),
            h('div', { className: 'inbox-modal-sub' }, formatWhen(item.mtime, t)),
            h('button', { type: 'button', className: 'inbox-x', onClick: props.onClose, title: t.close, 'aria-label': t.close }, '×')),
          h('div', { className: 'inbox-modal-body' }, media),
          h('div', { className: 'inbox-modal-foot' },
            h('button', {
              type: 'button',
              className: 'inbox-btn inbox-btn-primary',
              disabled: props.busy,
              onClick: () => props.onCopy(item),
            }, copyLabel),
            h('button', {
              type: 'button',
              className: 'inbox-btn',
              disabled: props.busy,
              onClick: () => props.onReveal(item),
            }, t.reveal),
            h('button', {
              type: 'button',
              className: 'inbox-btn',
              disabled: props.busy,
              onClick: () => props.onOpen(item),
            }, t.open),
            h('div', { className: 'inbox-foot-spacer' }),
            h('button', {
              type: 'button',
              className: 'inbox-btn inbox-btn-danger',
              disabled: props.busy,
              'data-armed': armed ? 'true' : 'false',
              onClick: () => {
                if (!armed) {
                  setArmed(true)
                  return
                }
                setArmed(false)
                props.onDelete(item)
              },
            }, armed ? t.delConfirm : t.del),
            h('div', { className: 'inbox-nav' },
              h('button', {
                type: 'button', className: 'inbox-nav-btn', title: t.prev, 'aria-label': t.prev,
                disabled: props.index <= 0, onClick: () => props.onNav(-1),
              }, '‹'),
              h('button', {
                type: 'button', className: 'inbox-nav-btn', title: t.next, 'aria-label': t.next,
                disabled: props.index < 0 || props.index >= props.total - 1, onClick: () => props.onNav(1),
              }, '›')))))
    }

    function Card(props) {
      const t = props.t
      const item = props.item
      const isImage = item.kind === 'image'
      const src = isImage ? props.mediaUrl(item) : null
      const onDragStart = event => {
        try {
          const absolute = props.mediaUrl(item)
          event.dataTransfer.effectAllowed = 'copy'
          event.dataTransfer.setData('DownloadURL', dragMime(item) + ':' + item.name + ':' + absolute)
          event.dataTransfer.setData('text/uri-list', absolute)
        } catch {
          /* 拖不出去就算了，复制按钮兜底 */
        }
      }
      return h('div', {
        className: 'inbox-card',
        role: 'button',
        tabIndex: 0,
        draggable: true,
        onDragStart,
        title: item.name,
        onClick: () => props.onOpenPreview(item),
        onKeyDown: event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            props.onOpenPreview(item)
          }
        },
      },
        h('div', { className: 'inbox-thumb' },
          isImage
            ? h('img', { src, alt: '', loading: 'lazy', draggable: false })
            : item.kind === 'video'
              ? h('div', { className: 'inbox-thumb-icon' },
                h('div', { className: 'inbox-play' }, '▶'),
                h('div', { className: 'inbox-ext' }, String(item.ext || 'video').toUpperCase().slice(0, 6)))
              : h('div', { className: 'inbox-thumb-icon' }, h('div', { className: 'inbox-ext' }, String(item.ext || 'file').toUpperCase().slice(0, 6))),
          h('div', { className: 'inbox-kind' }, kindLabel(item, t)),
          h('div', { className: 'inbox-quick' },
            h('button', {
              type: 'button',
              className: 'inbox-quick-btn',
              title: item.kind === 'image' ? t.copyImage : t.copyFile,
              onClick: event => { event.stopPropagation(); props.onCopy(item) },
            }, t.copy),
            h('button', {
              type: 'button',
              className: 'inbox-quick-btn',
              title: t.reveal,
              onClick: event => { event.stopPropagation(); props.onReveal(item) },
            }, t.revealShort))),
        h('div', { className: 'inbox-card-foot' },
          h('div', { className: 'inbox-name' }, item.name),
          h('div', { className: 'inbox-meta' },
            h('span', null, formatWhen(item.mtime, t)),
            h('span', null, formatBytes(item.size)))))
    }

    /** 分类卡（一级视图）：跟「项目」面板同款——色点 + 分类名 + 件数 + 对话数/最新时间 + 缩略图。 */
    function CategoryCard(props) {
      const t = props.t
      const cat = props.category
      const images = cat.items.filter(item => item.kind === 'image').slice(0, 3)
      const kindLabels = { image: t.tabImage, video: t.tabVideo, audio: t.tabAudio, doc: t.tabDoc, other: t.tabOther }
      const chips = ['image', 'video', 'audio', 'doc', 'other']
        .filter(kind => (cat.kindCounts[kind] || 0) > 0)
        .map(kind => h('span', { key: kind, className: 'inbox-cat-kind' },
          kindLabels[kind] + ' ' + cat.kindCounts[kind]))
      return h('div', {
        className: 'inbox-cat',
        role: 'button',
        tabIndex: 0,
        title: '打开分类：' + cat.label,
        onClick: props.onOpen,
        onKeyDown: event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            props.onOpen()
          }
        },
      },
        h('div', { className: 'inbox-cat-top' },
          h('span', { className: 'inbox-cat-dot', style: { background: colorOfKey(cat.key) } }),
          h('span', { className: 'inbox-cat-name' }, cat.label),
          h('span', { className: 'inbox-cat-count' }, cat.items.length + ' ' + t.countUnit)),
        h('div', { className: 'inbox-cat-meta' },
          h('span', null, t.catTalks(cat.origins.size)),
          h('span', null, t.latestPrefix + formatWhen(cat.latest, t))),
        images.length > 0
          ? h('div', { className: 'inbox-cat-thumbs' }, images.map(item => h('img', {
            key: item.name,
            className: 'inbox-cat-thumb',
            src: props.mediaUrl(item),
            alt: '',
            loading: 'lazy',
            draggable: false,
          })))
          : null,
        chips.length > 0 ? h('div', { className: 'inbox-cat-kinds' }, chips) : null)
    }

    function InboxPanel() {
      const t = React.useMemo(() => STRINGS[pickLocale()], [])
      const [phase, setPhase] = React.useState('loading')
      const [items, setItems] = React.useState([])
      const [root, setRoot] = React.useState('')
      const [webBase, setWebBase] = React.useState('')
      const [error, setError] = React.useState('')
      const [filter, setFilter] = React.useState('all')
      const [activeProject, setActiveProject] = React.useState(null)
      const [previewName, setPreviewName] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [toast, setToast] = React.useState(null)
      const knownRef = React.useRef(null)
      const toastTimerRef = React.useRef(null)

      const showToast = React.useCallback((text, tone) => {
        setToast({ text: String(text), tone: tone === 'error' ? 'error' : 'ok', id: Date.now() })
      }, [])

      React.useEffect(() => {
        if (toast === null) return undefined
        if (toastTimerRef.current !== null) clearTimeout(toastTimerRef.current)
        toastTimerRef.current = setTimeout(() => setToast(null), TOAST_MS)
        return () => {
          if (toastTimerRef.current !== null) clearTimeout(toastTimerRef.current)
        }
      }, [toast])

      const load = React.useCallback(async () => {
        try {
          const response = await fetch(API + '/list')
          const payload = await response.json().catch(() => null)
          if (!response.ok || payload === null || payload.ok !== true) {
            const message = payload !== null && payload.error !== undefined && payload.error.message !== undefined
              ? payload.error.message
              : 'HTTP ' + response.status
            throw new Error(message)
          }
          const nextItems = Array.isArray(payload.items) ? payload.items : []
          setItems(nextItems)
          setRoot(String(payload.root || ''))
          setWebBase(typeof payload.webBase === 'string' ? payload.webBase : '')
          setPhase('ready')
          setError('')
          const names = new Set(nextItems.map(item => item.name))
          if (knownRef.current !== null) {
            const added = []
            names.forEach(name => { if (!knownRef.current.has(name)) added.push(name) })
            if (added.length > 0) showToast(t.newItems(added.length))
          }
          knownRef.current = names
        } catch (caught) {
          setPhase(previous => (previous === 'ready' ? previous : 'error'))
          setError(caught instanceof Error ? caught.message : String(caught))
        }
      }, [showToast, t])

      React.useEffect(() => {
        void load()
        const timer = setInterval(() => {
          if (document.visibilityState === 'visible') void load()
        }, REFRESH_MS)
        const onVisible = () => { if (document.visibilityState === 'visible') void load() }
        document.addEventListener('visibilitychange', onVisible)
        return () => {
          clearInterval(timer)
          document.removeEventListener('visibilitychange', onVisible)
        }
      }, [load])

      /** 媒体地址：优先用 Host 给的真 http origin（视频要 Range 才能拖进度条）；
       *  页面在 dsh-app:// 下时相对路径走自定义协议，是拖不动进度的根因。 */
      const mediaUrl = React.useCallback(item => {
        const rel = typeof item.url === 'string' ? item.url : ''
        if (webBase !== '' && rel !== '') {
          return webBase.replace(/\/+$/, '') + '/' + rel.replace(/^\/+/, '')
        }
        return rel
      }, [webBase])

      const post = React.useCallback(async (path, body) => {
        const response = await fetch(API + '/' + path, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body === undefined ? {} : body),
        })
        const payload = await response.json().catch(() => null)
        if (!response.ok || payload === null || payload.ok !== true) {
          const message = payload !== null && payload.error !== undefined && payload.error.message !== undefined
            ? payload.error.message
            : 'HTTP ' + response.status
          throw new Error(message)
        }
        return payload
      }, [])

      const runAction = React.useCallback(async (work, successText) => {
        setBusy(true)
        try {
          const result = await work()
          if (successText !== null && successText !== undefined) showToast(successText)
          return result
        } catch (caught) {
          showToast(t.actionFailed + (caught instanceof Error ? caught.message : String(caught)), 'error')
          return null
        } finally {
          setBusy(false)
        }
      }, [showToast, t])

      const copyItem = React.useCallback(item => runAction(
        () => post('copy', { name: item.name }),
        item.kind === 'image' ? t.copiedImage : t.copiedFile,
      ), [post, runAction, t])

      const revealItem = React.useCallback(item => runAction(() => post('reveal', { name: item.name }), null), [post, runAction])

      const openItem = React.useCallback(item => runAction(() => post('open', { name: item.name }), null), [post, runAction])

      const deleteItem = React.useCallback(async item => {
        const result = await runAction(() => post('delete', { name: item.name }), t.deleted)
        if (result !== null) {
          setItems(previous => previous.filter(entry => entry.name !== item.name))
          setPreviewName(previous => (previous === item.name ? null : previous))
          knownRef.current = null
          void load()
        }
      }, [load, post, runAction, t])

      const openFolder = React.useCallback(async () => {
        try {
          await post('open-folder', {})
        } catch (caught) {
          showToast(t.openFailed + (caught instanceof Error ? caught.message : String(caught)), 'error')
        }
      }, [post, showToast, t])

      /** 一级：分类（默认按 project 分；没有 project 的退回按 origin 分）。 */
      const categories = React.useMemo(() => {
        const map = new Map()
        for (const item of items) {
          const project = typeof item.project === 'string' && item.project !== '' ? item.project : ''
          const origin = typeof item.origin === 'string' ? item.origin : ''
          const key = project !== '' ? 'project:' + project : (origin !== '' ? 'origin:' + origin : '')
          const label = project !== '' ? project : (origin !== '' ? origin : t.unlabeled)
          if (!map.has(key)) {
            map.set(key, {
              key,
              label,
              project,
              origins: new Set(),
              items: [],
              latest: 0,
              kindCounts: { image: 0, video: 0, audio: 0, doc: 0, other: 0 },
            })
          }
          const cat = map.get(key)
          cat.items.push(item)
          cat.origins.add(origin !== '' ? origin : label)
          if (item.mtime > cat.latest) cat.latest = item.mtime
          const kindGroup = groupOf(item)
          cat.kindCounts[kindGroup] = (cat.kindCounts[kindGroup] || 0) + 1
        }
        return [...map.values()].sort((a, b) => b.latest - a.latest)
      }, [items, t])

      const category = React.useMemo(
        () => (activeProject === null ? null : categories.find(entry => entry.key === activeProject) || null),
        [activeProject, categories],
      )

      React.useEffect(() => {
        if (activeProject !== null && category === null && phase === 'ready') setActiveProject(null)
      }, [activeProject, category, phase])

      const categoryItems = category === null ? [] : category.items

      const counts = React.useMemo(() => {
        const result = { all: categoryItems.length, image: 0, video: 0, audio: 0, doc: 0, other: 0 }
        for (const item of categoryItems) {
          const group = groupOf(item)
          result[group] = (result[group] || 0) + 1
        }
        return result
      }, [categoryItems])

      const visible = React.useMemo(() => {
        if (category === null) return []
        if (filter === 'all') return categoryItems
        return categoryItems.filter(item => groupOf(item) === filter)
      }, [category, categoryItems, filter])

      /** 二级：按「产出它的对话」分组（没有 origin 就按项目；都没有归「未标注来源」）。 */
      const groups = React.useMemo(() => {
        const map = new Map()
        for (const item of visible) {
          const origin = typeof item.origin === 'string' ? item.origin : ''
          const project = typeof item.project === 'string' ? item.project : ''
          const key = origin !== '' ? origin : (project !== '' ? 'project:' + project : '')
          if (!map.has(key)) map.set(key, { key, origin, project, items: [] })
          map.get(key).items.push(item)
        }
        return [...map.values()]
      }, [visible])

      const previewIndex = React.useMemo(() => {
        if (previewName === null) return -1
        return visible.findIndex(item => item.name === previewName)
      }, [previewName, visible])

      const previewItem = previewIndex >= 0 ? visible[previewIndex] : null

      React.useEffect(() => {
        if (previewName !== null && previewItem === null && phase === 'ready') setPreviewName(null)
      }, [phase, previewItem, previewName])

      const nav = React.useCallback(delta => {
        if (previewIndex < 0) return
        const nextIndex = previewIndex + delta
        if (nextIndex < 0 || nextIndex >= visible.length) return
        setPreviewName(visible[nextIndex].name)
      }, [previewIndex, visible])

      const filterTabs = React.useMemo(() => {
        const tabs = [{ key: 'all', label: t.tabAll }]
        if (counts.image > 0) tabs.push({ key: 'image', label: t.tabImage })
        if (counts.video > 0) tabs.push({ key: 'video', label: t.tabVideo })
        if (counts.audio > 0) tabs.push({ key: 'audio', label: t.tabAudio })
        if (counts.doc > 0) tabs.push({ key: 'doc', label: t.tabDoc })
        if (counts.other > 0) tabs.push({ key: 'other', label: t.tabOther })
        return tabs
      }, [counts, t])

      const styleTag = h('style', null, CSS)

      const renderedBody = category === null
        ? (categories.length === 0
          ? h('div', { className: 'inbox-empty' },
            h('h2', null, t.emptyTitle),
            h('p', null, t.emptyHint),
            h('button', { type: 'button', className: 'inbox-btn inbox-btn-primary', onClick: () => { void openFolder() } }, t.emptyOpen))
          : h('div', { className: 'inbox-cats' }, categories.map(cat => h(CategoryCard, {
            key: cat.key,
            t,
            category: cat,
            mediaUrl,
            onOpen: () => {
              setFilter('all')
              setPreviewName(null)
              setActiveProject(cat.key)
            },
          }))))
        : (visible.length === 0
          ? h('div', { className: 'inbox-empty' },
            h('h2', null, t.categoryEmpty),
            h('p', null, t.emptyHint))
          : h('div', { className: 'inbox-groups' }, groups.map(group => {
            const groupKey = group.key === '' ? '__unknown__' : group.key
            const groupTitle = group.origin !== '' ? group.origin : (group.project !== '' ? group.project : t.unlabeled)
            return h('section', { key: groupKey, className: 'inbox-group' },
              h('div', { className: 'inbox-group-head', title: group.origin !== '' ? '产出这个对话：' + group.origin : undefined },
                h('span', { className: 'inbox-group-dot', style: { background: colorOfKey(group.key) } }),
                h('span', { className: 'inbox-group-title' }, groupTitle),
                h('span', { className: 'inbox-group-count' }, group.items.length + ' ' + t.countUnit)),
              h('div', { className: 'inbox-grid' }, group.items.map(item => h(Card, {
                key: item.name,
                item,
                t,
                mediaUrl,
                onOpenPreview: entry => setPreviewName(entry.name),
                onCopy: copyItem,
                onReveal: revealItem,
              }))))
          })))

      if (phase === 'loading') {
        return h('div', { className: 'inbox-root' }, styleTag,
          h('div', { className: 'inbox-head' }, h('div', { className: 'inbox-head-main' },
            h('div', { className: 'inbox-h1row' }, h('h1', { className: 'inbox-h1' }, t.title)),
            h('div', { className: 'inbox-sub' }, t.sub))),
          h('div', { className: 'inbox-loading' }, h('div', { className: 'inbox-spinner' }), t.loading))
      }

      if (phase === 'error') {
        return h('div', { className: 'inbox-root' }, styleTag,
          h('div', { className: 'inbox-head' }, h('div', { className: 'inbox-head-main' },
            h('div', { className: 'inbox-h1row' }, h('h1', { className: 'inbox-h1' }, t.title)),
            h('div', { className: 'inbox-sub' }, t.sub))),
          h('div', { className: 'inbox-empty' },
            h('h2', null, t.loadFailed),
            h('p', null, error),
            h('button', { type: 'button', className: 'inbox-btn', onClick: () => { setPhase('loading'); void load() } }, t.retry)))
      }

      return h('div', { className: 'inbox-root' }, styleTag,
        h('div', { className: 'inbox-head' },
          h('div', { className: 'inbox-head-main' },
            h('div', { className: 'inbox-h1row' },
              category !== null
                ? h('button', {
                  type: 'button',
                  className: 'inbox-back',
                  onClick: () => {
                    setActiveProject(null)
                    setFilter('all')
                    setPreviewName(null)
                  },
                }, t.backToCategories)
                : null,
              h('h1', { className: 'inbox-h1' }, category !== null ? category.label : t.title),
              h('span', { className: 'inbox-count' },
                (category !== null ? category.items.length : items.length) + ' ' + t.countUnit),
              category === null ? h('span', { className: 'inbox-group-sub' }, t.categoriesCount(categories.length)) : null),
            h('div', { className: 'inbox-sub' }, category === null ? t.subCategories : t.detailHint),
            h('div', { className: 'inbox-sub' }, t.hint)),
          h('div', { className: 'inbox-tools' },
            h('button', { type: 'button', className: 'inbox-btn', onClick: () => { void load() }, title: t.refresh }, '↻ ' + t.refresh),
            h('button', { type: 'button', className: 'inbox-btn', onClick: () => { void openFolder() }, title: root }, t.openFolder))),
        category === null
          ? null
          : h('div', { className: 'inbox-tabs' }, filterTabs.map(tab => h('button', {
            key: tab.key,
            type: 'button',
            className: 'inbox-tab',
            'data-active': filter === tab.key ? 'true' : 'false',
            onClick: () => setFilter(tab.key),
          }, tab.label, h('span', { className: 'inbox-tab-n' }, String(counts[tab.key] || 0))))),
        h('div', { className: 'inbox-body' }, renderedBody),
        previewItem !== null
          ? h(PreviewModal, {
            t,
            item: previewItem,
            index: previewIndex,
            total: visible.length,
            busy,
            mediaUrl,
            onClose: () => setPreviewName(null),
            onNav: nav,
            onCopy: copyItem,
            onReveal: revealItem,
            onOpen: openItem,
            onDelete: deleteItem,
          })
          : null,
        toast === null
          ? null
          : h('div', { className: 'inbox-toast', 'data-tone': toast.tone }, toast.text))
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 21,
          label: () => STRINGS[pickLocale()].entry,
        }, InboxIcon))
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
        }, InboxPanel))
      },
    }
  },
})
