/**
 * SiYuan Plugin: LocalBrowse - 本地文件浏览器
 * 在Dock面板快速浏览本地文件，便捷插入本地文件链接为思源附件
 *
 * Copyright (C) 2026 sqalei
 * Licensed under the GNU General Public License v3.0
 * https://github.com/sqalei/siyuan-plugin-localbrowse
 */

// console.log("[LocalBrowse] === LOADING ===");

var siyuanApi = {};
try {
    siyuanApi = require("siyuan");
} catch (e) {
    siyuanApi = window.siyuan || {};
}

var Plugin = siyuanApi.Plugin;

// Node.js modules (available in desktop environment)
var fs = null;
var path = null;
var os = null;

try {
    fs = require('fs');
    path = require('path');
    os = require('os');
    // console.log("[LocalBrowse] Node.js modules loaded successfully");
} catch (e) {
    console.error("[LocalBrowse] Failed to load Node.js modules:", e);  // 顶层，this 不可用
}

class LocalBrowsePlugin extends Plugin {
    constructor(options) {
        super(options);
        this.dockPanel = null;
        this.currentPath = '';
        this.driveLetter = this.isWindows ? 'C' : '/';  // Windows: 盘符字母; macOS/Linux: 根路径或卷路径
        this.workspacePath = '';
        this.assetsPath = '';
        this.cachedFiles = [];      // 当前目录完整文件列表（用于搜索过滤）
        this.cachedPath = '';       // 当前缓存对应的目录路径
        this.isDeepSearchMode = false; // 是否处于深度搜索模式
        this.preSearchPath = '';    // 深度搜索前所在的目录，用于返回
        this.availableDrives = [];  // 可用存储列表 [{value, label}]
        this.favorites = [];        // 收藏的文件夹列表 [{path, name}]
        this.fileDocMap = {};       // 文件路径 → 文档ID 映射（关联当前文档功能）
        this._selectedItems = [];   // 多选：当前选中的文件项 DOM 元素列表
        this._lastClickedItem = null; // 多选：上次点击的文件项，用于 Shift 范围选择
        this.currentView = 'list';  // 当前视图模式：list | icon
        this.sortBy = 'name';       // 排序方式：name | size | mtime
        this.sortOrder = 'asc';     // 排序顺序：asc | desc
        this.iconRenderState = null; // 图标视图滚动渲染状态
        this.listRenderState = null; // 列表视图分批渲染状态
        this._isScrolling = false;   // 是否正在滚动中（滚动时暂停预览）
        this._scrollEndTimer = null; // 滚动结束检测计时器
        this._thumbQueue = [];       // 缩略图加载队列
        this._thumbLoading = 0;      // 当前正在加载的缩略图数量
        this._scrollPositions = {};  // 目录路径 → 滚动位置，用于返回上级时恢复
        this._searchDebounceTimer = null; // 搜索输入防抖计时器
        // 在构造函数中一次性绑定滚动处理函数，避免每次切换视图时重复创建引用
        this._boundIconScroll = this.onIconScroll.bind(this);
        this._boundListScroll = null; // 列表滚动处理（延迟绑定，避免构造时 this 不完整）
        this._clipboardCut = null;   // 剪切板：记录剪切的文件/文件夹路径 {path, name, isDir}
        this._dragSource = null;    // 拖拽源：当前拖拽的文件信息 {path, name, isDir, el, multiFiles}
        this._linkStatus = 'none';    // 链接状态指示灯: none/green/yellow/red/checking
        this._lastCheckedDocId = '';  // 上次检测的文档 ID，避免重复扫描
        this.pathMap = null;          // 路径映射: { container: '/mnt/sync', host: 'C:\\Users\\sqalei\\坚果云' }
        this.syncRoots = {};          // 跨端同步文件夹: { win32: { "DESKTOP-ABC": "D:\\BaiduSyncdisk" }, darwin: { "macbook-pro": "/Users/sqalei/BaiduSyncdisk" } }
        this._syncRootsLoaded = false;  // syncRoots 是否已从存储加载完成（防止异步竞争）
        this._loadSeq = 0;              // 目录加载版本号，防止异步回调覆盖（竞态条件）
        this._deviceId = '';            // 当前设备标识（用主机名，不随思源同步）
        this.platform = this._detectPlatform();  // 平台检测：win32/darwin/linux
        this.isWindows = (this.platform === 'win32');
        this.platformIcon = this.platform === 'darwin' ? '🍎' : (this.platform === 'linux' ? '🐧' : '🪟');
        this.platformName = this.platform === 'darwin' ? 'macOS' : (this.platform === 'linux' ? 'Linux' : 'Windows');
        this._sep = (path && path.sep) || (this.isWindows ? '\\' : '/');  // 跨平台路径分隔符
        this.debug = localStorage.getItem('cd_debug') === 'true';  // 调试日志开关，默认关闭
        this._audioEl = null;      // 音频播放器
        this._audioPlaylist = [];  // 当前目录音频列表
        this._audioIndex = -1;     // 当前播放索引
        this._audioCurrentPath = null;  // 当前播放音频的本地路径
        this._audioCurrentName = null;  // 当前播放音频的文件名（单独存储，避免从路径中二次提取）
        this._audioEventsBound = false;  // 防止重复绑定
        this._lrcLines = [];       // 解析后的歌词行 [{time, text}, ...]
        this._lrcActiveIndex = -1; // 当前高亮歌词行索引
        this._lrcExpanded = false; // 歌词面板是否展开
        this._lastAudioHighlight = null; // 文件列表中上次高亮的音频项
        this._audioPlayerClosed = false; // 用户是否手动关闭了播放器（关闭后下次启动不再恢复）
        this._audioPlayMode = parseInt(localStorage.getItem('cd_audio_mode') || '0', 10) || 0; // 播放模式：0=随机播放，1=列表循环，2=单曲循环
        this._audioShouldAutoPlay = false; // 设置 src 后 canplay 时是否自动播放（恢复状态时不自动播放）
        this._audioLoadTimer = null; // loading 状态延迟显示定时器（避免本地文件快速切换时闪烁）
        this._savedVolume = parseFloat(localStorage.getItem('cd_audio_volume'));
        if (isNaN(this._savedVolume) || this._savedVolume < 0 || this._savedVolume > 1) {
            this._savedVolume = 0.8; // 默认音量
        }
        // 预加载缓存：提前准备下一首的封面、歌词，切歌时瞬间切换
        this._preloadData = null; // {path, nextIdx, coverUrl, coverIsBlob, coverBlurUrl, lrcLines, lrcTitle, lrcArtist}
        this._playlistBuildSeq = 0; // 播放列表构建版本号，防止异步回调覆盖
        this._pendingCoverBlobRevoke = null; // crossfade 完成后待释放的旧封面 blob URL
        this._pendingBlurBlobRevoke = null; // crossfade 完成后待释放的旧模糊缩略图 blob URL
        this._coverFadeEpoch = 0; // crossfade 世代计数器，快速切歌时旧 cleanup 自动失效
        this._lrcBgFadeEpoch = 0; // 歌词背景 crossfade 世代计数器
        // 本地文件：展开的文件夹路径集合（点击小房子返回根目录时折叠所有）
        this._expandedDirs = new Set();
        // 内部资源面板：路径导航状态
        this._assetsNavStack = []; // 导航栈 [{type:'notebook'|'doc', id, name, node}]
        this._assetsCurrentView = 'list'; // 内部资源视图模式：list | icon
        this._assetsExtFilter = null; // 格式筛选（如 'png', 'jpg'）
        this._assetsSizeFilter = 0; // 大小筛选阈值（字节），0=不筛选
        this._bigFileThreshold = 10 * 1024 * 1024; // 10MB
    }

    /**
     * 调试日志：仅在 debug 开关开启时输出
     * 用法：this._log('消息') 或 this._log('消息', 附加数据)
     */
    _log(msg, data) {
        if (!this.debug) return;
        if (data !== undefined) {
            console.log('[LocalBrowse] ' + msg, data);
        } else {
            console.log('[LocalBrowse] ' + msg);
        }
    }

    /**
     * 错误日志：始终输出（错误信息不应被静默）
     */
    _error(msg, data) {
        if (data !== undefined) {
            console.error('[LocalBrowse] ' + msg, data);
        } else {
            console.error('[LocalBrowse] ' + msg);
        }
    }

    /**
     * macOS APFS firmlink 路径规范化
     * /System/Volumes/Data/Users/... → /Users/...
     * 这两个路径指向同一个文件，统一为短路径形式
     */
    _normalizeMacPath(p) {
        if (!p || typeof p !== 'string') return p;
        // /System/Volumes/Data/ 前缀替换为 /
        if (p.indexOf('/System/Volumes/Data/') === 0) {
            return p.substring('/System/Volumes/Data'.length);
        }
        return p;
    }

    /**
     * 搜索结果去重：macOS firmlink 导致同一文件出现两个路径
     * 规范化后去重，保留规范化后路径较短的那个（即 /Users/... 而非 /System/Volumes/Data/Users/...）
     */
    _dedupCandidates(candidates) {
        if (!candidates || candidates.length <= 1) return candidates;
        var seen = {};
        var deduped = [];
        for (var i = 0; i < candidates.length; i++) {
            var c = candidates[i];
            var norm = this._normalizeMacPath(c.fullPath);
            if (seen[norm]) {
                this._log('_dedupCandidates - removing firmlink duplicate:', c.fullPath, '→ same as', seen[norm]);
                continue;
            }
            seen[norm] = c.fullPath;
            // 如果路径是 firmlink 长路径，替换为规范化短路径
            if (c.fullPath !== norm) {
                c.fullPath = norm;
            }
            deduped.push(c);
        }
        return deduped;
    }

    onload() {
        this._log("onload");
        this.registerIcons();
        this.loadFavorites();
        this.loadFileDocMap();
        this.loadSortSettings();
        this.loadDriveSettings();
        this.loadViewSettings();
        this.loadPathSettings();
        this.loadPathMap();
        this.loadSyncRoots();
        this.registerDock();
        this.registerEditorDropHandler();

        // 链接指示灯初始化 + 自动检测
        var that = this;
        that._linkInitTimeout = setTimeout(function() {
            that._updateLinkIndicator('green');
            that._autoCheckLinks();
            that._linkCheckInterval = setInterval(function() { that._autoCheckLinks(); }, 5000);
            // 监听文档切换：focusin 事件（用户点击编辑区时触发）
            that._linkFocusHandler = function() {
                // 延迟 300ms 执行，避免 focusin 和 click 事件冲突
                clearTimeout(that._linkFocusDebounce);
                that._linkFocusDebounce = setTimeout(function() {
                    var newDocId = that.getCurrentDocId();
                    if (newDocId && newDocId !== that._lastCheckedDocId) {
                        that._autoCheckLinks();
                    }
                }, 300);
            };
            document.addEventListener('focusin', that._linkFocusHandler);
        }, 2000);

        // 注册链接点击拦截器：处理带 fragment（#size=xxx&mtime=xxx）的 file:/// 链接
        // Windows 会把 fragment 当作文件名一部分，导致打不开文件
        this.registerLinkClickInterceptor();
    }

    onunload() {
        this._log("onunload");
        // 清理右键菜单残留的 document 级监听器
        this.hideContextMenu();
        // 清理滚动监听器
        if (this._boundIconScroll) {
            var fileListEl = document.getElementById('cd-file-list');
            if (fileListEl) {
                fileListEl.removeEventListener('scroll', this._boundIconScroll);
            }
        }
        if (this._boundListScroll) {
            var fileListEl2 = document.getElementById('cd-file-list');
            if (fileListEl2) {
                fileListEl2.removeEventListener('scroll', this._boundListScroll);
            }
        }
        // 清理预览计时器
        if (this._previewTimer) {
            clearTimeout(this._previewTimer);
            this._previewTimer = null;
        }
        // 清理滚动防抖计时器
        if (this._scrollTimer) {
            clearTimeout(this._scrollTimer);
            this._scrollTimer = null;
        }
        // 清理滚动结束检测计时器
        if (this._scrollEndTimer) {
            clearTimeout(this._scrollEndTimer);
            this._scrollEndTimer = null;
        }
        // 清理图标渲染状态
        this.iconRenderState = null;
        // 清理列表渲染状态
        this.listRenderState = null;
        // 清理缩略图队列
        this._thumbQueue = [];
        this._thumbLoading = 0;
        // 清理链接指示灯定时器
        if (this._linkInitTimeout) {
            clearTimeout(this._linkInitTimeout);
            this._linkInitTimeout = null;
        }
        if (this._linkCheckInterval) {
            clearInterval(this._linkCheckInterval);
            this._linkCheckInterval = null;
        }
        if (this._linkFocusHandler) {
            document.removeEventListener('focusin', this._linkFocusHandler);
            this._linkFocusHandler = null;
        }
        if (this._linkFocusDebounce) {
            clearTimeout(this._linkFocusDebounce);
            this._linkFocusDebounce = null;
        }
        // 清理搜索防抖计时器
        if (this._searchDebounceTimer) {
            clearTimeout(this._searchDebounceTimer);
            this._searchDebounceTimer = null;
        }
        // 清理编辑器拖拽 drop 处理器
        if (this._editorDragOverHandler) {
            document.removeEventListener('dragover', this._editorDragOverHandler, true);
            this._editorDragOverHandler = null;
        }
        if (this._editorDropHandler) {
            document.removeEventListener('drop', this._editorDropHandler, true);
            this._editorDropHandler = null;
        }
        // 清理链接点击拦截器
        if (this._linkClickInterceptor) {
            document.removeEventListener('click', this._linkClickInterceptor, true);
            this._linkClickInterceptor = null;
        }
        // 清理拖拽源引用
        this._dragSource = null;
        // 清理拖拽高亮监听器
        if (this._clearDragHighlight) {
            document.removeEventListener('dragend', this._clearDragHighlight, true);
            document.removeEventListener('drop', this._clearDragHighlight, true);
            this._clearDragHighlight = null;
            this._dragEndListenerSet = false;
        }
        // 取消正在进行的深度搜索
        if (this._deepSearchAbort) {
            this._deepSearchAbort.cancelled = true;
            this._deepSearchAbort = null;
        }
        // 清理 sortMenu 的 document 点击监听器
        if (this._sortMenuClickHandler) {
            document.removeEventListener('click', this._sortMenuClickHandler);
            this._sortMenuClickHandler = null;
        }
        // 清理同步文件夹内联面板的 document 点击监听器
        if (this._syncRootInlineClickHandler) {
            document.removeEventListener('click', this._syncRootInlineClickHandler);
            this._syncRootInlineClickHandler = null;
            this._syncRootInlineCloseBound = false;
        }
        // 清理排序菜单 DOM 残留
        var sortMenu = document.getElementById('cd-sort-menu');
        if (sortMenu) sortMenu.remove();
        // 清理 toast 定时器
        if (this._toastTimer1) {
            clearTimeout(this._toastTimer1);
            this._toastTimer1 = null;
        }
        if (this._toastTimer2) {
            clearTimeout(this._toastTimer2);
            this._toastTimer2 = null;
        }
        // 清理搜索渲染计时器
        if (this._searchRenderTimer) {
            clearTimeout(this._searchRenderTimer);
            this._searchRenderTimer = null;
        }
        // 清理 Dock 面板引用，避免内存泄漏
        this.dockPanel = null;
        // 保存音频播放器状态（如果用户没有手动关闭）
        if (this._audioEl && this._audioCurrentPath && !this._audioPlayerClosed) {
            // 优先使用单独存储的文件名，避免从路径提取时分隔符不匹配
            var fileName = this._audioCurrentName;
            if (!fileName) {
                var sep = this._sep;
                var lastSep = this._audioCurrentPath.lastIndexOf(sep);
                if (lastSep < 0) {
                    var altSep = (sep === '\\' || sep === '\\\\') ? '/' : '\\';
                    var altIdx = this._audioCurrentPath.lastIndexOf(altSep);
                    if (altIdx > lastSep) lastSep = altIdx;
                }
                fileName = lastSep >= 0 ? this._audioCurrentPath.substring(lastSep + 1) : this._audioCurrentPath;
            }
            this._saveAudioState(this._audioCurrentPath, fileName);
        }
        // 清理音频播放器
        if (this._audioEl) {
            this._audioEl.pause();
            this._audioEl.src = '';
            this._audioEl = null;
        }
        // 清理 loading 延迟定时器
        if (this._audioLoadTimer) {
            clearTimeout(this._audioLoadTimer);
            this._audioLoadTimer = null;
        }
        // 清理预加载数据
        if (this._preloadData) {
            if (this._preloadData.coverIsBlob && this._preloadData.coverUrl) {
                URL.revokeObjectURL(this._preloadData.coverUrl);
            }
            if (this._preloadData.coverBlurUrl) {
                URL.revokeObjectURL(this._preloadData.coverBlurUrl);
            }
            this._preloadData = null;
        }
        // 清理封面 ObjectURL
        function revokeBlobBg(elId) {
            var el = document.getElementById(elId);
            if (el && el.style.backgroundImage) {
                var bgUrl = el.style.backgroundImage;
                if (bgUrl.indexOf('blob:') !== -1) {
                    URL.revokeObjectURL(bgUrl.replace(/^url\(["']?/, '').replace(/["']?\)$/, ''));
                }
            }
        }
        revokeBlobBg('cd-audio-cover');
        revokeBlobBg('cd-audio-lrc-bg');
        // 清理 crossfade 待释放的 blob URL（可能在 crossfade 过渡中被延迟释放）
        if (this._pendingCoverBlobRevoke) {
            try { URL.revokeObjectURL(this._pendingCoverBlobRevoke); } catch(x) {}
            this._pendingCoverBlobRevoke = null;
        }
        if (this._pendingBlurBlobRevoke) {
            try { URL.revokeObjectURL(this._pendingBlurBlobRevoke); } catch(x) {}
            this._pendingBlurBlobRevoke = null;
        }
        this._lrcLines = [];
        this._lrcActiveIndex = -1;
        this._lrcExpanded = false;
    }

    uninstall() {
        this._log("uninstall");
        this.removeData('favorites');
        this.removeData('sortSettings');
        this.removeData('driveSettings');
        this.removeData('viewSettings');
        this.removeData('pathSettings');
    }

    registerIcons() {
        // 文件夹图标
        var svg = '<symbol id="iconLocalBrowse" viewBox="0 0 24 24"><path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10z"/></symbol>';
        try {
            this.addIcons(svg);
        } catch (e) {
            this._error("addIcons failed:", e);
        }
    }

    registerDock() {
        var that = this;
        // 安全获取 i18n dock 标题
        var dockTitle = '本地文件';
        try {
            if (this.i18n) {
                if (typeof this.i18n === 'function') {
                    dockTitle = this.i18n('panel.dockTitle') || dockTitle;
                } else if (this.i18n.panel && this.i18n.panel.dockTitle) {
                    dockTitle = this.i18n.panel.dockTitle;
                }
            }
        } catch(e) {
            console.warn('[LocalBrowse] i18n fallback:', e);
        }
        try {
            this.addDock({
                config: {
                    position: 'RightTop',
                    size: { width: 300, height: 600 },
                    icon: 'iconLocalBrowse',
                    title: dockTitle,
                    show: true
                },
                data: {},
                type: 'cd_filetree',
                init: function() {
                    that.dockPanel = this;
                    that.renderFileTree();
                },
                destroy: function() {
                    that._log('Dock destroyed');
                    // Dock 销毁时清理资源，防止长时间闲置后重建时的冲突
                    that.hideContextMenu();
                    if (that._boundIconScroll) {
                        var fileListEl = document.getElementById('cd-file-list');
                        if (fileListEl) {
                            fileListEl.removeEventListener('scroll', that._boundIconScroll);
                        }
                        that._boundIconScroll = null;
                    }
                    if (that._previewTimer) {
                        clearTimeout(that._previewTimer);
                        that._previewTimer = null;
                    }
                    if (that._searchRenderTimer) {
                        clearTimeout(that._searchRenderTimer);
                        that._searchRenderTimer = null;
                    }
                    if (that._scrollEndTimer) {
                        clearTimeout(that._scrollEndTimer);
                        that._scrollEndTimer = null;
                    }
                    if (that._scrollTimer) {
                        clearTimeout(that._scrollTimer);
                        that._scrollTimer = null;
                    }
                    if (that._toastTimer1) {
                        clearTimeout(that._toastTimer1);
                        that._toastTimer1 = null;
                    }
                    if (that._toastTimer2) {
                        clearTimeout(that._toastTimer2);
                        that._toastTimer2 = null;
                    }
                    // 取消正在进行的深度搜索
                    if (that._deepSearchAbort) {
                        that._deepSearchAbort.cancelled = true;
                        that._deepSearchAbort = null;
                    }
                    that.hideImagePreview();
                }
            });
            this._log("Dock registered");
        } catch (e) {
            this._error("addDock failed:", e);
        }
    }

    renderFileTree() {
        if (!this.dockPanel || !this.dockPanel.element) return;
        
        // Docker/浏览器版：构造函数执行时 window.siyuan.config.system 可能还没就绪，
        // 导致平台被错误检测为 win32。Dock 面板渲染时重新检测并修正。
        this._correctPlatformIfNeeded();

        // DOM 重建后需要重新绑定事件
        this._audioEventsBound = false;

        var that = this;
        var el = this.dockPanel.element;
        
        var isDocker = that._isDockerBrowser();
        var activeTab = that._activeTab || 'local';
        el.innerHTML = '<div class="cd-container" style="height:100%;display:flex;flex-direction:column;padding:4px;box-sizing:border-box;font-size:13px;overflow:hidden;position:relative">' +
            // === Tab 栏 ===
            '<div id="cd-tab-bar" style="display:flex;align-items:center;flex-shrink:0;border-bottom:1px solid var(--b3-border,#e0e0e0);margin-bottom:4px">' +
                '<button class="cd-tab-btn' + (activeTab === 'local' ? ' cd-tab-active' : '') + '" data-tab="local" style="padding:6px 12px;font-size:12px;background:transparent;border:none;border-bottom:2px solid ' + (activeTab === 'local' ? 'var(--b3-theme-primary,#4285f4)' : 'transparent') + ';color:' + (activeTab === 'local' ? 'var(--b3-theme-primary,#4285f4)' : 'var(--b3-theme-secondary,#999)') + ';cursor:pointer;transition:all 0.2s;flex-shrink:0">📁 本地文件</button>' +
                '<button class="cd-tab-btn' + (activeTab === 'assets' ? ' cd-tab-active' : '') + '" data-tab="assets" style="padding:6px 12px;font-size:12px;background:transparent;border:none;border-bottom:2px solid ' + (activeTab === 'assets' ? 'var(--b3-theme-primary,#4285f4)' : 'transparent') + ';color:' + (activeTab === 'assets' ? 'var(--b3-theme-primary,#4285f4)' : 'var(--b3-theme-secondary,#999)') + ';cursor:pointer;transition:all 0.2s;flex-shrink:0">📦 内部资源</button>' +
            '</div>' +
            // === 本地文件面板 ===
            '<div id="cd-panel-local" style="display:' + (activeTab === 'local' ? 'flex' : 'none') + ';flex-direction:column;flex:1;overflow:hidden">' +
                '<div style="margin-bottom:2px;display:flex;align-items:center;flex-shrink:0;gap:2px;height:28px">' +
                    '<select id="cd-drive-select" style="padding:3px 6px;font-size:12px;border:1px solid var(--b3-border,#ddd);border-radius:4px;background:var(--b3-theme-background,#fff);color:var(--b3-theme-on-background,#333);cursor:pointer;outline:none;min-width:60px"></select>' +
                    '<button id="cd-syncroot-pill" style="padding:2px 6px;font-size:11px;background:var(--b3-theme-surface,#f0f0f0);color:#4caf50;border:1px solid #4caf50;border-radius:10px;' + (isDocker ? 'opacity:0.35;cursor:not-allowed;' : 'cursor:pointer;opacity:0.7;transition:opacity 0.2s;') + 'flex-shrink:0;white-space:nowrap" title="' + (isDocker ? 'Docker浏览器环境不支持跨端同步' : '右键添加同步文件夹') + '" ' + (isDocker ? 'disabled' : 'onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.7"') + '>🔄 跨端同步文件夹</button>' +
                    '<div id="cd-favorites-list" style="flex:1;display:flex;align-items:center;gap:4px;overflow:hidden;min-width:0"></div>' +
                    '<button id="cd-view-toggle" style="padding:4px 8px;font-size:11px;background:transparent;color:var(--b3-theme-secondary,#999);border:1px solid var(--b3-border,#ddd);border-radius:4px;cursor:pointer;opacity:0.6;transition:opacity 0.2s;flex-shrink:0" title="切换为图标视图" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.6">☰</button>' +
                    '<button id="cd-relink-btn" style="padding:4px 8px;font-size:14px;background:transparent;border:none;cursor:pointer;flex-shrink:0;opacity:0.6;transition:opacity 0.2s" title="点击修复失效链接" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.6">🔘</button>' +
                '</div>' +
                '<div id="cd-syncroot-inline" style="margin-bottom:2px;padding:6px 8px;background:var(--b3-theme-surface,#f0f0f0);border-radius:4px;display:none;flex-shrink:0">' +
                    '<div style="display:flex;align-items:center;gap:6px;margin-bottom:2px">' +
                        '<span style="font-size:12px;color:var(--b3-theme-on-background,#333);font-weight:700">跨端同步文件夹</span>' +
                        '<span style="font-size:10px;padding:1px 6px;background:var(--b3-theme-background,#fff);border:1px solid var(--b3-border,#ddd);border-radius:8px;color:var(--b3-theme-secondary,#888);line-height:1.4" title="' + this._getDeviceId() + '">' + this.platformName + '</span>' +
                    '</div>' +
                    '<div style="font-size:9px;color:var(--b3-theme-secondary,#888);margin-bottom:4px;line-height:1.3">选择网盘同步目录的父文件夹，将自动创建 LocalBrowseSync 子文件夹</div>' +
                    '<div style="display:flex;gap:4px;align-items:center">' +
                        '<input id="cd-syncroot-path" type="text" placeholder="如 D:\\BaiduSyncdisk（自动拼接 LocalBrowseSync）" style="flex:1;min-width:0;padding:3px 6px;font-size:11px;border:1px solid var(--b3-border,#ddd);border-radius:3px;background:var(--b3-theme-background,#fff);color:var(--b3-theme-on-background,#333);outline:none">' +
                        '<button id="cd-syncroot-browse" style="padding:3px 6px;font-size:11px;background:transparent;color:var(--b3-theme-secondary,#999);border:1px solid var(--b3-border,#ddd);border-radius:3px;cursor:pointer;flex-shrink:0" title="浏览选择父文件夹">📂</button>' +
                        '<button id="cd-syncroot-save" style="padding:3px 8px;font-size:11px;background:#ccc;color:#888;border:none;border-radius:3px;cursor:default;flex-shrink:0">保存</button>' +
                        '<button id="cd-syncroot-clear" style="padding:3px 6px;font-size:11px;background:transparent;color:var(--b3-theme-error,#d32f2f);border:1px solid var(--b3-border,#ddd);border-radius:3px;cursor:pointer;flex-shrink:0" title="清除同步文件夹">✕</button>' +
                    '</div>' +
                '</div>' +
                '<div id="cd-search-wrap" style="margin-bottom:2px;position:relative;flex-shrink:0;height:28px;display:none">' +
                    '<input id="cd-search" type="text" placeholder="搜索当前目录（按 Enter 深度搜索）..." style="width:100%;height:28px;line-height:1;padding:0 56px 0 10px;box-sizing:border-box;font-size:12px;border:1px solid var(--b3-border,#ddd);border-radius:4px;background:var(--b3-theme-background,#fff);color:var(--b3-theme-on-background,#333);outline:none">' +
                    '<button id="cd-deep-search" style="position:absolute;right:24px;top:50%;transform:translateY(-50%);padding:0 4px;font-size:13px;line-height:1;background:transparent;border:none;color:var(--b3-theme-secondary,#999);cursor:pointer;opacity:0.6;transition:opacity 0.2s" title="深度搜索子目录" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.6">🔍</button>' +
                    '<button id="cd-clear-search" style="position:absolute;right:6px;top:50%;transform:translateY(-50%);padding:0 4px;font-size:14px;line-height:1;background:transparent;border:none;color:var(--b3-theme-secondary,#999);cursor:pointer;display:none">×</button>' +
                '</div>' +
                '<div style="margin-bottom:2px;display:flex;align-items:center;gap:2px;flex-shrink:0;background:transparent;border:none;height:24px">' +
                    '<div id="cd-breadcrumb" style="flex:1;padding:0 0 0 8px;font-size:12px;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:transparent;border:none;display:flex;align-items:center"></div>' +
                    '<button id="cd-sort-btn" style="padding:4px 8px;font-size:11px;background:transparent;color:var(--b3-theme-secondary,#999);border:1px solid var(--b3-border,#ddd);border-radius:4px;cursor:pointer;opacity:0.6;transition:opacity 0.2s;flex-shrink:0;white-space:nowrap" title="排序" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.6">⇅ 名称</button>' +
                '</div>' +
                '<div id="cd-file-list" style="flex:1;overflow-y:auto;border:1px solid var(--b3-border,#e0e0e0);border-radius:4px;background:var(--b3-theme-background,#fff);min-height:0">' +
                    '<div style="padding:20px;text-align:center;color:#999">Loading...</div>' +
                '</div>' +
                '<div id="cd-stats-bar" style="padding:6px 10px;font-size:11px;color:var(--b3-theme-secondary,#999);flex-shrink:0;display:flex;align-items:center;gap:12px;border-top:1px solid var(--b3-border,#eee);min-height:20px;white-space:nowrap;overflow:hidden">' +
                    '<span id="cd-stats-text" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">📊 加载中...</span>' +
                    '<span id="cd-platform-badge" title="' + this.platformName + '" style="margin-left:auto;font-size:10px;font-weight:600;letter-spacing:0.3px;color:rgba(190,190,190,0.8);cursor:default;text-shadow:0 -1px 0 rgba(0,0,0,0.4)">' + this.platformName + '</span>' +
                '</div>' +
            '</div>' +
            // === 内部资源面板 ===
            '<div id="cd-panel-assets" style="display:' + (activeTab === 'assets' ? 'flex' : 'none') + ';flex-direction:column;flex:1;overflow:hidden">' +
                '<div style="margin-bottom:2px;display:flex;align-items:center;flex-shrink:0;gap:6px;height:28px">' +
                    '<select id="cd-assets-filter" style="padding:3px 6px;font-size:12px;border:1px solid var(--b3-border,#ddd);border-radius:4px;background:var(--b3-theme-background,#fff);color:var(--b3-theme-on-background,#333);cursor:pointer;outline:none;min-width:80px;flex-shrink:0">' +
                        '<option value="all">全部类型</option>' +
                        '<option value="image">🖼️ 图片</option>' +
                        '<option value="video">🎬 视频</option>' +
                        '<option value="audio">🎵 音频</option>' +
                        '<option value="doc">📄 文档</option>' +
                        '<option value="other">📦 其他</option>' +
                    '</select>' +
                    '<div id="cd-assets-type-stats" style="flex:1;min-width:0;font-size:11px;color:var(--b3-theme-secondary,#999);white-space:nowrap;overflow-x:auto;scrollbar-width:none;-ms-overflow-style:none;-webkit-overflow-scrolling:touch;line-height:1.6"></div>' +
                    '<button id="cd-assets-view-toggle" style="padding:3px 8px;font-size:11px;background:transparent;color:var(--b3-theme-secondary,#999);border:1px solid var(--b3-border,#ddd);border-radius:4px;cursor:pointer;opacity:0.6;transition:opacity 0.2s;flex-shrink:0" title="切换为图标视图" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.6">☰</button>' +
                    '<button id="cd-assets-expand-toggle" style="padding:3px 8px;font-size:12px;background:transparent;color:var(--b3-theme-secondary,#999);border:1px solid var(--b3-border,#ddd);border-radius:4px;cursor:pointer;opacity:0.6;transition:opacity 0.2s;flex-shrink:0" title="展开/折叠全部" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.6">⊕</button>' +
                '</div>' +
                '<div style="margin-bottom:2px;flex-shrink:0;position:relative;height:28px">' +
                    '<input id="cd-assets-search" type="text" placeholder="搜索资源文件名..." style="width:100%;height:28px;line-height:1;padding:0 28px 0 10px;box-sizing:border-box;font-size:12px;border:1px solid var(--b3-border,#ddd);border-radius:4px;background:var(--b3-theme-background,#fff);color:var(--b3-theme-on-background,#333);outline:none">' +
                    '<button id="cd-assets-search-clear" style="position:absolute;right:6px;top:50%;transform:translateY(-50%);padding:0 4px;font-size:14px;line-height:1;background:transparent;border:none;color:var(--b3-theme-secondary,#999);cursor:pointer;display:none">×</button>' +
                '</div>' +
                '<div style="margin-bottom:2px;display:flex;align-items:center;gap:2px;flex-shrink:0;background:transparent;border:none;height:24px">' +
                    '<div id="cd-assets-breadcrumb" style="flex:1;padding:0 0 0 8px;font-size:12px;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:transparent;border:none;display:flex;align-items:center"></div>' +
                    '<button id="cd-assets-sort-btn" style="padding:4px 8px;font-size:11px;background:transparent;color:var(--b3-theme-secondary,#999);border:1px solid var(--b3-border,#ddd);border-radius:4px;cursor:pointer;opacity:0.6;transition:opacity 0.2s;flex-shrink:0;white-space:nowrap" title="排序" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.6">⇅ 名称</button>' +
                '</div>' +
                '<div id="cd-assets-list" style="flex:1;overflow-y:auto;border:1px solid var(--b3-border,#e0e0e0);border-radius:4px;background:var(--b3-theme-background,#fff);min-height:0">' +
                    '<div style="padding:20px;text-align:center;color:#999">切换到「内部资源」标签以查看</div>' +
                '</div>' +
                '<div id="cd-assets-stats-bar" style="padding:6px 10px;font-size:11px;color:var(--b3-theme-secondary,#999);flex-shrink:0;display:flex;align-items:center;gap:12px;border-top:1px solid var(--b3-border,#eee);min-height:20px;white-space:nowrap;overflow:hidden">' +
                    '<span id="cd-assets-stats-text" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">加载中...</span>' +
                    '<span id="cd-assets-platform-badge" title="' + this.platformName + '" style="margin-left:auto;font-size:10px;font-weight:600;letter-spacing:0.3px;color:rgba(190,190,190,0.8);cursor:default;text-shadow:0 -1px 0 rgba(0,0,0,0.4)">' + this.platformName + '</span>' +
                '</div>' +
            '</div>' +
            // === 共享音频播放器 ===
            '<div id="cd-audio-lrc-panel" style="display:none;position:absolute;bottom:36px;left:4px;right:4px;height:160px;overflow:hidden;font-size:11px;border:1px solid var(--b3-border,#eee);border-radius:8px 8px 0 0;z-index:10;box-shadow:0 -4px 16px rgba(0,0,0,0.12);scrollbar-width:none;-ms-overflow-style:none">' +
                '<div id="cd-audio-lrc-bg" style="position:absolute;top:0;left:0;right:0;bottom:0;border-radius:8px 8px 0 0;opacity:0.38;background-size:cover;background-position:center;pointer-events:none"></div>' +
                '<div style="position:absolute;top:0;left:0;right:0;bottom:0;border-radius:8px 8px 0 0;background:rgba(255,255,255,0.55);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);pointer-events:none"></div>' +
                '<div style="position:relative;display:flex;height:100%;padding:10px;box-sizing:border-box">' +
                    '<div id="cd-audio-cover" style="width:140px;height:140px;min-width:140px;margin-right:10px;border-radius:8px;background:var(--b3-theme-surface,#f0f0f0);display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;font-size:48px;background-size:cover;background-position:center;position:relative">🎵</div>' +
                    '<div style="flex:1;display:flex;flex-direction:column;min-width:0;overflow:hidden">' +
                        '<div id="cd-audio-lrc-content" style="flex:1;overflow-y:auto;overflow-x:hidden;padding:10px 8px 8px 8px;margin:4px 4px 4px 0;line-height:1.8;color:var(--b3-theme-secondary,#333);text-align:center;border-radius:6px;text-shadow:0 1px 3px rgba(255,255,255,0.7)">暂无歌词</div>' +
                    '</div>' +
                '</div>' +
            '</div>' +
            '<div id="cd-audio-bar" style="display:none;padding:4px 10px;flex-shrink:0;border-top:1px solid var(--b3-border,#eee);background:var(--b3-theme-background,#fff);flex-direction:column;gap:3px">' +
                '<div style="display:flex;align-items:center;gap:8px">' +
                    '<span id="cd-audio-prev" class="cd-audio-btn" style="width:24px;height:24px;padding:0" title="上一首"><svg viewBox="0 0 24 24" width="12" height="12"><polygon points="17,5 8,12 17,19" fill="currentColor"/><rect x="5" y="5" width="3" height="14" rx="1" fill="currentColor"/></svg></span>' +
                    '<span id="cd-audio-play" class="cd-audio-btn cd-audio-btn-play" style="width:28px;height:28px;padding:0" title="播放"><svg viewBox="0 0 24 24" width="14" height="14"><polygon points="8,5 19,12 8,19" fill="currentColor"/></svg></span>' +
                    '<span id="cd-audio-next" class="cd-audio-btn" style="width:24px;height:24px;padding:0" title="下一首"><svg viewBox="0 0 24 24" width="12" height="12"><polygon points="7,5 16,12 7,19" fill="currentColor"/><rect x="16" y="5" width="3" height="14" rx="1" fill="currentColor"/></svg></span>' +
                    '<span id="cd-audio-mode" class="cd-audio-btn" style="width:24px;height:24px;padding:0" title="随机播放"><svg viewBox="0 0 24 24" width="12" height="12"><path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z" fill="currentColor"/></svg></span>' +
                    '<span id="cd-audio-name" style="flex:1;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--b3-theme-on-background,#333);cursor:pointer" title="打开所在文件夹">未播放</span>' +
                    '<span id="cd-audio-lrc-toggle" class="cd-audio-lrc-btn" style="cursor:pointer;font-size:11px;opacity:0.35;flex-shrink:0;transition:opacity 0.2s,color 0.2s" title="歌词">词</span>' +
                    '<span id="cd-audio-time" style="font-size:10px;color:var(--b3-theme-secondary,#999);flex-shrink:0;white-space:nowrap">0:00/0:00</span>' +
                    '<span id="cd-audio-vol-icon" style="cursor:pointer;font-size:12px;flex-shrink:0" title="静音">🔊</span>' +
                    '<input id="cd-audio-vol" type="range" min="0" max="100" value="80" style="width:50px;height:3px;flex-shrink:0;cursor:pointer;accent-color:var(--b3-theme-primary,#4285f4)">' +
                    '<span id="cd-audio-close" style="cursor:pointer;font-size:12px;opacity:0.5;flex-shrink:0" title="关闭">✕</span>' +
                '</div>' +
                '<div id="cd-audio-progress-wrap" style="width:100%;height:4px;background:var(--b3-border,#e0e0e0);border-radius:2px;cursor:pointer;position:relative">' +
                    '<div id="cd-audio-progress" style="height:100%;background:var(--b3-theme-primary,#4285f4);border-radius:2px;width:0%;transition:width 0.1s linear;pointer-events:none"></div>' +
                '</div>' +
            '</div>' +
            // === 共享元素 ===
            '<div id="cd-context-menu" style="display:none;position:fixed;z-index:9999;background:var(--b3-theme-background,#fff);border:1px solid var(--b3-border,#ddd);border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,0.15);min-width:160px;padding:4px 0;font-size:13px;user-select:none">' +
            '</div>' +
            '<div id="cd-image-preview" style="display:none;position:fixed;z-index:9998;background:var(--b3-theme-background,#fff);border:1px solid var(--b3-border,#ddd);border-radius:6px;box-shadow:0 6px 20px rgba(0,0,0,0.18);padding:6px;pointer-events:none">' +
                '<img id="cd-preview-img" src="" style="display:block;max-width:560px;max-height:480px;border-radius:3px">' +
                '<div id="cd-preview-name" style="margin-top:6px;text-align:center;font-size:12px;color:var(--b3-theme-on-background,#333);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:560px"></div>' +
                '<div id="cd-preview-time" style="text-align:center;font-size:11px;color:var(--b3-theme-secondary,#999);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:560px"></div>' +
            '</div>' +
        '</div>';
        
        // 保存按钮脏状态检测
        var _updateSaveDirty = function() {
            var pathInput = el.querySelector('#cd-syncroot-path');
            var saveBtn = el.querySelector('#cd-syncroot-save');
            if (!pathInput || !saveBtn) return;
            var currentVal = (pathInput.value || '').trim();
            var savedVal = that._getMySyncRoot() || '';
            var isDirty = currentVal !== savedVal;
            saveBtn.style.background = isDirty ? 'var(--b3-theme-primary,#4285f4)' : '#ccc';
            saveBtn.style.color = isDirty ? '#fff' : '#888';
            saveBtn.style.cursor = isDirty ? 'pointer' : 'default';
        };

        // 绑定跨端文件夹保存按钮
        var syncSaveBtn = el.querySelector('#cd-syncroot-save');
        if (syncSaveBtn) {
            syncSaveBtn.addEventListener('click', function() {
                // 防止异步加载未完成时保存导致数据覆盖
                if (!that._syncRootsLoaded) {
                    that.showToastMsg('配置加载中，请稍后再试');
                    return;
                }
                var pathInput = el.querySelector('#cd-syncroot-path');
                var val = (pathInput && pathInput.value || '').trim();
                if (val) {
                    // 自动确保路径以 LocalBrowseSync 结尾
                    var syncFolderName = 'LocalBrowseSync';
                    var pathBasename = val.replace(/[\\/]+$/, '').split(/[\\/]/).pop();
                    var finalPath = val;
                    if (pathBasename !== syncFolderName) {
                        // 用户输入的是父目录，自动拼接 LocalBrowseSync
                        finalPath = val.replace(/[\\/]+$/, '') + (that.isWindows ? '\\' : '/') + syncFolderName;
                    }

                    // 检查父目录是否存在
                    var parentDir = finalPath.replace(/[\\/]+$/, '').split(/[\\/]/).slice(0, -1).join(that.isWindows ? '\\' : '/');
                    try {
                        var stat = fs.statSync(parentDir);
                        if (!stat.isDirectory()) {
                            that.showToastMsg('父目录不是文件夹');
                            return;
                        }
                    } catch (e) {
                        that.showToastMsg('父目录不存在或无法访问');
                        return;
                    }

                    // 如果 LocalBrowseSync 子文件夹不存在，自动创建
                    try {
                        if (!fs.existsSync(finalPath)) {
                            fs.mkdirSync(finalPath, { recursive: true });
                            that.showToastMsg('已创建 ' + syncFolderName + ' 文件夹');
                        }
                    } catch (e) {
                        that.showToastMsg('无法创建 ' + syncFolderName + ' 文件夹：' + (e.message || e));
                        return;
                    }

                    // 更新输入框显示完整路径
                    if (pathInput) pathInput.value = finalPath;

                    that._setMySyncRoot(finalPath);
                    that.saveSyncRoots();
                    that.renderFavorites();
                    that._updateSyncPill();
                    _updateSaveDirty();
                    that.showToastMsg(that.platformName + ' 同步文件夹已保存');
                } else {
                    that._clearMySyncRoot();
                    that.saveSyncRoots();
                    that.renderFavorites();
                    that._updateSyncPill();
                    _updateSaveDirty();
                    that.showToastMsg(that.platformName + ' 同步文件夹已清除');
                }
            });
        }
        // 绑定跨端文件夹清除按钮
        var syncClearBtn = el.querySelector('#cd-syncroot-clear');
        if (syncClearBtn) {
            syncClearBtn.addEventListener('click', function() {
                if (!that._syncRootsLoaded) {
                    that.showToastMsg('配置加载中，请稍后再试');
                    return;
                }
                that._clearMySyncRoot();
                that.saveSyncRoots();
                var pathInput = el.querySelector('#cd-syncroot-path');
                if (pathInput) pathInput.value = '';
                that.renderFavorites();
                that._updateSyncPill();
                _updateSaveDirty();
                that.showToastMsg(that.platformName + ' 同步文件夹已清除');
            });
        }
        // 绑定跨端文件夹浏览按钮
        var syncBrowseBtn = el.querySelector('#cd-syncroot-browse');
        if (syncBrowseBtn) {
            syncBrowseBtn.addEventListener('click', function() {
                that._browseSyncFolder(el, function(selectedDir) {
                    // 浏览选择的是父目录，自动拼接 LocalBrowseSync
                    var syncFolderName = 'LocalBrowseSync';
                    if (selectedDir) {
                        var basename = selectedDir.replace(/[\\/]+$/, '').split(/[\\/]/).pop();
                        var finalPath = selectedDir;
                        if (basename !== syncFolderName) {
                            finalPath = selectedDir.replace(/[\\/]+$/, '') + (that.isWindows ? '\\' : '/') + syncFolderName;
                        }
                        var pathInput = el.querySelector('#cd-syncroot-path');
                        if (pathInput) pathInput.value = finalPath;
                    }
                    _updateSaveDirty();
                });
            });
        }
        // 绑定输入框变化检测
        var syncPathInput = el.querySelector('#cd-syncroot-path');
        if (syncPathInput) {
            syncPathInput.addEventListener('input', _updateSaveDirty);
        }

        // 点击外部关闭同步文件夹内联面板
        if (!that._syncRootInlineCloseBound) {
            that._syncRootInlineCloseBound = true;
            that._syncRootInlineClickHandler = function(e) {
                var inlinePanel = document.getElementById('cd-syncroot-inline');
                if (!inlinePanel || inlinePanel.style.display === 'none') return;
                var target = e.target;
                var favList = document.getElementById('cd-favorites-list');
                var syncFolderTab = favList && favList.firstChild;
                var isInsidePanel = inlinePanel.contains(target);
                var isOnTab = syncFolderTab && syncFolderTab.contains(target);
                if (!isInsidePanel && !isOnTab) {
                    inlinePanel.style.display = 'none';
                }
            };
            document.addEventListener('click', that._syncRootInlineClickHandler);
        }

        // 绑定链接状态指示灯
        var relinkBtn = el.querySelector('#cd-relink-btn');
        if (relinkBtn) {
            relinkBtn.addEventListener('click', function() {
                that.relinkBrokenLinks().catch(function(e) {
                    that._error('relink error:', e);
                    that.showToastMsg('修复链接出错：' + (e.message || e));
                });
            });
        }

        // 绑定视图切换按钮
        var viewToggleBtn = el.querySelector('#cd-view-toggle');
        if (viewToggleBtn) {
            // 初始化按钮状态
            viewToggleBtn.textContent = that.currentView === 'icon' ? '⊞' : '☰';
            viewToggleBtn.title = that.currentView === 'icon' ? '切换为列表视图' : '切换为图标视图';
            viewToggleBtn.addEventListener('click', function() {
                // 在列表和图标之间切换
                that.currentView = (that.currentView === 'list') ? 'icon' : 'list';
                this.textContent = that.currentView === 'icon' ? '⊞' : '☰';
                this.title = that.currentView === 'icon' ? '切换为列表视图' : '切换为图标视图';
                that.saveViewSettings();
                // 重新渲染当前目录
                if (that.cachedFiles.length && that.cachedPath) {
                    var sorted = that.sortFiles(that.cachedFiles.slice());
                    that.doRender(sorted, that.cachedPath, '', that.isDeepSearchMode);
                } else {
                    that.loadDirectory(that.currentPath || that.getRootPath());
                }
            });
        }

        // 绑定 Tab 切换
        var tabBtns = el.querySelectorAll('.cd-tab-btn');
        tabBtns.forEach(function(btn) {
            btn.addEventListener('click', function() {
                var tabName = this.getAttribute('data-tab');
                that._switchTab(tabName);
            });
        });

        // 初始化时把音频播放器放入当前活动面板（默认 local），放在统计栏上方
        var initAudioBar = document.getElementById('cd-audio-bar');
        var initPanel = document.getElementById('cd-panel-' + (that._activeTab || 'local'));
        if (initPanel) {
            var initStats = initPanel.querySelector('#cd-stats-bar, #cd-assets-stats-bar');
            if (initStats && initAudioBar) {
                initPanel.insertBefore(initAudioBar, initStats);
            }
        }

        // 绑定排序按钮
        var sortBtn = el.querySelector('#cd-sort-btn');
        if (sortBtn) {
            that.updateSortButton(sortBtn);
            sortBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                that.showSortMenu(this);
            });
        }


        // 检测并绑定存储下拉框（跨平台）
        that.detectDrives(function(drives) {
            var driveSelect = el.querySelector('#cd-drive-select');
            if (driveSelect) {
                driveSelect.innerHTML = '';
                if (drives.length === 0) {
                    var fallbackValue = that.driveLetter || (that.isWindows ? 'C' : '/');
                    var opt = document.createElement('option');
                    opt.value = fallbackValue;
                    opt.textContent = that.isWindows ? (fallbackValue + ':') : fallbackValue;
                    driveSelect.appendChild(opt);
                } else {
                    for (var i = 0; i < drives.length; i++) {
                        var opt = document.createElement('option');
                        opt.value = drives[i].value;
                        opt.textContent = drives[i].label;
                        if (drives[i].value === that.driveLetter) {
                            opt.selected = true;
                        }
                        driveSelect.appendChild(opt);
                    }
                }
                driveSelect.addEventListener('change', function() {
                    that.driveLetter = this.value;
                    that.saveDriveSettings();
                    that.loadDirectory(that.getRootPath());
                });
            }
        });

        // 绑定同步文件夹 pill 按钮（盘符下拉框旁边）
        var syncPill = el.querySelector('#cd-syncroot-pill');
        if (syncPill && !isDocker) {
            syncPill.addEventListener('click', function() {
                var sp = that._getMySyncRoot();
                if (sp) {
                    that.loadDirectory(sp);
                } else {
                    that.showToastMsg('请先右键配置同步文件夹');
                }
            });
            syncPill.addEventListener('contextmenu', function(e) {
                e.preventDefault();
                e.stopPropagation();
                var inlinePanel = document.getElementById('cd-syncroot-inline');
                if (inlinePanel) {
                    var isVisible = inlinePanel.style.display !== 'none';
                    inlinePanel.style.display = isVisible ? 'none' : 'block';
                    if (!isVisible) {
                        // 仅在路径为空时才填充已保存的值，避免覆盖用户已输入但未保存的路径
                        var pathInput = inlinePanel.querySelector('#cd-syncroot-path');
                        if (pathInput && !pathInput.value.trim()) {
                            pathInput.value = that._getMySyncRoot() || '';
                        }
                        var saveBtn = inlinePanel.querySelector('#cd-syncroot-save');
                        if (saveBtn) {
                            saveBtn.style.background = '#ccc';
                            saveBtn.style.color = '#888';
                            saveBtn.style.cursor = 'default';
                        }
                    }
                }
            });
        }

        // 绑定搜索框
        var searchInput = el.querySelector('#cd-search');
        var clearBtn = el.querySelector('#cd-clear-search');
        var deepSearchBtn = el.querySelector('#cd-deep-search');
        if (searchInput) {
            searchInput.addEventListener('input', function() {
                var query = this.value.trim();
                if (clearBtn) clearBtn.style.display = query ? 'block' : 'none';
                // 防抖 200ms，大目录下避免每次按键都触发全量过滤
                if (that._searchDebounceTimer) {
                    clearTimeout(that._searchDebounceTimer);
                }
                that._searchDebounceTimer = setTimeout(function() {
                    that.applyFilter(query);
                }, 200);
            });
            searchInput.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') {
                    var query = this.value.trim();
                    if (query) {
                        that.startDeepSearch(query);
                    }
                }
            });
        }

        // Backspace 快速返回上级目录（不在搜索框聚焦时）
        var fileListEl = el.querySelector('#cd-file-list');
        if (fileListEl) {
            fileListEl.addEventListener('keydown', function(e) {
                if (e.key === 'Backspace') {
                    // 搜索框聚焦时不触发
                    if (document.activeElement && document.activeElement.id === 'cd-search') return;
                    e.preventDefault();
                    that.goUp();
                }
            });
            // 让文件列表可聚焦，才能响应键盘事件
            fileListEl.setAttribute('tabindex', '0');
            fileListEl.style.outline = 'none';
        }

        if (clearBtn) {
            clearBtn.addEventListener('click', function() {
                // 如果正在深度搜索，点击叉按钮取消搜索
                if (that.isDeepSearchMode || that._deepSearchAbort) {
                    that._searchIsCancelled = true;
                    if (that._searchRenderTimer) {
                        clearTimeout(that._searchRenderTimer);
                        that._searchRenderTimer = null;
                    }
                    if (that._deepSearchAbort) {
                        that._deepSearchAbort.cancelled = true;
                        that._deepSearchAbort = null;
                    }
                    if (searchInput) {
                        searchInput.disabled = false;
                        searchInput.value = '';
                        searchInput.focus();
                    }
                    clearBtn.style.display = 'none';
                    that.isDeepSearchMode = false;
                    that.cachedFiles = [];
                    that.cachedPath = '';
                    that.loadDirectory(that.preSearchPath);
                    return;
                }
                // 普通状态：清空搜索框
                if (searchInput) {
                    searchInput.value = '';
                    clearBtn.style.display = 'none';
                    searchInput.focus();
                    that.applyFilter('');
                }
            });
        }
        if (deepSearchBtn) {
            deepSearchBtn.addEventListener('click', function() {
                if (searchInput) {
                    var query = searchInput.value.trim();
                    if (query) {
                        that.startDeepSearch(query);
                    } else {
                        searchInput.focus();
                    }
                }
            });
        }

        // 初始加载：优先跨端同步文件夹根目录（需验证存在），其次上次保存的路径，否则加载当前盘符根目录
        var initSyncRoot = this._getMySyncRoot();
        var initPath;
        that._log('renderFileTree: _getMySyncRoot()=' + initSyncRoot + ', currentPath=' + this.currentPath + ', syncRootsLoaded=' + this._syncRootsLoaded);
        if (initSyncRoot && (this.isWindows ? /^[A-Za-z]:/.test(initSyncRoot) : initSyncRoot.charAt(0) === '/')) {
            // 同步文件夹路径格式正确，进一步验证是否实际存在
            if (fs && fs.existsSync && fs.existsSync(initSyncRoot)) {
                initPath = initSyncRoot;
            } else {
                initPath = this.currentPath || this.getRootPath();
            }
        } else {
            initPath = this.currentPath || this.getRootPath();
        }
        that._log('renderFileTree: initPath=' + initPath);
        this.loadDirectory(initPath);

        // 绑定音频播放器事件（DOM 已就绪）
        this._bindAudioEvents();

        // 恢复上次音频播放器状态（如果用户没有手动关闭）
        this._restoreAudioState();

        // 渲染收藏夹（DOM 已就绪）
        this.renderFavorites();
        this._updateSyncPill();

        // 恢复上次活跃的 Tab
        try {
            var savedTab = localStorage.getItem('cd-active-tab');
            if (savedTab && savedTab !== 'local') {
                that._switchTab(savedTab);
            }
        } catch (e) {}
    }

    /**
     * 使用 Node.js fs 读取目录
     */
    loadDirectory(dirPath) {
        var that = this;

        // 切换目录时清除多选状态
        this._selectedItems = [];
        this._lastClickedItem = null;

        // 切换目录时清除展开状态
        if (this._expandedDirs) this._expandedDirs.clear();

        // 递增加载版本号，旧回调检测到版本过时则丢弃结果（防止异步竞态覆盖）
        this._loadSeq++;
        var myLoadSeq = this._loadSeq;
        that._log('loadDirectory: path=' + dirPath + ', _loadSeq=' + myLoadSeq);

        // 取消正在进行的深度搜索（如果有）
        if (this._deepSearchAbort) {
            this._deepSearchAbort.cancelled = true;
            this._deepSearchAbort = null;
        }
        this._searchIsCancelled = true;
        if (this._searchRenderTimer) {
            clearTimeout(this._searchRenderTimer);
            this._searchRenderTimer = null;
        }

        // 保存当前目录的滚动位置，便于返回时恢复
        if (this.currentPath) {
            var fileListEl = document.getElementById('cd-file-list');
            if (fileListEl) {
                this._scrollPositions[this.currentPath] = fileListEl.scrollTop;
            }
        }

        this.currentPath = dirPath;
        this.savePathSettings();

        // 清理旧的渲染状态
        this.listRenderState = null;
        this.iconRenderState = null;
        this._thumbQueue = [];
        this._thumbLoading = 0;

        // 同步当前路径的存储位置到下拉框（跨平台）
        that._syncDriveLetterFromPath(dirPath, true);

        var fileListEl = document.getElementById('cd-file-list');
        var breadcrumbEl = document.getElementById('cd-breadcrumb');
        var searchWrap = document.getElementById('cd-search-wrap');
        var searchInput = document.getElementById('cd-search');
        var clearBtn = document.getElementById('cd-clear-search');

        if (!fileListEl) return;

        // 切换目录时清空搜索和深度搜索状态
        if (searchInput) {
            searchInput.value = '';
            searchInput.disabled = false;
            this.cachedFiles = [];
            this.cachedPath = '';
            this.isDeepSearchMode = false;
        }
        if (clearBtn) clearBtn.style.display = 'none';
        // 搜索框始终显示（根目录也可搜索）
        if (searchWrap) {
            searchWrap.style.display = 'block';
        }

        // 更新面包屑为可点击的路径导航条
        if (breadcrumbEl) {
            breadcrumbEl.innerHTML = '';
            breadcrumbEl.style.cursor = 'default';

            var _sep = this._sep;
            // 统一路径分隔符（兼容正斜杠输入）
            var normalizedPath = dirPath.replace(/\//g, _sep);
            var cleanPath = normalizedPath.endsWith(_sep) ? normalizedPath.slice(0, -1) : normalizedPath;
            // 物理根目录判断：Windows 盘符根（D: 或 D:\）或 Unix 根 /
            var isRootDir = /^[A-Za-z]:$/.test(cleanPath) || cleanPath === '/' || cleanPath === '';
            var homeIcon = '<svg viewBox="0 0 24 24" style="width:14px;height:14px;display:inline-block;vertical-align:middle;fill:currentColor"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>';
            // 根路径：Windows 盘符加反斜杠，Unix 根 /
            var rootPath = isRootDir ? (cleanPath + (this.isWindows ? '\\' : '/')) : (cleanPath.split(_sep)[0] + _sep);

            // 小房子：始终绑定点击事件（展开文件夹后需动态亮起）
            var rootSpan = document.createElement('span');
            rootSpan.id = 'cd-breadcrumb-home';
            rootSpan.innerHTML = homeIcon;
            rootSpan.style.display = 'inline-block';
            rootSpan.addEventListener('click', function(e) {
                e.stopPropagation();
                if (that._expandedDirs && that._expandedDirs.size > 0) {
                    // 有展开：折叠最近一层（最后一个加入的）
                    var expandedArr = Array.from(that._expandedDirs);
                    var lastExpanded = expandedArr[expandedArr.length - 1];
                    var allItems = document.querySelectorAll('.cd-item');
                    for (var k = 0; k < allItems.length; k++) {
                        if (allItems[k].dataset.path === lastExpanded) {
                            var exp = allItems[k].querySelector('.cd-list-expand');
                            var child = allItems[k].nextElementSibling;
                            if (child && child.classList.contains('cd-list-children')) {
                                child.style.display = 'none';
                            }
                            if (exp) exp.style.transform = 'rotate(0deg)';
                            break;
                        }
                    }
                    that._expandedDirs.delete(lastExpanded);
                    that._updateBreadcrumbHomeState();
                } else if (!isRootDir) {
                    // 子目录无展开：返回根目录
                    that.loadDirectory(rootPath);
                }
                // 根目录无展开：什么都不做
            });
            breadcrumbEl.appendChild(rootSpan);

            // 子目录路径部分（去掉根目录）
            if (!isRootDir) {
                var segments = cleanPath.split(_sep);
                var accumulated = segments[0] + _sep;
                for (var i = 1; i < segments.length; i++) {
                    accumulated += segments[i] + _sep;
                    var isLast = (i === segments.length - 1);

                    var sep = document.createElement('span');
                    sep.innerHTML = '<svg viewBox="0 0 24 24" style="width:12px;height:12px;display:inline-block;fill:currentColor;vertical-align:middle"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z"/></svg>';
                    sep.style.display = 'inline-block';
                    sep.style.margin = '0 5px';
                    sep.style.color = 'var(--b3-theme-primary,#4285f4)';
                    breadcrumbEl.appendChild(sep);

                    var span = document.createElement('span');
                    span.textContent = segments[i];
                    span.style.display = 'inline-block';
                    if (isLast) {
                        span.style.fontWeight = 'bold';
                        span.style.color = 'var(--b3-theme-on-background,#333)';
                    } else {
                        span.style.cursor = 'pointer';
                        span.style.color = 'var(--b3-theme-primary,#4285f4)';
                        span.style.textDecoration = 'underline';
                        span.style.marginRight = '2px';
                        (function(targetPath) {
                            span.addEventListener('click', function(e) {
                                e.stopPropagation();
                                that.loadDirectory(targetPath);
                            });
                        })(accumulated);
                    }
                    breadcrumbEl.appendChild(span);
                }
            }

            // 初始化小房子状态
            this._updateBreadcrumbHomeState();
        }

        fileListEl.innerHTML = '<div style="padding:20px;text-align:center;color:#999">正在加载...</div>';
        
        // 优先使用 Node.js fs 读取
        if (fs && path) {
            this.loadDirectoryWithNode(dirPath, fileListEl);
        } else {
            // 降级：尝试思源API
            this.loadDirectoryWithAPI(dirPath, fileListEl);
        }
    }

    /**
     * Backspace 快速返回上级目录
     */
    goUp() {
        var currentPath = this.currentPath;
        if (!currentPath) return;
        // 清理末尾路径分隔符（跨平台：Windows \ 或 Linux /）
        var sep = this._sep;
        var cleanPath = currentPath.endsWith(sep) ? currentPath.slice(0, -1) : currentPath;
        // 如果是盘符根目录（如 C:）或 Unix 根目录 /，不再往上了
        if (/^[A-Za-z]:$/.test(cleanPath) || cleanPath === '/') return;
        // 取上级目录（跨平台：Windows 用 \，Linux 用 /）
        var lastSlash = cleanPath.lastIndexOf(sep);
        if (lastSlash < 0) {
            // 无分隔符（不应该发生），回到根路径
            this.loadDirectory(this.getRootPath());
        } else if (lastSlash === 0) {
            // Unix: 路径形如 /Volumes 或 /home，上级是根目录 /
            this.loadDirectory('/');
        } else if (this.isWindows && lastSlash === 2 && cleanPath.charAt(1) === ':') {
            // Windows: 如 C:\Users → 上级是 C:\
            this.loadDirectory(cleanPath.substring(0, lastSlash + 1));
        } else {
            // 正常上级目录
            this.loadDirectory(cleanPath.substring(0, lastSlash));
        }
    }

    /**
     * 使用 Node.js fs 模块读取目录
     */
    loadDirectoryWithNode(dirPath, fileListEl) {
        var that = this;
        var myLoadSeq = this._loadSeq;  // 捕获当前加载版本号，回调中检查是否过时
        
        try {
            // 标准化路径
            var normalizedPath = dirPath;
            if (!normalizedPath.endsWith(that._sep)) {
                normalizedPath += that._sep;
            }
            
            fs.readdir(normalizedPath, { withFileTypes: true }, function(err, entries) {
                // 版本号已变（用户已导航到其他目录），丢弃本次过时结果
                if (myLoadSeq !== that._loadSeq) {
                    that._log('loadDirectoryWithNode: stale callback discarded, mySeq=' + myLoadSeq + ', current=' + that._loadSeq);
                    return;
                }

                if (err) {
                    // withFileTypes 可能在某些 Docker 环境下不支持，回退到普通 readdir
                    if (err.code === 'ERR_INVALID_ARG_VALUE' || err.code === 'ENOSYS' || err.code === 'ENOTSUP') {
                        fs.readdir(normalizedPath, function(err2, filenames) {
                            if (myLoadSeq !== that._loadSeq) return;  // 版本过时检查
                            if (err2) {
                                that._handleDirReadError(dirPath, normalizedPath, err2, fileListEl);
                                return;
                            }
                            that._buildFileEntries(filenames, normalizedPath, fileListEl);
                        });
                        return;
                    }
                    that._handleDirReadError(dirPath, normalizedPath, err, fileListEl);
                    return;
                }
                
                // 过滤隐藏文件和系统目录
                entries = entries.filter(function(entry) {
                    return entry.name.charAt(0) !== '.' &&
                           entry.name !== '$RECYCLE.BIN' &&
                           entry.name !== 'System Volume Information';
                });

                // 异步并行 stat，避免同步阻塞主线程
                var statTasks = [];
                for (var i = 0; i < entries.length; i++) {
                    (function(entry) {
                        var fullPath = normalizedPath + entry.name;
                        statTasks.push(new Promise(function(resolve) {
                            fs.stat(fullPath, function(err, stat) {
                                resolve({ entry: entry, fullPath: fullPath, stat: err ? null : stat });
                            });
                        }));
                    })(entries[i]);
                }

                Promise.all(statTasks).then(function(results) {
                    // 所有 stat 完成后再检查一次版本号，防止过时结果覆盖最新渲染
                    if (myLoadSeq !== that._loadSeq) return;

                    var files = [];
                    for (var i = 0; i < results.length; i++) {
                        var r = results[i];
                        var size = 0;
                        var mtime = 0;
                        if (r.stat) {
                            size = r.stat.size;
                            mtime = r.stat.mtime ? r.stat.mtime.getTime() : 0;
                        }

                        var isDir = r.entry.isDirectory();
                        if (!isDir && !r.entry.isFile() && r.stat) {
                            try { isDir = r.stat.isDirectory(); } catch(e) {}
                        }

                        files.push({
                            name: r.entry.name,
                            isDir: isDir,
                            size: size,
                            mtime: mtime,
                            path: r.fullPath
                        });
                    }
                    that.renderFiles(files, normalizedPath);
                });
            });
        } catch (e) {
            that._error('loadDirectoryWithNode error:', e);
            this.loadDirectoryWithAPI(dirPath, fileListEl);
        }
    }

    /**
     * 降级：使用思源API读取目录
     */
    loadDirectoryWithAPI(dirPath, fileListEl) {
        var that = this;
        var myLoadSeq = this._loadSeq;  // 捕获当前加载版本号
        
        fetch('/api/file/readDir', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: dirPath }),
            credentials: 'include'
        }).then(function(resp) {
            return resp.json();
        }).then(function(data) {
            // 版本号已变（用户已导航到其他目录），丢弃本次过时结果
            if (myLoadSeq !== that._loadSeq) return;

            if (data.code === 0 && Array.isArray(data.data)) {
                var files = data.data.filter(function(f) {
                    return f.name && f.name.charAt(0) !== '.' &&
                           f.name !== '$RECYCLE.BIN' &&
                           f.name !== 'System Volume Information';
                });
                that.renderFiles(files, dirPath);
            } else {
                that.showError('API 无法访问外部驱动器: ' + (data.msg || '未知错误'));
            }
        }).catch(function(e) {
            that._error('API error:', e);
            that.showError('网络错误: ' + e.message);
        });
    }

    /**
     * 处理目录读取错误（统一的错误处理逻辑）
     */
    _handleDirReadError(dirPath, normalizedPath, err, fileListEl) {
        var that = this;
        var isRootDir = /^[A-Za-z]:\\?$/.test(dirPath) || dirPath === '/' || dirPath === '';
        if (err.code === 'ENOENT' || err.code === 'EPERM' || err.code === 'EACCES') {
            if (isRootDir) {
                that._error('fs.readdir error:', err);
                this.showError('无法访问 ' + dirPath + '，请确认挂载盘已启动且驱动器已挂载');
            } else {
                this.renderFiles([], normalizedPath);
            }
        } else {
            that._error('fs.readdir error:', err);
            // 尝试降级到 API
            this.loadDirectoryWithAPI(dirPath, fileListEl);
        }
    }

    /**
     * 从文件名数组构建文件条目（无 withFileTypes 时的 fallback）
     */
    _buildFileEntries(filenames, normalizedPath, fileListEl) {
        var that = this;
        var myLoadSeq = this._loadSeq;  // 捕获当前加载版本号
        // 过滤隐藏文件和系统目录
        filenames = filenames.filter(function(name) {
            return name.charAt(0) !== '.' &&
                   name !== '$RECYCLE.BIN' &&
                   name !== 'System Volume Information';
        });
        var statTasks = [];
        for (var i = 0; i < filenames.length; i++) {
            (function(name) {
                var fullPath = normalizedPath + name;
                statTasks.push(new Promise(function(resolve) {
                    fs.stat(fullPath, function(err, stat) {
                        resolve({ name: name, fullPath: fullPath, stat: err ? null : stat });
                    });
                }));
            })(filenames[i]);
        }
        Promise.all(statTasks).then(function(results) {
            // 版本号已变，丢弃过时结果
            if (myLoadSeq !== that._loadSeq) return;

            var files = [];
            for (var i = 0; i < results.length; i++) {
                var r = results[i];
                var size = 0;
                var mtime = 0;
                var isDir = false;
                if (r.stat) {
                    size = r.stat.size;
                    mtime = r.stat.mtime ? r.stat.mtime.getTime() : 0;
                    try { isDir = r.stat.isDirectory(); } catch(e) {}
                }
                files.push({
                    name: r.name,
                    isDir: isDir,
                    size: size,
                    mtime: mtime,
                    path: r.fullPath
                });
            }
            that.renderFiles(files, normalizedPath);
        }).catch(function(e) {
            if (myLoadSeq !== that._loadSeq) return;  // 版本过时，不渲染错误
            that._error('_buildFileEntries error:', e);
            that.showError('读取目录失败: ' + (e.message || e));
        });
    }

    /**
     * 检测可用存储（跨平台）
     * Windows: 扫描 A-Z 盘符
     * macOS: 根目录 + /Volumes/ 下挂载卷
     * Linux: 根目录 + /mnt/ + /media/ + 用户主目录
     * @returns [{value, label}] - value 用于逻辑，label 用于 UI 显示
     */
    detectDrives(callback) {
        var that = this;
        var drives = [];

        // 无 fs 模块时的回退（Docker/鸿蒙版，通过 API 扫描）
        if (!fs) {
            if (that.isWindows) {
                drives = [{value: 'T', label: 'T:'}];
            } else {
                drives.push({value: '/', label: '🏠 /', isDefault: true});
                // 尝试通过 API 扫描 /mnt/ /media/ 等挂载点
                that._apiScanLinuxMounts(function(mountDrives) {
                    drives = drives.concat(mountDrives);
                    that.availableDrives = drives;
                    callback(drives);
                });
                return; // 异步扫描，等回调
            }
            that.availableDrives = drives;
            callback(drives);
            return;
        }

        // macOS: 根目录 + /Volumes/ 下挂载卷 + 用户主目录 + 常见网盘目录
        if (that.platform === 'darwin') {
            drives.push({value: '/', label: '🏠 /', isDefault: true});
            try {
                var volumes = fs.readdirSync('/Volumes/');
                for (var v = 0; v < volumes.length; v++) {
                    var volName = volumes[v];
                    if (volName.charAt(0) === '.') continue;  // 排除隐藏项
                    var volPath = '/Volumes/' + volName;
                    try {
                        var stat = fs.statSync(volPath);
                        if (stat.isDirectory() && !stat.isSymbolicLink()) {
                            var icon = volName.toLowerCase().indexOf('macintosh') >= 0 ? '💻' : '📁';
                            drives.push({value: volPath, label: icon + ' ' + volName, isDefault: false});
                        }
                    } catch(e) {}
                }
            } catch(e) {}
            // 用户主目录
            if (os && os.homedir) {
                try {
                    var homeDir = os.homedir();
                    if (homeDir && homeDir !== '/') {
                        drives.push({value: homeDir, label: '🏠 ~', isDefault: false});
                        // 扫描常见网盘目录
                        var cloudDirs = ['BaiduNetdisk_mac', 'BaiduNetdisk', '百度网盘', '百度网盘同步空间', 'BaiduSyncdisk'];
                        for (var cd = 0; cd < cloudDirs.length; cd++) {
                            var cloudPath = homeDir + '/' + cloudDirs[cd];
                            try {
                                if (fs.existsSync(cloudPath) && fs.statSync(cloudPath).isDirectory()) {
                                    drives.push({value: cloudPath, label: '☁️ ' + cloudDirs[cd], isDefault: false});
                                }
                            } catch(e) {}
                        }
                    }
                } catch(e) {}
            }
            that.availableDrives = drives;
            callback(drives);
            return;
        }

        // Linux: 根目录 + /mnt/ + /media/ + 用户主目录
        if (!that.isWindows) {
            drives.push({value: '/', label: '🏠 /', isDefault: true});
            // 读取 /mnt/ 下挂载点
            try {
                var mnts = fs.readdirSync('/mnt/');
                for (var m = 0; m < mnts.length; m++) {
                    var mName = mnts[m];
                    if (mName.charAt(0) === '.') continue;
                    var mPath = '/mnt/' + mName;
                    try {
                        if (fs.statSync(mPath).isDirectory()) {
                            drives.push({value: mPath, label: '📁 ' + mName, isDefault: false});
                        }
                    } catch(e) {}
                }
            } catch(e) {}
            // 读取 /media/ 下子目录（自动挂载的 U 盘等）
            try {
                var mediaEntries = fs.readdirSync('/media/');
                for (var me = 0; me < mediaEntries.length; me++) {
                    var mediaUser = mediaEntries[me];
                    if (mediaUser.charAt(0) === '.') continue;
                    var mediaUserPath = '/media/' + mediaUser;
                    try {
                        if (fs.statSync(mediaUserPath).isDirectory()) {
                            drives.push({value: mediaUserPath, label: '📁 ' + mediaUser, isDefault: false});
                            // 读取用户下的子挂载点
                            var subEntries = fs.readdirSync(mediaUserPath);
                            for (var se = 0; se < subEntries.length; se++) {
                                var subName = subEntries[se];
                                if (subName.charAt(0) === '.') continue;
                                var subPath = mediaUserPath + '/' + subName;
                                try {
                                    if (fs.statSync(subPath).isDirectory()) {
                                        drives.push({value: subPath, label: '🔌 ' + subName, isDefault: false});
                                    }
                                } catch(e) {}
                            }
                        }
                    } catch(e) {}
                }
            } catch(e) {}
            // 用户主目录
            if (os && os.homedir) {
                try {
                    var homeDir = os.homedir();
                    if (homeDir && homeDir !== '/') {
                        drives.push({value: homeDir, label: '🏠 ~', isDefault: false});
                    }
                } catch(e) {}
            }
            that.availableDrives = drives;
            callback(drives);
            return;
        }

        // Windows: 扫描 A-Z 盘符
        var letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        var checked = 0;
        var finished = false;

        // 超时保护：5 秒后强制返回已检测到的盘符（防止网络盘 access 永不回调）
        var timeout = setTimeout(function() {
            if (!finished) {
                finished = true;
                drives.sort(function(a, b) { return a.value.localeCompare(b.value); });
                if (drives.length === 0) drives.push({value: 'T', label: 'T:', isDefault: true});
                that.availableDrives = drives;
                callback(drives);
            }
        }, 5000);

        function tryFinish() {
            if (finished) return;
            finished = true;
            clearTimeout(timeout);
            drives.sort(function(a, b) { return a.value.localeCompare(b.value); });
            if (drives.length === 0) drives.push({value: 'T', label: 'T:', isDefault: true});
            that.availableDrives = drives;
            callback(drives);
        }

        for (var i = 0; i < letters.length; i++) {
            (function(letter) {
                var drivePath = letter + ':\\';
                fs.access(drivePath, fs.constants.F_OK, function(err) {
                    if (finished) return;
                    checked++;
                    if (!err) {
                        drives.push({value: letter, label: letter + ':', isDefault: letter === 'C'});
                    }
                    if (checked === letters.length) {
                        tryFinish();
                    }
                });
            })(letters[i]);
        }
    }

    showError(msg) {
        var fileListEl = document.getElementById('cd-file-list');
        if (fileListEl) {
            fileListEl.innerHTML = '<div style="padding:20px;text-align:center;color:#d32f2f">' +
                '<div style="font-size:14px;margin-bottom:8px">❌ 出错了</div>' +
                '<div style="font-size:12px;color:#999">' + msg + '</div>' +
            '</div>';
        }
    }

    renderFiles(files, currentPath) {
        // 过滤不应显示的文件
        files = files.filter(function(f) { return !this._shouldHideFile(f); }.bind(this));
        // 保存缓存用于搜索过滤
        this.cachedFiles = files.slice();
        this.cachedPath = currentPath;
        // 应用当前排序
        files = this.sortFiles(files);
        this.doRender(files, currentPath);
        // 更新底部统计栏
        this.updateFileStats();
        // 检查是否有待定位的文件（跨文件夹导航后自动定位）
        var that = this;
        if (this._pendingLocateFileName) {
            var locateName = this._pendingLocateFileName;
            this._pendingLocateFileName = null;
            // 延迟一帧，等 DOM 渲染完成
            setTimeout(function() {
                that._doLocateFile(locateName);
            }, 100);
        }
    }

    /**
     * 判断文件是否应在 UI 中隐藏
     * 1. 隐藏文件/目录（.开头）
     * 2. 系统目录（$RECYCLE.BIN、System Volume Information）
     * 3. 随机哈希名 DLL（如 a1b2c3d4e5f6.dll，文件名全为十六进制字符且较长）
     */
    _shouldHideFile(f) {
        var name = f.name;
        if (!name) return true;
        // 隐藏文件
        if (name.charAt(0) === '.') return true;
        // 系统目录
        if (name === '$RECYCLE.BIN' || name === 'System Volume Information') return true;
        // 系统配置文件后缀 + 歌词文件（播放器自动加载，无需在列表中显示）
        var ext = name.split('.').pop().toLowerCase();
        if (ext === 'ini' || ext === 'sys' || ext === 'drv' || ext === 'lrc') return true;
        // 随机哈希名 DLL（30位以上字母数字混合 + .dll 后缀）
        if (name.length > 34 && name.toLowerCase().endsWith('.dll')) {
            var stem = name.substring(0, name.length - 4);
            if (/^[0-9a-zA-Z]{30,}$/.test(stem)) return true;
        }
        return false;
    }

    /**
     * 排序文件列表
     */
    sortFiles(files) {
        var that = this;
        var sortBy = that.sortBy;
        var order = that.sortOrder === 'asc' ? 1 : -1;

        files.sort(function(a, b) {
            // 文件夹始终在文件前面（无论按什么排序）
            if (a.isDir !== b.isDir) {
                return a.isDir ? -1 : 1;
            }

            var cmp = 0;
            if (sortBy === 'name') {
                cmp = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
            } else if (sortBy === 'size') {
                cmp = (a.size || 0) - (b.size || 0);
            } else if (sortBy === 'mtime') {
                cmp = (a.mtime || 0) - (b.mtime || 0);
            }
            return cmp * order;
        });

        return files;
    }

    /**
     * 开始深度搜索（递归搜索子目录，渐进式返回结果）
     */
    startDeepSearch(query) {
        var that = this;
        var fileListEl = document.getElementById('cd-file-list');
        var breadcrumbEl = document.getElementById('cd-breadcrumb');
        var searchInput = document.getElementById('cd-search');

        if (!fileListEl) return;

        // 如果正在搜索，先取消上一次
        if (this._deepSearchAbort) {
            this._deepSearchAbort.cancelled = true;
        }

        // 保存搜索前的目录，用于返回
        this.preSearchPath = this.currentPath || this.getRootPath();

        // 禁用搜索框并显示 loading，同时显示叉按钮用于取消
        if (searchInput) searchInput.disabled = true;
        var clearBtn = document.getElementById('cd-clear-search');
        if (clearBtn) clearBtn.style.display = 'block';
        that.renderSearchBreadcrumb(query, true, 0);
        fileListEl.innerHTML = '<div style="padding:20px;text-align:center;color:#999">正在深度搜索...</div>';

        // 渐进式渲染状态
        var partialResults = [];
        that._searchRenderTimer = null;
        var isFinished = false;
        that._searchIsCancelled = false;
        var currentSearchedDirs = 0;
        var currentMatchedFiles = 0;

        var pendingRender = false;

        function scheduleRender() {
            if (that._searchIsCancelled) return;
            pendingRender = true;
            if (that._searchRenderTimer) return; // 已有待渲染的定时器，标记 pending 后返回
            that._searchRenderTimer = setTimeout(function() {
                that._searchRenderTimer = null;
                if (!isFinished && !that._searchIsCancelled) {
                    pendingRender = false;
                    // 渐进渲染时更新面包屑进度
                    that.renderSearchBreadcrumb(query, true, partialResults.length, currentSearchedDirs);
                    if (partialResults.length > 0) {
                        that.doRender(partialResults.slice(), that.currentPath, query, true);
                    } else {
                        // 没有匹配结果时也更新文件列表区域的进度
                        fileListEl.innerHTML = '<div style="padding:20px;text-align:center;color:#999">正在深度搜索...（已搜索 ' + currentSearchedDirs + ' 个目录）</div>';
                    }
                    // 如果在定时器执行期间又有新的更新请求，继续调度下一次渲染
                    if (pendingRender) {
                        scheduleRender();
                    }
                }
            }, 200); // 每 200ms 刷新一次结果
        }

        function onPartialResult(items, searchedDirs, matchedFiles) {
            if (that._searchIsCancelled) return;
            partialResults = partialResults.concat(items);
            currentSearchedDirs = searchedDirs || currentSearchedDirs;
            currentMatchedFiles = matchedFiles || currentMatchedFiles;
            scheduleRender();
        }

        this.deepSearch(this.currentPath || this.getRootPath(), query, onPartialResult, function(finalResults, wasCancelled) {
            if (that._searchRenderTimer) {
                clearTimeout(that._searchRenderTimer);
                that._searchRenderTimer = null;
            }
            isFinished = true;

            if (searchInput) searchInput.disabled = false;

            // 如果已取消，且用户已经通过 loadDirectory 导航走了（不在深度搜索模式），则不再更新 UI
            if (wasCancelled || that._searchIsCancelled) {
                if (that.isDeepSearchMode) {
                    // 用户还没导航走，显示"已取消"状态
                    that.renderSearchBreadcrumb(query, false, 0);
                    fileListEl.innerHTML = '<div style="padding:20px;text-align:center;color:#999">搜索已取消</div>';
                }
                return;
            }

            // 保存深度搜索结果到缓存，支持后续实时过滤
            that.cachedFiles = finalResults;
            that.cachedPath = that.currentPath;
            that.isDeepSearchMode = true;

            if (finalResults.length === 0) {
                that.renderSearchBreadcrumb(query, false, 0);
                fileListEl.innerHTML = '<div style="padding:20px;text-align:center;color:#999">未找到匹配文件</div>';
                return;
            }
            that.renderSearchBreadcrumb(query, false, finalResults.length);
            that.doRender(finalResults, that.currentPath, query, true);
        });
    }

    /**
     * 渲染深度搜索时的面包屑（带返回按钮和进度信息）
     */
    renderSearchBreadcrumb(query, isLoading, resultCount, searchedDirs) {
        var that = this;
        var breadcrumbEl = document.getElementById('cd-breadcrumb');
        if (!breadcrumbEl) return;

        breadcrumbEl.innerHTML = '';
        breadcrumbEl.style.cursor = 'default';

        var searchLabel = document.createElement('span');
        if (isLoading) {
            var progress = '🔍 深度搜索: ' + query + '（';
            var parts = [];
            if (typeof searchedDirs === 'number' && searchedDirs > 0) {
                parts.push('已搜索 ' + searchedDirs + ' 个目录');
            }
            if (typeof resultCount === 'number' && resultCount > 0) {
                parts.push('找到 ' + resultCount + ' 个结果');
            }
            if (parts.length === 0) {
                parts.push('搜索中...');
            }
            progress += parts.join('，') + '）';
            searchLabel.textContent = progress;
        } else {
            searchLabel.textContent = '🔍 深度搜索: ' + query;
        }
        searchLabel.style.fontWeight = 'bold';
        searchLabel.style.color = 'var(--b3-theme-on-background,#333)';
        breadcrumbEl.appendChild(searchLabel);

        if (!isLoading) {
            var sep = document.createElement('span');
            sep.textContent = ' | ';
            sep.style.margin = '0 8px';
            sep.style.color = 'var(--b3-theme-secondary,#999)';
            breadcrumbEl.appendChild(sep);

            // 搜索完成：显示结果计数和返回按钮
            if (typeof resultCount === 'number') {
                var countLabel = document.createElement('span');
                countLabel.textContent = resultCount + ' 个结果';
                countLabel.style.color = 'var(--b3-theme-secondary,#999)';
                countLabel.style.marginRight = '8px';
                countLabel.style.fontSize = '12px';
                breadcrumbEl.appendChild(countLabel);
            }

            var backBtn = document.createElement('span');
            backBtn.textContent = '↩ 返回';
            backBtn.style.cursor = 'pointer';
            backBtn.style.color = 'var(--b3-theme-primary,#4285f4)';
            backBtn.style.textDecoration = 'underline';
            backBtn.style.fontSize = '12px';
            backBtn.title = '返回 ' + that.preSearchPath;
            backBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                // 清空搜索状态并返回原目录
                var searchInput = document.getElementById('cd-search');
                var clearBtn = document.getElementById('cd-clear-search');
                if (searchInput) {
                    searchInput.value = '';
                    that.cachedFiles = [];
                    that.cachedPath = '';
                    that.isDeepSearchMode = false;
                }
                if (clearBtn) clearBtn.style.display = 'none';
                that.loadDirectory(that.preSearchPath);
            });
            breadcrumbEl.appendChild(backBtn);
        }
    }

    /**
     * 递归搜索子目录中的文件（异步版本，无深度限制）
     * 支持取消：新的搜索会自动取消上一次搜索
     * 支持渐进式返回：每搜完一个目录就通过 onPartial 回调返回当前批次结果
     * @param {string} dirPath - 搜索根目录
     * @param {string} query - 搜索关键词
     * @param {Function} onPartial - 渐进式回调，参数为新增结果数组
     * @param {Function} onComplete - 完成回调，参数为全部结果数组
     */
    async deepSearch(dirPath, query, onPartial, onComplete, externalAbort) {
        var that = this;
        var allResults = [];
        // 支持多关键词：空格分隔，所有关键词都必须匹配（AND 逻辑）
        var keywords = query.toLowerCase().split(/\s+/).filter(function(k) { return k.length > 0; });
        var searchedDirs = 0;
        var matchedFiles = 0;

        // 如果有外部传入的 abortFlag（如并行 relink 场景），使用外部的，避免互相取消
        // 否则使用共享的 abortion 机制（向后兼容）
        var abortFlag;
        if (externalAbort) {
            abortFlag = externalAbort;
        } else {
            if (this._deepSearchAbort) {
                this._deepSearchAbort.cancelled = true;
            }
            abortFlag = { cancelled: false };
            this._deepSearchAbort = abortFlag;
        }

        // 并发池：最多同时执行 CONCURRENCY 个 readdir
        var CONCURRENCY = 16;
        var active = 0;
        var pendingCallbacks = [];

        // 任务计数器：跟踪所有已提交但未完成的搜索任务（包括子目录递归）
        // 当计数器归零时，表示所有目录搜索完毕
        var pendingTasks = 0;
        var allDoneResolve = null;
        var allDonePromise = new Promise(function(resolve) { allDoneResolve = resolve; });

        function taskStarted() {
            pendingTasks++;
        }

        function taskFinished() {
            pendingTasks--;
            if (pendingTasks === 0 && allDoneResolve) {
                allDoneResolve();
                allDoneResolve = null;
            }
        }

        function schedule(fn) {
            return new Promise(function(resolve, reject) {
                function tryRun() {
                    if (abortFlag.cancelled) {
                        // 取消时，fn 不会执行，但 searchRecursive 已经 taskStarted()，
                        // 所以必须 taskFinished() 以避免 pendingTasks 永远不归零
                        taskFinished();
                        resolve();
                        return;
                    }
                    if (active < CONCURRENCY) {
                        active++;
                        fn().then(function(val) {
                            active--;
                            resolve(val);
                            if (pendingCallbacks.length > 0) {
                                var next = pendingCallbacks.shift();
                                next();
                            }
                        }, function(err) {
                            active--;
                            reject(err);
                            if (pendingCallbacks.length > 0) {
                                var next = pendingCallbacks.shift();
                                next();
                            }
                        });
                    } else {
                        pendingCallbacks.push(tryRun);
                    }
                }
                tryRun();
            });
        }

        function searchRecursive(currentDir, depth) {
            if (abortFlag.cancelled) return;

            var normalizedPath = currentDir;
            if (!normalizedPath.endsWith(that._sep)) normalizedPath += that._sep;

            taskStarted();
            schedule(function() {
                if (abortFlag.cancelled) { taskFinished(); return Promise.resolve(); }

                return that._fsReaddir(normalizedPath).then(function(rawEntries) {
                    // 统一 entry 格式：fs 返回 Dirent 对象，API 返回 plain object
                    var entries = rawEntries.map(function(e) {
                        return {
                            name: e.name,
                            isDir: typeof e.isDirectory === 'function' ? e.isDirectory() : e.isDir,
                            isFile: typeof e.isFile === 'function' ? e.isFile() : !e.isDir,
                            isSymlink: typeof e.isSymbolicLink === 'function' ? e.isSymbolicLink() : (e.isSymlink || false)
                        };
                    });
                    var subPromises = [];
                    var batchResults = [];

                    searchedDirs++;

                    for (var i = 0; i < entries.length; i++) {
                        if (abortFlag.cancelled) break;

                        var entry = entries[i];
                        if (entry.name.charAt(0) === '.' || entry.name === '$RECYCLE.BIN' || entry.name === 'System Volume Information') continue;

                        // macOS APFS firmlink: /System/Volumes/Data 镜像根文件系统，跳过避免重复扫描
                        if (entry.name === 'Data' && normalizedPath === '/System/Volumes/') continue;

                        var fullPath = normalizedPath + entry.name;

                        // 多关键词匹配
                        var lowerName = entry.name.toLowerCase();
                        var allMatch = true;
                        for (var ki = 0; ki < keywords.length; ki++) {
                            if (lowerName.indexOf(keywords[ki]) === -1) {
                                allMatch = false;
                                break;
                            }
                        }
                        if (allMatch) {
                            var item = {
                                name: entry.name,
                                isDir: entry.isDir,
                                path: fullPath,
                                relativePath: that.getRelativePath(fullPath, dirPath)
                            };
                            if (!entry.isDir) {
                                // 异步取 size 和 mtime
                                var statP = that._fsStat(fullPath).then(function(st) {
                                    item.size = st.size;
                                    item.mtime = st.mtime ? st.mtime.getTime() : 0;
                                }).catch(function() {
                                    item.size = 0;
                                    item.mtime = 0;
                                });
                                subPromises.push(statP);
                            }
                            batchResults.push(item);
                            matchedFiles++;
                        }

                        if (entry.isDir) {
                            searchRecursive(fullPath, depth + 1);
                        }
                    }

                    // 立即回调当前目录的搜索进度，不等子目录完成
                    allResults = allResults.concat(batchResults);
                    if (onPartial) {
                        onPartial(batchResults, searchedDirs, matchedFiles);
                    }

                    // 只等待 stat 操作完成（获取文件大小/时间），不再等子目录递归
                    return Promise.all(subPromises);
                }).catch(function(err) {
                    // 目录无权限等错误，静默跳过
                }).finally(function() {
                    taskFinished();
                });
            });
        }

        // 取消搜索时，需要确保 pendingTasks 归零以解除 await
        function forceFinishAll() {
            // 清空排队中的回调，防止新任务启动
            pendingCallbacks.length = 0;
            // 如果还有 pending 任务，直接归零并 resolve
            if (pendingTasks > 0 && allDoneResolve) {
                pendingTasks = 0;
                allDoneResolve();
                allDoneResolve = null;
            }
        }

        try {
            searchRecursive(dirPath, 0);
            await allDonePromise;
        } catch (e) {
            that._error('deepSearch error:', e);
        }

        // 清理 abort 标记
        if (this._deepSearchAbort === abortFlag) {
            this._deepSearchAbort = null;
        }

        // 无论是否取消都回调，让上层统一处理 UI 状态
        onComplete(allResults, abortFlag.cancelled);
    }

    /**
     * 计算相对路径用于显示
     */
    getRelativePath(fullPath, basePath) {
        var normBase = basePath;
        if (!normBase.endsWith(this._sep)) normBase += this._sep;
        if (fullPath.indexOf(normBase) === 0) {
            return fullPath.substring(normBase.length);
        }
        return fullPath;
    }

    /**
     * 根据搜索词过滤当前目录文件
     * 支持多关键词：空格分隔，所有关键词都必须匹配（AND 逻辑）
     */
    applyFilter(query) {
        if (!this.cachedFiles.length || !this.cachedPath) return;

        var filtered;
        if (!query) {
            filtered = this.cachedFiles.slice();
        } else {
            var keywords = query.toLowerCase().split(/\s+/).filter(function(k) { return k.length > 0; });
            filtered = this.cachedFiles.filter(function(f) {
                var lowerName = f.name.toLowerCase();
                for (var i = 0; i < keywords.length; i++) {
                    if (lowerName.indexOf(keywords[i]) === -1) {
                        return false;
                    }
                }
                return true;
            });
        }

        filtered = this.sortFiles(filtered);
        this.doRender(filtered, this.cachedPath, query, this.isDeepSearchMode);
    }

    /**
     * 实际渲染文件列表（支持搜索状态提示）
     * @param {boolean} isDeepSearch - 是否为深度搜索结果（显示相对路径）
     */
    doRender(files, currentPath, filterQuery, isDeepSearch) {
        var that = this;
        var fileListEl = document.getElementById('cd-file-list');
        if (!fileListEl) return;

        if (files.length === 0) {
            var emptyMsg = filterQuery ? '无匹配结果' : '目录为空';
            fileListEl.innerHTML = '<div style="padding:20px;text-align:center;color:#999">' + emptyMsg + '</div>';
            return;
        }

        var html = '';

        // 图标模式：grid 布局 + 滚动动态渲染
        if (that.currentView === 'icon' && !isDeepSearch) {
            fileListEl.style.display = 'grid';
            fileListEl.style.gridTemplateColumns = 'repeat(auto-fill, minmax(80px, 1fr))';
            fileListEl.style.gridAutoRows = '110px';
            fileListEl.style.gap = '4px';
            fileListEl.style.padding = '8px';
            fileListEl.style.alignItems = 'start';

            // 保存状态用于滚动渲染
            that.iconRenderState = {
                files: files,
                currentPath: currentPath,
                batchSize: 60,  // 每批渲染数量（图标较小，加大批量减少卡顿）
                renderedCount: 0,
                isLoading: false
            };

            // 初始渲染第一批
            that.renderIconBatch(fileListEl);

            // 绑定滚动事件（使用 passive 提升性能，先移除旧的）
            // 使用构造函数中绑定的 _boundIconScroll，避免重复创建函数引用导致 removeEventListener 失效
            fileListEl.removeEventListener('scroll', that._boundIconScroll);
            fileListEl.addEventListener('scroll', that._boundIconScroll, { passive: true });

            return;
        } else {
            // 列表模式（默认，也用于深度搜索）
            fileListEl.style.display = 'block';
            fileListEl.style.gridTemplateColumns = '';
            fileListEl.style.gap = '';
            fileListEl.style.padding = '';

            // 文件数量超过阈值时启用分批渲染
            var LIST_BATCH_THRESHOLD = 200;
            var LIST_BATCH_SIZE = 100;

            if (!isDeepSearch && files.length > LIST_BATCH_THRESHOLD) {
                // 分批渲染模式
                that.listRenderState = {
                    files: files,
                    currentPath: currentPath,
                    batchSize: LIST_BATCH_SIZE,
                    renderedCount: 0,
                    isLoading: false,
                    isDeepSearch: false
                };

                that.renderListBatch(fileListEl);

                // 绑定滚动事件
                if (!that._boundListScroll) {
                    that._boundListScroll = that.onListScroll.bind(that);
                }
                fileListEl.removeEventListener('scroll', that._boundListScroll);
                fileListEl.addEventListener('scroll', that._boundListScroll, { passive: true });
                return;
            }

            // 文件数量不多或深度搜索时，一次性渲染
            that.listRenderState = null;

            for (var i = 0; i < files.length; i++) {
                var f = files[i];
                var icon = f.isDir ? '📁' : that.getFileIcon(f.name);
                var name = that.escapeHtml(f.name);
                var itemClass = f.isDir ? 'cd-dir' : 'cd-file';
                var fullPath = f.path || ((currentPath.endsWith(that._sep) ? currentPath : currentPath + that._sep) + f.name);

                var relativePathHtml = '';
                if (isDeepSearch && f.relativePath) {
                    var displayPath = that.escapeHtml(f.relativePath);
                    var lastSlash = Math.max(displayPath.lastIndexOf('\\'), displayPath.lastIndexOf('/'));
                    var folderPath = lastSlash > 0 ? displayPath.substring(0, lastSlash) : '';
                    if (folderPath) {
                        relativePathHtml = '<div style="font-size:11px;color:var(--b3-theme-secondary,#999);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">📂 ' + folderPath + '</div>';
                    }
                }

                var timeStr = f.mtime ? that.formatTime(f.mtime) : '';
                var sizeStr = f.isDir ? '' : that.formatSize(f.size);
                var favMark = that.isFavorite(fullPath) ? '<span style="margin-left:2px;font-size:11px;color:#f5a623">⭐</span>' : '';
                var linkMark = that.isFileDocLinked(fullPath) ? '<span class="cd-doc-link-icon" data-linkpath="' + that.escapeHtml(fullPath) + '" title="点击打开关联文档" style="margin-left:2px;font-size:11px;cursor:pointer;color:#4fc3f7">🔗</span>' : '';

                if (isDeepSearch && relativePathHtml) {
                    html += '<div class="cd-item ' + itemClass + '" ' +
                        'data-path="' + that.escapeHtml(fullPath) + '" ' +
                        'data-name="' + that.escapeHtml(f.name) + '" ' +
                        'data-isdir="' + f.isDir + '" ' +
                        'draggable="true" ' +
                        'style="display:flex;align-items:flex-start;padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--b3-border,#eee);transition:background 0.15s">' +
                        '<span style="font-size:16px;margin-right:8px;flex-shrink:0;margin-top:1px">' + icon + '</span>' +
                        '<span style="flex:1;overflow:hidden;min-width:0">' +
                            '<div style="font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + name + linkMark + favMark + '</div>' +
                            relativePathHtml +
                        '</span>' +
                        (sizeStr ? '<span style="font-size:11px;color:var(--b3-theme-secondary,#999);margin-left:8px;flex-shrink:0;white-space:nowrap;min-width:50px;text-align:right">' + sizeStr + '</span>' : '') +
                        (timeStr ? '<span style="font-size:11px;color:#bbb;margin-left:8px;flex-shrink:0;white-space:nowrap">' + timeStr + '</span>' : '') +
                    '</div>';
                } else {
                    // 文件夹直接显示展开箭头，点击时再检测是否有子项；文件显示空占位
                    var isDockerList1 = that._isDockerBrowser();
                    var expander = f.isDir ?
                        '<span class="cd-list-expand" title="' + (isDockerList1 ? 'Docker 环境不支持展开' : '展开/折叠') + '" style="cursor:' + (isDockerList1 ? 'not-allowed' : 'pointer') + ';width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;margin-right:2px;vertical-align:middle' + (isDockerList1 ? ';opacity:0.35' : '') + '"><svg viewBox="0 0 32 32" style="width:10px;height:10px;color:var(--b3-theme-on-surface,#666);transition:transform 0.15s;fill:currentColor;pointer-events:none"><path d="M21.964 16.874l-10.453 10.453c-0.737 0.737-1.942 0.737-2.678 0s-0.737-1.942 0-2.678l9.114-9.114-9.114-9.114c-0.737-0.737-0.737-1.942 0-2.678s1.942-0.737 2.678 0l10.453 10.453c0.369 0.369 0.553 0.861 0.553 1.339s-0.184 0.97-0.553 1.339z"></path></svg></span>' :
                        '<span style="width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;margin-right:2px"></span>';

                    html += '<div class="cd-item ' + itemClass + '" ' +
                        'data-path="' + that.escapeHtml(fullPath) + '" ' +
                        'data-name="' + that.escapeHtml(f.name) + '" ' +
                        'data-isdir="' + f.isDir + '" ' +
                        'data-has-children="false" ' +
                        'data-level="0" ' +
                        'draggable="true" ' +
                        'style="display:flex;align-items:center;padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--b3-border,#eee);transition:background 0.15s">' +
                        expander +
                        '<span style="font-size:16px;margin-right:6px;flex-shrink:0">' + icon + '</span>' +
                        '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px">' + name + linkMark + favMark + '</span>' +
                        (sizeStr ? '<span style="font-size:11px;color:var(--b3-theme-secondary,#999);margin-left:8px;flex-shrink:0;white-space:nowrap;min-width:50px;text-align:right">' + sizeStr + '</span>' : '') +
                        (timeStr ? '<span style="font-size:11px;color:#bbb;margin-left:8px;flex-shrink:0;white-space:nowrap">' + timeStr + '</span>' : '') +
                    '</div>' +
                    '<div class="cd-list-children" data-parent="' + that.escapeHtml(fullPath) + '" data-level="0" style="display:none"></div>';
                }
            }
        }

        fileListEl.innerHTML = html;

        // 绑定点击事件
        that.bindItemEvents(fileListEl, files, currentPath);

        // 恢复滚动位置
        that._restoreScrollPosition(fileListEl, currentPath);
    }

    /**
     * 恢复当前目录的滚动位置
     */
    _restoreScrollPosition(fileListEl, currentPath) {
        var saved = this._scrollPositions[currentPath];
        if (saved && fileListEl) {
            // 用 requestAnimationFrame 等待 DOM 稳定后恢复
            var that = this;
            requestAnimationFrame(function() {
                fileListEl.scrollTop = saved;
                // 恢复后清除记录，避免下次误恢复
                delete that._scrollPositions[currentPath];
            });
        }
    }

    /**
     * 列表视图分批渲染（大目录场景）
     */
    renderListBatch(fileListEl) {
        var that = this;
        var state = that.listRenderState;
        if (!state || state.isLoading) return;

        state.isLoading = true;
        var files = state.files;
        var currentPath = state.currentPath;
        var batchSize = state.batchSize;
        var startIdx = state.renderedCount;
        var endIdx = Math.min(startIdx + batchSize, files.length);

        if (startIdx >= files.length) {
            state.isLoading = false;
            return;
        }

        var html = '';
        for (var i = startIdx; i < endIdx; i++) {
            var f = files[i];
            var icon = f.isDir ? '📁' : that.getFileIcon(f.name);
            var name = that.escapeHtml(f.name);
            var itemClass = f.isDir ? 'cd-dir' : 'cd-file';
            var fullPath = f.path || ((currentPath.endsWith(that._sep) ? currentPath : currentPath + that._sep) + f.name);
            var timeStr = f.mtime ? that.formatTime(f.mtime) : '';
            var sizeStr = f.isDir ? '' : that.formatSize(f.size);
            var favMark2 = that.isFavorite(fullPath) ? '<span style="margin-left:2px;font-size:11px;color:#f5a623">⭐</span>' : '';
            var linkMark2 = that.isFileDocLinked(fullPath) ? '<span class="cd-doc-link-icon" data-linkpath="' + that.escapeHtml(fullPath) + '" title="点击打开关联文档" style="margin-left:2px;font-size:11px;cursor:pointer;color:#4fc3f7">🔗</span>' : '';

            // 文件夹直接显示展开箭头，点击时再检测是否有子项；文件显示空占位
            var isDockerList2 = that._isDockerBrowser();
            var expander = f.isDir ?
                '<span class="cd-list-expand" title="' + (isDockerList2 ? 'Docker 环境不支持展开' : '展开/折叠') + '" style="cursor:' + (isDockerList2 ? 'not-allowed' : 'pointer') + ';width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;margin-right:2px;vertical-align:middle' + (isDockerList2 ? ';opacity:0.35' : '') + '"><svg viewBox="0 0 32 32" style="width:10px;height:10px;color:var(--b3-theme-on-surface,#666);transition:transform 0.15s;fill:currentColor;pointer-events:none"><path d="M21.964 16.874l-10.453 10.453c-0.737 0.737-1.942 0.737-2.678 0s-0.737-1.942 0-2.678l9.114-9.114-9.114-9.114c-0.737-0.737-0.737-1.942 0-2.678s1.942-0.737 2.678 0l10.453 10.453c0.369 0.369 0.553 0.861 0.553 1.339s-0.184 0.97-0.553 1.339z"></path></svg></span>' :
                '<span style="width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;margin-right:2px"></span>';

            html += '<div class="cd-item ' + itemClass + '" ' +
                'data-path="' + that.escapeHtml(fullPath) + '" ' +
                'data-name="' + that.escapeHtml(f.name) + '" ' +
                'data-isdir="' + f.isDir + '" ' +
                'data-has-children="false" ' +
                'data-level="0" ' +
                'draggable="true" ' +
                'style="display:flex;align-items:center;padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--b3-border,#eee);transition:background 0.15s;font-size:13px;user-select:none">' +
                expander +
                '<span style="font-size:16px;margin-right:6px;flex-shrink:0">' + icon + '</span>' +
                '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;color:var(--b3-theme-on-background,#333)">' + name + linkMark2 + favMark2 + '</span>' +
                (sizeStr ? '<span style="font-size:11px;color:var(--b3-theme-secondary,#999);margin-left:8px;flex-shrink:0;white-space:nowrap;min-width:50px;text-align:right">' + sizeStr + '</span>' : '') +
                (timeStr ? '<span style="font-size:11px;color:var(--b3-theme-secondary,#999);margin-left:8px;flex-shrink:0;white-space:nowrap">' + timeStr + '</span>' : '') +
            '</div>' +
            '<div class="cd-list-children" data-parent="' + that.escapeHtml(fullPath) + '" data-level="0" style="display:none"></div>';
        }

        if (startIdx === 0) {
            fileListEl.innerHTML = html;
            // 首批渲染后恢复滚动位置
            that._restoreScrollPosition(fileListEl, currentPath);
        } else {
            fileListEl.insertAdjacentHTML('beforeend', html);
        }

        state.renderedCount = endIdx;

        that.bindItemEvents(fileListEl, files, currentPath);

        state.isLoading = false;

        // 有更多内容时显示加载提示
        if (state.renderedCount < state.files.length) {
            var existing = document.getElementById('cd-loading-more');
            if (!existing) {
                fileListEl.insertAdjacentHTML('beforeend',
                    '<div id="cd-loading-more" style="padding:10px;text-align:center;color:var(--b3-theme-secondary,#999);font-size:12px">加载中...</div>');
            }
        } else {
            // 全部加载完成，移除加载提示
            var loadingEl = document.getElementById('cd-loading-more');
            if (loadingEl) loadingEl.remove();
        }

        // 如果内容没有撑满容器，自动加载下一批
        setTimeout(function() {
            if (fileListEl.scrollHeight <= fileListEl.clientHeight + 50) {
                if (state.renderedCount < state.files.length) {
                    that.renderListBatch(fileListEl);
                }
            }
            // 渲染完成后移除加载提示
            var loadingEl = document.getElementById('cd-loading-more');
            if (loadingEl) loadingEl.remove();
        }, 50);
    }

    /**
     * 列表视图：滚动事件处理（分批渲染）
     */
    onListScroll(e) {
        var that = this;
        var fileListEl = e.target;
        var state = that.listRenderState;
        if (!state || state.isLoading) return;

        if (that._scrollTimer) {
            clearTimeout(that._scrollTimer);
        }

        that._scrollTimer = setTimeout(function() {
            var scrollTop = fileListEl.scrollTop;
            var clientHeight = fileListEl.clientHeight;
            var scrollHeight = fileListEl.scrollHeight;
            var scrollBottom = scrollTop + clientHeight;

            if (scrollBottom >= scrollHeight - 100 && state.renderedCount < state.files.length) {
                // 滚动触底时有更多内容，显示加载提示
                var existing = document.getElementById('cd-loading-more');
                if (!existing) {
                    fileListEl.insertAdjacentHTML('beforeend',
                        '<div id="cd-loading-more" style="padding:10px;text-align:center;color:var(--b3-theme-secondary,#999);font-size:12px">加载中...</div>');
                }
                that.renderListBatch(fileListEl);
            }
        }, 100);
    }

    /**
     * 异步检测空文件夹，移除空文件夹的展开箭头
     * 策略：先快速渲染（文件夹默认不显示箭头），再异步检测有子项的文件夹并插入箭头
     */
    /**
     * 移除文件夹的展开箭头（点击展开后发现是空文件夹时调用）
     */
    _removeExpandArrow(item) {
        var expander = item.querySelector('.cd-list-expand');
        if (!expander) return;
        // 替换为空占位，保持对齐
        var placeholder = document.createElement('span');
        placeholder.style.cssText = 'width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;margin-right:2px';
        expander.parentNode.replaceChild(placeholder, expander);
        item.dataset.hasChildren = 'false';
    }

    /**
     * 渲染列表视图中展开的子项
     * 优化：先渲染前 50 条立即展开，剩余后台分批追加
     * stat 信息（大小/时间）异步补齐（_fillStatInfo）
     */
    renderListChildren(containerEl, dirPath, level) {
        var that = this;
        level = level || 1;

        containerEl.style.display = 'block';

        // 双模式：fs 优先，API 兜底
        this._fsReaddir(dirPath).then(function(entries) {
            // 过滤隐藏文件、系统目录和歌词文件
            entries = entries.filter(function(entry) {
                var ext = entry.name.split('.').pop().toLowerCase();
                return entry.name.charAt(0) !== '.' &&
                       entry.name !== '$RECYCLE.BIN' &&
                       entry.name !== 'System Volume Information' &&
                       ext !== 'lrc';
            });
            entries.sort(function(a, b) {
                if (a.isDir && !b.isDir) return -1;
                if (!a.isDir && b.isDir) return 1;
                return a.name.localeCompare(b.name);
            });

            if (entries.length === 0) {
                containerEl.innerHTML = '';
                containerEl.style.display = 'none';
                delete containerEl.dataset.loading;
                var parentItem = containerEl.previousElementSibling;
                if (parentItem && parentItem.classList.contains('cd-item')) {
                    that._removeExpandArrow(parentItem);
                }
                return;
            }

            // 立即渲染前 50 条
            var FIRST_BATCH = 50;
            var firstEntries = entries.slice(0, FIRST_BATCH);
            var html = that._buildListItemsHtml(firstEntries, dirPath, level);

            containerEl.innerHTML = html;
            delete containerEl.dataset.loading;
            that.bindItemEvents(containerEl, [], dirPath);

            // 先补前 50 条的 stat
            that._fillStatInfo(containerEl, firstEntries, dirPath);

            // 后台分批追加剩余条目
            if (entries.length > FIRST_BATCH) {
                that._appendRemainingItems(containerEl, entries, dirPath, level, FIRST_BATCH);
            }
        }).catch(function(err) {
            console.warn('[LocalBrowse] renderListChildren error:', err);
            var isENOENT = err && err.code === 'ENOENT';
            if (!isENOENT && err && err.message) {
                var m = err.message;
                isENOENT = m.indexOf('ENOENT') !== -1 || m.indexOf('no such file') !== -1;
            }
            // ENOENT：静默处理——箭头消失、文件夹变淡、不提示
            if (isENOENT) {
                containerEl.innerHTML = '';
                containerEl.style.display = 'none';
                delete containerEl.dataset.loading;
                var parentItem = containerEl.previousElementSibling;
                if (parentItem && parentItem.classList.contains('cd-item')) {
                    that._removeExpandArrow(parentItem);
                    parentItem.style.opacity = '0.45';
                }
                return;
            }
            // 其他错误：显示提示
            var errMsg = '无法读取';
            if (err && (err.code === 'EACCES' || err.code === 'EPERM')) {
                errMsg = '🔒 无访问权限';
            } else if (err && err.message) {
                var m2 = err.message;
                if (m2.indexOf('EACCES') !== -1 || m2.indexOf('EPERM') !== -1 || m2.indexOf('permission') !== -1) {
                    errMsg = '🔒 无访问权限';
                }
            }
            containerEl.innerHTML = '<div style="padding:8px 12px;font-size:12px;color:var(--b3-theme-error,#e74c3c)">' + errMsg + '</div>';
            delete containerEl.dataset.loading;
        });
    }
    _buildListItemsHtml(entries, dirPath, level) {
        var that = this;
        var html = '';
        var indent = level * 18;
        var isDockerBuildList = that._isDockerBrowser();
        for (var i = 0; i < entries.length; i++) {
            var entry = entries[i];
            var fullPath = path ? path.join(dirPath, entry.name) : (dirPath.replace(/[\\\/]+$/, '') + that._sep + entry.name);
            var isDir = typeof entry.isDirectory === 'function' ? entry.isDirectory() : entry.isDir;
            var icon = isDir ? '📁' : that.getFileIcon(entry.name);

            var expander = isDir ?
                '<span class="cd-list-expand" title="' + (isDockerBuildList ? 'Docker 环境不支持展开' : '展开/折叠') + '" style="cursor:' + (isDockerBuildList ? 'not-allowed' : 'pointer') + ';width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;margin-right:2px;vertical-align:middle' + (isDockerBuildList ? ';opacity:0.35' : '') + '"><svg viewBox="0 0 32 32" style="width:10px;height:10px;color:var(--b3-theme-on-surface,#666);transition:transform 0.15s;fill:currentColor;pointer-events:none"><path d="M21.964 16.874l-10.453 10.453c-0.737 0.737-1.942 0.737-2.678 0s-0.737-1.942 0-2.678l9.114-9.114-9.114-9.114c-0.737-0.737-0.737-1.942 0-2.678s1.942-0.737 2.678 0l10.453 10.453c0.369 0.369 0.553 0.861 0.553 1.339s-0.184 0.97-0.553 1.339z"></path></svg></span>' :
                '<span style="width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;margin-right:2px"></span>';

            html += '<div class="cd-item ' + (isDir ? 'cd-dir' : 'cd-file') + '" ' +
                'data-path="' + that.escapeHtml(fullPath) + '" ' +
                'data-name="' + that.escapeHtml(entry.name) + '" ' +
                'data-isdir="' + isDir + '" ' +
                'data-has-children="false" ' +
                'data-level="' + level + '" ' +
                'draggable="true" ' +
                'style="display:flex;align-items:center;padding:6px 12px;cursor:pointer;border-bottom:1px solid var(--b3-border,#f0f0f0);transition:background 0.15s;padding-left:' + (12 + indent) + 'px">' +
                expander +
                '<span style="font-size:15px;margin-right:6px;flex-shrink:0">' + icon + '</span>' +
                '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:400">' + that.escapeHtml(entry.name) + (that.isFileDocLinked(fullPath) ? '<span class="cd-doc-link-icon" data-linkpath="' + that.escapeHtml(fullPath) + '" title="点击打开关联文档" style="font-size:11px;cursor:pointer;color:#4fc3f7;margin-left:2px">🔗</span>' : '') + '</span>' +
                '<span class="cd-stat-size" style="font-size:11px;color:var(--b3-theme-secondary,#999);margin-left:8px;flex-shrink:0;white-space:nowrap;min-width:50px;text-align:right"></span>' +
                '<span class="cd-stat-time" style="font-size:11px;color:#bbb;margin-left:8px;flex-shrink:0;white-space:nowrap"></span>' +
            '</div>' +
            '<div class="cd-list-children" data-parent="' + that.escapeHtml(fullPath) + '" data-level="' + level + '" style="display:none"></div>';
        }
        return html;
    }

    /**
     * 后台分批追加剩余列表项（每批 50 条）
     * 每批渲染后触发 stat 补齐，用 requestAnimationFrame 让主线程喘口气
     */
    _appendRemainingItems(containerEl, entries, dirPath, level, startIndex) {
        var that = this;
        var BATCH = 50;

        function appendBatch() {
            // 容器已被卸载（用户折叠或导航走了）
            if (!containerEl.parentNode) return;

            var end = Math.min(startIndex + BATCH, entries.length);
            var batchEntries = entries.slice(startIndex, end);
            var html = that._buildListItemsHtml(batchEntries, dirPath, level);

            // 追加到容器末尾
            containerEl.insertAdjacentHTML('beforeend', html);

            // 绑定新增条目的事件
            that.bindItemEvents(containerEl, [], dirPath);

            // 异步补这批条目的 stat
            that._fillStatInfo(containerEl, batchEntries, dirPath);

            startIndex = end;
            if (startIndex < entries.length) {
                // 让主线程休息一帧再追加下一批
                requestAnimationFrame(appendBatch);
            }
        }

        // 用 rAF 延迟启动，先让前 50 条的 DOM 渲染完
        requestAnimationFrame(appendBatch);
    }

    /**
     * 异步批量补齐 stat 信息（文件大小、修改时间）
     * 每批最多 20 个并发，避免网盘环境下的 IO 风暴
     */
    _fillStatInfo(containerEl, entries, dirPath) {
        var that = this;
        if (!fs || !fs.stat) {
            // API 模式：没有完整 stat 信息，尝试用 _fsStat 异步补齐
            that._fillStatInfoAPI(containerEl, entries, dirPath);
            return;
        }
        var BATCH = 20;
        var index = 0;

        function nextBatch() {
            var tasks = [];
            var batchEntries = [];
            for (var i = 0; index < entries.length && i < BATCH; index++, i++) {
                (function(entry) {
                    var fullPath = path ? path.join(dirPath, entry.name) : (dirPath.replace(/[\\\/]+$/, '') + that._sep + entry.name);({ entry: entry, fullPath: fullPath });
                    tasks.push(new Promise(function(resolve) {
                        fs.stat(fullPath, function(err, stat) {
                            resolve({ entry: entry, fullPath: fullPath, stat: err ? null : stat });
                        });
                    }));
                })(entries[index]);
            }

            if (tasks.length === 0) return;

            Promise.all(tasks).then(function(results) {
                for (var i = 0; i < results.length; i++) {
                    var r = results[i];
                    if (!r.stat) continue;
                    if (!containerEl.parentNode) return;

                    // 遍历匹配（避免 CSS.escape 无法处理 Windows 反斜杠路径的 DOMException）
                    var itemEl = null;
                    var allItems = containerEl.querySelectorAll('.cd-item');
                    for (var j = 0; j < allItems.length; j++) {
                        if (allItems[j].dataset.path === r.fullPath) { itemEl = allItems[j]; break; }
                    }
                    if (!itemEl) continue;

                    var isDir = typeof r.entry.isDirectory === 'function' ? r.entry.isDirectory() : r.entry.isDir;
                    if (!isDir) {
                        var sizeEl = itemEl.querySelector('.cd-stat-size');
                        if (sizeEl) sizeEl.textContent = that.formatSize(r.stat.size);
                    }
                    if (r.stat.mtime) {
                        var timeEl = itemEl.querySelector('.cd-stat-time');
                        if (timeEl) timeEl.textContent = that.formatTime(r.stat.mtime);
                    }
                }
                nextBatch();
            });
        }

        nextBatch();
    }

    /**
     * API 模式下异步补齐 stat 信息（大小/时间）
     * API 不返回文件大小，仅补时间
     */
    _fillStatInfoAPI(containerEl, entries, dirPath) {
        var that = this;
        for (var i = 0; i < entries.length; i++) {
            var entry = entries[i];
            if (!containerEl.parentNode) return;
            var fullPath = path ? path.join(dirPath, entry.name) : (dirPath.replace(/[\\\/]+$/, '') + that._sep + entry.name);
            // 遍历匹配（避免 CSS.escape 无法处理 Windows 反斜杠路径的 DOMException）
            var itemEl = null;
            var allItems = containerEl.querySelectorAll('.cd-item');
            for (var k = 0; k < allItems.length; k++) {
                if (allItems[k].dataset.path === fullPath) { itemEl = allItems[k]; break; }
            }
            if (!itemEl) continue;
            var isDir = typeof entry.isDirectory === 'function' ? entry.isDirectory() : entry.isDir;
            if (!isDir && entry.size) {
                var sizeEl = itemEl.querySelector('.cd-stat-size');
                if (sizeEl) sizeEl.textContent = that.formatSize(entry.size);
            }
            if (entry.updated) {
                var timeEl = itemEl.querySelector('.cd-stat-time');
                if (timeEl) timeEl.textContent = that.formatTime(new Date(entry.updated * 1000));
            }
        }
    }


    /**
     * 构建单个图标项 HTML
     */
    buildIconItem(f, currentPath) {
        var that = this;
        var name = that.escapeHtml(f.name);
        var itemClass = f.isDir ? 'cd-dir' : 'cd-file';
        var fullPath = f.path || ((currentPath.endsWith(that._sep) ? currentPath : currentPath + that._sep) + f.name);
        var isImg = !f.isDir && that.isImageFile(f.name);

        var iconHtml;
        if (isImg) {
            // 大文件（>5MB）或 LIVP 文件显示占位图标，避免加载慢
            var isLargeFile = f.size > 5 * 1024 * 1024;
            var ext = name.split('.').pop().toLowerCase();
            var isLivp = (ext === 'livp');
            if (isLargeFile || isLivp) {
                // LIVP 不支持浏览器预览，大图悬浮时懒加载缩放缩略图
                if (isLivp) {
                    iconHtml = '<div class="cd-thumb-wrap" style="width:56px;height:56px;border-radius:4px;background:var(--b3-theme-surface,#f0f0f0);overflow:hidden;position:relative;flex-shrink:0;display:flex;align-items:center;justify-content:center">' +
                        '<span style="font-size:28px;color:var(--b3-theme-secondary,#999)">📷</span>' +
                        '</div>';
                } else {
                    // 大图：给 data-src + data-large，悬浮时 Canvas 缩放加载
                    iconHtml = '<div class="cd-thumb-wrap" data-src="' + that.escapeHtml(that.toFileUrl(fullPath)) + '" data-large="1" style="width:56px;height:56px;border-radius:4px;background:var(--b3-theme-surface,#f0f0f0);overflow:hidden;position:relative;flex-shrink:0;display:flex;align-items:center;justify-content:center">' +
                        '<span class="cd-thumb-placeholder" style="font-size:28px;color:var(--b3-theme-secondary,#999)">🖼️</span>' +
                        '</div>';
                }
            } else {
                // 先显示占位符，滚动停止后再加载缩略图
                iconHtml = '<div class="cd-thumb-wrap" data-src="' + that.escapeHtml(that.toFileUrl(fullPath)) + '" style="width:56px;height:56px;border-radius:4px;background:var(--b3-theme-surface,#f0f0f0);overflow:hidden;position:relative;flex-shrink:0;display:flex;align-items:center;justify-content:center">' +
                    '<span class="cd-thumb-placeholder" style="font-size:20px;color:var(--b3-theme-secondary,#999)">🖼️</span>' +
                    '</div>';
            }
        } else {
            var icon = f.isDir ? '📁' : that.getFileIcon(f.name);
            iconHtml = '<span style="font-size:36px;line-height:1;display:block">' + icon + '</span>';
        }

        // 图片文件名后追加文件大小
        var displayName = name;
        if (isImg && f.size) {
            displayName += ' <span style="color:var(--b3-theme-secondary,#999);font-size:10px">(' + that.formatSize(f.size) + ')</span>';
        }
        if (that.isFavorite(fullPath)) {
            displayName += '<span style="margin-left:1px;font-size:9px;color:#f5a623">⭐</span>';
        }
        var linkMarkIcon = that.isFileDocLinked(fullPath) ? '<span class="cd-doc-link-icon" data-linkpath="' + that.escapeHtml(fullPath) + '" title="点击打开关联文档" style="font-size:9px;cursor:pointer;color:#4fc3f7">🔗</span>' : '';

        return '<div class="cd-item ' + itemClass + '" ' +
            'data-path="' + that.escapeHtml(fullPath) + '" ' +
            'data-name="' + that.escapeHtml(f.name) + '" ' +
            'data-isdir="' + f.isDir + '" ' +
            'data-isimg="' + isImg + '" ' +
            'draggable="true" ' +
            'style="display:flex;flex-direction:column;align-items:center;justify-content:flex-start;padding:6px 4px;cursor:pointer;border-radius:4px;transition:background 0.15s;height:110px;box-sizing:border-box;overflow:hidden">' +
            '<div style="width:56px;height:56px;display:flex;align-items:center;justify-content:center;margin-bottom:4px;flex-shrink:0">' + iconHtml + '</div>' +
            '<span class="cd-name" style="font-size:11px;text-align:center;word-break:break-all;line-height:1.2;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;width:100%;flex-shrink:0">' + displayName + linkMarkIcon + '</span>' +
        '</div>';
    }


    /**
     * 绑定文件项的点击/双击/悬停/右键事件
     */
    bindItemEvents(fileListEl, files, currentPath) {
        var that = this;
        // 注入箭头 hover 样式（仅一次）
        if (!document.getElementById('cd-expand-hover-style')) {
            var hoverStyle = document.createElement('style');
            hoverStyle.id = 'cd-expand-hover-style';
            hoverStyle.textContent = '.cd-list-expand:hover,.cd-asset-arrow:hover,.cd-asset-doc-arrow:hover{background:var(--b3-theme-hover,rgba(0,0,0,0.06));border-radius:3px}';
            document.head.appendChild(hoverStyle);
        }
        var items = fileListEl.querySelectorAll('.cd-item:not([data-bound])');
        for (var j = 0; j < items.length; j++) {
            (function(item) {
                item.dataset.bound = 'true';
                item.addEventListener('click', function(e) {
                    e.preventDefault();
                    e.stopPropagation();

                    // 如果点击的是关联图标，打开关联文档
                    if (e.target.classList.contains('cd-doc-link-icon')) {
                        var linkPath = e.target.dataset.linkpath;
                        if (linkPath) {
                            that.openLinkedDoc(linkPath);
                        }
                        return;
                    }

                    var isDir = item.dataset.isdir === 'true';
                    var itemPath = item.dataset.path;

                    if (isDir) {
                        // Ctrl/Cmd/Shift+点击文件夹时支持多选
                        if (e.ctrlKey || e.metaKey || e.shiftKey) {
                            that.selectItem(item, e);
                            return;
                        }
                        // Docker 浏览器模式下禁止展开子目录
                        if (that._isDockerBrowser()) {
                            return;
                        }
                        // 判断点击的是箭头还是文件夹名称/图标区域
                        var expandEl = e.target.closest ? e.target.closest('.cd-list-expand') : null;
                        // SVG 在箭头内部，也属于箭头点击
                        if (!expandEl && e.target.parentElement && e.target.parentElement.classList && e.target.parentElement.classList.contains('cd-list-expand')) {
                            expandEl = e.target.parentElement;
                        }
                        if (expandEl) {
                            // 点击箭头 → 展开/折叠（零延迟，瞬间响应）
                            var expander = item.querySelector('.cd-list-expand');
                            var childrenEl = item.nextElementSibling;
                            if (childrenEl && !childrenEl.classList.contains('cd-list-children')) {
                                childrenEl = null;
                            }
                            var currentLevel = parseInt(item.dataset.level || '0', 10);
                            if (childrenEl) {
                                if (childrenEl.style.display === 'none') {
                                    if (childrenEl.innerHTML === '') {
                                        childrenEl.dataset.loading = 'true';
                                        that.renderListChildren(childrenEl, itemPath, currentLevel + 1);
                                    } else {
                                        childrenEl.style.display = 'block';
                                    }
                                    if (expander) expander.style.transform = 'rotate(90deg)';
                                    that._expandedDirs.add(itemPath);
                                } else if (childrenEl.dataset.loading === 'true') {
                                    return;
                                } else {
                                    childrenEl.style.display = 'none';
                                    if (expander) expander.style.transform = 'rotate(0deg)';
                                    that._expandedDirs.delete(itemPath);
                                }
                            }
                            that._updateBreadcrumbHomeState();
                        } else {
                            // 点击文件夹名称/图标区域 → 进入该目录
                            that.loadDirectory(itemPath);
                        }
                        return;
                    }

                    // 文件：单击选中
                    that.selectItem(item, e);
                });

                item.addEventListener('dblclick', function(e) {
                    e.preventDefault();
                    e.stopPropagation();

                    var isDir = item.dataset.isdir === 'true';
                    var itemPath = item.dataset.path;
                    var name = item.dataset.name;

                    if (isDir) {
                        // 双击箭头时忽略（已由 click 处理展开/折叠），仅双击名称区域才进入目录
                        var expandEl = e.target.closest ? e.target.closest('.cd-list-expand') : null;
                        if (!expandEl && e.target.parentElement && e.target.parentElement.classList && e.target.parentElement.classList.contains('cd-list-expand')) {
                            expandEl = e.target.parentElement;
                        }
                        if (expandEl) return;
                        that.loadDirectory(itemPath);
                    } else {
                        // 文件：双击打开
                        if (that.isAudioFile(name)) {
                            // 音频文件：内置播放器播放
                            that.playAudio(itemPath, name);
                        } else if (that.isVideoFile(name)) {
                            // 视频文件：优先思播，降级系统默认
                            that.playVideo(itemPath, name);
                        } else {
                            that.openFile(itemPath);
                        }
                    }
                });

                item.addEventListener('mouseenter', function(e) {
                    if (!this.classList.contains('cd-selected')) {
                        this.style.background = 'var(--b3-theme-hover,#e3f2fd)';
                    }
                    // 记录鼠标位置，用于预览图定位
                    that._previewMousePos = { x: e.clientX, y: e.clientY };
                    // 滚动中暂停预览，避免卡顿
                    if (that._isScrolling) return;
                    // 图片文件：延迟显示预览（LIVP 不支持浏览器预览，跳过）
                    var isDir = item.dataset.isdir === 'true';
                    var name = item.dataset.name;
                    var nameExt = name.split('.').pop().toLowerCase();
                    if (!isDir && that.isImageFile(name) && nameExt !== 'livp') {
                        that._previewTimer = setTimeout(function() {
                            // 从 files 数组中查找对应的文件大小和修改时间
                            var fileSize = null;
                            var fileMtime = null;
                            if (that.iconRenderState && that.iconRenderState.files) {
                                for (var fi = 0; fi < that.iconRenderState.files.length; fi++) {
                                    var f = that.iconRenderState.files[fi];
                                    if (f.name === name) {
                                        fileSize = f.size;
                                        fileMtime = f.mtime;
                                        break;
                                    }
                                }
                            }
                            that.showImagePreview(item.dataset.path, name, fileSize, fileMtime);
                        }, 600);
                    }
                    // 图标视图：大图悬浮时懒加载缩略图
                    if (that.currentView === 'icon' && !isDir) {
                        var thumbWrap = item.querySelector('.cd-thumb-wrap[data-large="1"]:not([data-loaded])');
                        if (thumbWrap) {
                            that.loadLargeThumbnail(thumbWrap);
                        }
                    }
                    // 图标视图：悬停显示完整文件名
                    if (that.currentView === 'icon') {
                        var nameSpan = item.querySelector('.cd-name');
                        if (nameSpan) {
                            nameSpan.title = item.dataset.name;
                        }
                    }
                });
                item.addEventListener('mousemove', function(e) {
                    // 实时更新鼠标坐标
                    that._previewMousePos = { x: e.clientX, y: e.clientY };
                });
                item.addEventListener('mouseleave', function() {
                    if (!this.classList.contains('cd-selected')) {
                        this.style.background = '';
                    }
                    // 取消预览计时器并隐藏预览
                    if (that._previewTimer) {
                        clearTimeout(that._previewTimer);
                        that._previewTimer = null;
                    }
                    that.hideImagePreview();
                });

                item.addEventListener('contextmenu', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    var isDir = item.dataset.isdir === 'true';
                    var itemPath = item.dataset.path;
                    var name = item.dataset.name;

                    // 右键未选中项时，先选中该项（清除多选）
                    if (!item.classList.contains('cd-selected')) {
                        that.clearSelection();
                        item.classList.add('cd-selected');
                        item.style.background = 'var(--b3-theme-primary-light,#bbdefb)';
                        that._selectedItems = [item];
                        that._lastClickedItem = item;
                    }

                    that.showContextMenu(e, itemPath, name, isDir);
                });

                // === 拖拽 ===
                item.addEventListener('dragstart', function(e) {
                    var isDir = item.dataset.isdir === 'true';
                    var itemPath = item.dataset.path;
                    var name = item.dataset.name;

                    // 如果拖拽的项不在已选列表中，清除之前的选择，单选此项
                    var isSelected = item.classList.contains('cd-selected');
                    if (!isSelected) {
                        that.clearSelection();
                        item.classList.add('cd-selected');
                        item.style.background = 'var(--b3-theme-primary-light,#bbdefb)';
                        that._selectedItems = [item];
                        that._lastClickedItem = item;
                    }

                    var selected = that._selectedItems;

                    if (selected.length > 1) {
                        // === 多选批量拖拽 ===
                        var files = [];
                        for (var si = 0; si < selected.length; si++) {
                            var selItem = selected[si];
                            files.push({
                                path: selItem.dataset.path,
                                name: selItem.dataset.name,
                                isDir: selItem.dataset.isdir === 'true',
                                el: selItem
                            });
                            selItem.style.opacity = '0.4';
                        }
                        that._dragSource = {
                            multiFiles: files,
                            // 兼容：也设置单文件属性（取第一个文件）
                            path: files[0].path,
                            name: files[0].name,
                            isDir: files[0].isDir,
                            el: item
                        };
                        e.dataTransfer.effectAllowed = 'copyMove';
                        // 生成批量 Markdown 链接文本
                        if (!that._isDockerBrowser()) {
                            var batchMd = '';
                            for (var bi = 0; bi < files.length; bi++) {
                                if (bi > 0) batchMd += '\n';
                                batchMd += that.buildLocalFileMarkdown(files[bi].path, files[bi].name, files[bi].isDir);
                            }
                            e.dataTransfer.setData('text/markdown', batchMd);
                            e.dataTransfer.setData('text/plain', batchMd);
                        } else {
                            e.dataTransfer.setData('text/plain', files.map(function(f) { return f.path; }).join('\n'));
                        }
                    } else {
                        // === 单文件拖拽（原有逻辑） ===
                        that._dragSource = {
                            path: itemPath,
                            name: name,
                            isDir: isDir,
                            el: item
                        };
                        item.style.opacity = '0.4';
                        e.dataTransfer.effectAllowed = 'copyMove';
                        e.dataTransfer.setData('text/plain', itemPath);
                        if (!that._isDockerBrowser()) {
                            var fileUrl = that.toFileUrl(itemPath);
                            var mdText;
                            var icon = isDir ? '📂' : that.getFileIcon(name);
                            var linkText = icon + ' ' + that.escapeMarkdown(name);
                            if (!isDir && that.isImageFile(name)) {
                                mdText = '![' + that.escapeMarkdown(name) + '](' + fileUrl + ')';
                            } else {
                                mdText = '[' + linkText + '](' + fileUrl + ')';
                            }
                            e.dataTransfer.setData('text/markdown', mdText);
                            e.dataTransfer.setData('text/plain', mdText);
                        }
                    }
                    // 拖拽开始时关闭图片预览，避免遮挡
                    that.hideImagePreview();
                    if (that._previewTimer) {
                        clearTimeout(that._previewTimer);
                        that._previewTimer = null;
                    }
                });

                item.addEventListener('dragend', function(e) {
                    item.style.opacity = '';
                    // 恢复多选项的透明度
                    var selected = that._selectedItems;
                    for (var si = 0; si < selected.length; si++) {
                        selected[si].style.opacity = '';
                    }
                    that._dragSource = null;
                    // 清除所有拖拽高亮
                    var highlighted = fileListEl.querySelectorAll('.cd-drag-over');
                    for (var h = 0; h < highlighted.length; h++) {
                        highlighted[h].classList.remove('cd-drag-over');
                        highlighted[h].style.background = '';
                        highlighted[h].style.boxShadow = '';
                    }
                });

                // 文件夹作为拖拽目标
                if (item.dataset.isdir === 'true') {
                    item.addEventListener('dragover', function(e) {
                        // 支持内部拖拽和外部文件拖入
                        var hasInternal = !!that._dragSource;
                        // dragover 阶段 files 为空，用 types 检测是否有外部文件拖入
                        var hasExternal = false;
                        if (e.dataTransfer && e.dataTransfer.types) {
                            for (var ti = 0; ti < e.dataTransfer.types.length; ti++) {
                                if (e.dataTransfer.types[ti].toLowerCase() === 'files') {
                                    hasExternal = true;
                                    break;
                                }
                            }
                        }
                        if (hasInternal || hasExternal) {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = hasInternal ? 'move' : 'copy';
                            if (!item.classList.contains('cd-drag-over')) {
                                item.classList.add('cd-drag-over');
                                item.style.background = 'var(--b3-theme-primary-light,#bbdefb)';
                                item.style.boxShadow = 'inset 0 0 0 2px var(--b3-theme-primary,#4285f4)';
                            }
                        }
                    });
                    item.addEventListener('dragleave', function(e) {
                        // 只在鼠标真正离开文件夹项时才移除高亮（避免移到子元素时误触）
                        if (!item.contains(e.relatedTarget)) {
                            item.classList.remove('cd-drag-over');
                            item.style.background = '';
                            item.style.boxShadow = '';
                        }
                    });
                    item.addEventListener('drop', function(e) {
                        e.preventDefault();
                        e.stopPropagation();
                        item.classList.remove('cd-drag-over');
                        item.style.background = '';
                        item.style.boxShadow = '';
                        // 同时清除面板虚线边框（外部拖拽时 fileListEl 的 drop 不会触发）
                        that._clearDragHighlight && that._clearDragHighlight();
                        var targetPath = item.dataset.path;
                        if (that._dragSource) {
                            // 内部拖拽：移动文件
                            // 多选批量移动
                            if (that._dragSource.multiFiles && that._dragSource.multiFiles.length > 1) {
                                var files = that._dragSource.multiFiles;
                                var movedCount = 0;
                                for (var mi = 0; mi < files.length; mi++) {
                                    if (targetPath.indexOf(files[mi].path) === 0) continue; // 不能拖到自身内部
                                    that.moveFile(files[mi].path, targetPath, files[mi].name, files[mi].isDir);
                                    movedCount++;
                                }
                                if (movedCount === 0) {
                                    that.showToastMsg('不能将文件夹移动到自身内部');
                                }
                            } else {
                                // 单文件移动
                                if (targetPath.indexOf(that._dragSource.path) === 0) {
                                    that.showToastMsg('不能将文件夹移动到自身内部');
                                    return;
                                }
                                that.moveFile(that._dragSource.path, targetPath, that._dragSource.name, that._dragSource.isDir);
                            }
                        } else if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                            // 外部拖拽：复制文件到目标文件夹
                            that.copyExternalFiles(e.dataTransfer.files, targetPath);
                        }
                    });
                }
            })(items[j]);
        }

        // 文件列表空白处作为拖拽目标（内部拖拽=移动到当前目录，外部拖拽=复制到当前目录）
        // 仅绑定一次，避免 loadDirectory 重复调用时累积监听器
        if (!fileListEl._cdDragEventsBound) {
            fileListEl._cdDragEventsBound = true;
            fileListEl.addEventListener('dragover', function(e) {
            if (that._dragSource) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
            } else {
                // dragover 阶段用 types 检测是否有外部文件拖入（files 属性为空）
                var hasExternal = false;
                if (e.dataTransfer && e.dataTransfer.types) {
                    for (var ti = 0; ti < e.dataTransfer.types.length; ti++) {
                        if (e.dataTransfer.types[ti].toLowerCase() === 'files') {
                            hasExternal = true;
                            break;
                        }
                    }
                }
                if (hasExternal) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'copy';
                    if (!fileListEl.classList.contains('cd-external-drag-over')) {
                        fileListEl.classList.add('cd-external-drag-over');
                        fileListEl.style.background = 'rgba(66,133,244,0.08)';
                        fileListEl.style.outline = '2px dashed var(--b3-theme-primary,#4285f4)';
                        fileListEl.style.outlineOffset = '-2px';
                    }
                }
            }
        });
        fileListEl.addEventListener('dragleave', function(e) {
            // 只在离开 fileListEl 本身时移除样式
            if (!fileListEl.contains(e.relatedTarget)) {
                fileListEl.classList.remove('cd-external-drag-over');
                fileListEl.style.background = '';
                fileListEl.style.outline = '';
                fileListEl.style.outlineOffset = '';
            }
        });
        // 拖拽结束时清除面板高亮（确保边框不会残留）
        if (!this._dragEndListenerSet) {
            this._clearDragHighlight = function() {
                var fl = document.getElementById('cd-file-list');
                if (fl) {
                    fl.classList.remove('cd-external-drag-over');
                    fl.style.background = '';
                    fl.style.outline = '';
                    fl.style.outlineOffset = '';
                }
                // 同时清除所有文件夹项的拖拽高亮
                var dragOvers = document.querySelectorAll('.cd-drag-over');
                for (var k = 0; k < dragOvers.length; k++) {
                    dragOvers[k].classList.remove('cd-drag-over');
                    dragOvers[k].style.background = '';
                    dragOvers[k].style.boxShadow = '';
                }
            };
            // dragend：内部拖拽结束时触发
            document.addEventListener('dragend', this._clearDragHighlight, true);
            // drop：外部拖拽放下的全局兜底（外部拖拽不会触发 dragend）
            document.addEventListener('drop', this._clearDragHighlight, true);
            this._dragEndListenerSet = true;
        }

        fileListEl.addEventListener('drop', function(e) {
            // 清除拖拽高亮
            that._clearDragHighlight && that._clearDragHighlight();
            // 如果 drop 在文件项上，由文件项的 drop 事件处理
            if (e.target.closest('.cd-item')) return;
            if (that._dragSource) {
                e.preventDefault();
                e.stopPropagation();
                // 多选批量移动到当前目录
                if (that._dragSource.multiFiles && that._dragSource.multiFiles.length > 1) {
                    var files = that._dragSource.multiFiles;
                    for (var mi = 0; mi < files.length; mi++) {
                        that.moveFile(files[mi].path, currentPath, files[mi].name, files[mi].isDir);
                    }
                } else {
                    that.moveFile(that._dragSource.path, currentPath, that._dragSource.name, that._dragSource.isDir);
                }
            } else if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                // 外部拖拽：复制文件到当前目录
                e.preventDefault();
                e.stopPropagation();
                that.copyExternalFiles(e.dataTransfer.files, currentPath);
            }
        });
        // 文件列表空白处右键：显示粘贴菜单（如果有剪切内容）
        // 点击空白区域清除多选
        fileListEl.addEventListener('click', function(e) {
            if (e.target.closest('.cd-item')) return;
            that.clearSelection();
        });
        fileListEl.addEventListener('contextmenu', function(e) {
            // 如果点击的是文件项，不处理（由上面的 item contextmenu 处理）
            if (e.target.closest('.cd-item')) return;
            e.preventDefault();
            e.stopPropagation();
            // 如果有剪切内容，显示粘贴菜单
            if (that._clipboardCut) {
                that.showPasteMenu(e, that.currentPath);
            }
        });
        } // end if (!_cdDragEventsBound)
    }

    /**
     * 处理文件点击：插入本地文件链接
     */
    handleFileClick(filePath, fileName) {
        // Docker 浏览器模式下 file:/// 链接无法打开，禁止插入
        if (this._isDockerBrowser()) {
            this.showToastMsg('Docker 浏览器环境下无法打开本地文件链接，已禁止插入');
            return;
        }
        // 直接插入本地文件链接
        this.insertLocalFileLink(filePath, fileName);
    }

    /**
     * 内置视频播放器：在 Dock 面板内播放视频，支持时间戳、循环片段、截图
     */
    /**
     * 插入本地文件链接到编辑器
     * 附加文件的 size 和 mtime 信息到 URL fragment，用于失效链接修复时的精确匹配
     */
    insertLocalFileLink(filePath, fileName, isFolder) {
        var that = this;
        var fileUrl = this.toFileUrl(filePath);
        
        // 尝试获取文件的 size 和 mtime，作为链接标题（title）用于指纹匹配
        var fingerprintTitle = '';
        try {
            var stat = fs.statSync(filePath);
            if (stat) {
                fingerprintTitle = 'size=' + stat.size + '&mtime=' + (stat.mtime ? stat.mtime.getTime() : 0);
            }
        } catch(e) {
            // 获取不到就算了，不影响正常插入
        }
        
        var markdown;
        var icon = isFolder ? '📂' : this.getFileIcon(fileName);
        var linkText = icon + ' ' + this.escapeMarkdown(fileName);
        
        if (this.isImageFile(fileName)) {
            // 图片：直接显示
            markdown = '![' + this.escapeMarkdown(fileName) + '](' + fileUrl + ')';
        } else {
            // 视频和其他文件：显示为链接，锚文本干净，标题放指纹
            if (fingerprintTitle) {
                markdown = '[' + linkText + '](' + fileUrl + ' "' + fingerprintTitle + '")';
            } else {
                markdown = '[' + linkText + '](' + fileUrl + ')';
            }
        }
        
        // 尝试插入到编辑器（带重试，首次启动时编辑器可能尚未就绪）
        this.tryInsertToEditor(markdown, function(success) {
            if (!success) {
                // 重试全部失败，降级到剪贴板
                that.copyToClipboard(markdown);
                that.showToastMsg('已复制到剪贴板，请 Ctrl+V 粘贴');
            }
        });
    }

    /**
     * 注册编辑器区域的拖拽 drop 处理器
     * 实现拖拽文件/文件夹到文档后插入链接到鼠标位置，没有鼠标位置则插入到文档最下面
     */
    registerEditorDropHandler() {
        var that = this;

        // dragover 处理：允许在编辑器区域 drop，设置 copy 效果
        this._editorDragOverHandler = function(e) {
            if (!that._dragSource) return;
            // 检查拖拽目标是否在编辑器区域内
            var targetEl = e.target.nodeType === 1 ? e.target : (e.target.parentElement || e.target);
            var protyle = targetEl.closest ? targetEl.closest('.protyle') : null;
            if (protyle) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
            }
        };

        // drop 处理：在鼠标位置插入链接
        this._editorDropHandler = function(e) {
            if (!that._dragSource) return;

            // Docker 浏览器模式下 file:/// 链接无法打开，禁止插入
            if (that._isDockerBrowser()) {
                that.showToastMsg('Docker 浏览器环境下无法打开本地文件链接，已禁止插入');
                that._dragSource = null;
                return;
            }

            var targetEl = e.target.nodeType === 1 ? e.target : (e.target.parentElement || e.target);
            var protyleWysiwyg = targetEl.closest ? targetEl.closest('.protyle-wysiwyg') : null;
            var protyle = targetEl.closest ? targetEl.closest('.protyle') : null;

            if (!protyle) return; // 不在编辑器区域内，不处理

            e.preventDefault();
            e.stopPropagation();

            var source = that._dragSource;

            // 检查是否为多选批量拖拽
            if (source.multiFiles && source.multiFiles.length > 1) {
                var files = source.multiFiles;
                // 批量插入：使用思源 API 逐个插入独立块，确保每个链接独占一行
                that.insertBatchFileLinks(files, protyleWysiwyg, e);
            } else {
                // 单文件拖拽
                var filePath = source.path;
                var fileName = source.name;
                var isDir = source.isDir;

                if (protyleWysiwyg) {
                    that.insertAtDropPosition(e, protyleWysiwyg, filePath, fileName, isDir);
                } else {
                    var wysiwyg2 = protyle.querySelector('.protyle-wysiwyg[contenteditable="true"]');
                    if (wysiwyg2) {
                        that.insertAtDocBottom(wysiwyg2, filePath, fileName, isDir);
                    }
                }
            }

            // 清理拖拽源
            that._dragSource = null;
        };

        document.addEventListener('dragover', this._editorDragOverHandler, true);
        document.addEventListener('drop', this._editorDropHandler, true);
    }

    /**
     * 在鼠标 drop 位置插入链接
     * 使用 caretRangeFromPoint 获取鼠标落点对应的文档位置
     */
    insertAtDropPosition(e, protyleWysiwyg, filePath, fileName, isDir) {
        var that = this;

        // 生成要插入的 Markdown 链接
        var markdown = that.buildLocalFileMarkdown(filePath, fileName, isDir);

        // 使用 caretRangeFromPoint 获取鼠标落点位置
        var range = null;
        try {
            if (document.caretRangeFromPoint) {
                range = document.caretRangeFromPoint(e.clientX, e.clientY);
            } else if (document.caretPositionFromPoint) {
                var pos = document.caretPositionFromPoint(e.clientX, e.clientY);
                if (pos) {
                    range = document.createRange();
                    range.setStart(pos.offsetNode, pos.offset);
                    range.collapse(true);
                }
            }
        } catch (ex) {
            that._log('caretRangeFromPoint error:', ex);
        }

        if (range && protyleWysiwyg.contains(range.startContainer)) {
            // 鼠标位置在编辑器内容区内 → 在该位置插入链接
            try {
                // 先聚焦编辑器
                protyleWysiwyg.focus();

                // 设置选区到鼠标落点位置（focus 后设置，避免 focus 重置选区）
                var selection = window.getSelection();
                selection.removeAllRanges();
                selection.addRange(range);

                // 在选区位置插入文本
                range.deleteContents();
                var textNode = document.createTextNode(markdown);
                range.insertNode(textNode);
                range.setStartAfter(textNode);
                range.collapse(true);
                selection.removeAllRanges();
                selection.addRange(range);

                // 触发输入事件，让思源感知内容变更
                var inputEvent = new InputEvent('input', {
                    bubbles: true,
                    cancelable: true,
                    inputType: 'insertText',
                    data: markdown
                });
                protyleWysiwyg.dispatchEvent(inputEvent);
                try {
                    var pasteEvent = new InputEvent('input', {
                        bubbles: true,
                        cancelable: true,
                        inputType: 'insertFromPaste',
                        data: markdown
                    });
                    protyleWysiwyg.dispatchEvent(pasteEvent);
                } catch (ex2) {}

                return;
            } catch (ex) {
                that._error('insertAtDropPosition error:', ex);
                // 降级到文档底部插入
            }
        }

        // 无法确定鼠标位置 → 插入到文档最底部
        that.insertAtDocBottom(protyleWysiwyg, filePath, fileName, isDir);
    }

    /**
     * 在文档最底部插入链接
     */
    insertAtDocBottom(protyleWysiwyg, filePath, fileName, isDir) {
        var that = this;

        // 将光标移到编辑器末尾
        protyleWysiwyg.focus();
        var selection = window.getSelection();
        var newRange = document.createRange();
        newRange.selectNodeContents(protyleWysiwyg);
        newRange.collapse(false); // 折叠到末尾
        selection.removeAllRanges();
        selection.addRange(newRange);

        // 使用 insertLocalFileLink 插入（带指纹和重试机制）
        that.insertLocalFileLink(filePath, fileName, isDir);
    }

    /**
     * 批量插入多个文件链接为独立块（竖排显示，每个链接一个块）
     * 有鼠标位置时：第一个文件在鼠标位置插入，后续文件依次追加新块
     * 无鼠标位置时：追加到文档底部
     * @param {Array<{path, name, isDir}>} files - 文件列表
     * @param {Element} protyleWysiwyg - 编辑器 DOM
     * @param {Event} dropEvent - drop 事件对象（用于获取鼠标位置）
     */
    insertBatchFileLinks(files, protyleWysiwyg, dropEvent) {
        var that = this;

        if (!protyleWysiwyg) {
            // 无编辑器 DOM，尝试获取
            var protyle = dropEvent && dropEvent.target ? (dropEvent.target.closest ? dropEvent.target.closest('.protyle') : null) : null;
            if (protyle) {
                protyleWysiwyg = protyle.querySelector('.protyle-wysiwyg[contenteditable="true"]');
            }
        }
        if (!protyleWysiwyg) {
            // 最终降级：复制到剪贴板
            var allMd = '';
            for (var i = 0; i < files.length; i++) {
                if (i > 0) allMd += '\n';
                allMd += that.buildLocalFileMarkdown(files[i].path, files[i].name, files[i].isDir);
            }
            that.copyToClipboard(allMd);
            that.showToastMsg('已复制到剪贴板，请 Ctrl+V 粘贴');
            return;
        }

        // 检测鼠标是否在编辑器内容区内
        var hasDropPosition = false;
        if (dropEvent && protyleWysiwyg) {
            var range = null;
            try {
                if (document.caretRangeFromPoint) {
                    range = document.caretRangeFromPoint(dropEvent.clientX, dropEvent.clientY);
                } else if (document.caretPositionFromPoint) {
                    var pos = document.caretPositionFromPoint(dropEvent.clientX, dropEvent.clientY);
                    if (pos) {
                        range = document.createRange();
                        range.setStart(pos.offsetNode, pos.offset);
                        range.collapse(true);
                    }
                }
            } catch (ex) {}

            if (range && protyleWysiwyg.contains(range.startContainer)) {
                hasDropPosition = true;
                // 设置选区到鼠标位置
                protyleWysiwyg.focus();
                var selection = window.getSelection();
                selection.removeAllRanges();
                selection.addRange(range);
            }
        }

        if (hasDropPosition) {
            // === 有鼠标位置：第一个文件在鼠标位置插入，后续逐个追加新块 ===
            that.insertAtDropPosition(dropEvent, protyleWysiwyg, files[0].path, files[0].name, files[0].isDir);
            // 后续文件：逐个在新块中插入
            var index = 1;
            function insertNext() {
                if (index >= files.length) return;
                var file = files[index];
                index++;
                // 在当前光标位置插入链接
                that.insertLocalFileLink(file.path, file.name, file.isDir);
                // 延迟模拟 Enter 键创建新块
                if (index < files.length) {
                    setTimeout(function() {
                        protyleWysiwyg.focus();
                        var enterEvent = new KeyboardEvent('keydown', {
                            key: 'Enter',
                            code: 'Enter',
                            keyCode: 13,
                            which: 13,
                            bubbles: true,
                            cancelable: true
                        });
                        protyleWysiwyg.dispatchEvent(enterEvent);
                        setTimeout(insertNext, 50);
                    }, 100);
                }
            }
            // 第一个文件插入后，模拟 Enter 创建新块再插入第二个
            if (files.length > 1) {
                setTimeout(function() {
                    protyleWysiwyg.focus();
                    var enterEvent = new KeyboardEvent('keydown', {
                        key: 'Enter',
                        code: 'Enter',
                        keyCode: 13,
                        which: 13,
                        bubbles: true,
                        cancelable: true
                    });
                    protyleWysiwyg.dispatchEvent(enterEvent);
                    setTimeout(insertNext, 50);
                }, 150);
            }
        } else {
            // === 无鼠标位置：用 API 追加到文档底部 ===
            var docId = that.getCurrentDocId();
            if (!docId) {
                that.showToastMsg('无法获取当前文档，批量插入失败');
                return;
            }

            // 构建批量 markdown：每个链接之间用空行分隔（空行 = 新块）
            var batchMd = '';
            for (var j = 0; j < files.length; j++) {
                if (j > 0) batchMd += '\n\n';
                batchMd += that.buildLocalFileMarkdown(files[j].path, files[j].name, files[j].isDir);
            }

            fetch('/api/block/insertBlock', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    data: batchMd,
                    dataType: 'markdown',
                    parentID: docId
                }),
                credentials: 'include'
            }).then(function(resp) {
                return resp.json();
            }).then(function(data) {
                if (data.code !== 0) {
                    that._log('insertBatchFileLinks API failed:', data.msg);
                    // 降级：逐个 DOM 插入到文档底部
                    for (var k = 0; k < files.length; k++) {
                        that.insertAtDocBottom(protyleWysiwyg, files[k].path, files[k].name, files[k].isDir);
                    }
                }
            }).catch(function(e) {
                that._error('insertBatchFileLinks error:', e);
                // 降级
                for (var k2 = 0; k2 < files.length; k2++) {
                    that.insertAtDocBottom(protyleWysiwyg, files[k2].path, files[k2].name, files[k2].isDir);
                }
            });
        }
    }

    /**
     * 构建本地文件/文件夹的 Markdown 链接文本
     * @param {string} filePath - 文件完整路径
     * @param {string} fileName - 文件名
     * @param {boolean} isDir - 是否为文件夹
     * @returns {string} Markdown 格式的链接文本
     */
    buildLocalFileMarkdown(filePath, fileName, isDir) {
        var fileUrl = this.toFileUrl(filePath);
        var icon = isDir ? '📂' : this.getFileIcon(fileName);
        var linkText = icon + ' ' + this.escapeMarkdown(fileName);

        // 尝试获取文件指纹（size + mtime），用于失效链接修复
        var fingerprintTitle = '';
        try {
            var stat = fs.statSync(filePath);
            if (stat) {
                fingerprintTitle = 'size=' + stat.size + '&mtime=' + (stat.mtime ? stat.mtime.getTime() : 0);
            }
        } catch (e) {
            // 获取不到就算了
        }

        var markdown;
        if (!isDir && this.isImageFile(fileName)) {
            // 图片：直接显示
            markdown = '![' + this.escapeMarkdown(fileName) + '](' + fileUrl + ')';
        } else {
            // 文件夹和非图片文件：显示为链接
            if (fingerprintTitle) {
                markdown = '[' + linkText + '](' + fileUrl + ' "' + fingerprintTitle + '")';
            } else {
                markdown = '[' + linkText + '](' + fileUrl + ')';
            }
        }
        return markdown;
    }

    /**
     * 插入资源到编辑器
     */
    insertAssetToEditor(assetPath, displayName) {
        var that = this;
        var content;
        var isVideo = that.isVideoFile(displayName);
        var isImage = that.isImageFile(displayName);

        if (isImage) {
            content = '![' + that.escapeMarkdown(displayName) + '](' + assetPath + ')';
        } else if (isVideo) {
            // 视频文件：通过思源 API 插入 HTML 块
            that.insertVideoBlock(assetPath, displayName);
            return;
        } else {
            // 其他文件（PDF、DOC 等）：加文件类型图标前缀
            var icon = that.getFileIcon(displayName);
            content = '[' + icon + ' ' + that.escapeMarkdown(displayName) + '](' + assetPath + ')';
        }

        // 尝试插入到编辑器（带重试，首次启动时编辑器可能尚未就绪）
        this.tryInsertToEditor(content, function(success) {
            if (!success) {
                // 重试全部失败，降级到剪贴板
                that.copyToClipboard(content);
                that.showToastMsg('已复制到剪贴板，请 Ctrl+V 粘贴');
            }
        });
    }

    /**
     * 通过思源 API 插入视频 HTML 块
     * 思源编辑器会覆盖直接 DOM 操作，必须用 API 才能持久化 HTML 块
     */
    insertVideoBlock(assetPath, fileName) {
        var that = this;
        var docId = that.getCurrentDocId();
        if (!docId) {
            that.showToastMsg('无法获取当前文档 ID');
            return;
        }

        // 获取光标所在块 ID，用于精确定位插入位置
        var focusBlockId = that.getFocusBlockId();

        // 思源视频块格式：Type=NodeVideo，Data 为 <video> 标签（含 data-src 属性）
        // 必须用 dataType:"markdown"，让思源自动把 <video> 标签转为 NodeVideo（含 Data 字段）
        // 用 dataType:"dom" + data-type="NodeVideo" 会导致 Data 字段为空，刷新后视频消失
        var videoHtml = '<video controls="controls" src="' + assetPath + '" data-src="' + assetPath + '"></video>';

        var params = {
            data: videoHtml,
            dataType: 'markdown'
        };
        if (focusBlockId) {
            params.previousID = focusBlockId;
        } else {
            params.parentID = docId;
        }

        fetch('/api/block/insertBlock', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params),
            credentials: 'include'
        }).then(function(resp) {
            return resp.json();
        }).then(function(data) {
            if (data.code !== 0) {
                console.warn('[LocalBrowse] insertBlock markdown failed, trying DOM:', data.msg);
                that.insertVideoBlockFallback(assetPath, fileName, docId, focusBlockId);
            }
        }).catch(function(e) {
            console.warn('[LocalBrowse] insertBlock error, trying DOM:', e);
            that.insertVideoBlockFallback(assetPath, fileName, docId, focusBlockId);
        });
    }

    /**
     * 降级：用 DOM 格式插入视频（用 dataType:"dom" 方式，可能缺少 Data 字段）
     */
    insertVideoBlockFallback(assetPath, fileName, docId, focusBlockId) {
        var that = this;
        var videoHtml = '<video controls="controls" src="' + assetPath + '" data-src="' + assetPath + '"></video>';
        var domData = '<div data-type="NodeVideo">' + videoHtml + '</div>';

        var params = {
            data: domData,
            dataType: 'dom'
        };
        if (focusBlockId) {
            params.previousID = focusBlockId;
        } else {
            params.parentID = docId;
        }

        fetch('/api/block/insertBlock', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params),
            credentials: 'include'
        }).then(function(resp) {
            return resp.json();
        }).then(function(data) {
            if (data.code !== 0) {
                console.warn('[LocalBrowse] insertBlock DOM fallback failed:', data.msg);
                that.copyToClipboard(videoHtml);
                that.showToastMsg('已复制视频标签到剪贴板，请 Ctrl+V 粘贴');
            }
        }).catch(function(e) {
            console.warn('[LocalBrowse] insertBlock DOM fallback error:', e);
            that.copyToClipboard(videoHtml);
            that.showToastMsg('已复制视频标签到剪贴板，请 Ctrl+V 粘贴');
        });
    }

    /**
     * 复制文件到思源 assets 目录并插入
     * 优先使用思源 API，避免直接 fs 写入触发数据保护
     */
    copyFileToAssets(filePath, fileName) {
        var that = this;

        // 处理文件名冲突：先生成唯一文件名
        var finalName = that.resolveAssetName(fileName);

        // API 模式下用思源 putFile API：先读取文件内容，再写入 assets
        if (that._fsMode() === 'api') {
            that._fsReadFile(filePath).then(function(arrayBuffer) {
                if (!arrayBuffer) {
                    that.showToastMsg('❌ 无法读取文件: ' + fileName);
                    return;
                }
                // 用 Blob + putFile 上传到 assets
                var blob = new Blob([arrayBuffer]);
                var formData = new FormData();
                formData.append('path', 'data/assets/' + finalName);
                formData.append('file', blob, finalName);
                formData.append('isDir', 'false');
                formData.append('modTime', String(Date.now()));

                fetch('/api/file/putFile', {
                    method: 'POST',
                    credentials: 'include',
                    body: formData
                }).then(function(resp) {
                    return resp.json();
                }).then(function(data) {
                    if (data.code === 0) {
                        that.insertAssetToEditor('assets/' + finalName, fileName);
                    } else {
                        console.warn('[LocalBrowse] API putFile failed:', data.msg);
                        that.showToastMsg('❌ 复制到 assets 失败: ' + data.msg);
                    }
                }).catch(function(e) {
                    console.warn('[LocalBrowse] API putFile error:', e);
                    that.showToastMsg('❌ 复制到 assets 失败');
                });
            }).catch(function(e) {
                console.warn('[LocalBrowse] _fsReadFile error:', e);
                that.showToastMsg('❌ 无法读取文件: ' + fileName);
            });
            return;
        }

        // Node.js 模式：优先用思源 API 复制（更安全，不会触发数据保护）
        fetch('/api/file/copyFile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                src: filePath,
                dest: 'assets/' + finalName
            }),
            credentials: 'include'
        }).then(function(resp) {
            return resp.json();
        }).then(function(data) {
            if (data.code === 0) {
                // 复制到 assets 成功，无提示
                // 传入原文件名作为显示文本，finalName 作为实际路径
                that.insertAssetToEditor('assets/' + finalName, fileName);
            } else {
                console.warn('[LocalBrowse] API copyFile failed:', data.msg);
                that.copyFileToAssetsFallback(filePath, fileName);
            }
        }).catch(function(e) {
            console.warn('[LocalBrowse] API copyFile error:', e);
            that.copyFileToAssetsFallback(filePath, fileName);
        });
    }

    /**
     * 生成唯一的 assets 文件名（思源风格：hash-时间戳-随机后缀.扩展名）
     */
    resolveAssetName(fileName) {
        var dataDir = '';
        try {
            if (window.siyuan && window.siyuan.config && window.siyuan.config.system && window.siyuan.config.system.dataDir) {
                dataDir = window.siyuan.config.system.dataDir;
            }
        } catch (e) {}

        // 提取扩展名
        var ext = '';
        var lastDot = fileName.lastIndexOf('.');
        if (lastDot > 0) {
            ext = fileName.substring(lastDot + 1).toLowerCase();
        }

        // 生成思源风格的唯一文件名：hash-时间戳-随机后缀
        var now = new Date();
        var timestamp = now.getFullYear() +
            String(now.getMonth() + 1).padStart(2, '0') +
            String(now.getDate()).padStart(2, '0') +
            String(now.getHours()).padStart(2, '0') +
            String(now.getMinutes()).padStart(2, '0') +
            String(now.getSeconds()).padStart(2, '0');
        var randomSuffix = Math.random().toString(36).substring(2, 8);
        var uniqueName = timestamp + '-' + randomSuffix;
        if (ext) {
            uniqueName += '.' + ext;
        }

        // 如果 dataDir 拿不到，直接返回唯一文件名
        if (!dataDir) return uniqueName;

        var assetsDir = dataDir.replace(/\\/g, '/') + '/assets';
        var destPath = assetsDir + '/' + uniqueName;

        // 如果已存在（极罕见），再追加随机数（仅 Node.js 模式可检查）
        if (fs && fs.existsSync && fs.existsSync(destPath)) {
            uniqueName = timestamp + '-' + randomSuffix + '-' + Math.random().toString(36).substring(2, 6);
            if (ext) uniqueName += '.' + ext;
        }

        return uniqueName;
    }

    /**
     * 降级：用 fs 流式复制到 assets（API 失败时使用）
     */
    copyFileToAssetsFallback(filePath, displayName) {
        var that = this;

        // 生成唯一文件名（避免 assets 目录冲突）
        var fileName = that.resolveAssetName(displayName);

        var dataDir = '';
        try {
            if (window.siyuan && window.siyuan.config && window.siyuan.config.system && window.siyuan.config.system.dataDir) {
                dataDir = window.siyuan.config.system.dataDir;
            }
        } catch (e) {}

        if (!dataDir) {
            that.showToastMsg('❌ 无法获取思源数据目录');
            return;
        }

        var assetsDir = dataDir.replace(/\\/g, '/');
        var destPath = assetsDir + '/assets/' + fileName;

        // 确保 assets 目录存在
        if (!fs.existsSync(assetsDir + '/assets')) {
            try {
                fs.mkdirSync(assetsDir + '/assets', { recursive: true });
            } catch (e) {
                that.showToastMsg('❌ 无法创建 assets 目录');
                return;
            }
        }

        // 流式复制，避免长时间锁定文件句柄
        try {
            var readStream = fs.createReadStream(filePath);
            var writeStream = fs.createWriteStream(destPath);

            readStream.on('error', function(err) {
                that._error('read stream error:', err);
                that.showToastMsg('❌ 复制失败: ' + err.message);
            });

            writeStream.on('finish', function() {
                // 复制到 assets 成功，无提示
                // fileName 是生成的唯一文件名，displayName 是原文件名（用于显示）
                that.insertAssetToEditor('assets/' + fileName, displayName);
            });

            writeStream.on('error', function(err) {
                that._error('write stream error:', err);
                that.showToastMsg('❌ 复制失败: ' + err.message);
            });

            readStream.pipe(writeStream);
        } catch (e) {
            that._error('fallback copy failed:', e);
            that.showToastMsg('❌ 复制失败: ' + e.message);
        }
    }

    /**
     * 尝试插入到编辑器（带重试，解决首次启动时编辑器尚未就绪的问题）
     * @param {string} text - 要插入的文本
     * @param {Function} callback - 可选回调，参数为 boolean 表示是否成功
     * @returns {boolean} - 同步返回首次尝试结果
     */
    tryInsertToEditor(text, callback) {
        var that = this;

        // 内部：执行单次插入尝试
        function attempt() {
            try {
                // 优先获取当前激活/聚焦的编辑器，避免插入到后台文档
                var protyle = null;
                var activeElement = document.activeElement;
                if (activeElement) {
                    // 如果焦点在编辑器内，直接使用该编辑器
                    if (activeElement.classList && activeElement.classList.contains('protyle-wysiwyg')) {
                        protyle = activeElement;
                    } else {
                        // 向上查找最近的编辑器祖先
                        var parent = activeElement.closest ? activeElement.closest('.protyle-wysiwyg') : null;
                        if (parent) protyle = parent;
                    }
                }
                // 兜底：获取可见的编辑器（排除隐藏的标签页）
                if (!protyle) {
                    var allProtyles = document.querySelectorAll('.protyle-wysiwyg[contenteditable="true"]');
                    for (var i = 0; i < allProtyles.length; i++) {
                        var p = allProtyles[i];
                        // 检查编辑器是否在可见区域且不是后台标签页
                        var rect = p.getBoundingClientRect();
                        var isVisible = rect.width > 0 && rect.height > 0;
                        var isInActiveTab = p.closest('.layout__tab--active, .fn__flex-1:not([style*="display: none"])');
                        if (isVisible && isInActiveTab) {
                            protyle = p;
                            break;
                        }
                    }
                }
                // 最终兜底：取第一个可见编辑器
                if (!protyle) {
                    protyle = document.querySelector('.protyle-wysiwyg[contenteditable="true"]');
                }
                if (!protyle) return false;

                protyle.focus();
                var selection = window.getSelection();
                if (!selection || selection.rangeCount === 0) return false;

                var range = selection.getRangeAt(0);

                // 检查选区是否在当前编辑器内，如果不是则重置到编辑器末尾
                if (!protyle.contains(range.commonAncestorContainer)) {
                    // 选区在编辑器外（如 dock 面板）: 创建新选区到编辑器末尾
                    var newRange = document.createRange();
                    newRange.selectNodeContents(protyle);
                    newRange.collapse(false);
                    selection.removeAllRanges();
                    selection.addRange(newRange);
                    range = newRange;
                }

                range.deleteContents();
                var textNode = document.createTextNode(text);
                range.insertNode(textNode);
                range.setStartAfter(textNode);
                range.collapse(true);
                selection.removeAllRanges();
                selection.addRange(range);

                // 触发输入事件，让思源感知内容变更
                var inputEvent = new InputEvent('input', {
                    bubbles: true,
                    cancelable: true,
                    inputType: 'insertText',
                    data: text
                });
                protyle.dispatchEvent(inputEvent);

                // 额外触发 protyle 的 input 事件，确保长时间闲置后也能同步
                try {
                    var protyleInputEvent = new InputEvent('input', {
                        bubbles: true,
                        cancelable: true,
                        inputType: 'insertFromPaste',
                        data: text
                    });
                    protyle.dispatchEvent(protyleInputEvent);
                } catch (e) {}

                return true;
            } catch (e) {
                that._error('insert error:', e);
                return false;
            }
        }

        // 首次同步尝试
        if (attempt()) {
            if (callback) callback(true);
            return true;
        }

        // 异步重试（用于编辑器尚未就绪的场景）
        if (callback) {
            var retryDelay = 200;
            var maxRetries = 4;
            var retryCount = 0;

            function retry() {
                retryCount++;
                if (attempt()) {
                    callback(true);
                    return;
                }
                if (retryCount < maxRetries) {
                    setTimeout(retry, retryDelay);
                } else {
                    callback(false);
                }
            }

            setTimeout(retry, retryDelay);
        }

        return false;
    }

    /**
     * 复制到剪贴板
     */
    copyToClipboard(text) {
        var that = this;
        
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function() {
                that.showToastMsg('已复制到剪贴板！在编辑器中 Ctrl+V 粘贴');
            }).catch(function(e) {
                that.fallbackCopy(text);
            });
        } else {
            this.fallbackCopy(text);
        }
    }

    fallbackCopy(text) {
        var that = this;
        var textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        textarea.style.top = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        
        try {
            var successful = document.execCommand('copy');
            if (successful) {
                that.showToastMsg('已复制到剪贴板！在编辑器中 Ctrl+V 粘贴');
            } else {
                that.showToastMsg('复制失败，请手动复制');
            }
        } catch(e) {
            that.showToastMsg('复制失败，请手动复制');
        }
        
        document.body.removeChild(textarea);
    }

    /**
     * 移动文件/文件夹（拖拽专用）
     */
    moveFile(srcPath, targetDir, srcName, isDir) {
        var that = this;
        if (!fs) {
            this.showToastMsg('文件系统不可用，无法移动');
            return;
        }

        // 不能移动到自身内部
        if (targetDir.indexOf(srcPath) === 0) {
            this.showToastMsg('不能将文件夹移动到自身内部');
            return;
        }

        var destPath = path.join(targetDir, srcName);

        // 如果目标已存在，添加数字后缀
        var finalDestPath = destPath;
        var counter = 1;
        while (fs.existsSync(finalDestPath)) {
            var ext = path.extname(srcName);
            var base = path.basename(srcName, ext);
            finalDestPath = path.join(targetDir, base + ' (' + counter + ')' + ext);
            counter++;
        }

        try {
            if (that.isWindows) {
                // Windows: 检查盘符是否相同（rename 不能跨盘）
                var srcDrive = srcPath.charAt(0).toUpperCase();
                var destDrive = targetDir.charAt(0).toUpperCase();

                if (srcDrive !== destDrive) {
                    if (isDir) {
                        that.copyDirectorySync(srcPath, finalDestPath);
                        that.removeDirectorySync(srcPath);
                    } else {
                        fs.copyFileSync(srcPath, finalDestPath);
                        fs.unlinkSync(srcPath);
                    }
                } else {
                    fs.renameSync(srcPath, finalDestPath);
                }
            } else {
                // macOS/Linux: 先尝试 rename，跨文件系统时回退到 copy+delete
                try {
                    fs.renameSync(srcPath, finalDestPath);
                } catch(renameErr) {
                    if (renameErr.code === 'EXDEV' || renameErr.code === 'EPERM') {
                        // 跨文件系统：copy + delete
                        if (isDir) {
                            that.copyDirectorySync(srcPath, finalDestPath);
                            that.removeDirectorySync(srcPath);
                        } else {
                            fs.copyFileSync(srcPath, finalDestPath);
                            fs.unlinkSync(srcPath);
                        }
                    } else {
                        throw renameErr;
                    }
                }
            }

            // 更新文件-文档关联映射中的路径
            that.updateFileDocMapPath(srcPath, finalDestPath);

            // 刷新当前目录
            that.loadDirectory(that.currentPath);
        } catch(e) {
            that._error('moveFile error:', e);
            that.showToastMsg('移动失败：' + (e.message || '未知错误'));
        }
    }

    /**
     * 剪切文件/文件夹
     */
    cutFile(filePath, fileName, isDir) {
        this._clipboardCut = {
            path: filePath,
            name: fileName,
            isDir: isDir
        };
        // 剪切成功，无提示
    }

    /**
     * 粘贴文件/文件夹到目标目录
     */
    pasteFile(targetDir) {
        var that = this;
        if (!this._clipboardCut) {
            this.showToastMsg('剪贴板为空，请先剪切文件');
            return;
        }
        if (!fs) {
            this.showToastMsg('文件系统不可用，无法粘贴');
            return;
        }

        var srcPath = this._clipboardCut.path;
        var srcName = this._clipboardCut.name;
        var isDir = this._clipboardCut.isDir;

        // 不能粘贴到自身子目录
        if (targetDir.indexOf(srcPath) === 0) {
            this.showToastMsg('不能将文件夹粘贴到自身内部');
            return;
        }

        var destPath = path.join(targetDir, srcName);

        // 如果目标已存在，添加数字后缀
        var finalDestPath = destPath;
        var counter = 1;
        while (fs.existsSync(finalDestPath)) {
            var ext = path.extname(srcName);
            var base = path.basename(srcName, ext);
            finalDestPath = path.join(targetDir, base + ' (' + counter + ')' + ext);
            counter++;
        }

        try {
            if (that.isWindows) {
                // Windows: 检查是否跨盘符（rename 不能跨盘）
                var srcDrive = srcPath.charAt(0).toUpperCase();
                var destDrive = targetDir.charAt(0).toUpperCase();

                if (srcDrive !== destDrive) {
                    // 跨盘符：先复制再删除
                    if (isDir) {
                        that.copyDirectorySync(srcPath, finalDestPath);
                        that.removeDirectorySync(srcPath);
                    } else {
                        fs.copyFileSync(srcPath, finalDestPath);
                        fs.unlinkSync(srcPath);
                    }
                } else {
                    // 同盘符：直接 rename
                    fs.renameSync(srcPath, finalDestPath);
                }
            } else {
                // macOS/Linux: 先尝试 rename，跨文件系统时回退到 copy+delete
                try {
                    fs.renameSync(srcPath, finalDestPath);
                } catch(renameErr) {
                    if (renameErr.code === 'EXDEV' || renameErr.code === 'EPERM') {
                        // 跨文件系统：copy + delete
                        if (isDir) {
                            that.copyDirectorySync(srcPath, finalDestPath);
                            that.removeDirectorySync(srcPath);
                        } else {
                            fs.copyFileSync(srcPath, finalDestPath);
                            fs.unlinkSync(srcPath);
                        }
                    } else {
                        throw renameErr;
                    }
                }
            }

            // 更新文件-文档关联映射中的路径
            that.updateFileDocMapPath(srcPath, finalDestPath);

            // 粘贴成功，无提示
            that._clipboardCut = null;

            // 刷新当前目录
            that.loadDirectory(that.currentPath);
        } catch(e) {
            that._error('pasteFile error:', e);
            that.showToastMsg('移动失败：' + (e.message || '未知错误'));
        }
    }

    /**
     * 同步复制目录（用于跨盘符移动）
     */
    copyDirectorySync(src, dest) {
        if (!fs) return;
        fs.mkdirSync(dest, { recursive: true });
        var entries = fs.readdirSync(src, { withFileTypes: true });
        for (var i = 0; i < entries.length; i++) {
            var entry = entries[i];
            var srcPath = path.join(src, entry.name);
            var destPath = path.join(dest, entry.name);
            if (entry.isDirectory()) {
                this.copyDirectorySync(srcPath, destPath);
            } else {
                fs.copyFileSync(srcPath, destPath);
            }
        }
    }

    /**
     * 同步删除目录（用于跨盘符移动后清理）
     */
    removeDirectorySync(dirPath) {
        if (!fs) return;
        var entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (var i = 0; i < entries.length; i++) {
            var entry = entries[i];
            var fullPath = path.join(dirPath, entry.name);
            if (entry.isDirectory()) {
                this.removeDirectorySync(fullPath);
            } else {
                fs.unlinkSync(fullPath);
            }
        }
        fs.rmdirSync(dirPath);
    }

    /**
     * 处理外部拖拽文件复制到目标目录
     * 从系统文件管理器等外部来源拖入的文件，复制到插件面板当前目录或目标文件夹
     * @param {FileList} fileList - dataTransfer.files 对象
     * @param {string} targetDir - 目标目录路径
     */
    copyExternalFiles(fileList, targetDir) {
        var that = this;
        if (!fs || !path) {
            this.showToastMsg('文件系统不可用，无法复制');
            return;
        }
        if (!fileList || fileList.length === 0) {
            this.showToastMsg('没有检测到文件');
            return;
        }
        // 检查目标目录是否存在
        if (!fs.existsSync(targetDir)) {
            this.showToastMsg('目标目录不存在: ' + targetDir);
            return;
        }

        // 尝试获取 electron.webUtils（新版 Electron 获取文件路径的方式）
        var webUtils = null;
        try {
            var electron = require('electron');
            webUtils = electron.webUtils || (electron.remote && electron.remote.webUtils);
        } catch(e) {
            // 非 Electron 环境或无法 require electron
        }

        var copiedCount = 0;
        var failedCount = 0;
        var skippedCount = 0;
        var failMsgs = [];
        var pendingAsync = 0;  // FileReader 异步处理中的文件数

        function finish() {
            // 刷新目录（始终刷新当前目录，以显示新复制进来的文件）
            that.loadDirectory(that.currentPath);
            // 提示结果
            var msgs = [];
            if (copiedCount > 0) msgs.push('已复制 ' + copiedCount + ' 个文件');
            if (failedCount > 0) msgs.push(failedCount + ' 个失败（' + failMsgs.join('; ') + '）');
            if (skippedCount > 0) msgs.push(skippedCount + ' 个跳过');
            if (msgs.length === 0) msgs.push('没有文件被复制');
            that.showToastMsg(msgs.join('，'));
        }

        for (var i = 0; i < fileList.length; i++) {
            var file = fileList[i];
            var srcPath = null;

            // 方式1：file.path（旧版 Electron）
            if (file.path && typeof file.path === 'string' && file.path.length > 0) {
                srcPath = file.path;
            }
            // 方式2：electron.webUtils.getPathForFile(file)（新版 Electron 20+）
            if (!srcPath && webUtils && typeof webUtils.getPathForFile === 'function') {
                try {
                    srcPath = webUtils.getPathForFile(file);
                } catch(e) {
                    // ignore
                }
            }

            if (!srcPath) {
                // 无法获取完整路径，使用 FileReader 读取文件内容并写入
                pendingAsync++;
                that._copyExternalFileByReader(file, targetDir, function(ok, msg) {
                    if (ok) {
                        copiedCount++;
                    } else {
                        failedCount++;
                        failMsgs.push(msg);
                    }
                    pendingAsync--;
                    if (pendingAsync === 0) finish();
                });
                continue;
            }

            // 有路径时走文件系统复制
            if (!fs.existsSync(srcPath)) {
                failMsgs.push(file.name + ' 源文件不存在');
                failedCount++;
                continue;
            }

            var srcName = path.basename(srcPath);
            var isDir = fs.statSync(srcPath).isDirectory();

            // 如果源路径就在目标目录内，跳过（用 path.normalize 避免斜杠差异）
            var srcDir = path.normalize(path.dirname(srcPath));
            if (srcDir === path.normalize(targetDir)) {
                skippedCount++;
                continue;
            }

            // 构造目标路径，处理重名
            var destPath = path.join(targetDir, srcName);
            var finalDestPath = destPath;
            var counter = 1;
            while (fs.existsSync(finalDestPath)) {
                var ext = isDir ? '' : path.extname(srcName);
                var base = isDir ? srcName : path.basename(srcName, ext);
                finalDestPath = path.join(targetDir, base + ' (' + counter + ')' + ext);
                counter++;
            }

            try {
                if (isDir) {
                    that.copyDirectorySync(srcPath, finalDestPath);
                } else {
                    fs.copyFileSync(srcPath, finalDestPath);
                }
                copiedCount++;
            } catch(e) {
                that._error('copyExternalFiles error:', e);
                failMsgs.push(file.name + ': ' + (e.message || '未知错误'));
                failedCount++;
            }
        }

        // 如果没有异步操作，立即刷新和提示
        if (pendingAsync === 0) finish();
    }

    /**
     * 通过 FileReader 读取外部拖入文件并写入目标目录（当 file.path 不可用时的降级方案）
     */
    _copyExternalFileByReader(file, targetDir, callback) {
        var that = this;
        var srcName = file.name || 'unknown';

        // 文件夹无法通过 FileReader 读取（size=0 且无 type 是文件夹的粗略特征）
        if (file.size === 0 && !file.type) {
            callback(false, srcName + ': 无法复制文件夹（浏览器未暴露文件路径）');
            return;
        }

        // 构造目标路径，处理重名
        var destPath = path.join(targetDir, srcName);
        var finalDestPath = destPath;
        var counter = 1;
        try {
            while (fs.existsSync(finalDestPath)) {
                var ext = path.extname(srcName);
                var base = path.basename(srcName, ext);
                finalDestPath = path.join(targetDir, base + ' (' + counter + ')' + ext);
                counter++;
            }
        } catch(e) {
            callback(false, srcName + ': 路径检查失败');
            return;
        }

        var reader = new FileReader();
        reader.onload = function(e) {
            try {
                var arrayBuffer = e.target.result;
                var buffer = Buffer.from(arrayBuffer);
                fs.writeFileSync(finalDestPath, buffer);
                callback(true);
            } catch(err) {
                that._error('_copyExternalFileByReader write error:', err);
                callback(false, srcName + ': ' + (err.message || '写入失败'));
            }
        };
        reader.onerror = function() {
            callback(false, srcName + ': 读取失败');
        };
        reader.readAsArrayBuffer(file);
    }

    /**
     * 显示提示消息
     */
    showToastMsg(msg) {
        // 方式1：使用插件自带的 showMessage
        if (typeof this.showMessage === 'function') {
            this.showMessage(msg);
        }
        // 方式2：使用思源全局 messenger
        if (window.siyuan && window.siyuan.messenger) {
            window.siyuan.messenger.show(msg);
        }
        // 方式3：兜底 - 在编辑器区域显示浮动提示
        var existingToast = document.getElementById('cd-toast-msg');
        if (existingToast) {
            existingToast.remove();
        }
        var toast = document.createElement('div');
        toast.id = 'cd-toast-msg';
        toast.textContent = msg;
        toast.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);' +
            'background:var(--b3-theme-surface,#1e1e1e);color:var(--b3-theme-on-surface,#e0e0e0);' +
            'padding:16px 32px;border-radius:8px;font-size:15px;z-index:999999;' +
            'box-shadow:0 4px 20px rgba(0,0,0,0.4);transition:opacity 0.3s;pointer-events:none;';
        document.body.appendChild(toast);
        setTimeout(function() {
            toast.style.opacity = '0';
            setTimeout(function() { toast.remove(); }, 300);
        }, 2500);
    }

    /**
     * 显示粘贴菜单（空白处右键）
     */
    showPasteMenu(e, targetDir) {
        var that = this;
        var menuEl = document.getElementById('cd-context-menu');
        if (!menuEl) return;

        that.hideContextMenu();

        if (!that._clipboardCut) return;

        var items = [];
        items.push({
            icon: '📋',
            label: '粘贴「' + that._clipboardCut.name + '」',
            action: function() { that.pasteFile(targetDir); }
        });
        items.push({ type: 'divider' });
        items.push({
            icon: '❌',
            label: '取消剪切',
            action: function() {
                that._clipboardCut = null;
                that.showToastMsg('已取消剪切');
            }
        });

        var html = '';
        for (var i = 0; i < items.length; i++) {
            var item = items[i];
            if (item.type === 'divider') {
                html += '<div style="height:1px;background:var(--b3-border,#eee);margin:4px 0"></div>';
            } else {
                html += '<div class="cd-menu-item" data-idx="' + i + '" style="padding:6px 14px;cursor:pointer;white-space:nowrap;transition:background 0.1s;display:flex;align-items:center;gap:8px">' +
                    '<span style="font-size:14px;width:18px;text-align:center;flex-shrink:0">' + item.icon + '</span>' +
                    '<span style="flex:1">' + item.label + '</span>' +
                '</div>';
            }
        }
        menuEl.innerHTML = html;

        var menuItems = menuEl.querySelectorAll('.cd-menu-item');
        for (var j = 0; j < menuItems.length; j++) {
            menuItems[j].addEventListener('click', function(e) {
                e.stopPropagation();
                that.hideContextMenu();
                var idx = parseInt(this.dataset.idx, 10);
                if (items[idx] && items[idx].action) {
                    items[idx].action();
                }
            });
            menuItems[j].addEventListener('mouseenter', function() {
                this.style.background = 'var(--b3-theme-hover,#e3f2fd)';
            });
            menuItems[j].addEventListener('mouseleave', function() {
                this.style.background = '';
            });
        }

        menuEl.style.display = 'block';
        var rect = menuEl.getBoundingClientRect();
        var winW = window.innerWidth;
        var winH = window.innerHeight;
        var x = e.clientX;
        var y = e.clientY;
        if (x + rect.width > winW) x = winW - rect.width - 4;
        if (y + rect.height > winH) y = winH - rect.height - 4;
        if (x < 0) x = 4;
        if (y < 0) y = 4;
        menuEl.style.left = x + 'px';
        menuEl.style.top = y + 'px';

        document.addEventListener('click', that._menuDocClick);
        document.addEventListener('keydown', that._menuKeyDown);
    }

    /**
     * 显示右键菜单
     */
    showContextMenu(e, filePath, fileName, isDir) {
        var that = this;
        var menuEl = document.getElementById('cd-context-menu');
        if (!menuEl) return;

        // 先关闭可能已打开的菜单
        that.hideContextMenu();

        var isDocker = that._isDockerBrowser();
        var items = [];
        if (isDir) {
            // 文件夹右键菜单：插入链接、收藏文件夹、关联当前文档、打开所在位置、查看属性
            items.push({ icon: '📎', label: '插入链接', action: isDocker ? null : function() { that.insertLocalFileLink(filePath, fileName, true); }, disabled: isDocker });
            if (that.isFavorite(filePath)) {
                items.push({ icon: '❌', label: '移除收藏', action: function() { that.removeFavorite(filePath); } });
            } else {
                items.push({ icon: '⭐', label: '收藏文件夹', action: function() { that.addFavorite(filePath, fileName); } });
            }
            // 关联当前文档
            if (that.isFileDocLinked(filePath)) {
                items.push({ icon: '🔗', label: '取消关联', action: function() { that.unlinkFileDoc(filePath); } });
                items.push({ icon: '📖', label: '打开关联文档', action: function() { that.openLinkedDoc(filePath); } });
            } else {
                items.push({ icon: '🔗', label: '关联当前文档', action: function() { that.linkFileToCurrentDoc(filePath); } });
            }
            items.push({ icon: '📁', label: '打开所在位置', action: isDocker ? null : function() { that.openContainingFolder(filePath); }, disabled: isDocker });
            items.push({ type: 'divider' });
            items.push({ icon: 'ℹ️', label: '查看属性', action: function() { that.showFileProperties(filePath, fileName, isDir); } });
        } else {
            // 文件右键菜单：插入链接、插入文件、关联当前文档、打开所在位置、剪切、查看属性
            items.push({ icon: '📎', label: '插入链接', action: isDocker ? null : function() { that.handleFileClick(filePath, fileName); }, disabled: isDocker });
            items.push({ icon: '📦', label: '插入文件', action: function() { that.copyFileToAssets(filePath, fileName); } });
            // 关联当前文档
            if (that.isFileDocLinked(filePath)) {
                items.push({ icon: '🔗', label: '取消关联', action: function() { that.unlinkFileDoc(filePath); } });
                items.push({ icon: '📖', label: '打开关联文档', action: function() { that.openLinkedDoc(filePath); } });
            } else {
                items.push({ icon: '🔗', label: '关联当前文档', action: function() { that.linkFileToCurrentDoc(filePath); } });
            }
            items.push({ icon: '📁', label: '打开所在位置', action: isDocker ? null : function() { that.openContainingFolder(filePath); }, disabled: isDocker });
            items.push({ type: 'divider' });
            items.push({ icon: '✂️', label: '剪切', action: isDocker ? null : function() { that.cutFile(filePath, fileName, isDir); }, disabled: isDocker });
            items.push({ type: 'divider' });
            items.push({ icon: 'ℹ️', label: '查看属性', action: function() { that.showFileProperties(filePath, fileName, isDir); } });
        }

        var html = '';
        for (var i = 0; i < items.length; i++) {
            var item = items[i];
            if (item.type === 'divider') {
                html += '<div style="height:1px;background:var(--b3-border,#eee);margin:4px 0"></div>';
            } else {
                var disabledStyle = item.disabled ? 'opacity:0.35;cursor:not-allowed;' : 'cursor:pointer;';
                html += '<div class="cd-menu-item' + (item.disabled ? ' cd-menu-item-disabled' : '') + '" data-idx="' + i + '" style="padding:6px 14px;white-space:nowrap;transition:background 0.1s;display:flex;align-items:center;gap:8px;' + disabledStyle + '">' +
                    '<span style="font-size:14px;width:18px;text-align:center;flex-shrink:0">' + item.icon + '</span>' +
                    '<span style="flex:1">' + item.label + '</span>' +
                '</div>';
            }
        }
        menuEl.innerHTML = html;

        // 绑定菜单项点击（通过 data-idx 获取 items 数组中的真实位置）
        var menuItems = menuEl.querySelectorAll('.cd-menu-item');
        for (var j = 0; j < menuItems.length; j++) {
            // disabled 项不绑定点击和悬停
            if (menuItems[j].classList.contains('cd-menu-item-disabled')) continue;
            menuItems[j].addEventListener('click', function(e) {
                e.stopPropagation();
                that.hideContextMenu();
                var idx = parseInt(this.dataset.idx, 10);
                if (items[idx] && items[idx].action) {
                    items[idx].action();
                }
            });
            menuItems[j].addEventListener('mouseenter', function() {
                this.style.background = 'var(--b3-theme-hover,#e3f2fd)';
            });
            menuItems[j].addEventListener('mouseleave', function() {
                this.style.background = '';
            });
        }

        // 定位菜单
        menuEl.style.display = 'block';
        var rect = menuEl.getBoundingClientRect();
        var winW = window.innerWidth;
        var winH = window.innerHeight;
        var x = e.clientX;
        var y = e.clientY;
        if (x + rect.width > winW) x = winW - rect.width - 4;
        if (y + rect.height > winH) y = winH - rect.height - 4;
        if (x < 0) x = 4;
        if (y < 0) y = 4;
        menuEl.style.left = x + 'px';
        menuEl.style.top = y + 'px';

        // 文档级 mousemove：鼠标离开菜单区域后自动关闭
        that._menuMouseMove = function(e) {
            var rect = menuEl.getBoundingClientRect();
            var inside = e.clientX >= rect.left && e.clientX <= rect.right &&
                         e.clientY >= rect.top && e.clientY <= rect.bottom;
            if (inside) {
                // 鼠标在菜单内，取消关闭计时
                if (that._menuLeaveTimer) {
                    clearTimeout(that._menuLeaveTimer);
                    that._menuLeaveTimer = null;
                }
            } else {
                // 鼠标在菜单外，启动关闭计时（如果还没启动）
                if (!that._menuLeaveTimer) {
                    that._menuLeaveTimer = setTimeout(function() {
                        that.hideContextMenu();
                    }, 300);
                }
            }
        };
        document.addEventListener('mousemove', that._menuMouseMove);

        // 点击其他地方关闭
        that._menuDocClick = function() { that.hideContextMenu(); };
        document.addEventListener('click', that._menuDocClick, { once: true });

        // ESC 关闭
        that._menuKeyDown = function(ev) {
            if (ev.key === 'Escape') {
                that.hideContextMenu();
            }
        };
        document.addEventListener('keydown', that._menuKeyDown);
    }

    /**
     * 隐藏右键菜单
     */
    hideContextMenu() {
        var menuEl = document.getElementById('cd-context-menu');
        if (menuEl) {
            menuEl.style.display = 'none';
        }
        if (this._menuLeaveTimer) {
            clearTimeout(this._menuLeaveTimer);
            this._menuLeaveTimer = null;
        }
        if (this._menuMouseMove) {
            document.removeEventListener('mousemove', this._menuMouseMove);
            this._menuMouseMove = null;
        }
        if (this._menuDocClick) {
            document.removeEventListener('click', this._menuDocClick);
            this._menuDocClick = null;
        }
        if (this._menuKeyDown) {
            document.removeEventListener('keydown', this._menuKeyDown);
            this._menuKeyDown = null;
        }
    }

    /**
     * 播放视频文件
     * 优先调用思播(siyuan-media-player)插件播放，降级到系统默认播放器
     */
    playVideo(filePath, fileName) {
        var that = this;
        var fileUrl = this.toFileUrl(filePath);

        // 优先：尝试调用思播(siyuan-media-player)插件播放
        try {
            var smp = window.siyuanMediaPlayer;
            if (smp && typeof smp.playLink === 'function') {
                smp.playLink(fileUrl).then(function(ok) {
                    if (!ok) {
                        // 思播无法解析该URL，打开系统默认播放器
                        that.openFile(filePath);
                    }
                }).catch(function(e) {
                    that._error('思播播放失败，打开系统默认播放器:', e);
                    that.openFile(filePath);
                });
                return;
            }
        } catch (e) {
            that._error('调用思播失败:', e);
        }

        // 思播未安装或不可用，打开系统默认播放器
        that.openFile(filePath);
    }

    /**
     * 用系统默认程序打开文件（跨平台：Electron > cmd/open/xdg-open）
     */
    openFile(filePath) {
        var that = this;
        // 如果是文件夹，在插件面板中打开，不弹出系统资源管理器
        try {
            if (fs && fs.statSync(filePath).isDirectory()) {
                that.loadDirectory(filePath);
                that.ensurePanelVisible();
                return;
            }
        } catch (e) {}
        try {
            var electron = window.require && window.require('electron');
            if (electron && electron.shell && electron.shell.openPath) {
                electron.shell.openPath(filePath);
                return;
            }
        } catch (e) {}
        try {
            var cp = require('child_process');
            if (that.isWindows) {
                cp.spawn('cmd', ['/c', 'start', '""', filePath], { stdio: 'ignore', detached: true }).unref();
            } else if (that.platform === 'darwin') {
                cp.spawn('open', [filePath], { stdio: 'ignore', detached: true }).unref();
            } else {
                cp.spawn('xdg-open', [filePath], { stdio: 'ignore', detached: true }).unref();
            }
        } catch (e) {
            this.showToastMsg('无法打开文件，请手动访问：' + filePath);
        }
    }

    /**
     * 打开文件所在文件夹（跨平台）
     * Windows: explorer /select
     * macOS: open -R（在 Finder 中显示并选中）
     * Linux: xdg-open 目录
     */
    openContainingFolder(filePath) {
        var that = this;
        console.log('[localbrowse] openContainingFolder path:', filePath);
        // 优先通过思源 IPC 通道发送 showItemInFolder（和思源自带功能完全一致）
        try {
            var electron = window.require && window.require('electron');
            if (electron && electron.ipcRenderer) {
                electron.ipcRenderer.send('siyuan-cmd', {
                    cmd: 'showItemInFolder',
                    filePath: filePath
                });
                console.log('[localbrowse] sent siyuan-cmd showItemInFolder');
                return;
            }
        } catch (e) {
            console.warn('[localbrowse] ipcRenderer unavailable:', e);
        }
        // 回退到 Electron shell API
        try {
            var electron = window.require && window.require('electron');
            if (electron && electron.shell && typeof electron.shell.showItemInFolder === 'function') {
                electron.shell.showItemInFolder(filePath);
                console.log('[localbrowse] showItemInFolder called');
                return;
            }
        } catch (e) {
            console.warn('[localbrowse] showItemInFolder unavailable:', e);
        }
        // 回退到 child_process
        try {
            var cp = require('child_process');
            if (that.isWindows) {
                cp.spawn('explorer', ['/select,', filePath], {
                    stdio: 'ignore',
                    detached: true
                }).unref();
            } else if (that.platform === 'darwin') {
                cp.spawn('open', ['-R', filePath], { stdio: 'ignore', detached: true }).unref();
            } else {
                var dir = filePath.substring(0, Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\')));
                cp.spawn('xdg-open', [dir || '/'], { stdio: 'ignore', detached: true }).unref();
            }
        } catch (e) {
            console.error('[localbrowse] openContainingFolder failed:', e, 'path:', filePath);
            that.showToastMsg('无法打开文件夹，请手动访问');
        }
    }

    /**
     * 用系统默认程序打开文件（内部资源）
     * 通过 siyuan-cmd IPC 调用主进程 openPath
     */
    _openAssetFile(filePath) {
        var that = this;
        console.log('[localbrowse] _openAssetFile path:', filePath);
        // 优先通过思源 IPC 通道发送 openPath
        try {
            var electron = window.require && window.require('electron');
            if (electron && electron.ipcRenderer) {
                electron.ipcRenderer.send('siyuan-cmd', {
                    cmd: 'openPath',
                    filePath: filePath
                });
                console.log('[localbrowse] sent siyuan-cmd openPath');
                return;
            }
        } catch (e) {
            console.warn('[localbrowse] ipcRenderer unavailable:', e);
        }
        // 回退到 Electron shell API
        try {
            var electron = window.require && window.require('electron');
            if (electron && electron.shell && typeof electron.shell.openPath === 'function') {
                electron.shell.openPath(filePath);
                console.log('[localbrowse] shell.openPath called');
                return;
            }
        } catch (e) {
            console.warn('[localbrowse] shell.openPath unavailable:', e);
        }
        // 回退到 child_process
        try {
            var cp = require('child_process');
            if (that.isWindows) {
                cp.spawn('explorer', [filePath], { stdio: 'ignore', detached: true }).unref();
            } else if (that.platform === 'darwin') {
                cp.spawn('open', [filePath], { stdio: 'ignore', detached: true }).unref();
            } else {
                cp.spawn('xdg-open', [filePath], { stdio: 'ignore', detached: true }).unref();
            }
        } catch (e) {
            console.error('[localbrowse] _openAssetFile failed:', e, 'path:', filePath);
            that.showToastMsg('无法打开文件，请手动访问');
        }
    }

    /**
     * 注册链接点击拦截器
     * 拦截文档中 file:/// 链接的点击：
     * 1. 文件夹链接 → 在插件面板中打开
     * 2. 带指纹信息的文件链接 → 去掉指纹后正确打开
     *
     * 思源编辑器中链接可能渲染为 <a href="..."> 或 <span data-type="a" data-href="...">
     */
    registerLinkClickInterceptor() {
        var that = this;

        /**
         * 从点击事件中提取 file:/// 链接的 href 和元素
         * @returns {{ href: string, linkEl: Element } | null}
         */
        function findFileLink(e) {
            var target = e.target;
            while (target && target !== document) {
                // 标准链接 <a href="file:///...">
                if (target.tagName === 'A' && target.href && target.href.indexOf('file:///') === 0) {
                    return { href: target.href, linkEl: target };
                }
                // 思源 protyle 链接 <span data-type="a" data-href="file:///...">
                if (target.dataset && target.dataset.type === 'a' && target.dataset.href && target.dataset.href.indexOf('file:///') === 0) {
                    return { href: target.dataset.href, linkEl: target };
                }
                target = target.parentElement;
            }
            return null;
        }

        that._linkClickInterceptor = function(e) {
            var linkInfo = findFileLink(e);
            if (!linkInfo) return;

            var href = linkInfo.href;
            // 解析本地路径（去掉 fragment）
            var cleanUrl = href.split('#')[0];
            var localPath = that.fileUrlToLocalPath(cleanUrl);

            // 文件夹链接：在插件面板中打开，不弹出系统资源管理器
            if (localPath) {
                try {
                    if (fs && fs.statSync(localPath).isDirectory()) {
                        e.preventDefault();
                        e.stopPropagation();
                        e.stopImmediatePropagation();
                        // 确保面板可见并切换到本地文件标签
                        that.ensurePanelVisible();
                        if (that._activeTab !== 'local') {
                            that._switchTab('local');
                        }
                        that.loadDirectory(localPath);
                        return;
                    }
                } catch(ex) {
                    // 路径不存在或无法访问，继续走文件逻辑
                }

                // 文件链接：在插件面板中同步定位到该文件
                that.locateFileInPanel(localPath);
            }

            // 检查是否包含指纹信息（URL fragment 或 title 属性）
            var hasFragmentFingerprint = (href.indexOf('#size=') !== -1 || href.indexOf('#mtime=') !== -1);
            var titleAttr = linkInfo.linkEl.getAttribute('title') || '';
            var hasTitleFingerprint = (titleAttr.indexOf('size=') !== -1 || titleAttr.indexOf('mtime=') !== -1);

            if (!hasFragmentFingerprint && !hasTitleFingerprint) return;

            // 阻止默认行为和事件冒泡（带指纹的链接需要特殊处理）
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();

            // 去掉 fragment 后打开文件
            that.openFileByUrl(cleanUrl);
        };

        // 在捕获阶段拦截 click 事件（思源通过 click 处理链接，不用 mousedown）
        document.addEventListener('click', that._linkClickInterceptor, true);
    }

    /**
     * 在插件面板中定位到指定文件（导航到文件所在目录并高亮选中）
     * @param {string} filePath - 文件的完整本地路径
     */
    locateFileInPanel(filePath) {
        var that = this;
        if (!filePath) return;

        // 从完整路径中提取文件名和目录路径
        var fileName = require('path').basename(filePath);
        var dirPath = require('path').dirname(filePath);

        // 规范化目录路径用于比较（去末尾分隔符）
        var normalizeDir = function(p) {
            if (!p) return '';
            while (p.length > 1 && (p.endsWith('\\') || p.endsWith('/'))) {
                p = p.slice(0, -1);
            }
            return p;
        };

        var currentDir = normalizeDir(that.currentPath);
        var targetDir = normalizeDir(dirPath);

        // 确保面板可见并切换到本地文件标签
        that.ensurePanelVisible();
        if (that._activeTab !== 'local') {
            that._switchTab('local');
        }

        // 如果当前不在文件所在目录，先导航过去
        if (targetDir && targetDir !== currentDir) {
            // 设置待定位标记，renderFiles 完成后会自动定位
            that._pendingLocateFileName = fileName;
            that.loadDirectory(targetDir);
            return;
        }

        // 当前已在目标目录，直接定位
        that._doLocateFile(fileName);
    }

    /**
     * 通过 file:/// URL 打开文件（去掉 fragment 后转为本地路径）
     */
    openFileByUrl(url) {
        var localPath = this.fileUrlToLocalPath(url);
        if (localPath) {
            this.openFile(localPath);
        } else {
            this.showToastMsg('无法解析文件路径：' + url);
        }
    }

    /**
     * 确保插件面板可见（如果面板被隐藏则显示它）
     */
    ensurePanelVisible() {
        if (!this.dockPanel || !this.dockPanel.element) return;
        // 检查面板自身是否可见
        var panelEl = this.dockPanel.element;
        var rect = panelEl.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) return; // 已可见
        // 面板不可见，模拟点击 dock 图标来显示
        var dockIcon = document.querySelector('.dock__item[data-type="cd_filetree"]');
        if (dockIcon) {
            dockIcon.click();
        }
    }

    /**
     * 复制文件路径到剪贴板
     */
    copyFilePath(filePath) {
        this.copyToClipboard(filePath);
        // 路径复制成功，无提示
    }

    /**
     * 复制 Markdown 链接到剪贴板
     * 同样附加 size+mtime fragment
     */
    copyMarkdownLink(filePath, fileName) {
        var fileUrl = this.toFileUrl(filePath);
        // 获取文件指纹，作为链接标题（title）
        var fingerprintTitle = '';
        try {
            var stat = fs.statSync(filePath);
            if (stat) {
                fingerprintTitle = 'size=' + stat.size + '&mtime=' + (stat.mtime ? stat.mtime.getTime() : 0);
            }
        } catch(e) {}
        var markdown;
        var icon = this.getFileIcon(fileName);
        var linkText = icon + ' ' + this.escapeMarkdown(fileName);
        if (this.isImageFile(fileName)) {
            markdown = '![' + this.escapeMarkdown(fileName) + '](' + fileUrl + ')';
        } else {
            if (fingerprintTitle) {
                markdown = '[' + linkText + '](' + fileUrl + ' "' + fingerprintTitle + '")';
            } else {
                markdown = '[' + linkText + '](' + fileUrl + ')';
            }
        }
        this.copyToClipboard(markdown);
        // Markdown 链接复制成功，无提示
    }

    /**
     * 查看文件/文件夹属性
     */
    showFileProperties(filePath, fileName, isDir) {
        var that = this;
        var sizeStr = '';
        var timeStr = '';
        var typeStr = isDir ? '文件夹' : '文件';

        if (fs && fs.statSync) {
            try {
                var st = fs.statSync(filePath);
                if (!isDir) {
                    sizeStr = '大小：' + that.formatSize(st.size);
                }
                var mtime = new Date(st.mtime);
                timeStr = '修改时间：' + mtime.getFullYear() + '-' +
                    String(mtime.getMonth()+1).padStart(2,'0') + '-' +
                    String(mtime.getDate()).padStart(2,'0') + ' ' +
                    String(mtime.getHours()).padStart(2,'0') + ':' +
                    String(mtime.getMinutes()).padStart(2,'0');
            } catch (e) {
                sizeStr = '';
                timeStr = '';
            }
        }

        var content = '<div style="padding:16px;font-size:13px;max-width:380px">' +
            '<div style="font-weight:bold;font-size:14px;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid var(--b3-border,#eee)">ℹ️ 属性</div>' +
            '<div style="margin-bottom:8px;word-break:break-all"><span style="color:var(--b3-theme-secondary,#999)">名称：</span>' + that.escapeHtml(fileName) + '</div>' +
            '<div style="margin-bottom:8px;word-break:break-all"><span style="color:var(--b3-theme-secondary,#999)">类型：</span>' + typeStr + '</div>' +
            (sizeStr ? '<div style="margin-bottom:8px"><span style="color:var(--b3-theme-secondary,#999)">' + sizeStr + '</span></div>' : '') +
            (timeStr ? '<div style="margin-bottom:12px"><span style="color:var(--b3-theme-secondary,#999)">' + timeStr + '</span></div>' : '') +
            '<div style="word-break:break-all"><span style="color:var(--b3-theme-secondary,#999)">路径：</span><code style="background:var(--b3-theme-surface,#f5f5f5);padding:2px 6px;border-radius:3px;font-size:12px">' + that.escapeHtml(filePath) + '</code></div>' +
            '<div style="margin-top:14px;text-align:right">' +
                '<button id="cd-prop-ok" style="padding:5px 16px;font-size:12px;background:var(--b3-theme-primary,#4285f4);color:#fff;border:none;border-radius:4px;cursor:pointer">确定</button>' +
            '</div>' +
        '</div>';

        var dialog = document.createElement('div');
        dialog.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.35);z-index:10000;display:flex;align-items:center;justify-content:center';
        dialog.innerHTML = '<div style="background:var(--b3-theme-background,#fff);border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,0.2);max-width:90vw;max-height:90vh;overflow:auto">' + content + '</div>';
        document.body.appendChild(dialog);

        dialog.addEventListener('click', function(e) {
            if (e.target === dialog) {
                document.body.removeChild(dialog);
            }
        });
        var okBtn = dialog.querySelector('#cd-prop-ok');
        if (okBtn) {
            okBtn.addEventListener('click', function() {
                document.body.removeChild(dialog);
            });
        }
    }

    /**
     * 选中文件项（高亮）
     */
    selectItem(selectedItem, e) {
        // 支持 Ctrl/Cmd + 点击：切换选中；Shift + 点击：范围选择；普通点击：单选
        var multiKey = e && (e.ctrlKey || e.metaKey);
        var shiftKey = e && e.shiftKey;

        if (shiftKey && this._lastClickedItem) {
            // Shift + 点击：范围选择（从上次点击到当前项之间的所有项）
            this._selectRange(this._lastClickedItem, selectedItem);
        } else if (multiKey) {
            // Ctrl/Cmd + 点击：切换当前项选中状态
            if (selectedItem.classList.contains('cd-selected')) {
                selectedItem.classList.remove('cd-selected');
                selectedItem.style.background = '';
                // 从 _selectedItems 中移除
                var idx = this._selectedItems.indexOf(selectedItem);
                if (idx !== -1) this._selectedItems.splice(idx, 1);
            } else {
                selectedItem.classList.add('cd-selected');
                selectedItem.style.background = 'var(--b3-theme-primary-light,#bbdefb)';
                this._selectedItems.push(selectedItem);
            }
            this._lastClickedItem = selectedItem;
        } else {
            // 普通点击：清除其他选中，只选中当前项
            this.clearSelection();
            selectedItem.classList.add('cd-selected');
            selectedItem.style.background = 'var(--b3-theme-primary-light,#bbdefb)';
            this._selectedItems = [selectedItem];
            this._lastClickedItem = selectedItem;
        }
    }

    /**
     * 范围选择：选中 from 到 to 之间的所有项
     */
    _selectRange(fromItem, toItem) {
        var list = document.getElementById('cd-file-list');
        if (!list) return;
        var allItems = list.querySelectorAll('.cd-item');
        var fromIdx = -1, toIdx = -1;
        for (var i = 0; i < allItems.length; i++) {
            if (allItems[i] === fromItem) fromIdx = i;
            if (allItems[i] === toItem) toIdx = i;
        }
        if (fromIdx === -1 || toIdx === -1) return;
        var start = Math.min(fromIdx, toIdx);
        var end = Math.max(fromIdx, toIdx);
        // 清除之前的选择
        this.clearSelection();
        for (var j = start; j <= end; j++) {
            allItems[j].classList.add('cd-selected');
            allItems[j].style.background = 'var(--b3-theme-primary-light,#bbdefb)';
            this._selectedItems.push(allItems[j]);
        }
    }

    /**
     * 清除所有选中状态
     */
    clearSelection() {
        for (var i = 0; i < this._selectedItems.length; i++) {
            this._selectedItems[i].classList.remove('cd-selected');
            this._selectedItems[i].style.background = '';
        }
        this._selectedItems = [];
    }

    /**
     * 获取所有选中文件的信息列表
     * @returns {Array<{path, name, isDir, el}>}
     */
    getSelectedFiles() {
        var result = [];
        for (var i = 0; i < this._selectedItems.length; i++) {
            var item = this._selectedItems[i];
            result.push({
                path: item.dataset.path,
                name: item.dataset.name,
                isDir: item.dataset.isdir === 'true',
                el: item
            });
        }
        return result;
    }

    /**
     * 将本地路径转换为 file:/// URL
     */
    toFileUrl(filePath) {
        // Docker 路径映射：容器路径 → 宿主机路径
        var mappedPath = this.containerToHost(filePath);
        var normalizedPath = mappedPath.replace(/\\/g, '/').replace(/\/+/g, '/');
        if (normalizedPath.startsWith('file:///')) {
            return normalizedPath;
        } else if (normalizedPath.startsWith('file://')) {
            return 'file:///' + normalizedPath.substring(7);
        } else if (normalizedPath.startsWith('/')) {
            return 'file://' + normalizedPath;
        } else {
            return 'file:///' + normalizedPath;
        }
    }

    /**
     * 判断文件是否为图片
     */
    isImageFile(fileName) {
        var ext = fileName.split('.').pop().toLowerCase();
        var imageExts = {'jpg':1,'jpeg':1,'png':1,'gif':1,'webp':1,'svg':1,'bmp':1,'heic':1,'heif':1,'livp':1};
        return !!imageExts[ext];
    }

    /**
     * 判断是否为视频文件
     */
    isVideoFile(fileName) {
        var ext = fileName.split('.').pop().toLowerCase();
        var videoExts = {'mp4':1,'avi':1,'mkv':1,'mov':1,'wmv':1,'flv':1,'webm':1,'m4v':1,'mpg':1,'mpeg':1,'ts':1,'m2ts':1,'3gp':1};
        return !!videoExts[ext];
    }

    /**
     * 判断是否为音频文件
     */
    isAudioFile(fileName) {
        var ext = fileName.split('.').pop().toLowerCase();
        var audioExts = {'mp3':1,'wav':1,'flac':1,'aac':1,'ogg':1,'wma':1,'m4a':1,'ape':1,'opus':1,'aiff':1,'alac':1};
        return !!audioExts[ext];
    }

    /**
     * 播放音频文件
     * @param {string} filePath - 本地文件路径
     * @param {string} fileName - 文件名
     */
    playAudio(filePath, fileName) {
        var that = this;
        var audioBar = document.getElementById('cd-audio-bar');
        if (!audioBar) return;

        // 构建 file:// URL
        var fileUrl = that.toFileUrl(filePath);

        // 如果没有 audio 元素则创建
        if (!that._audioEl) {
            that._audioEl = new Audio();
            that._audioEl.volume = that._savedVolume;
            that._audioPlaylist = [];  // 当前目录的音频文件列表
            that._audioIndex = -1;     // 当前播放索引
        }

        // 更新播放列表（从当前目录的缓存文件中筛选音频文件）
        var cachedFiles = that.cachedFiles || [];
        var audioFiles = [];
        var curPath = that.cachedPath;
        var sep = that._sep;
        if (curPath && !curPath.endsWith(sep)) curPath += sep;
        for (var i = 0; i < cachedFiles.length; i++) {
            if (!cachedFiles[i].isDir && that.isAudioFile(cachedFiles[i].name)) {
                audioFiles.push({
                    name: cachedFiles[i].name,
                    isDir: false,
                    path: curPath + cachedFiles[i].name
                });
            }
        }
        that._audioPlaylist = audioFiles;

        // 找到当前文件在播放列表中的索引
        var idx = -1;
        for (var j = 0; j < audioFiles.length; j++) {
            if (audioFiles[j].name === fileName) {
                idx = j;
                break;
            }
        }
        that._audioIndex = idx >= 0 ? idx : 0;
        that._audioCurrentPath = filePath;
        that._audioCurrentName = fileName;  // 单独存储文件名

        // 设置预加载策略：仅加载元数据，避免网盘大文件阻塞 UI
        that._audioEl.preload = 'metadata';
        that._audioShouldAutoPlay = true;

        // 先更新 UI，避免设置 src 后网盘文件加载阻塞界面
        audioBar.style.display = 'flex';
        var nameEl = document.getElementById('cd-audio-name');
        if (nameEl) nameEl.textContent = '🎵 ' + fileName;
        // 延迟显示 loading：本地文件 canplay 很快，不需要 loading；只有加载卡顿超过 80ms 才显示
        if (that._audioLoadTimer) clearTimeout(that._audioLoadTimer);
        that._audioLoadTimer = setTimeout(function() {
            that._updateAudioPlayBtn('loading');
        }, 80);

        // 延迟设置 src：让 UI 渲染先完成，再触发音频加载
        setTimeout(function() {
            if (!that._audioEl) return;
            that._audioEl.src = fileUrl;
        }, 0);

        // 为文件列表添加底部内边距，避免最后一个条目紧贴播放器栏
        var fileListEl = document.getElementById('cd-file-list');
        if (fileListEl) fileListEl.style.paddingBottom = '44px';
        var assetsListEl = document.getElementById('cd-assets-list');
        if (assetsListEl) assetsListEl.style.paddingBottom = '44px';

        // 加载歌词和封面：清理可能存在的旧预加载数据
        if (that._preloadData) {
            if (that._preloadData.coverIsBlob && that._preloadData.coverUrl) {
                URL.revokeObjectURL(that._preloadData.coverUrl);
            }
            if (that._preloadData.coverBlurUrl) {
                URL.revokeObjectURL(that._preloadData.coverBlurUrl);
            }
            that._preloadData = null;
        }
        that._loadLrc(filePath);

        // 首次播放后延迟触发预加载
        setTimeout(function() {
            that._preloadNext();
        }, 500);

        // 保存播放器状态（下次打开插件时恢复）
        that._audioPlayerClosed = false;
        that._saveAudioState(filePath, fileName);
    }

    /**
     * 更新播放/暂停按钮状态
     */
    _updateAudioPlayBtn(isPlaying) {
        var playBtn = document.getElementById('cd-audio-play');
        if (!playBtn) return;

        // 避免频繁切换同一状态导致 DOM 抖动（网盘缓冲时 waiting/canplay 可能交替触发）
        var stateMap = { true: 'playing', false: 'paused' };
        var newState = isPlaying === 'loading' ? 'loading' : stateMap[isPlaying];
        if (playBtn.getAttribute('data-play-state') === newState) return;
        playBtn.setAttribute('data-play-state', newState);

        var svgPlay = '<svg viewBox="0 0 24 24" width="14" height="14"><polygon points="8,5 19,12 8,19" fill="currentColor"/></svg>';
        var svgPause = '<svg viewBox="0 0 24 24" width="14" height="14"><rect x="7" y="5" width="4" height="14" rx="1.5" fill="currentColor"/><rect x="13" y="5" width="4" height="14" rx="1.5" fill="currentColor"/></svg>';
        var svgLoading = '<svg viewBox="0 0 24 24" width="14" height="14"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2.5" stroke-dasharray="8 4" stroke-linecap="round"/></svg>';
        if (isPlaying === 'loading') {
            playBtn.innerHTML = svgLoading;
            playBtn.title = '加载中...';
            playBtn.classList.add('cd-loading');
        } else if (isPlaying) {
            playBtn.innerHTML = svgPause;
            playBtn.title = '暂停';
            playBtn.classList.remove('cd-loading');
        } else {
            playBtn.innerHTML = svgPlay;
            playBtn.title = '播放';
            playBtn.classList.remove('cd-loading');
        }
    }

    /**
     * 更新播放模式按钮的图标和提示
     * 模式：0=随机播放 🎲，1=列表循环 🔁，2=单曲循环 🔂
     */
    _updateModeBtn(btn) {
        var svgs = [
            '<svg viewBox="0 0 24 24" width="12" height="12"><path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z" fill="currentColor"/></svg>',
            '<svg viewBox="0 0 24 24" width="12" height="12"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z" fill="currentColor"/></svg>',
            '<svg viewBox="0 0 24 24" width="12" height="12"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-5H9v2h4v-2z" fill="currentColor"/></svg>'
        ];
        var titles = ['随机播放', '列表循环', '单曲循环'];
        var mode = this._audioPlayMode || 0;
        if (btn) {
            btn.innerHTML = svgs[mode];
            btn.title = titles[mode];
            // 随机模式稍淡，循环模式高亮
            btn.style.opacity = mode === 0 ? '0.6' : '1';
        }
    }

    /**
     * 格式化秒数为 m:ss
     */
    _formatAudioTime(sec) {
        if (!sec || !isFinite(sec)) return '0:00';
        var m = Math.floor(sec / 60);
        var s = Math.floor(sec % 60);
        return m + ':' + (s < 10 ? '0' : '') + s;
    }

    /**
     * 根据播放模式计算下一首索引（不修改当前索引）
     * @param {number} direction - -1 上一首，1 下一首
     * @param {boolean} fromEnded - 是否由 ended 事件触发
     * @returns {number} 下一首索引
     */
    _getNextAudioIndex(direction, fromEnded) {
        var that = this;
        if (!that._audioPlaylist || that._audioPlaylist.length === 0) return -1;
        var len = that._audioPlaylist.length;
        var curIdx = that._audioIndex;

        // 单曲循环（mode=2）：歌曲结束时仍然是当前
        if (fromEnded && that._audioPlayMode === 2) {
            return curIdx;
        }

        // 随机播放（mode=0）：下一首随机选（避免重复当前，仅1首时顺序循环）
        if (that._audioPlayMode === 0 && len > 1) {
            if (direction === 1) {
                // 优先使用预加载的索引，确保和预加载的封面/歌词一致
                if (that._preloadData && that._preloadData.nextIdx >= 0 && that._preloadData.nextIdx < len) {
                    return that._preloadData.nextIdx;
                }
                var newIdx;
                do { newIdx = Math.floor(Math.random() * len); } while (newIdx === curIdx);
                return newIdx;
            }
            // 上一首：顺序回退
            return (curIdx - 1 + len) % len;
        }

        // 列表循环(1) 或 单曲循环(2) 手动切歌：顺序切换
        return (curIdx + direction + len) % len;
    }

    /**
     * 预加载下一首的封面和歌词（在当前歌曲播放时后台准备）
     */
    _preloadNext() {
        var that = this;
        if (!that._audioPlaylist || that._audioPlaylist.length <= 1) return;

        var nextIdx = that._getNextAudioIndex(1, false);
        if (nextIdx < 0 || nextIdx === that._audioIndex) return;
        var f = that._audioPlaylist[nextIdx];
        var audioPath = f.path;

        // 如果已经预加载了这首，跳过
        if (that._preloadData && that._preloadData.path === audioPath) return;

        // 清理旧的预加载 blob URL
        if (that._preloadData && that._preloadData.coverIsBlob && that._preloadData.coverUrl) {
            URL.revokeObjectURL(that._preloadData.coverUrl);
        }
        if (that._preloadData && that._preloadData.coverBlurUrl) {
            URL.revokeObjectURL(that._preloadData.coverBlurUrl);
        }
        // 保存 nextIdx：随机模式下确保预加载的"下一首"和实际切歌一致
        that._preloadData = { path: audioPath, nextIdx: nextIdx, coverUrl: null, coverIsBlob: false, coverBlurUrl: null, lrcLines: null };

        // 预加载歌词
        var lrcPath = audioPath.replace(/\.[^.]+$/, '.lrc');
        that._fsReadFile(lrcPath, 'utf-8').then(function(content) {
            if (content && that._preloadData && that._preloadData.path === audioPath) {
                that._preloadData.lrcLines = that._parseLrc(content);
            }
        }).catch(function() {
            // 无歌词文件，lrcLines 保持 null
        });

        // 预加载封面（目录封面）
        var lastSep = audioPath.replace(/\\/g, '/').lastIndexOf('/');
        var dir = lastSep >= 0 ? audioPath.substring(0, lastSep) : '';
        var coverNames = ['cover.jpg', 'cover.png', 'folder.jpg', 'folder.png',
            'album.jpg', 'album.png', 'front.jpg', 'front.png',
            'Cover.jpg', 'Cover.png', 'Folder.jpg', 'Folder.png'];
        var tryIndex = 0;
        function tryNextCover() {
            if (tryIndex >= coverNames.length) {
                // 目录封面没找到，尝试 MP3 内嵌封面
                that._preloadMp3Cover(audioPath);
                return;
            }
            var coverPath = dir + that._sep + coverNames[tryIndex];
            var coverFileName = coverNames[tryIndex]; // 闭包捕获文件名用于判断 MIME
            tryIndex++;
            that._fsExists(coverPath).then(function(exists) {
                if (exists && that._preloadData && that._preloadData.path === audioPath) {
                    // 读取封面文件并转为 blob URL，确保切歌时图片数据已在内存中
                    that._fsReadFile(coverPath, null).then(function(buf) {
                        if (!buf || !that._preloadData || that._preloadData.path !== audioPath) return;
                        var mime = coverFileName.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
                        var blob = new Blob([buf], { type: mime });
                        var url = URL.createObjectURL(blob);
                        that._preloadData.coverUrl = url;
                        that._preloadData.coverIsBlob = true;
                        // 预生成模糊背景缩略图（小尺寸+高斯模糊，避免浏览器实时 blur 大图导致延迟）
                        that._createBlurThumb(url).then(function(blurUrl) {
                            if (blurUrl && that._preloadData && that._preloadData.path === audioPath) {
                                that._preloadData.coverBlurUrl = blurUrl;
                            }
                        });
                    }).catch(function() {
                        // 读取失败，降级为 file:// URL
                        if (that._preloadData && that._preloadData.path === audioPath) {
                            that._preloadData.coverUrl = that.toFileUrl(coverPath);
                            that._preloadData.coverIsBlob = false;
                        }
                    });
                } else {
                    tryNextCover();
                }
            }).catch(function() {
                tryNextCover();
            });
        }
        tryNextCover();
    }

    /**
     * 预加载 MP3 内嵌封面（仅读取前 256KB，避免网盘大文件阻塞）
     */
    _preloadMp3Cover(filePath) {
        var that = this;
        var ext = filePath.split('.').pop().toLowerCase();
        if (ext !== 'mp3') return;
        if (!that._preloadData) return;
        var targetPath = that._preloadData.path;

        // 使用范围读取：只读前 256KB（ID3v2 标签通常在文件头部）
        that._fsReadFile(filePath, null, 262144).then(function(buf) {
            if (!buf || !that._preloadData || that._preloadData.path !== targetPath) return;
            var bytes;
            if (buf instanceof ArrayBuffer) {
                bytes = new Uint8Array(buf);
            } else if (buf.length !== undefined) {
                bytes = new Uint8Array(buf);
            } else return;

            if (bytes.length < 10 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return;

            var tagSize = ((bytes[6] & 0x7F) << 21) | ((bytes[7] & 0x7F) << 14) | ((bytes[8] & 0x7F) << 7) | (bytes[9] & 0x7F);
            var pos = 10;
            while (pos < Math.min(tagSize + 10, bytes.length) - 10) {
                if (pos + 10 > bytes.length) break;
                var frameId = String.fromCharCode(bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]);
                var frameSize = (bytes[pos + 4] << 24) | (bytes[pos + 5] << 16) | (bytes[pos + 6] << 8) | bytes[pos + 7];
                if (frameSize <= 0 || pos + 10 + frameSize > bytes.length) break;
                if (frameId === 'APIC') {
                    var frameData = bytes.subarray(pos + 10, pos + 10 + frameSize);
                    var encoding = frameData[0];
                    var mimeEnd = 1;
                    while (mimeEnd < frameData.length && frameData[mimeEnd] !== 0) mimeEnd++;
                    var mime = '';
                    for (var m = 1; m < mimeEnd; m++) mime += String.fromCharCode(frameData[m]);
                    var descStart = mimeEnd + 2;
                    if (encoding === 1 || encoding === 2) {
                        while (descStart < frameData.length - 1) {
                            if (frameData[descStart] === 0 && frameData[descStart + 1] === 0) {
                                descStart += 2;
                                break;
                            }
                            descStart++;
                        }
                    } else {
                        while (descStart < frameData.length && frameData[descStart] !== 0) descStart++;
                        descStart++;
                    }
                    if (descStart >= frameData.length) break;
                    var imgData = frameData.subarray(descStart);
                    var blob = new Blob([imgData], { type: mime || 'image/jpeg' });
                    if (that._preloadData && that._preloadData.path === targetPath) {
                        var blobUrl = URL.createObjectURL(blob);
                        that._preloadData.coverUrl = blobUrl;
                        that._preloadData.coverIsBlob = true;
                        // 预生成模糊背景缩略图
                        that._createBlurThumb(blobUrl).then(function(blurUrl) {
                            if (blurUrl && that._preloadData && that._preloadData.path === targetPath) {
                                that._preloadData.coverBlurUrl = blurUrl;
                            }
                        });
                    }
                    return;
                }
                pos += 10 + frameSize;
            }
        }).catch(function() {});
    }

    /**
     * 从封面 URL 创建预模糊的小缩略图（用于歌词背景）
     * 用 Canvas 缩小到 80x80 + 高斯模糊，大幅降低实时渲染负担
     * @param {string} imageUrl - 封面 blob URL
     * @returns {Promise<string|null>} 模糊缩略图的 blob URL，失败返回 null
     */
    _createBlurThumb(imageUrl) {
        return new Promise(function(resolve) {
            var img = new Image();
            img.onload = function() {
                var W = 80, H = 80;
                var canvas = document.createElement('canvas');
                canvas.width = W;
                canvas.height = H;
                var ctx = canvas.getContext('2d');
                ctx.filter = 'blur(6px) saturate(1.8)';
                ctx.drawImage(img, 0, 0, W, H);
                canvas.toBlob(function(blob) {
                    if (blob) {
                        resolve(URL.createObjectURL(blob));
                    } else {
                        resolve(null);
                    }
                }, 'image/jpeg', 0.6);
            };
            img.onerror = function() { resolve(null); };
            img.src = imageUrl;
        });
    }

    /**
     * 封面 crossfade：从旧封面平滑过渡到新封面
     * 使用 overlay 叠加层实现，避免 "先清后设" 的闪烁
     * @param {HTMLElement} coverEl - cd-audio-cover 元素
     * @param {string} newImageUrl - 新封面 URL
     */
    _crossfadeCover(coverEl, newImageUrl) {
        var that = this;
        var myEpoch = ++that._coverFadeEpoch; // 递增世代，旧 cleanup 自动失效

        // 清理上一次未完成的 crossfade（快速切歌场景）
        var pending = coverEl.querySelector('.cd-cover-fade');
        if (pending) {
            // 立即将 pending 的图片应用为封面背景
            var pImg = pending.style.backgroundImage;
            if (pImg) {
                coverEl.style.backgroundImage = pImg;
                coverEl.style.backgroundSize = 'cover';
                coverEl.style.backgroundPosition = 'center';
            } else {
                coverEl.style.backgroundImage = '';
            }
            coverEl.innerHTML = '';
            pending.remove();
        }

        // 相同图片，跳过动画
        if (coverEl.style.backgroundImage === 'url(' + newImageUrl + ')') return;

        // 无旧封面（首次加载），直接设置即可
        if (!coverEl.style.backgroundImage) {
            coverEl.style.backgroundImage = 'url(' + newImageUrl + ')';
            coverEl.style.backgroundSize = 'cover';
            coverEl.style.backgroundPosition = 'center';
            coverEl.innerHTML = '';
            return;
        }

        // 创建 overlay 叠加层，从透明渐变到不透明
        var overlay = document.createElement('div');
        overlay.className = 'cd-cover-fade';
        overlay.style.cssText = 'position:absolute;inset:0;border-radius:inherit;background-size:cover;background-position:center;opacity:0;transition:opacity 0.35s ease;pointer-events:none;z-index:2';
        overlay.style.backgroundImage = 'url(' + newImageUrl + ')';
        coverEl.appendChild(overlay);

        // 强制重排后启动过渡动画
        void overlay.offsetHeight;
        overlay.style.opacity = '1';

        var cleaned = false;
        var cleanup = function(e) {
            if (cleaned) return;
            if (myEpoch !== that._coverFadeEpoch) return; // 已被更新的 crossfade 取代，跳过
            cleaned = true;
            try { overlay.removeEventListener('transitionend', cleanup); } catch(x) {}
            // 动画结束：将新封面设为元素背景，移除 overlay
            coverEl.style.backgroundImage = 'url(' + newImageUrl + ')';
            coverEl.style.backgroundSize = 'cover';
            coverEl.style.backgroundPosition = 'center';
            coverEl.innerHTML = '';
            if (overlay.parentNode) overlay.remove();
            // 延迟释放旧 blob URL（此时新图已完全显示）
            if (that._pendingCoverBlobRevoke) {
                try { URL.revokeObjectURL(that._pendingCoverBlobRevoke); } catch(x) {}
                that._pendingCoverBlobRevoke = null;
            }
        };
        overlay.addEventListener('transitionend', cleanup);
        setTimeout(cleanup, 600); // 安全兜底
    }

    /**
     * 封面 crossfade：从旧封面平滑过渡到无封面状态（显示 🎵）
     * @param {HTMLElement} coverEl - cd-audio-cover 元素
     */
    _crossfadeToNoCover(coverEl) {
        var that = this;
        var myEpoch = ++that._coverFadeEpoch;

        // 清理 pending（释放 pending overlay 的 blob 背景，防止泄漏）
        var pending = coverEl.querySelector('.cd-cover-fade');
        if (pending) {
            var pImg = pending.style.backgroundImage;
            if (pImg && pImg.indexOf('blob:') !== -1) {
                try { URL.revokeObjectURL(pImg.replace(/^url\(["']?/, '').replace(/["']?\)$/, '')); } catch(x) {}
            }
            pending.remove();
        }

        // 已经无封面，跳过
        if (!coverEl.style.backgroundImage) return;

        // 创建 overlay：默认背景色 + 🎵，从透明渐变到不透明，遮住旧封面
        var overlay = document.createElement('div');
        overlay.className = 'cd-cover-fade';
        overlay.style.cssText = 'position:absolute;inset:0;border-radius:inherit;background:var(--b3-theme-surface,#f0f0f0);opacity:0;transition:opacity 0.3s ease;pointer-events:none;z-index:2;display:flex;align-items:center;justify-content:center;font-size:48px';
        overlay.textContent = '\uD83C\uDFB5'; // 🎵
        coverEl.appendChild(overlay);

        void overlay.offsetHeight;
        overlay.style.opacity = '1';

        var cleaned = false;
        var cleanup = function(e) {
            if (cleaned) return;
            if (myEpoch !== that._coverFadeEpoch) return;
            cleaned = true;
            try { overlay.removeEventListener('transitionend', cleanup); } catch(x) {}
            coverEl.style.backgroundImage = '';
            coverEl.style.backgroundSize = 'cover';
            coverEl.style.backgroundPosition = 'center';
            coverEl.innerHTML = '\uD83C\uDFB5'; // 🎵
            if (overlay.parentNode) overlay.remove();
            if (that._pendingCoverBlobRevoke) {
                try { URL.revokeObjectURL(that._pendingCoverBlobRevoke); } catch(x) {}
                that._pendingCoverBlobRevoke = null;
            }
        };
        overlay.addEventListener('transitionend', cleanup);
        setTimeout(cleanup, 500);
    }

    /**
     * 歌词背景 crossfade：平滑切换背景图/色
     * @param {HTMLElement} bgEl - cd-audio-lrc-bg 元素
     * @param {string|null} newImageUrl - 新背景 URL，null 表示使用柔和色
     */
    _crossfadeLrcBg(bgEl, newImageUrl) {
        var that = this;
        var myEpoch = ++that._lrcBgFadeEpoch;

        // 清理 pending（释放 pending overlay 的 blob 背景，防止泄漏）
        var pending = bgEl.querySelector('.cd-lrcbg-fade');
        if (pending) {
            var pImg = pending.style.backgroundImage;
            var pColor = pending.style.backgroundColor;
            if (pImg) {
                bgEl.style.backgroundImage = pImg;
                // 释放被覆盖的 blob URL
                if (pImg.indexOf('blob:') !== -1) {
                    try { URL.revokeObjectURL(pImg.replace(/^url\(["']?/, '').replace(/["']?\)$/, '')); } catch(x) {}
                }
            }
            if (pColor) bgEl.style.backgroundColor = pColor;
            pending.remove();
        }

        var hasImage = !!newImageUrl;

        // 创建 overlay
        var overlay = document.createElement('div');
        overlay.className = 'cd-lrcbg-fade';
        overlay.style.cssText = 'position:absolute;inset:0;border-radius:inherit;background-size:cover;background-position:center;opacity:0;transition:opacity 0.4s ease;pointer-events:none';
        if (hasImage) {
            overlay.style.backgroundImage = 'url(' + newImageUrl + ')';
        } else {
            overlay.style.backgroundColor = 'hsl(210, 35%, 88%)';
        }
        bgEl.appendChild(overlay);

        void overlay.offsetHeight;
        overlay.style.opacity = '1';

        var cleaned = false;
        var cleanup = function(e) {
            if (cleaned) return;
            if (myEpoch !== that._lrcBgFadeEpoch) return;
            cleaned = true;
            try { overlay.removeEventListener('transitionend', cleanup); } catch(x) {}
            if (hasImage) {
                bgEl.style.backgroundImage = 'url(' + newImageUrl + ')';
                bgEl.style.backgroundColor = '';
            } else {
                bgEl.style.backgroundImage = '';
                bgEl.style.backgroundColor = 'hsl(210, 35%, 88%)';
            }
            if (overlay.parentNode) overlay.remove();
            // 释放旧的模糊缩略图 blob
            if (that._pendingBlurBlobRevoke) {
                try { URL.revokeObjectURL(that._pendingBlurBlobRevoke); } catch(x) {}
                that._pendingBlurBlobRevoke = null;
            }
        };
        overlay.addEventListener('transitionend', cleanup);
        setTimeout(cleanup, 600);
    }

    /**
     * 播放上一首/下一首
     * @param {number} direction - -1 上一首，1 下一首
     * @param {boolean} fromEnded - 是否由 ended 事件触发（影响播放模式行为）
     */
    _playAudioPrevNext(direction, fromEnded) {
        var that = this;
        if (!that._audioPlaylist || that._audioPlaylist.length === 0) return;
        var len = that._audioPlaylist.length;

        // 单曲循环（mode=2）：歌曲结束时重新播放当前
        if (fromEnded && that._audioPlayMode === 2) {
            that._audioEl.currentTime = 0;
            that._audioEl.play().catch(function() {});
            return;
        }

        // 随机播放（mode=0）：下一首随机选（避免重复当前，仅1首时顺序循环）
        if (that._audioPlayMode === 0 && len > 1) {
            if (direction === 1) {
                // 优先使用预加载的索引，确保和预加载的封面/歌词一致
                if (that._preloadData && that._preloadData.nextIdx >= 0 && that._preloadData.nextIdx < len) {
                    that._audioIndex = that._preloadData.nextIdx;
                } else {
                    var newIdx;
                    do { newIdx = Math.floor(Math.random() * len); } while (newIdx === that._audioIndex);
                    that._audioIndex = newIdx;
                }
            } else {
                // 上一首：顺序回退
                that._audioIndex = (that._audioIndex - 1 + len) % len;
            }
        } else {
            // 列表循环(1) 或 单曲循环(2) 手动切歌：顺序切换
            that._audioIndex = (that._audioIndex + direction + len) % len;
        }
        var f = that._audioPlaylist[that._audioIndex];
        var audioPath = f.path || ((that.cachedPath && that.cachedPath.endsWith(that._sep) ? that.cachedPath : that.cachedPath + that._sep) + f.name);
        that._audioCurrentPath = audioPath;
        that._audioCurrentName = f.name;  // 单独存储文件名
        var fileUrl = that.toFileUrl(audioPath);
        that._audioEl.preload = 'metadata';
        that._audioShouldAutoPlay = true;
        var nameEl = document.getElementById('cd-audio-name');
        if (nameEl) nameEl.textContent = '🎵 ' + f.name;
        // 延迟显示 loading：本地文件 canplay 很快，不需要 loading；只有加载卡顿超过 80ms 才显示
        if (that._audioLoadTimer) clearTimeout(that._audioLoadTimer);
        that._audioLoadTimer = setTimeout(function() {
            that._updateAudioPlayBtn('loading');
        }, 80);
        setTimeout(function() {
            if (!that._audioEl) return;
            that._audioEl.src = fileUrl;
        }, 0);

        // 加载歌词和封面：优先使用预加载数据，瞬间切换
        var preloaded = that._preloadData && that._preloadData.path === audioPath;
        if (preloaded) {
            that._loadLrc(audioPath, that._preloadData);
        } else {
            that._loadLrc(audioPath);
        }

        // 清理预加载数据：如果预加载数据已用于当前封面（path 匹配），
        // 则不释放 blob URL（封面元素还在引用），交给 onunload 统一释放
        if (that._preloadData) {
            if (!preloaded) {
                if (that._preloadData.coverIsBlob && that._preloadData.coverUrl) {
                    URL.revokeObjectURL(that._preloadData.coverUrl);
                }
                if (that._preloadData.coverBlurUrl) {
                    URL.revokeObjectURL(that._preloadData.coverBlurUrl);
                }
            }
            that._preloadData = null;
        }
        // 延迟触发下一首预加载（让当前切歌的 UI 更新先完成）
        setTimeout(function() {
            that._preloadNext();
        }, 200);

        // 保存播放器状态
        that._audioPlayerClosed = false;
        that._saveAudioState(audioPath, f.name);
    }

    /**
     * 在文件列表中定位当前播放的音频文件并高亮
     * 支持跨文件夹：如果音频不在当前目录，会自动导航到音频所在目录
     */
    _locateAudioInList() {
        var that = this;
        var filePath = that._audioCurrentPath;
        if (!filePath) {
            that.showToastMsg('没有正在播放的音频');
            return;
        }

        // 优先使用单独存储的文件名（避免路径分隔符不匹配导致提取错误）
        var fileName = that._audioCurrentName;
        var dirPath = '';

        // 如果没有单独存储的文件名，则从路径中提取（兼容两种分隔符）
        if (!fileName) {
            var sep = that._sep;
            var lastSepIdx = filePath.lastIndexOf(sep);
            // 兼容：如果平台分隔符找不到，尝试另一种分隔符
            if (lastSepIdx < 0) {
                var altSep = (sep === '\\' || sep === '\\\\') ? '/' : '\\';
                var altIdx = filePath.lastIndexOf(altSep);
                if (altIdx > lastSepIdx) lastSepIdx = altIdx;
            }
            fileName = lastSepIdx >= 0 ? filePath.substring(lastSepIdx + 1) : filePath;
        }

        // 从路径中提取目录路径（兼容两种分隔符）
        var sep2 = that._sep;
        var dirSepIdx = filePath.lastIndexOf(sep2);
        if (dirSepIdx < 0) {
            var altSep2 = (sep2 === '\\' || sep2 === '\\\\') ? '/' : '\\';
            var altIdx2 = filePath.lastIndexOf(altSep2);
            if (altIdx2 > dirSepIdx) dirSepIdx = altIdx2;
        }
        dirPath = dirSepIdx >= 0 ? filePath.substring(0, dirSepIdx) : '';

        // 规范化目录路径用于比较（去末尾分隔符）
        var normalizeDir = function(p) {
            if (!p) return '';
            while (p.length > 1 && (p.endsWith('\\') || p.endsWith('/'))) {
                p = p.slice(0, -1);
            }
            return p;
        };

        var currentDir = normalizeDir(that.currentPath);
        var targetDir = normalizeDir(dirPath);

        that._log('_locateAudioInList: currentPath=', that.currentPath, 'filePath=', filePath, 'fileName=', fileName, 'currentDir=', currentDir, 'targetDir=', targetDir);

        // 如果当前不在音频所在目录，先导航过去
        if (targetDir && targetDir !== currentDir) {
            // 设置待定位标记，renderFiles 完成后会自动定位
            that._pendingLocateFileName = fileName;
            that.loadDirectory(targetDir);
            return;
        }

        // 当前已在目标目录，直接定位
        that._doLocateFile(fileName);
    }

    /**
     * 在当前文件列表中查找并高亮指定文件名
     * @param {string} fileName - 文件名
     * @param {number} [retryCount=0] - 当前重试次数
     */
    _doLocateFile(fileName, retryCount) {
        var that = this;
        retryCount = retryCount || 0;
        var fileListEl = document.getElementById('cd-file-list');
        if (!fileListEl) return;

        // 查找匹配的文件项
        var items = fileListEl.querySelectorAll('.cd-item[data-name]');
        var target = null;
        for (var i = 0; i < items.length; i++) {
            if (items[i].dataset.name === fileName) {
                target = items[i];
                break;
            }
        }

        if (!target) {
            // 分批渲染模式下，目标文件可能还没被渲染到 DOM 中
            var state = that.listRenderState;
            if (state && state.files && state.renderedCount < state.files.length) {
                var targetIdx = -1;
                for (var k = 0; k < state.files.length; k++) {
                    if (state.files[k].name === fileName) {
                        targetIdx = k;
                        break;
                    }
                }
                if (targetIdx >= 0) {
                    var neededBatch = Math.floor(targetIdx / state.batchSize) + 1;
                    var currentBatch = Math.ceil(state.renderedCount / state.batchSize);
                    if (currentBatch < neededBatch) {
                        that._log('_doLocateFile: batch render needed, currentBatch=' + currentBatch + ', neededBatch=' + neededBatch);
                        that.renderListBatch(fileListEl);
                        setTimeout(function() {
                            that._doLocateFile(fileName, retryCount);
                        }, 80);
                        return;
                    }
                }
            }

            // 列表可能还在渲染中（分批渲染或 DOM 未就绪），自动重试最多 5 次
            if (retryCount < 5) {
                that._log('_doLocateFile: not found, retry ' + (retryCount + 1) + '/5, fileName=', fileName, 'items=', items.length);
                setTimeout(function() {
                    that._doLocateFile(fileName, retryCount + 1);
                }, 200);
                return;
            }
            // 重试耗尽，输出详细诊断日志
            var names = [];
            for (var j = 0; j < Math.min(items.length, 20); j++) {
                names.push(items[j].dataset.name);
            }
            that._log('_doLocateFile: not found after retries, fileName=', fileName, 'items=', items.length, 'sample names=', names.join(', '));
            that.showToastMsg('未在当前列表中找到该音频');
            return;
        }

        that._log('_doLocateFile: found', fileName);

        // 滚动到目标元素
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });

        // 添加高亮效果
        target.style.background = 'var(--b3-theme-primary-lightest,rgba(66,133,244,0.15))';
        target.style.transition = 'background 0.3s';

        // 清除之前的高亮
        if (that._lastAudioHighlight) {
            that._lastAudioHighlight.style.background = '';
        }
        that._lastAudioHighlight = target;
    }

    /**
     * 绑定音频播放器事件（仅绑定一次）
     */
    _bindAudioEvents() {
        var that = this;
        if (that._audioEventsBound) return;  // 防止重复绑定
        that._audioEventsBound = true;

        var playBtn = document.getElementById('cd-audio-play');
        var prevBtn = document.getElementById('cd-audio-prev');
        var nextBtn = document.getElementById('cd-audio-next');
        var closeBtn = document.getElementById('cd-audio-close');
        var volInput = document.getElementById('cd-audio-vol');
        var volIcon = document.getElementById('cd-audio-vol-icon');
        var progressWrap = document.getElementById('cd-audio-progress-wrap');
        var lrcToggle = document.getElementById('cd-audio-lrc-toggle');
        var progressBar = document.getElementById('cd-audio-progress');
        var timeEl = document.getElementById('cd-audio-time');

        // 播放/暂停
        if (playBtn) {
            playBtn.addEventListener('click', function() {
                if (!that._audioEl) return;
                if (that._audioEl.paused) {
                    that._audioEl.play().catch(function() {});
                    that._updateAudioPlayBtn(true);
                } else {
                    that._audioEl.pause();
                    that._updateAudioPlayBtn(false);
                }
            });
        }

        // 点击歌曲名在文件列表中定位
        var nameEl = document.getElementById('cd-audio-name');
        if (nameEl) {
            nameEl.addEventListener('click', function() {
                that._locateAudioInList();
            });
        }

        // 上一首/下一首
        if (prevBtn) prevBtn.addEventListener('click', function() { that._playAudioPrevNext(-1); });
        if (nextBtn) nextBtn.addEventListener('click', function() { that._playAudioPrevNext(1); });

        // 播放模式切换
        var modeBtn = document.getElementById('cd-audio-mode');
        if (modeBtn) {
            // 初始化按钮显示
            that._updateModeBtn(modeBtn);
            modeBtn.addEventListener('click', function() {
                that._audioPlayMode = (that._audioPlayMode + 1) % 3;
                that._updateModeBtn(modeBtn);
                // 保存播放模式到 localStorage
                try { localStorage.setItem('cd_audio_mode', that._audioPlayMode); } catch (e) {}
            });
        }

        // 歌词面板展开/收起
        if (lrcToggle) {
            lrcToggle.addEventListener('click', function() {
                that._lrcExpanded = !that._lrcExpanded;
                var lrcPanel = document.getElementById('cd-audio-lrc-panel');
                if (lrcPanel) {
                    if (that._lrcExpanded) {
                        // 动态计算 bottom：音频栏 + 当前可见的底部统计栏的高度
                        var audioBar = document.getElementById('cd-audio-bar');
                        var statsBar = document.getElementById('cd-stats-bar');
                        var assetsStatsBar = document.getElementById('cd-assets-stats-bar');
                        var bottom = 4;  // 容器 padding
                        // 取当前可见的统计栏（offsetParent 不为 null 表示可见）
                        var activeStats = (statsBar && statsBar.offsetParent !== null) ? statsBar : assetsStatsBar;
                        if (activeStats) bottom += activeStats.offsetHeight;
                        if (audioBar) bottom += audioBar.offsetHeight;
                        lrcPanel.style.bottom = bottom + 'px';
                        lrcPanel.style.display = 'block';
                    } else {
                        lrcPanel.style.display = 'none';
                    }
                }
                lrcToggle.style.opacity = that._lrcExpanded ? '1' : '0.5';
            });
        }

        // 关闭播放器
        if (closeBtn) {
            closeBtn.addEventListener('click', function() {
                if (that._audioEl) {
                    that._audioEl.pause();
                    that._audioEl.src = '';
                }
                var audioBar = document.getElementById('cd-audio-bar');
                if (audioBar) audioBar.style.display = 'none';
                that._updateAudioPlayBtn(false);
                // 移除文件列表底部内边距
                var fileListEl = document.getElementById('cd-file-list');
                if (fileListEl) fileListEl.style.paddingBottom = '';
                var assetsListEl = document.getElementById('cd-assets-list');
                if (assetsListEl) assetsListEl.style.paddingBottom = '';
                // 收起歌词面板
                that._lrcExpanded = false;
                var lrcPanel = document.getElementById('cd-audio-lrc-panel');
                if (lrcPanel) lrcPanel.style.display = 'none';
                if (lrcToggle) lrcToggle.style.opacity = '0.5';
                // 标记用户手动关闭，下次启动不再恢复播放器
                that._audioPlayerClosed = true;
                that._audioCurrentName = null;
                that._saveAudioState(null, null);
            });
        }

        // 音量滑块
        if (volInput) {
            volInput.value = Math.round(that._savedVolume * 100);
            volInput.addEventListener('input', function() {
                var v = this.value / 100;
                if (that._audioEl) that._audioEl.volume = v;
                that._savedVolume = v;
                localStorage.setItem('cd_audio_volume', v);
                if (volIcon) volIcon.textContent = this.value == 0 ? '🔇' : (this.value < 50 ? '🔉' : '🔊');
            });
        }

        // 点击音量图标静音/恢复
        if (volIcon) {
            volIcon.addEventListener('click', function() {
                if (!that._audioEl) return;
                if (that._audioEl.volume > 0) {
                    that._audioEl._prevVol = that._audioEl.volume;
                    that._audioEl.volume = 0;
                    volInput.value = 0;
                    volIcon.textContent = '🔇';
                } else {
                    var restoredVol = that._audioEl._prevVol || that._savedVolume || 0.8;
                    that._audioEl.volume = restoredVol;
                    that._savedVolume = restoredVol;
                    localStorage.setItem('cd_audio_volume', restoredVol);
                    volInput.value = Math.round(restoredVol * 100);
                    volIcon.textContent = restoredVol < 0.5 ? '🔉' : '🔊';
                }
            });
        }

        // 进度条点击跳转
        if (progressWrap) {
            progressWrap.addEventListener('click', function(e) {
                if (!that._audioEl || !that._audioEl.duration) return;
                var rect = this.getBoundingClientRect();
                var ratio = (e.clientX - rect.left) / rect.width;
                ratio = Math.max(0, Math.min(1, ratio));
                that._audioEl.currentTime = ratio * that._audioEl.duration;
            });
        }

        // Audio 元素事件（仅首次创建时绑定，避免重复）
        var newAudio = false;
        if (!that._audioEl) {
            that._audioEl = new Audio();
            that._audioEl.volume = that._savedVolume;
            that._audioPlaylist = [];
            that._audioIndex = -1;
            newAudio = true;
        }

        if (newAudio) {
            that._audioEl.addEventListener('timeupdate', function() {
                if (!that._audioEl.duration) return;
                var pct = (that._audioEl.currentTime / that._audioEl.duration) * 100;
                if (progressBar) progressBar.style.width = pct + '%';
                if (timeEl) timeEl.textContent = that._formatAudioTime(that._audioEl.currentTime) + '/' + that._formatAudioTime(that._audioEl.duration);
                // 同步歌词高亮
                that._updateLrcHighlight(that._audioEl.currentTime);
            });

            // canplay：元数据加载完成，可以开始播放（解决网盘大文件阻塞 UI）
            that._audioEl.addEventListener('canplay', function() {
                if (!that._audioEl) return;
                // 取消延迟 loading（本地文件加载快，不需要显示 loading）
                if (that._audioLoadTimer) {
                    clearTimeout(that._audioLoadTimer);
                    that._audioLoadTimer = null;
                }
                // 仅当显式请求播放时才自动 play（恢复状态时不自动播放）
                if (that._audioShouldAutoPlay && that._audioEl.paused) {
                    that._audioShouldAutoPlay = false;
                    that._audioEl.play().catch(function(e) {
                        that._error('canplay auto-play failed:', e);
                    });
                }
                // 当前歌曲已就绪，后台预加载下一首
                that._preloadNext();
            });

            // waiting：网络缓冲中，显示加载状态
            that._audioEl.addEventListener('waiting', function() {
                if (that._audioLoadTimer) {
                    clearTimeout(that._audioLoadTimer);
                    that._audioLoadTimer = null;
                }
                that._updateAudioPlayBtn('loading');
            });

            // playing：开始播放，更新为暂停按钮
            that._audioEl.addEventListener('playing', function() {
                that._updateAudioPlayBtn(true);
            });

            that._audioEl.addEventListener('ended', function() {
                // 随机播放(0) / 列表循环(1) / 单曲循环(2) 统一由 _playAudioPrevNext 处理
                that._playAudioPrevNext(1, true);
            });

            that._audioEl.addEventListener('error', function() {
                that._error('Audio playback error');
                that._audioShouldAutoPlay = false;
                that._updateAudioPlayBtn(false);
            });
        }
    }

    /**
     * 保存音频播放器状态（双写：saveData 持久化 + localStorage 即时缓存）
     * 音频路径是设备相关的，不需要跨设备同步
     * @param {string|null} filePath - 音频文件路径，null 表示用户关闭了播放器
     * @param {string|null} fileName - 音频文件名
     */
    _saveAudioState(filePath, fileName) {
        var that = this;
        try {
            var key = 'cd_audio_state_' + this.platform;
            var data = filePath && fileName ? { path: filePath, name: fileName } : null;
            // localStorage 即时缓存（同步，_restoreAudioState 优先读取）
            if (data) {
                localStorage.setItem(key, JSON.stringify(data));
            } else {
                localStorage.removeItem(key);
            }
            // saveData 持久化到 data.json（异步，跨重启不丢失）
            if (typeof this.saveData === 'function') {
                this.saveData(key, data).catch(function(e) {
                    that._error('saveData audio state failed:', e);
                });
            }
        } catch (e) {
            this._error('save audio state error:', e);
        }
    }

    /**
     * 恢复音频播放器状态（localStorage 优先，降级到 loadData）
     * 如果上次用户没有关闭播放器，重新显示播放器（暂停状态）
     */
    _restoreAudioState() {
        var that = this;
        try {
            var key = 'cd_audio_state_' + this.platform;

            // 内部函数：根据保存的数据恢复播放器 UI
            var doRestore = function(savedPath, savedName) {
                if (!savedPath || !savedName) return;

                // 验证文件是否存在于当前设备（使用 _fsExists 保证跨平台一致性）
                that._fsExists(savedPath).then(function(exists) {
                    if (!exists) {
                        that._log('_restoreAudioState: file not exists, skip:', savedPath);
                        localStorage.removeItem(key);
                        return;
                    }

                    // 显示播放器（暂停状态）
                    var audioBar = document.getElementById('cd-audio-bar');
                    if (!audioBar) return;

                    // 创建/复用 Audio 元素
                    if (!that._audioEl) {
                        that._audioEl = new Audio();
                        that._audioEl.volume = that._savedVolume;
                    }

                    var fileUrl = that.toFileUrl(savedPath);
                    that._audioEl.preload = 'metadata';
                    // 不自动播放，暂停状态（_audioShouldAutoPlay 保持 false）
                    that._audioCurrentPath = savedPath;
                    that._audioCurrentName = savedName;  // 单独存储文件名，避免从路径二次提取
                    setTimeout(function() {
                        if (!that._audioEl) return;
                        that._audioEl.src = fileUrl;
                    }, 0);

                    audioBar.style.display = 'flex';
                    var nameEl = document.getElementById('cd-audio-name');
                    if (nameEl) nameEl.textContent = '🎵 ' + savedName;
                    that._updateAudioPlayBtn(false);

                    // 为文件列表添加底部内边距，避免最后一个条目紧贴播放器栏
                    var fileListEl = document.getElementById('cd-file-list');
                    if (fileListEl) fileListEl.style.paddingBottom = '44px';
                    var assetsListEl = document.getElementById('cd-assets-list');
                    if (assetsListEl) assetsListEl.style.paddingBottom = '44px';

                    // 加载歌词（不播放也能看歌词）
                    that._loadLrc(savedPath);

                    // 异步构建播放列表（从音频所在目录读取）
                    that._buildAudioPlaylist(savedPath, savedName);

                    that._log('_restoreAudioState: restored', savedName);
                }).catch(function(e) {
                    that._error('_restoreAudioState: _fsExists check failed:', e);
                });
            };

            // 优先从 localStorage 读取（同步，速度快）
            var saved = localStorage.getItem(key);
            if (saved) {
                var parsed = JSON.parse(saved);
                doRestore(parsed.path, parsed.name);
                return;
            }

            // localStorage 没有数据，尝试从 loadData 读取（重启后 localStorage 可能被清空）
            if (typeof this.loadData === 'function') {
                this.loadData(key).then(function(data) {
                    if (data && data.path && data.name) {
                        // 回写 localStorage 缓存，下次启动更快
                        try { localStorage.setItem(key, JSON.stringify(data)); } catch (e) {}
                        doRestore(data.path, data.name);
                    }
                }).catch(function() {
                    // 没有保存过数据，忽略
                });
            }
        } catch (e) {
            that._error('_restoreAudioState error:', e);
        }
    }

    /**
     * 从音频文件所在目录构建播放列表
     * @param {string} audioPath - 音频文件完整路径
     * @param {string} audioName - 音频文件名
     */
    _buildAudioPlaylist(audioPath, audioName) {
        var that = this;
        var sep = that._sep;
        var lastSep = audioPath.lastIndexOf(sep);
        // 兼容：如果平台分隔符找不到，尝试另一种分隔符
        if (lastSep < 0) {
            var altSep = (sep === '\\' || sep === '\\\\') ? '/' : '\\';
            var altIdx = audioPath.lastIndexOf(altSep);
            if (altIdx > lastSep) lastSep = altIdx;
        }
        var dirPath = lastSep >= 0 ? audioPath.substring(0, lastSep + 1) : '';

        if (!dirPath || !fs || !fs.readdir) return;

        // 递增版本号，旧回调检测到版本过时则丢弃结果（防止异步竞态覆盖）
        that._playlistBuildSeq++;
        var mySeq = that._playlistBuildSeq;

        try {
            fs.readdir(dirPath, { withFileTypes: true }, function(err, entries) {
                if (mySeq !== that._playlistBuildSeq) return; // 版本过时，丢弃结果
                if (err || !entries) return;
                var audioFiles = [];
                for (var i = 0; i < entries.length; i++) {
                    var e = entries[i];
                    if (e.isFile() && that.isAudioFile(e.name)) {
                        audioFiles.push({
                            name: e.name,
                            isDir: false,
                            path: dirPath + e.name
                        });
                    }
                }
                that._audioPlaylist = audioFiles;
                // 找到当前文件在播放列表中的索引
                var idx = -1;
                for (var j = 0; j < audioFiles.length; j++) {
                    if (audioFiles[j].name === audioName) {
                        idx = j;
                        break;
                    }
                }
                that._audioIndex = idx >= 0 ? idx : 0;
            });
        } catch (e) {
            that._error('_buildAudioPlaylist error:', e);
        }
    }

    /**
     * 解析 LRC 歌词文本
     * 支持格式：[mm:ss.xx] 或 [mm:ss.xxx] 或 [mm:ss]
     * @param {string} text - LRC 原始文本
     * @returns {Array<{time:number, text:string}>} 按时间排序的歌词行
     */
    _parseLrc(text) {
        var lines = text.split('\n');
        var result = [];
        // 匹配时间标签 [mm:ss.xx] 或 [mm:ss]
        var timeReg = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g;
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (!line) continue;
            var times = [];
            var match;
            timeReg.lastIndex = 0;
            while ((match = timeReg.exec(line)) !== null) {
                var min = parseInt(match[1], 10);
                var sec = parseInt(match[2], 10);
                var ms = match[3] ? parseInt(match[3], 10) : 0;
                // 补齐毫秒位数：.xx → x0, .xxx → xxx
                if (match[3] && match[3].length === 2) ms = ms * 10;
                if (match[3] && match[3].length === 1) ms = ms * 100;
                var t = min * 60 + sec + ms / 1000;
                times.push(t);
            }
            // 提取歌词文本（去掉所有时间标签）
            var lyricText = line.replace(/\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]/g, '').trim();
            if (!lyricText) continue;  // 纯时间标签行跳过
            // 一行多个时间标签 → 拆成多条
            for (var j = 0; j < times.length; j++) {
                result.push({ time: times[j], text: lyricText });
            }
        }
        // 按时间排序
        result.sort(function(a, b) { return a.time - b.time; });
        return result;
    }

    /**
     * 加载歌词文件和封面
     * 查找与音频文件同名的 .lrc 文件，解析并渲染歌词面板
     * @param {string} audioPath - 音频文件完整路径
     */
    _loadLrc(audioPath, preloaded) {
        var that = this;
        that._lrcLines = [];
        that._lrcActiveIndex = -1;

        // 加载封面：优先使用预加载封面
        if (preloaded && preloaded.coverUrl) {
            that._loadCoverArt(audioPath, preloaded.coverUrl, preloaded.coverBlurUrl || null);
        } else {
            that._loadCoverArt(audioPath);
        }

        // 歌词：优先使用预加载歌词
        if (preloaded && preloaded.lrcLines) {
            that._lrcLines = preloaded.lrcLines;
            that._renderLrcPanel(preloaded.lrcLines);
            return;
        }

        var lrcPath = audioPath.replace(/\.[^.]+$/, '.lrc');
        that._fsReadFile(lrcPath, 'utf-8').then(function(content) {
            // 竞态保护：用户已切到其他歌曲，跳过
            if (that._audioCurrentPath !== audioPath) return;
            if (!content) {
                that._renderLrcPanel([]);
                return;
            }
            var lines = that._parseLrc(content);
            that._lrcLines = lines;
            that._renderLrcPanel(lines);
        }).catch(function() {
            // 找不到 .lrc 文件，显示提示
            if (that._audioCurrentPath !== audioPath) return;
            that._renderLrcPanel([]);
        });
    }

    /**
     * 渲染歌词面板
     * @param {Array<{time:number, text:string}>} lines - 歌词行
     */
    _renderLrcPanel(lines) {
        var that = this;

        // 注入隐藏滚动条样式（仅一次）
        if (!document.getElementById('cd-lrc-scrollbar-style')) {
            var style = document.createElement('style');
            style.id = 'cd-lrc-scrollbar-style';
            style.textContent = '#cd-audio-lrc-content::-webkit-scrollbar{display:none}';
            document.head.appendChild(style);
        }

        var lrcContent = document.getElementById('cd-audio-lrc-content');
        if (!lrcContent) return;

        // 更新"词"按钮状态：有歌词高亮，无歌词暗淡
        var lrcToggle = document.getElementById('cd-audio-lrc-toggle');
        if (lrcToggle) {
            if (lines && lines.length > 0) {
                lrcToggle.style.opacity = '1';
                lrcToggle.style.color = 'var(--b3-theme-primary,#4285f4)';
                lrcToggle.style.fontWeight = '600';
                lrcToggle.title = '歌词 (' + lines.length + '行)';
            } else {
                lrcToggle.style.opacity = '0.35';
                lrcToggle.style.color = 'inherit';
                lrcToggle.style.fontWeight = 'normal';
                lrcToggle.title = '歌词 (无)';
            }
        }

        if (!lines || lines.length === 0) {
            var emptyFrag = document.createDocumentFragment();
            var emptyDiv = document.createElement('div');
            emptyDiv.style.cssText = 'padding:16px 0;color:var(--b3-theme-secondary,#999);opacity:0.6';
            emptyDiv.textContent = '暂无歌词';
            emptyFrag.appendChild(emptyDiv);
            lrcContent.replaceChildren(emptyFrag);
            return;
        }

        // 用 DocumentFragment 原子替换歌词内容，避免 innerHTML 导致闪烁
        var fragment = document.createDocumentFragment();
        for (var i = 0; i < lines.length; i++) {
            var div = document.createElement('div');
            div.className = 'cd-lrc-line';
            div.setAttribute('data-lrc-idx', i);
            div.style.cssText = 'padding:1px 4px;cursor:pointer;transition:color 0.3s,font-weight 0.3s,transform 0.3s;font-size:12px;color:var(--b3-theme-secondary,#999)';
            div.textContent = lines[i].text; // textContent 自动转义，无需 _escapeHtml
            fragment.appendChild(div);
        }
        lrcContent.replaceChildren(fragment);

        // 切歌后重置滚动到顶部，避免旧滚动位置 + scroll-behavior:smooth 产生上滚动画
        lrcContent.scrollTop = 0;

        // 点击歌词行跳转（必须从 lrcContent 获取，replaceChildren 已将 fragment 子节点移入 lrcContent）
        var lrcDivs = lrcContent.querySelectorAll('.cd-lrc-line');
        for (var j = 0; j < lrcDivs.length && j < lines.length; j++) {
            (function(div, idx) {
                div.addEventListener('click', function() {
                    if (!that._audioEl) return;
                    if (idx >= 0 && idx < that._lrcLines.length) {
                        that._audioEl.currentTime = that._lrcLines[idx].time;
                    }
                });
            })(lrcDivs[j], j);
        }
    }

    /**
     * HTML 转义
     */
    _escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    /**
     * 更新歌词面板背景：有封面用封面图做模糊背景，无封面用随机柔和色
     * @param {string} source - 封面 URL，传空/null 则使用随机柔和色
     * @param {boolean} forceClear - 是否强制清除旧背景（切到无封面歌曲时使用）
     */
    _updateLrcBg(source, forceClear) {
        var bgEl = document.getElementById('cd-audio-lrc-bg');
        if (!bgEl) return;

        // 判断是否需要触发 crossfade
        var willCrossfade = false;
        if (source) {
            willCrossfade = true;
        } else if (forceClear) {
            willCrossfade = true;
        } else if (!bgEl.style.backgroundImage && !bgEl.style.backgroundColor) {
            willCrossfade = true;
        }

        // 仅在确定触发 crossfade 时才保存旧 blob URL（由 crossfade cleanup 负责释放）
        // 必须在 _crossfadeLrcBg 调用之前设置，因为 cleanup 读取 _pendingBlurBlobRevoke
        if (willCrossfade) {
            var oldBg = bgEl.style.backgroundImage;
            if (oldBg && oldBg.indexOf('blob:') !== -1) {
                this._pendingBlurBlobRevoke = oldBg.replace(/^url\(["']?/, '').replace(/["']?\)$/, '');
            }
        }

        if (source) {
            this._crossfadeLrcBg(bgEl, source);
        } else if (forceClear) {
            this._crossfadeLrcBg(bgEl, null);
        } else if (willCrossfade) {
            this._crossfadeLrcBg(bgEl, null);
        }
    }

    /**
     * 加载封面图
     * 优先查找同目录封面文件，再提取 MP3 内嵌封面
     * @param {string} audioPath - 音频文件完整路径
     */
    _loadCoverArt(audioPath, preloadedCoverUrl, preloadedBlurUrl) {
        var that = this;
        var coverEl = document.getElementById('cd-audio-cover');
        if (!coverEl) return;

        // 延迟释放旧 blob URL：不立即 revoke，等 crossfade 完成后再释放
        // （旧图片在 crossfade 过渡期间仍需显示）
        var oldBg = coverEl.style.backgroundImage;
        if (oldBg && oldBg.indexOf('blob:') !== -1) {
            that._pendingCoverBlobRevoke = oldBg.replace(/^url\(["']?/, '').replace(/["']?\)$/, '');
        }

        // 如果有预加载封面，crossfade 过渡
        if (preloadedCoverUrl) {
            that._crossfadeCover(coverEl, preloadedCoverUrl);
            that._updateLrcBg(preloadedBlurUrl || null);
            // 如果模糊缩略图还没准备好，立即触发生成
            if (!preloadedBlurUrl && preloadedCoverUrl) {
                that._createBlurThumb(preloadedCoverUrl).then(function(blurUrl) {
                    if (blurUrl) that._updateLrcBg(blurUrl);
                });
            }
            return;
        }

        // 切歌时不立即清空封面/背景，保持旧内容直到新封面加载完成
        // 避免异步加载期间出现“闪一下”的空白/随机色
        var hadCover = !!coverEl.style.backgroundImage;

        // 获取音频文件所在目录
        var lastSep = audioPath.replace(/\\/g, '/').lastIndexOf('/');
        var dir = lastSep >= 0 ? audioPath.substring(0, lastSep) : '';

        // 常见封面文件名
        var coverNames = ['cover.jpg', 'cover.png', 'folder.jpg', 'folder.png',
            'album.jpg', 'album.png', 'front.jpg', 'front.png',
            'Cover.jpg', 'Cover.png', 'Folder.jpg', 'Folder.png'];

        // 逐个尝试查找封面文件
        var tryIndex = 0;
        function tryNextCover() {
            if (tryIndex >= coverNames.length) {
                // 目录封面没找到，尝试从 MP3 内嵌提取
                that._extractMp3Cover(audioPath, hadCover);
                return;
            }
            var coverPath = dir + that._sep + coverNames[tryIndex];
            tryIndex++;
            that._fsExists(coverPath).then(function(exists) {
                if (exists && that._audioCurrentPath === audioPath) {
                    var coverUrl = that.toFileUrl(coverPath);
                    that._crossfadeCover(coverEl, coverUrl);
                    // 先设柔和蓝背景，异步生成模糊缩略图后再替换
                    that._updateLrcBg(null);
                    that._createBlurThumb(coverUrl).then(function(blurUrl) {
                        if (blurUrl && that._audioCurrentPath === audioPath) that._updateLrcBg(blurUrl);
                    });
                } else if (!exists) {
                    tryNextCover();
                }
            }).catch(function() {
                tryNextCover();
            });
        }
        tryNextCover();
    }

    /**
     * 从 MP3 文件提取内嵌封面（ID3v2 APIC 帧）
     * @param {string} filePath - MP3 文件路径
     */
    _extractMp3Cover(filePath, keepOld) {
        var that = this;
        var ext = filePath.split('.').pop().toLowerCase();
        if (ext !== 'mp3') {
            // 非 MP3 文件，没有内嵌封面机制，保留旧封面（保持视觉连续性）
            return;
        }

        var coverEl = document.getElementById('cd-audio-cover');
        if (!coverEl) return;
        // 注意：切歌时不要检查 backgroundImage 来跳过！
        // 上一首歌的封面不应阻止当前歌提取新封面

        // 仅读取前 256KB（ID3v2 标签通常在文件头部）
        that._fsReadFile(filePath, null, 262144).then(function(buf) {
            // 竞态保护：用户已切到其他歌曲，跳过
            if (that._audioCurrentPath !== filePath) return;

            if (!buf) {
                that._crossfadeToNoCover(coverEl);
                that._updateLrcBg(null, true);
                return;
            }
            // 兼容 Node.js Buffer 和浏览器 ArrayBuffer
            var bytes;
            if (buf instanceof ArrayBuffer) {
                bytes = new Uint8Array(buf);
            } else if (buf.length !== undefined) {
                // 直接用 Buffer 创建 Uint8Array（Buffer 继承自 Uint8Array）
                bytes = new Uint8Array(buf);
            } else {
                that._crossfadeToNoCover(coverEl);
                that._updateLrcBg(null, true);
                return;
            }

            // 检查 ID3v2 头部
            if (bytes.length < 10 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) {
                that._crossfadeToNoCover(coverEl);
                that._updateLrcBg(null, true);
                return;
            }

            // 读取 ID3v2 标签总大小（syncsafe integer）
            var tagSize = ((bytes[6] & 0x7F) << 21) | ((bytes[7] & 0x7F) << 14) | ((bytes[8] & 0x7F) << 7) | (bytes[9] & 0x7F);
            var pos = 10;

            // 遍历帧，查找 APIC
            while (pos < Math.min(tagSize + 10, bytes.length) - 10) {
                if (pos + 10 > bytes.length) break;
                var frameId = String.fromCharCode(bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]);
                var frameSize = (bytes[pos + 4] << 24) | (bytes[pos + 5] << 16) | (bytes[pos + 6] << 8) | bytes[pos + 7];
                if (frameSize <= 0 || pos + 10 + frameSize > bytes.length) break;

                if (frameId === 'APIC') {
                    var frameData = bytes.subarray(pos + 10, pos + 10 + frameSize);
                    var encoding = frameData[0];
                    // 找 MIME 类型（null-terminated）
                    var mimeEnd = 1;
                    while (mimeEnd < frameData.length && frameData[mimeEnd] !== 0) mimeEnd++;
                    var mime = '';
                    for (var m = 1; m < mimeEnd; m++) mime += String.fromCharCode(frameData[m]);

                    // 跳过 picture type (1 byte) 和 description（null-terminated）
                    var descStart = mimeEnd + 2;  // +1 null, +1 picture type
                    if (encoding === 1 || encoding === 2) {
                        // UTF-16 描述：找双零终止
                        while (descStart < frameData.length - 1) {
                            if (frameData[descStart] === 0 && frameData[descStart + 1] === 0) {
                                descStart += 2;
                                break;
                            }
                            descStart++;
                        }
                    } else {
                        // Latin-1/UTF-8 描述：找单零终止
                        while (descStart < frameData.length && frameData[descStart] !== 0) descStart++;
                        descStart++;  // 跳过 null
                    }

                    if (descStart >= frameData.length) break;

                    // 提取图片数据
                    var imgData = frameData.subarray(descStart);
                    var blob = new Blob([imgData], { type: mime || 'image/jpeg' });
                    var url = URL.createObjectURL(blob);
                    that._crossfadeCover(coverEl, url);
                    // 异步生成模糊缩略图后再替换歌词背景
                    that._updateLrcBg(null);
                    that._createBlurThumb(url).then(function(blurUrl) {
                        if (blurUrl) that._updateLrcBg(blurUrl);
                    });
                    return;
                }
                pos += 10 + frameSize;
            }
            // 遍历完所有帧都没找到 APIC，平滑过渡到无封面
            that._crossfadeToNoCover(coverEl);
            that._updateLrcBg(null, true);
        }).catch(function() {
            // 提取失败，平滑过渡到无封面
            that._crossfadeToNoCover(coverEl);
            that._updateLrcBg(null, true);
        });
    }

    /**
     * 同步歌词高亮
     * @param {number} currentTime - 当前播放时间（秒）
     */
    _updateLrcHighlight(currentTime) {
        var that = this;
        var lines = that._lrcLines;
        if (!lines || lines.length === 0) return;

        // 二分查找当前时间对应的歌词行
        var lo = 0, hi = lines.length - 1, idx = -1;
        while (lo <= hi) {
            var mid = Math.floor((lo + hi) / 2);
            if (lines[mid].time <= currentTime) {
                idx = mid;
                lo = mid + 1;
            } else {
                hi = mid - 1;
            }
        }

        if (idx === that._lrcActiveIndex) return;  // 没变则不更新
        that._lrcActiveIndex = idx;

        // 更新高亮样式（用 transform 代替 fontSize 避免重排卡顿）
        var lrcContent = document.getElementById('cd-audio-lrc-content');
        if (!lrcContent) return;
        var allLines = lrcContent.querySelectorAll('.cd-lrc-line');
        for (var i = 0; i < allLines.length; i++) {
            if (i === idx) {
                allLines[i].style.color = 'var(--b3-theme-primary,#4285f4)';
                allLines[i].style.fontWeight = '700';
                allLines[i].style.transform = 'scale(1.2)';
            } else {
                allLines[i].style.color = '';
                allLines[i].style.fontWeight = '';
                allLines[i].style.transform = 'scale(1)';
            }
        }

        // 自动滚动到当前行
        if (idx >= 0 && idx < allLines.length) {
            var lineEl = allLines[idx];
            var panelH = lrcContent.clientHeight;
            var lineTop = lineEl.offsetTop;
            var lineH = lineEl.clientHeight;
            lrcContent.scrollTop = lineTop - panelH / 2 + lineH / 2;
        }
    }


    /**
     * 显示图片悬浮预览
     * 优化：使用 Canvas 缩放只显示缩小版本，避免加载全尺寸原图
     */
    showImagePreview(filePath, fileName, fileSize, fileMtime) {
        var that = this;
        var previewEl = document.getElementById('cd-image-preview');
        var imgEl = document.getElementById('cd-preview-img');
        if (!previewEl || !imgEl) return;

        var PREVIEW_W = 560;
        var PREVIEW_H = 480;
        var fileUrl = that.toFileUrl(filePath);

        // 使用 createImageBitmap 异步解码 + Canvas 缩放，避免全尺寸图片阻塞主线程
        var loadAndScale = function() {
            return new Promise(function(resolve) {
                var img = new Image();
                img.onload = function() {
                    // 计算缩放比例，保持纵横比
                    var scale = Math.min(PREVIEW_W / img.naturalWidth, PREVIEW_H / img.naturalHeight, 1);
                    var w = Math.round(img.naturalWidth * scale);
                    var h = Math.round(img.naturalHeight * scale);
                    var canvas = document.createElement('canvas');
                    canvas.width = w;
                    canvas.height = h;
                    var ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, w, h);
                    resolve(canvas.toDataURL('image/jpeg', 0.85));
                };
                img.onerror = function() { resolve(fileUrl); }; // 降级到原始 URL
                img.src = fileUrl;
            });
        };

        // 取消上一次的预览加载
        if (that._previewAbortController) {
            that._previewAbortController.abort();
        }
        var abortCtrl = new AbortController();
        that._previewAbortController = abortCtrl;

        // 先显示占位背景，立刻出界面
        imgEl.src = '';

        loadAndScale().then(function(dataUrl) {
            // 使用闭包捕获的 abortCtrl 确保取消检查正确
            if (abortCtrl.signal.aborted) return;
            imgEl.src = dataUrl;
        });

        // 设置文件名（带上文件大小）
        var nameEl = document.getElementById('cd-preview-name');
        if (nameEl) {
            var displayText = fileName || '';
            if (fileSize) {
                displayText += ' <span style="color:var(--b3-theme-secondary,#999);font-size:11px">(' + that.formatSize(fileSize) + ')</span>';
            }
            nameEl.innerHTML = displayText;
        }

        // 设置修改时间（先显示文件修改时间，异步读取 EXIF 拍摄时间后替换）
        var timeEl = document.getElementById('cd-preview-time');
        if (timeEl) {
            if (fileMtime) {
                timeEl.textContent = that.formatTime(fileMtime);
            } else {
                timeEl.textContent = '';
            }
        }

        // 异步读取 EXIF 拍摄时间，有则替换显示
        that._previewExifPath = filePath; // 标记当前预览文件，避免异步回调错位
        that.readExifData(filePath, function(exifResult) {
            // 确保回调时仍在预览同一文件
            if (!exifResult || that._previewExifPath !== filePath) return;
            if (exifResult.dateTime) {
                var tEl = document.getElementById('cd-preview-time');
                if (tEl) {
                    tEl.textContent = '📷 ' + exifResult.dateTime;
                }
            }
        });

        // 定位：显示在鼠标右侧，垂直方向跟随鼠标
        var winW = window.innerWidth;
        var winH = window.innerHeight;

        var mx = that._previewMousePos ? that._previewMousePos.x : 0;
        var my = that._previewMousePos ? that._previewMousePos.y : 0;

        var left = mx + 16;
        var top = my - PREVIEW_H / 2 + 20;

        if (left + PREVIEW_W > winW) {
            left = mx - PREVIEW_W - 2;
        }
        if (top + PREVIEW_H > winH) {
            top = winH - PREVIEW_H - 8;
        }
        if (top < 0) top = 8;
        if (left < 0) left = 8;

        previewEl.style.left = left + 'px';
        previewEl.style.top = top + 'px';
        previewEl.style.display = 'block';
    }

    /**
     * 隐藏图片悬浮预览
     */
    hideImagePreview() {
        var previewEl = document.getElementById('cd-image-preview');
        if (previewEl) {
            previewEl.style.display = 'none';
        }
        var imgEl = document.getElementById('cd-preview-img');
        if (imgEl) imgEl.src = '';
        var nameEl = document.getElementById('cd-preview-name');
        if (nameEl) nameEl.textContent = '';
        var timeEl = document.getElementById('cd-preview-time');
        if (timeEl) timeEl.textContent = '';
        // 取消还在进行的预览加载
        if (this._previewAbortController) {
            this._previewAbortController.abort();
            this._previewAbortController = null;
        }
    }

    /**
     * 更新排序按钮显示文本
     */
    updateSortButton(btn) {
        var labels = { name: '名称', size: '大小', mtime: '修改时间' };
        var arrow = this.sortOrder === 'asc' ? '↑' : '↓';
        btn.textContent = arrow + ' ' + (labels[this.sortBy] || '名称');
    }

    showSortMenu(anchorBtn) {
        var that = this;
        var menu = document.getElementById('cd-sort-menu');
        if (menu) menu.remove();

        menu = document.createElement('div');
        menu.id = 'cd-sort-menu';
        menu.style.cssText = 'position:fixed;z-index:9999;background:var(--b3-theme-background,#fff);border:1px solid var(--b3-border,#ddd);border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,0.15);padding:4px 0;font-size:13px;user-select:none;min-width:140px';

        var options = [
            { key: 'name', label: '按名称' },
            { key: 'size', label: '按大小' },
            { key: 'mtime', label: '按修改时间' }
        ];

        options.forEach(function(opt) {
            var item = document.createElement('div');
            var isActive = that.sortBy === opt.key;
            item.style.cssText = 'padding:6px 14px;cursor:pointer;transition:background 0.15s;display:flex;align-items:center;justify-content:space-between';
            item.innerHTML = '<span>' + opt.label + '</span>' + (isActive ? '<span style="color:var(--b3-theme-primary,#4285f4)">✓</span>' : '');
            item.addEventListener('mouseenter', function() { this.style.background = 'var(--b3-theme-hover,#e3f2fd)'; });
            item.addEventListener('mouseleave', function() { this.style.background = ''; });
            item.addEventListener('click', function(e) {
                e.stopPropagation();
                if (that.sortBy === opt.key) {
                    // 再次点击同一项，切换升序/降序
                    that.sortOrder = (that.sortOrder === 'asc') ? 'desc' : 'asc';
                } else {
                    that.sortBy = opt.key;
                    that.sortOrder = 'asc';
                }
                that.updateSortButton(anchorBtn);
                that.saveSortSettings();
                menu.remove();
                // 重新渲染当前目录
                if (that.cachedFiles.length && that.cachedPath) {
                    var filtered = that.cachedFiles.slice();
                    var searchInput = document.getElementById('cd-search');
                    var query = searchInput ? searchInput.value.trim() : '';
                    if (query) {
                        var keywords = query.toLowerCase().split(/\s+/).filter(function(k) { return k.length > 0; });
                        filtered = filtered.filter(function(f) {
                            var nameLower = f.name.toLowerCase();
                            for (var ki = 0; ki < keywords.length; ki++) {
                                if (nameLower.indexOf(keywords[ki]) === -1) return false;
                            }
                            return true;
                        });
                    }
                    filtered = that.sortFiles(filtered);
                    that.doRender(filtered, that.cachedPath, query, that.isDeepSearchMode);
                }
            });
            menu.appendChild(item);
        });

        // 分隔线
        var sep = document.createElement('div');
        sep.style.cssText = 'margin:4px 0;border-top:1px solid var(--b3-border,#eee)';
        menu.appendChild(sep);

        // 升序/降序切换
        var orderItem = document.createElement('div');
        orderItem.style.cssText = 'padding:6px 14px;cursor:pointer;transition:background 0.15s';
        orderItem.textContent = that.sortOrder === 'asc' ? '当前：升序 ↑' : '当前：降序 ↓';
        orderItem.addEventListener('mouseenter', function() { this.style.background = 'var(--b3-theme-hover,#e3f2fd)'; });
        orderItem.addEventListener('mouseleave', function() { this.style.background = ''; });
        orderItem.addEventListener('click', function(e) {
            e.stopPropagation();
            that.sortOrder = (that.sortOrder === 'asc') ? 'desc' : 'asc';
            that.updateSortButton(anchorBtn);
            that.saveSortSettings();
            menu.remove();
            if (that.cachedFiles.length && that.cachedPath) {
                var filtered = that.cachedFiles.slice();
                var searchInput = document.getElementById('cd-search');
                var query = searchInput ? searchInput.value.trim() : '';
                if (query) {
                    var lowerQuery = query.toLowerCase();
                    filtered = filtered.filter(function(f) {
                        return f.name.toLowerCase().indexOf(lowerQuery) !== -1;
                    });
                }
                filtered = that.sortFiles(filtered);
                that.doRender(filtered, that.cachedPath, query, that.isDeepSearchMode);
            }
        });
        menu.appendChild(orderItem);

        document.body.appendChild(menu);

        var rect = anchorBtn.getBoundingClientRect();
        menu.style.left = rect.left + 'px';
        menu.style.top = (rect.bottom + 4) + 'px';

        // 点击外部关闭菜单
        var closeMenu = function(e) {
            if (!menu.contains(e.target)) {
                menu.remove();
                document.removeEventListener('click', closeMenu);
                that._sortMenuClickHandler = null;
            }
        };
        this._sortMenuClickHandler = closeMenu;
        setTimeout(function() {
            document.addEventListener('click', closeMenu);
        }, 0);
    }

    /**
     * 从 data.json 加载排序设置
     */
    loadSortSettings() {
        var that = this;
        try {
            if (typeof this.loadData === 'function') {
                this.loadData('sortSettings').then(function(data) {
                    if (data && typeof data === 'object') {
                        if (data.sortBy) that.sortBy = data.sortBy;
                        if (data.sortOrder) that.sortOrder = data.sortOrder;
                    }
                    // DOM 已就绪时更新排序按钮文本
                    var btn = document.getElementById('cd-sort-btn');
                    if (btn) that.updateSortButton(btn);
                }).catch(function() {
                    // 忽略加载失败，使用默认值
                });
            } else {
                var saved = localStorage.getItem('cd_sort_settings');
                if (saved) {
                    var parsed = JSON.parse(saved);
                    if (parsed.sortBy) that.sortBy = parsed.sortBy;
                    if (parsed.sortOrder) that.sortOrder = parsed.sortOrder;
                }
                var btn = document.getElementById('cd-sort-btn');
                if (btn) that.updateSortButton(btn);
            }
        } catch (e) {
            // 忽略错误
        }
    }

    /**
     * 保存排序设置到 data.json
     */
    saveSortSettings() {
        var that = this;
        try {
            var data = { sortBy: this.sortBy, sortOrder: this.sortOrder };
            if (typeof this.saveData === 'function') {
                this.saveData('sortSettings', data).catch(function(e) {
                    that._error('save sort settings failed:', e);
                });
            } else {
                localStorage.setItem('cd_sort_settings', JSON.stringify(data));
            }
        } catch (e) {
            that._error('save sort settings error:', e);
        }
    }

    /**
     * 从 data.json 加载盘符设置
     */
    loadDriveSettings() {
        var that = this;
        try {
            if (typeof this.loadData === 'function') {
                this.loadData('driveSettings').then(function(data) {
                    if (data && typeof data === 'object' && data.driveLetter) {
                        // 校验盘符在当前设备上是否存在（防止跨设备同步来的无效盘符）
                        var dl = data.driveLetter;
                        var isValid = false;
                        if (that.isWindows) {
                            // Windows: 盘符字母，校验盘符是否存在
                            if (fs && fs.existsSync) {
                                isValid = fs.existsSync(dl + ':\\');
                            }
                        } else {
                            // macOS/Linux: 完整路径，校验路径是否存在
                            if (fs && fs.existsSync) {
                                isValid = fs.existsSync(dl);
                            }
                        }
                        if (isValid) {
                            that.driveLetter = dl;
                        }
                    }
                }).catch(function() {
                    // 忽略加载失败
                });
            } else {
                var saved = localStorage.getItem('cd_drive_settings');
                if (saved) {
                    var parsed = JSON.parse(saved);
                    if (parsed.driveLetter) {
                        // localStorage 降级也需要校验盘符是否存在（硬件变更等情况）
                        var dl = parsed.driveLetter;
                        var isValid = false;
                        if (this.isWindows) {
                            if (fs && fs.existsSync) {
                                isValid = fs.existsSync(dl + ':\\');
                            }
                        } else {
                            if (fs && fs.existsSync) {
                                isValid = fs.existsSync(dl);
                            }
                        }
                        if (isValid) {
                            this.driveLetter = dl;
                        }
                    }
                }
            }
        } catch (e) {
            // 忽略错误
        }
    }

    /**
     * 保存盘符设置到 data.json
     */
    saveDriveSettings() {
        var that = this;
        try {
            var data = { driveLetter: this.driveLetter };
            if (typeof this.saveData === 'function') {
                this.saveData('driveSettings', data).catch(function(e) {
                    that._error('save drive settings failed:', e);
                });
            } else {
                localStorage.setItem('cd_drive_settings', JSON.stringify(data));
            }
        } catch (e) {
            that._error('save drive settings error:', e);
        }
    }

    /**
     * 从 data.json 加载路径设置（按设备主机名隔离）
     * 新格式: { win32: { "DESKTOP-ABC": "D:\\path", "LAPTOP-XYZ": "E:\\path" }, darwin: { ... } }
     * 旧格式兼容: { currentPath: "D:\\path" } → 自动迁移为新格式
     */
    loadPathSettings() {
        var that = this;
        try {
            if (typeof this.loadData === 'function') {
                this.loadData('pathSettings').then(function(data) {
                    if (data && typeof data === 'object') {
                        var loadedPath = '';
                        // 旧格式兼容：{ currentPath: "D:\\xxx" }
                        // currentPath 可能是任意一台设备保存的路径，需要验证后才迁移到当前设备名下
                        if (data.currentPath) {
                            var legacyPath = data.currentPath;
                            // 校验路径是否适合当前平台
                            var legacyValid = that.isWindows ? /^[A-Za-z]:/.test(legacyPath) : legacyPath.charAt(0) === '/';
                            if (legacyValid && fs && fs.existsSync && fs.existsSync(legacyPath)) {
                                // 路径在当前设备上存在，迁移到当前设备名下
                                var deviceId = that._getDeviceId();
                                if (!data[that.platform]) data[that.platform] = {};
                                data[that.platform][deviceId] = legacyPath;
                                loadedPath = legacyPath;
                            }
                            // 无论是否迁移成功，都删除旧格式
                            delete data.currentPath;
                            that.saveData('pathSettings', data).catch(function() {});
                        }
                        // 新格式：{ win32: { "DESKTOP-ABC": "D:\\xxx" } }
                        else if (data[that.platform]) {
                            var deviceId = that._getDeviceId();
                            var platformPaths = data[that.platform];
                            if (platformPaths && typeof platformPaths === 'object' && platformPaths[deviceId]) {
                                loadedPath = platformPaths[deviceId];
                            }
                        }
                        if (loadedPath) {
                            // 校验路径是否适合当前平台（防止跨平台路径污染）
                            var isValidForPlatform = false;
                            if (that.isWindows) {
                                isValidForPlatform = /^[A-Za-z]:/.test(loadedPath);
                            } else {
                                isValidForPlatform = loadedPath.charAt(0) === '/';
                            }
                            if (isValidForPlatform) {
                                // 进一步校验路径是否在当前设备上实际存在（防止跨设备路径污染）
                                if (fs && fs.existsSync && fs.existsSync(loadedPath)) {
                                    that.currentPath = loadedPath;
                                    that._syncDriveLetterFromPath(loadedPath);
                                } else {
                                    that._log('路径在当前设备不存在，忽略:', loadedPath);
                                    // 清除当前设备的无效路径记录
                                    var _deviceId = that._getDeviceId();
                                    var _platformPaths = data[that.platform];
                                    if (_platformPaths && typeof _platformPaths === 'object' && _platformPaths[_deviceId]) {
                                        delete _platformPaths[_deviceId];
                                        that.saveData('pathSettings', data).catch(function() {});
                                    }
                                }
                            } else {
                                that._log('忽略跨平台路径:', loadedPath);
                            }
                        }
                    }
                }).catch(function() {
                    // 忽略加载失败
                });
            } else {
                var saved = localStorage.getItem('cd_path_settings');
                if (saved) {
                    var parsed = JSON.parse(saved);
                    if (parsed.currentPath) {
                        var localPath = parsed.currentPath;
                        var isValidLocal = false;
                        if (that.isWindows) {
                            isValidLocal = /^[A-Za-z]:/.test(localPath);
                        } else {
                            isValidLocal = localPath.charAt(0) === '/';
                        }
                        if (isValidLocal) {
                            if (fs && fs.existsSync && fs.existsSync(localPath)) {
                                that.currentPath = localPath;
                                that._syncDriveLetterFromPath(localPath);
                            }
                        }
                    }
                }
            }
        } catch (e) {
            // 忽略错误
        }
    }

    /**
     * 保存路径设置到 data.json（按设备主机名隔离）
     * 先读取现有数据（保留其他设备的路径），再写入当前设备的路径
     */
    savePathSettings() {
        var that = this;
        try {
            if (typeof this.saveData === 'function') {
                // 先读取现有数据，避免覆盖其他设备的路径
                this.loadData('pathSettings').then(function(existing) {
                    var data = (existing && typeof existing === 'object') ? existing : {};
                    // 清理旧格式残留
                    if (data.currentPath) delete data.currentPath;
                    // 按平台+设备写入
                    if (!data[that.platform]) data[that.platform] = {};
                    data[that.platform][that._getDeviceId()] = that.currentPath;
                    that.saveData('pathSettings', data).catch(function(e) {
                        that._error('save path settings failed:', e);
                    });
                }).catch(function() {
                    // 读取失败时，用仅含当前设备的数据写入
                    var data = {};
                    data[that.platform] = {};
                    data[that.platform][that._getDeviceId()] = that.currentPath;
                    that.saveData('pathSettings', data).catch(function(e) {
                        that._error('save path settings failed:', e);
                    });
                });
            } else {
                // localStorage 降级：仍用旧格式（仅当前设备可用，不跨端）
                var data = { currentPath: that.currentPath };
                localStorage.setItem('cd_path_settings', JSON.stringify(data));
            }
        } catch (e) {
            that._error('save path settings error:', e);
        }
    }

    /**
     * 加载路径映射配置
     */
    loadPathMap() {
        var that = this;
        try {
            var saved = localStorage.getItem('cd_path_map');
            if (saved) {
                var parsed = JSON.parse(saved);
                if (parsed && parsed.container && parsed.host) {
                    that.pathMap = parsed;
                }
            }
        } catch (e) {
            // 忽略错误
        }
    }

    /**
     * 保存路径映射配置
     */
    savePathMap() {
        var that = this;
        try {
            if (this.pathMap) {
                localStorage.setItem('cd_path_map', JSON.stringify(this.pathMap));
            } else {
                localStorage.removeItem('cd_path_map');
            }
        } catch (e) {
            that._error('save path map error:', e);
        }
    }

    // ========== 跨端同步文件夹：多设备支持辅助方法 ==========

    /**
     * 检测当前运行平台
     * 1. 桌面版：使用 Node.js os 模块
     * 2. Docker/浏览器版：从 window.siyuan.config.system 读取后端平台
     *    尝试 OS/os/platform 字段，或从 Container/dataDir 推断
     * 3. 兜底：默认 win32
     */
    _detectPlatform() {
        var that = this;
        // 1. 桌面版：Node.js os 模块
        if (os && os.platform) {
            return os.platform();
        }
        // 2. Docker/浏览器版：多字段尝试 + 推断
        try {
            var sys = window.siyuan && window.siyuan.config && window.siyuan.config.system;
            if (sys) {
                // 2a. 直接读取 OS 字段（多种可能命名）
                var osName = (sys.OS || sys.os || sys.platform || sys.Platform || '');
                if (osName) {
                    osName = String(osName).toLowerCase();
                    that._log('_detectPlatform OS field:', osName);
                    if (osName === 'windows') return 'win32';
                    if (osName === 'darwin') return 'darwin';
                    if (osName === 'linux') return 'linux';
                }
                // 2b. 从 Container 字段推断
                var container = (sys.Container || sys.container || '');
                if (container) {
                    that._log('_detectPlatform Container:', container);
                    if (container === 'docker' || container === 'android' || container === 'harmony') {
                        return 'linux';
                    }
                    if (container === 'ios') return 'darwin';
                }
                // 2c. 从 DataDir 路径格式推断
                var dataDir = (sys.DataDir || sys.dataDir || '');
                if (dataDir) {
                    that._log('_detectPlatform DataDir:', dataDir);
                    if (/^[A-Za-z]:/.test(dataDir)) return 'win32';
                    if (dataDir.indexOf('/home/') === 0 || dataDir.indexOf('/mnt/') === 0 || dataDir.indexOf('/media/') === 0) return 'linux';
                    if (dataDir.indexOf('/Users/') === 0 || dataDir.indexOf('/Volumes/') === 0) return 'darwin';
                    if (dataDir.charAt(0) === '/') return 'linux'; // Unix 类兜底
                }
            } else {
                that._log('_detectPlatform: window.siyuan.config.system not available');
            }
        } catch (e) {
            that._log('_detectPlatform error:', e);
        }
        // 3. 兜底默认
        that._log('_detectPlatform fallback to win32');
        return 'win32';
    }

    /**
     * 修正平台检测（Docker/浏览器版专用）
     * 构造函数执行时 window.siyuan.config.system 可能未就绪，
     * 导致平台被错误检测为 win32。在 Dock 面板渲染时调用此方法修正。
     */
    _correctPlatformIfNeeded() {
        // 桌面版 os 模块可用，不需要修正
        if (os && os.platform) return;

        var detected = this._detectPlatform();
        if (detected !== this.platform) {
            this._log('platform corrected in renderFileTree:', this.platform, '→', detected);
            this.platform = detected;
            this.isWindows = (this.platform === 'win32');
            this.platformIcon = this.platform === 'darwin' ? '🍎' : (this.platform === 'linux' ? '🐧' : '🪟');
            this.platformName = this.platform === 'darwin' ? 'macOS' : (this.platform === 'linux' ? 'Linux' : 'Windows');
            this.driveLetter = this.isWindows ? 'C' : '/';
            this._sep = (path && path.sep) || (this.isWindows ? '\\' : '/');
        }
    }

    /**
     * 获取当前设备标识（主机名，不随思源同步）
     * 用于区分同一平台的多台设备（如两台 Windows 电脑）
     */
    _getDeviceId() {
        var that = this;
        if (!this._deviceId) {
            // 1. 桌面版：Node.js os 模块
            if (os && os.hostname) {
                this._deviceId = os.hostname();
            }
            // 2. Docker/浏览器版：思源 config.system.Name/ID/id
            else {
                try {
                    var sys = window.siyuan && window.siyuan.config && window.siyuan.config.system;
                    if (sys) {
                        this._deviceId = sys.Name || sys.name || sys.ID || sys.id || sys.deviceId || '';
                        if (this._deviceId) {
                            that._log('_getDeviceId from config:', this._deviceId);
                        }
                    }
                } catch (e) {}
            }
            // 3. 兜底
            if (!this._deviceId) {
                this._deviceId = 'unknown';
                that._log('_getDeviceId fallback to unknown');
            }
        }
        return this._deviceId;
    }

    // ========== fs/API 双模式封装（Docker/鸿蒙版支持） ==========

    /**
     * 异步读取目录内容
     * 桌面版：fs.readdir（异步回调，避免网盘挂载时阻塞主线程）
     * Docker/鸿蒙版：/api/file/readDir
     * @param {string} dirPath 目录路径
     * @param {number} [timeoutMs] 超时毫秒数（默认 5000，网盘挂载场景防止无限挂起）
     * @returns {Promise<Array<{name:string, isDir:boolean, isSymlink:boolean, updated:number}>>}
     */
    _fsReaddir(dirPath, timeoutMs) {
        var that = this;
        timeoutMs = timeoutMs || 5000;
        return new Promise(function(resolve, reject) {
            var done = false;
            var timer = setTimeout(function() {
                if (!done) {
                    done = true;
                    that._error('_fsReaddir timeout:', dirPath);
                    reject(new Error('readdir timeout: ' + dirPath));
                }
            }, timeoutMs);

            function finish(val) {
                if (!done) { done = true; clearTimeout(timer); resolve(val); }
            }
            function fail(err) {
                if (!done) { done = true; clearTimeout(timer); reject(err); }
            }

            if (fs && fs.readdir) {
                fs.readdir(dirPath, { withFileTypes: true }, function(err, entries) {
                    if (err) {
                        // Node.js 异步模式失败时，尝试 API 兜底（沙箱/权限限制场景）
                        that._apiReaddir(dirPath).then(finish).catch(function() {
                            fail(err);
                        });
                        return;
                    }
                    var result = entries.map(function(e) {
                        return {
                            name: e.name,
                            isDir: e.isDirectory(),
                            isSymlink: e.isSymbolicLink && e.isSymbolicLink(),
                            updated: 0
                        };
                    });
                    finish(result);
                });
            } else {
                that._apiReaddir(dirPath).then(finish).catch(fail);
            }
        });
    }

    /**
     * API 模式读取目录（Docker/浏览器/沙箱环境）
     * @param {string} dirPath 目录路径
     */
    _apiReaddir(dirPath) {
        return fetch('/api/file/readDir', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: dirPath }),
            credentials: 'include'
        }).then(function(resp) { return resp.json(); }).then(function(data) {
            if (data.code === 0 && Array.isArray(data.data)) {
                return data.data;
            } else {
                throw new Error(data.msg || 'API readDir failed');
            }
        });
    }

    /**
     * 异步判断路径是否存在
     * 桌面版：fs.existsSync
     * Docker/鸿蒙版：尝试 readDir（目录）或 getFile（文件），根据返回判断
     * @param {string} filePath 文件/目录路径
     * @param {boolean} [isDirHint] 提示是否为目录（优化 API 调用）
     * @returns {Promise<boolean>}
     */
    _fsExists(filePath, isDirHint) {
        return new Promise(function(resolve, reject) {
            if (fs && fs.existsSync) {
                resolve(fs.existsSync(filePath));
            } else {
                // 尝试 readDir（如果是目录会成功，如果不是会失败）
                fetch('/api/file/readDir', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: filePath }),
                    credentials: 'include'
                }).then(function(resp) { return resp.json(); }).then(function(data) {
                    if (data.code === 0) {
                        resolve(true);  // 目录存在
                    } else {
                        // readDir 失败，可能是文件而非目录，也可能是真的不存在
                        // 尝试 getFile 检查文件
                        fetch('/api/file/getFile', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ path: filePath }),
                            credentials: 'include'
                        }).then(function(resp) {
                            resolve(resp.ok && resp.status === 200);
                        }).catch(function() {
                            resolve(false);
                        });
                    }
                }).catch(function() {
                    resolve(false);
                });
            }
        });
    }

    /**
     * 异步获取文件/目录信息
     * 桌面版：fs.statSync
     * Docker/鸿蒙版：用 readDir 列出父目录，匹配文件名获取信息
     * 注意：API 版没有完整 stat 信息（没有 size），只有 isDir/isSymlink/updated
     * @param {string} filePath 文件/目录路径
     * @returns {Promise<{isDirectory:boolean, isFile:boolean, size:number, mtime:Date, isSymlink:boolean}>}
     */
    _fsStat(filePath) {
        var that = this;
        return new Promise(function(resolve, reject) {
            if (fs && fs.stat) {
                fs.stat(filePath, function(err, st) {
                    if (err) {
                        reject(err);
                        return;
                    }
                    resolve({
                        isDirectory: function() { return st.isDirectory(); },
                        isFile: function() { return st.isFile(); },
                        size: st.size,
                        mtime: st.mtime,
                        isSymlink: function() { return st.isSymbolicLink && st.isSymbolicLink(); }
                    });
                });
            } else {
                // API 版：列出父目录，匹配文件名
                var sep = that._sep || '/';
                var parentDir = filePath.substring(0, filePath.lastIndexOf(sep)) || sep;
                var fileName = filePath.substring(filePath.lastIndexOf(sep) + 1);
                fetch('/api/file/readDir', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: parentDir }),
                    credentials: 'include'
                }).then(function(resp) { return resp.json(); }).then(function(data) {
                    if (data.code === 0 && Array.isArray(data.data)) {
                        var entry = data.data.find(function(e) { return e.name === fileName; });
                        if (entry) {
                            resolve({
                                isDirectory: function() { return entry.isDir; },
                                isFile: function() { return !entry.isDir; },
                                size: 0,  // API 不返回 size
                                mtime: entry.updated ? new Date(entry.updated * 1000) : new Date(),
                                isSymlink: function() { return entry.isSymlink; }
                            });
                        } else {
                            reject(new Error('File not found: ' + fileName));
                        }
                    } else {
                        reject(new Error(data.msg || 'API readDir failed'));
                    }
                }).catch(reject);
            }
        });
    }

    /**
     * 异步读取文件内容（二进制）
     * 桌面版：fs.readFileSync
     * Docker/鸿蒙版：/api/file/getFile
     * @param {string} filePath 文件路径
     * @param {string} [encoding] 编码（如 'utf-8'）
     * @returns {Promise<Buffer|string>}
     */
    _fsReadFile(filePath, encoding, maxBytes) {
        return new Promise(function(resolve, reject) {
            if (fs && fs.readFileSync) {
                try {
                    if (maxBytes) {
                        // 仅读取前 maxBytes 字节（预加载封面时避免读取整个大文件）
                        var fd = fs.openSync(filePath, 'r');
                        var buf = Buffer.alloc(maxBytes);
                        var bytesRead = fs.readSync(fd, buf, 0, maxBytes, 0);
                        fs.closeSync(fd);
                        // Buffer.from 创建独立副本，避免 subarray 的 buffer 引用问题
                        resolve(Buffer.from(buf.subarray(0, bytesRead)));
                    } else {
                        resolve(fs.readFileSync(filePath, encoding || null));
                    }
                } catch (err) {
                    reject(err);
                }
            } else {
                fetch('/api/file/getFile', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: filePath }),
                    credentials: 'include'
                }).then(function(resp) {
                    if (resp.status === 200) {
                        if (encoding) {
                            resp.text().then(resolve).catch(reject);
                        } else {
                            // 浏览器环境直接返回 ArrayBuffer，不使用 Buffer
                            resp.arrayBuffer().then(resolve).catch(reject);
                        }
                    } else {
                        reject(new Error('getFile failed: ' + resp.status));
                    }
                }).catch(reject);
            }
        });
    }

    /**
     * 获取当前文件系统模式
     * @returns {string} 'node' 或 'api'
     */
    _fsMode() {
        return (fs && fs.readdirSync) ? 'node' : 'api';
    }

    /**
     * 判断是否为 Docker 浏览器模式
     * Docker 浏览器模式下：
     * - file:/// 链接被浏览器安全策略拦截，无法打开
     * - 插入链接和链接修复都无意义，应跳过
     * 鸿蒙 PC 虽然也是 API 模式，但作为原生应用可以打开 file:/// 链接
     * @returns {boolean}
     */
    _isDockerBrowser() {
        if (this._fsMode() !== 'api') return false;
        try {
            var sys = window.siyuan && window.siyuan.config && window.siyuan.config.system;
            if (sys) {
                var container = String(sys.Container || sys.container || '').toLowerCase();
                // Docker 容器环境，浏览器无法打开 file:/// 链接
                if (container === 'docker') return true;
            }
        } catch (e) { /* ignore */ }
        // API 模式但非 Docker（鸿蒙 PC 等）：不是浏览器，可以打开链接
        return false;
    }

    /**
     * API 模式下扫描 Linux 挂载点（/mnt/ /media/ 等）
     * 用于 Docker/鸿蒙版 detectDrives 的 fallback
     */
    _apiScanLinuxMounts(callback) {
        var that = this;
        var mountDrives = [];
        var pending = 0;

        function checkDone() {
            if (pending <= 0) {
                callback(mountDrives);
            }
        }

        // 扫描 /mnt/
        pending++;
        that._fsReaddir('/mnt/').then(function(entries) {
            for (var i = 0; i < entries.length; i++) {
                var e = entries[i];
                var isDir = typeof e.isDirectory === 'function' ? e.isDirectory() : e.isDir;
                if (e.name.charAt(0) !== '.' && isDir) {
                    mountDrives.push({value: '/mnt/' + e.name, label: '📁 ' + e.name, isDefault: false});
                }
            }
        }).catch(function() {}).finally(function() {
            pending--;
            // 扫描 /media/
            pending++;
            that._fsReaddir('/media/').then(function(entries) {
                var subPromises = [];
                for (var i = 0; i < entries.length; i++) {
                    var e = entries[i];
                    var isDir = typeof e.isDirectory === 'function' ? e.isDirectory() : e.isDir;
                    if (e.name.charAt(0) !== '.' && isDir) {
                        mountDrives.push({value: '/media/' + e.name, label: '📁 ' + e.name, isDefault: false});
                        // 扫描用户子目录
                        (function(userPath) {
                            pending++;
                            that._fsReaddir(userPath).then(function(subs) {
                                for (var j = 0; j < subs.length; j++) {
                                    var s = subs[j];
                                    var sIsDir = typeof s.isDirectory === 'function' ? s.isDirectory() : s.isDir;
                                    if (s.name.charAt(0) !== '.' && sIsDir) {
                                        mountDrives.push({value: userPath + '/' + s.name, label: '🔌 ' + s.name, isDefault: false});
                                    }
                                }
                            }).catch(function() {}).finally(function() { pending--; checkDone(); });
                        })('/media/' + e.name);
                    }
                }
            }).catch(function() {}).finally(function() { pending--; checkDone(); });
        });
    }

    /**
     * 获取当前设备在本平台配置的同步文件夹路径
     * 新格式: syncRoots[platform] = { "DESKTOP-ABC": "D:\\path", "LAPTOP-XYZ": "E:\\path" }
     * 旧格式兼容: syncRoots[platform] = "D:\\path" (字符串)
     */
    _getMySyncRoot() {
        var platformRoots = this.syncRoots[this.platform];
        if (!platformRoots) return '';
        if (typeof platformRoots === 'string') return platformRoots;  // 旧格式兼容
        var deviceId = this._getDeviceId();
        var result = platformRoots[deviceId] || '';
        if (result) return result;

        // Fallback: deviceId 可能变更（如首次加载时为 'unknown'，后续变为真实主机名）
        // 在当前平台下查找其他 deviceId 的条目，如果只有一条且路径存在，则自动迁移
        var keys = Object.keys(platformRoots);
        if (keys.length === 1 && keys[0] !== deviceId && keys[0] !== '_legacy') {
            var candidate = platformRoots[keys[0]];
            if (candidate && typeof candidate === 'string') {
                // 规范化路径：去除连续斜杠
                var normalizedCandidate = candidate;
                if (!this.isWindows) {
                    normalizedCandidate = normalizedCandidate.replace(/\/+/g, '/');
                } else {
                    normalizedCandidate = normalizedCandidate.replace(/\\+/g, '\\');
                }
                var pathExists = false;
                if (fs && fs.existsSync) {
                    try { pathExists = fs.existsSync(normalizedCandidate); } catch(e) {}
                }
                if (pathExists) {
                    that._log('_getMySyncRoot: deviceId mismatch detected, migrating from "' + keys[0] + '" to "' + deviceId + '"');
                    platformRoots[deviceId] = normalizedCandidate;
                    delete platformRoots[keys[0]];
                    this.saveSyncRoots();
                    return normalizedCandidate;
                }
            }
        }
        return '';
    }

    /**
     * 设置当前设备的同步文件夹路径
     */
    _setMySyncRoot(pathVal) {
        var platformRoots = this.syncRoots[this.platform];
        // 如果旧格式（字符串），先转换为对象
        if (!platformRoots || typeof platformRoots === 'string') {
            this.syncRoots[this.platform] = {};
        }
        var deviceId = this._getDeviceId();
        // 清理可能遗留的 _legacy 键
        delete this.syncRoots[this.platform]['_legacy'];
        // 规范化路径：去除连续斜杠（macOS 上 /Users/mac//Downloads → /Users/mac/Downloads）
        var normalized = pathVal;
        if (!this.isWindows) {
            normalized = normalized.replace(/\/+/g, '/');
        } else {
            // Windows: 反斜杠连续也规范化，但不影响盘符后的单个反斜杠
            normalized = normalized.replace(/\\+/g, '\\');
        }
        // 去除末尾分隔符
        if (normalized.length > 1) {
            normalized = normalized.replace(/[\\/]+$/, '');
        }
        this.syncRoots[this.platform][deviceId] = normalized;
    }

    /**
     * 清除当前设备的同步文件夹路径
     */
    _clearMySyncRoot() {
        var platformRoots = this.syncRoots[this.platform];
        if (!platformRoots || typeof platformRoots === 'string') {
            delete this.syncRoots[this.platform];
            return;
        }
        var deviceId = this._getDeviceId();
        delete platformRoots[deviceId];
        // 如果该平台下已无任何设备，清理空对象
        if (Object.keys(platformRoots).length === 0) {
            delete this.syncRoots[this.platform];
        }
    }

    /**
     * 获取所有设备的同步文件夹路径（用于 _isInSyncFolder 前缀匹配）
     * 返回: [{ platform, deviceId, path }]
     */
    _getAllSyncRoots() {
        var result = [];
        var platforms = ['win32', 'darwin', 'linux'];
        for (var i = 0; i < platforms.length; i++) {
            var p = platforms[i];
            var platformRoots = this.syncRoots[p];
            if (!platformRoots) continue;
            if (typeof platformRoots === 'string') {
                // 旧格式兼容
                result.push({ platform: p, deviceId: '_legacy', path: platformRoots });
            } else {
                var keys = Object.keys(platformRoots);
                for (var j = 0; j < keys.length; j++) {
                    result.push({ platform: p, deviceId: keys[j], path: platformRoots[keys[j]] });
                }
            }
        }
        return result;
    }

    /**
     * 获取除当前设备外所有其他设备的同步文件夹路径（用于 _crossSyncRepair 跨端修复）
     * 返回: [{ platform, deviceId, path }]
     */
    _getOtherSyncRoots() {
        var result = [];
        var deviceId = this._getDeviceId();
        var all = this._getAllSyncRoots();
        for (var i = 0; i < all.length; i++) {
            // 跳过当前设备（同平台同主机名）
            if (all[i].platform === this.platform && all[i].deviceId === deviceId) continue;
            result.push(all[i]);
        }
        return result;
    }

    /**
     * 将旧格式 syncRoots 迁移为新格式（支持多设备）
     * 旧格式: { win32: "D:\\path", darwin: "/Users/x/path" }
     * 新格式: { win32: { "DESKTOP-ABC": "D:\\path" }, darwin: { "_legacy": "/Users/x/path" } }
     * 当前平台的旧值分配给本机主机名，其他平台用 _legacy 占位（待对应设备升级后迁移）
     */
    _migrateSyncRoots() {
        var deviceId = this._getDeviceId();
        var platforms = ['win32', 'darwin', 'linux'];
        var migrated = false;
        for (var i = 0; i < platforms.length; i++) {
            var p = platforms[i];
            var val = this.syncRoots[p];
            if (typeof val === 'string') {
                // 旧格式 → 新格式
                if (p === this.platform) {
                    // 当前平台：验证路径在当前设备上存在才迁移到本机名下
                    var pathExists = false;
                    if (fs && fs.existsSync) {
                        pathExists = fs.existsSync(val);
                    }
                    this.syncRoots[p] = {};
                    if (pathExists) {
                        this.syncRoots[p][deviceId] = val;
                    }
                } else {
                    this.syncRoots[p] = { '_legacy': val };
                }
                migrated = true;
            }
        }
        // 检查当前平台下是否有 _legacy 遗留键，迁移到本机主机名下
        var currentRoots = this.syncRoots[this.platform];
        if (currentRoots && typeof currentRoots === 'object' && currentRoots['_legacy'] && !currentRoots[deviceId]) {
            // 验证 _legacy 路径在当前设备上存在才迁移
            var legacyVal = currentRoots['_legacy'];
            var legacyExists = false;
            if (fs && fs.existsSync) {
                legacyExists = fs.existsSync(legacyVal);
            }
            if (legacyExists) {
                currentRoots[deviceId] = legacyVal;
            }
            delete currentRoots['_legacy'];
            migrated = true;
        }
        // 检查当前平台下是否有旧 deviceId 的条目需要迁移到本机名下
        // 场景：首次加载时 _getDeviceId() 返回 'unknown'，后续 config 就绪后返回真实主机名
        if (currentRoots && typeof currentRoots === 'object' && !currentRoots[deviceId]) {
            var otherKeys = Object.keys(currentRoots).filter(function(k) { return k !== '_legacy' && k !== deviceId; });
            if (otherKeys.length === 1) {
                // 当前平台下只有一个旧 deviceId 条目且不等于当前 deviceId
                var oldKey = otherKeys[0];
                var oldVal = currentRoots[oldKey];
                if (oldVal && typeof oldVal === 'string') {
                    var oldPathExists = false;
                    if (fs && fs.existsSync) {
                        try { oldPathExists = fs.existsSync(oldVal); } catch(e) {}
                    }
                    if (oldPathExists) {
                        that._log('_migrateSyncRoots: migrating deviceId "' + oldKey + '" → "' + deviceId + '" for platform ' + this.platform);
                        currentRoots[deviceId] = oldVal;
                        delete currentRoots[oldKey];
                        migrated = true;
                    }
                }
            }
        }
        // 迁移后自动保存
        if (migrated) {
            this.saveSyncRoots();
        }
    }

    /**
     * 加载跨端同步文件夹配置（使用 saveData/loadData 实现跨端共享）
     */
    loadSyncRoots() {
        var that = this;
        try {
            if (typeof this.loadData === 'function') {
                this.loadData('syncRoots').then(function(data) {
                    that._log('loadSyncRoots completed: data=' + JSON.stringify(data) + ', dockPanel=' + !!that.dockPanel + ', currentPath=' + that.currentPath);
                    if (data && typeof data === 'object') {
                        that.syncRoots = data;
                        that._migrateSyncRoots();  // 旧格式迁移为新格式（多设备）
                        // DOM 已就绪时更新 UI
                        that.renderFavorites();
                        that._updateSyncPill();
                    }
                    that._syncRootsLoaded = true;
                    // 默认导航到跨端同步文件夹（syncRoots 异步加载完成后补偿）
                    that._navigateToSyncRootOnLoad();
                }).catch(function(err) {
                    // 忽略加载失败，使用默认值
                    that._log('loadSyncRoots failed:', err);
                    that._syncRootsLoaded = true;
                });
            } else {
                var saved = localStorage.getItem('cd_sync_roots');
                if (saved) {
                    var parsed = JSON.parse(saved);
                    if (parsed && typeof parsed === 'object') {
                        this.syncRoots = parsed;
                    }
                }
                this._migrateSyncRoots();  // 旧格式迁移为新格式（多设备）
                this._syncRootsLoaded = true;
                // localStorage 模式同步完成后也尝试导航（renderFileTree 初始加载时可能还没拿到数据）
                this._navigateToSyncRootOnLoad();
            }
        } catch (e) {
            // 忽略错误
        }
    }

    /**
     * 启动时导航到跨端同步文件夹根目录
     * 在 loadSyncRoots 完成后调用，确保 syncRoots 数据已就绪
     * 仅在初始加载时生效（仅从 loadSyncRoots 调用，用户手动导航后不会触发）
     * 
     * 注意：不能用 this.currentPath === syncRoot 判断是否已在同步文件夹，
     * 因为 loadPathSettings() 可能在 renderFileTree() 之后异步完成并设置了
     * this.currentPath = syncRoot，但此时显示的仍然是 C:\（renderFileTree 的加载结果）。
     * 用 _loadSeq 版本号机制可以安全地丢弃旧的 C:\ 回调。
     */
    _navigateToSyncRootOnLoad() {
        var that = this;
        var syncRoot = this._getMySyncRoot();
        that._log('_navigateToSyncRootOnLoad: syncRoot=' + syncRoot + ', currentPath=' + this.currentPath + ', dockPanel=' + !!this.dockPanel + ', _loadSeq=' + this._loadSeq);
        if (!syncRoot) return;
        // 校验路径是否适合当前平台
        if (this.isWindows) {
            if (!/^[A-Za-z]:/.test(syncRoot)) {
                that._log('_navigateToSyncRootOnLoad: skip - platform mismatch');
                return;
            }
        } else {
            if (syncRoot.charAt(0) !== '/') {
                that._log('_navigateToSyncRootOnLoad: skip - platform mismatch');
                return;
            }
        }
        // 校验路径在当前设备上实际存在
        if (fs && fs.existsSync && !fs.existsSync(syncRoot)) {
            that._log('_navigateToSyncRootOnLoad: skip - path not exists');
            return;
        }
        // Dock 面板已就绪时，导航到同步文件夹根目录
        // 即使 this.currentPath 已等于 syncRoot（loadPathSettings 异步设置），
        // 也要调用 loadDirectory，因为显示内容可能仍是 C:\ 的加载结果
        if (this.dockPanel && this.dockPanel.element) {
            that._log('_navigateToSyncRootOnLoad: navigating to ' + syncRoot);
            this.currentPath = syncRoot;
            this._syncDriveLetterFromPath(syncRoot);
            this.loadDirectory(syncRoot);
        } else {
            that._log('_navigateToSyncRootOnLoad: skip - dockPanel not ready');
        }
    }

    /**
     * 保存跨端同步文件夹配置（使用 saveData/loadData 实现跨端共享）
     */
    saveSyncRoots() {
        var that = this;
        try {
            // 清理空的平台对象（所有设备都被删除的平台）
            var platforms = ['win32', 'darwin', 'linux'];
            for (var i = 0; i < platforms.length; i++) {
                var p = platforms[i];
                var val = this.syncRoots[p];
                if (val && typeof val === 'object' && Object.keys(val).length === 0) {
                    delete this.syncRoots[p];
                }
            }
            if (typeof this.saveData === 'function') {
                if (Object.keys(this.syncRoots).length > 0) {
                    this.saveData('syncRoots', this.syncRoots).catch(function(e) {
                        that._error('save sync roots failed:', e);
                    });
                } else {
                    this.saveData('syncRoots', {}).catch(function(e) {
                        that._error('save sync roots failed:', e);
                    });
                }
            } else {
                if (Object.keys(this.syncRoots).length > 0) {
                    localStorage.setItem('cd_sync_roots', JSON.stringify(this.syncRoots));
                } else {
                    localStorage.removeItem('cd_sync_roots');
                }
            }
        } catch (e) {
            that._error('save sync roots error:', e);
        }
    }

    /**
     * 更新同步文件夹 pill 按钮的文字（已配置显示文件夹名，未配置显示默认值）
     */
    _updateSyncPill() {
        var pill = document.getElementById('cd-syncroot-pill');
        if (!pill) return;
        var sp = this._getMySyncRoot();
        var isDocker = this._isDockerBrowser();
        if (sp) {
            var trimmed = sp.replace(/[\\/]+$/, '');
            var name = trimmed.replace(/\\/g, '/').split('/').pop() || sp;
            pill.textContent = '🔄 ' + name;
            if (isDocker) {
                // Docker 下即使有配置也不支持跨端同步，显示灰色
                pill.title = 'Docker浏览器环境不支持跨端同步';
                pill.style.color = '#888';
                pill.style.borderColor = '#ccc';
            } else {
                pill.title = '打开同步文件夹';
                pill.style.color = '#4caf50';
                pill.style.borderColor = '#4caf50';
            }
        } else {
            pill.textContent = '🔄 跨端同步文件夹';
            if (isDocker) {
                // Docker 浏览器环境不支持跨端同步，显示灰色
                pill.title = 'Docker浏览器环境不支持跨端同步';
                pill.style.color = '#888';
                pill.style.borderColor = '#ccc';
            } else {
                pill.title = '右键添加同步文件夹';
                pill.style.color = '#e53935';
                pill.style.borderColor = '#e53935';
            }
        }
    }

    /**
     * 渲染其他设备/平台的同步文件夹配置（参考信息，只读）
     * 同平台可能有多台设备（如两台 Windows），分别显示主机名
     */
    _renderSyncRootOther(el) {
        var otherEl = el.querySelector('#cd-syncroot-other');
        if (!otherEl) return;
        var platforms = ['win32', 'darwin', 'linux'];
        var names = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' };
        var deviceId = this._getDeviceId();
        var html = '';
        for (var i = 0; i < platforms.length; i++) {
            var p = platforms[i];
            var pRoots = this.syncRoots[p];
            if (!pRoots) {
                // 未配置：灰色提示
                html += '<div style="display:flex;align-items:center;gap:4px;margin-bottom:3px">' +
                    '<span style="flex-shrink:0;font-size:10px;font-weight:500;color:var(--b3-theme-on-background,#333);min-width:52px">' + names[p] + '</span>' +
                    '<span style="font-size:10px;color:var(--b3-theme-secondary,#bbb);font-style:italic">未配置</span>' +
                    '</div>';
                continue;
            }
            // 旧格式兼容（字符串值）
            if (typeof pRoots === 'string') {
                if (p !== this.platform) {
                    html += '<div style="display:flex;align-items:center;gap:4px;margin-bottom:3px">' +
                        '<span style="flex-shrink:0;font-size:10px;font-weight:500;color:var(--b3-theme-on-background,#333);min-width:52px">' + names[p] + '</span>' +
                        '<input type="text" value="' + pRoots.replace(/"/g, '&quot;') + '" readonly style="flex:1;min-width:0;padding:2px 6px;font-size:10px;border:1px solid var(--b3-border,#ddd);border-radius:3px;background:var(--b3-theme-surface,#f5f5f5);color:var(--b3-theme-on-background,#555);outline:none;cursor:default;opacity:0.8" title="' + pRoots.replace(/"/g, '&quot;') + '">' +
                        '</div>';
                }
                continue;
            }
            // 新格式：对象（多设备）
            var keys = Object.keys(pRoots);
            for (var j = 0; j < keys.length; j++) {
                var devId = keys[j];
                var pPath = pRoots[devId];
                // 跳过当前设备（已在上方输入框中显示）
                if (p === this.platform && devId === deviceId) continue;
                // 设备标识：显示主机名，_legacy 显示为"旧配置"
                var devLabel = devId === '_legacy' ? '旧配置' : devId;
                var label = names[p] + (keys.length > 1 || p === this.platform ? ' (' + devLabel + ')' : '');
                html += '<div style="display:flex;align-items:center;gap:4px;margin-bottom:3px">' +
                    '<span style="flex-shrink:0;font-size:10px;font-weight:500;color:var(--b3-theme-on-background,#333);min-width:52px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="' + label.replace(/"/g, '&quot;') + '">' + label + '</span>' +
                    '<input type="text" value="' + pPath.replace(/"/g, '&quot;') + '" readonly style="flex:1;min-width:0;padding:2px 6px;font-size:10px;border:1px solid var(--b3-border,#ddd);border-radius:3px;background:var(--b3-theme-surface,#f5f5f5);color:var(--b3-theme-on-background,#555);outline:none;cursor:default;opacity:0.8" title="' + pPath.replace(/"/g, '&quot;') + '">' +
                    '</div>';
            }
        }
        otherEl.innerHTML = html;
    }

    /**
     * 浏览选择同步文件夹（使用当前目录导航方式）
     * @param {HTMLElement} el - 设置面板元素
     * @param {Function} onSelect - 选择后的回调（可选）
     */
    _browseSyncFolder(el, onSelect) {
        var that = this;
        var pathInput = el.querySelector('#cd-syncroot-path');
        var startPath = (pathInput && pathInput.value && pathInput.value.trim()) || this.currentPath || this.getRootPath();

        // 统一回调：把选中的目录路径传给 onSelect，由调用方决定是否拼接 LocalBrowseSync
        function done(selectedDir) {
            if (selectedDir && typeof onSelect === 'function') {
                onSelect(selectedDir);
            }
        }

        // macOS / API模式：直接使用内置目录选择器（osascript 在沙盒环境下经常静默失败）
        if (this.platform === 'darwin' || this._fsMode() === 'api') {
            that.pickDirectory(startPath, function(selectedDir) {
                done(selectedDir);
            });
            return;
        }

        // Windows / Linux: 使用 Node.js child_process 调用系统原生文件夹选择对话框
        try {
            var child = require('child_process');
            if (this.isWindows) {
                // Windows: 写临时 ps1 脚本执行，避免命令行引号转义问题
                var tmpFile = path.join(os.tmpdir(), 'lb_browse_' + Date.now() + '.ps1');
                var psScript = 'Add-Type -AssemblyName System.Windows.Forms\r\n' +
                    '$dlg = New-Object System.Windows.Forms.FolderBrowserDialog\r\n' +
                    "$dlg.Description = 'Select sync folder'\r\n" +
                    '$dlg.ShowNewFolderButton = $false\r\n' +
                    (startPath ? ("$dlg.SelectedPath = '" + startPath.replace(/'/g, "''") + "'\r\n") : '') +
                    "if ($dlg.ShowDialog() -eq 'OK') { Write-Output $dlg.SelectedPath }\r\n";
                fs.writeFileSync(tmpFile, '\ufeff' + psScript, 'utf8');
                that._log('browse ps1:', tmpFile);
                child.exec('powershell -NoProfile -ExecutionPolicy Bypass -File "' + tmpFile + '"', { encoding: 'utf8', timeout: 60000 }, function(err, stdout, stderr) {
                    that._log('browse result err:', err ? err.message : null, 'stdout:', stdout ? stdout.trim() : null);
                    if (err) {
                        that._error('ps1 err:', err.message);
                        // PowerShell 失败，回退到内置目录选择器
                        that.pickDirectory(startPath, done);
                    } else {
                        var sel = stdout ? stdout.trim() : '';
                        if (sel && sel.length > 0 && sel.indexOf('Exception') === -1) {
                            done(sel);
                        } else {
                            // 无结果，回退到内置目录选择器
                            that.pickDirectory(startPath, done);
                        }
                    }
                    // 清理临时文件
                    try { fs.unlinkSync(tmpFile); } catch(e) {}
                });
                return;
            } else {
                // Linux: zenity
                child.exec('zenity --file-selection --directory --title="Select sync folder"', { encoding: 'utf8', timeout: 60000 }, function(err, stdout) {
                    if (err) {
                        that._error('zenity error:', err.message);
                        that.pickDirectory(startPath, done);
                        return;
                    }
                    var sel = stdout ? stdout.trim() : '';
                    if (sel && sel.length > 0) {
                        done(sel);
                    } else {
                        that.pickDirectory(startPath, done);
                    }
                });
                return;
            }
        } catch (e) {
            that._error('browse folder error:', e);
        }
        // 最终回退：内置目录选择器
        that.pickDirectory(startPath, done);
    }

    /**
     * 容器路径 → 宿主机路径转换
     */
    containerToHost(containerPath) {
        if (!this.pathMap) return containerPath;
        var normalized = containerPath.replace(/\\/g, '/');
        var containerRoot = this.pathMap.container.replace(/\\/g, '/').replace(/\/+$/, '');
        // 保留 host 原始格式，根据其特征判断使用哪种分隔符
        var hostRoot = this.pathMap.host.replace(/[\\/]+$/, '');
        var hostUsesBackslash = hostRoot.indexOf('\\') >= 0 || /^[A-Za-z]:/.test(hostRoot);
        if (normalized.indexOf(containerRoot) === 0) {
            var relative = normalized.substring(containerRoot.length);
            if (relative.charAt(0) === '/') relative = relative.substring(1);
            if (hostUsesBackslash) {
                return hostRoot + '\\' + relative.replace(/\//g, '\\');
            } else {
                return hostRoot + '/' + relative;
            }
        }
        return containerPath;
    }

    /**
     * 宿主机路径 → 容器路径转换（用于失效链接修复搜索）
     */
    hostToContainer(hostPath) {
        if (!this.pathMap) return hostPath;
        var normalizedHost = hostPath.replace(/\\/g, '/').toLowerCase();
        var hostRootNorm = this.pathMap.host.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
        if (normalizedHost.indexOf(hostRootNorm) === 0) {
            var relative = normalizedHost.substring(hostRootNorm.length);
            if (relative.charAt(0) === '/') relative = relative.substring(1);
            return this.pathMap.container.replace(/\/+$/, '') + '/' + relative;
        }
        return hostPath;
    }

    /**
     * 判断一个本地路径是否属于当前平台的链接格式
     * Windows: 盘符开头（如 C:\, D:/）
     * macOS: /Users/ 或 /Volumes/ 开头
     * Linux: /home/ 或 /mnt/ 或 /media/ 开头
     * 路径以 / 开头但不在上述列表中 → 归为当前平台（Unix 类通用）
     */
    _isCurrentPlatformLink(localPath) {
        if (!localPath) return false;
        var p = localPath.replace(/\\/g, '/');
        if (this.isWindows) {
            // Windows: 盘符格式 X: 或 X:/
            return /^[A-Za-z]:/.test(p);
        } else if (this.platform === 'darwin') {
            // macOS: /Users/ 或 /Volumes/ 开头
            if (p.indexOf('/Users/') === 0 || p.indexOf('/Volumes/') === 0) return true;
            // 其他以 / 开头的路径：排除 Linux 特征路径 + Windows 路径（如 /D:/...）
            if (p.charAt(0) === '/' && p.indexOf('/home/') !== 0 && p.indexOf('/mnt/') !== 0 && p.indexOf('/media/') !== 0 && !/^\/[A-Za-z]:/.test(p)) return true;
            return false;
        } else {
            // Linux: /home/ 或 /mnt/ 或 /media/ 开头
            if (p.indexOf('/home/') === 0 || p.indexOf('/mnt/') === 0 || p.indexOf('/media/') === 0) return true;
            // 其他以 / 开头的路径：排除 macOS 特征路径 + Windows 路径（如 /D:/...）
            if (p.charAt(0) === '/' && p.indexOf('/Users/') !== 0 && p.indexOf('/Volumes/') !== 0 && !/^\/[A-Za-z]:/.test(p)) return true;
            return false;
        }
    }

    /**
     * 从 syncRoots 中提取同步文件夹名称（三端路径的最后一个路径段）
     * 如 D:\BaiduSyncdisk → BaiduSyncdisk
     * 如 /Users/sqalei/BaiduSyncdisk → BaiduSyncdisk
     * 未配置则返回空字符串
     */
    _getSyncFolderName() {
        var myRoot = this._getMySyncRoot();
        if (!myRoot) return '';
        var normalized = myRoot.replace(/\\/g, '/').replace(/\/+$/, '');
        var lastSlash = normalized.lastIndexOf('/');
        if (lastSlash >= 0 && lastSlash < normalized.length - 1) {
            return normalized.substring(lastSlash + 1);
        }
        return normalized;  // 无分隔符时整个就是名称
    }

    /**
     * 判断路径是否属于任何设备的同步文件夹
     * 使用精确前缀匹配，遍历所有设备的 syncRoot 路径
     */
    _isInSyncFolder(localPath) {
        if (!localPath || !this.syncRoots) return false;
        var normalized = localPath.replace(/\\/g, '/').replace(/\/+/g, '/');
        var allRoots = this._getAllSyncRoots();
        for (var i = 0; i < allRoots.length; i++) {
            var rootNorm = allRoots[i].path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/+$/, '');
            if (normalized.indexOf(rootNorm) === 0) {
                // 精确前缀匹配：确保匹配到的是完整路径段（后面紧跟 / 或到末尾）
                var nextChar = normalized.charAt(rootNorm.length);
                if (nextChar === '' || nextChar === '/') return true;
            }
        }
        return false;
    }

    /**
     * 跨端同步文件夹修复通道
     * 将其他平台的路径转换为当前平台的路径
     * @param {string} localPath - 失效链接的本地路径（其他平台格式）
     * @param {string} fileName - 文件名
     * @returns {object|null} - { newPath: string, syncSearchRoot: string|null } 或 null（无法修复）
     *   newPath: 前缀替换后的新路径（可能存在也可能不存在）
     *   syncSearchRoot: 当前平台的同步文件夹路径（供后续搜索用）
     */
    _crossSyncRepair(localPath, fileName) {
        var that = this;
        if (!localPath || !this.syncRoots) return null;
        var myRoot = this._getMySyncRoot();
        if (!myRoot) {
            that._log('_crossSyncRepair: myRoot is empty! platform=' + this.platform + ', deviceId=' + this._getDeviceId() + ', syncRoots=' + JSON.stringify(this.syncRoots));
            return null;
        }

        var normalized = localPath.replace(/\\/g, '/').replace(/\/+/g, '/');
        var myRootNorm = myRoot.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/+$/, '');
        var otherRoots = this._getOtherSyncRoots();

        // 遍历所有其他设备的 syncRoot，找到原路径属于哪个设备
        for (var i = 0; i < otherRoots.length; i++) {
            var pRoot = otherRoots[i].path;
            var pRootNorm = pRoot.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/+$/, '');
            if (normalized.indexOf(pRootNorm) === 0) {
                // 精确前缀匹配：确保匹配到的是完整路径段（后面紧跟 / 或到末尾）
                var nextChar = normalized.charAt(pRootNorm.length);
                if (nextChar !== '' && nextChar !== '/') continue;

                // 匹配到其他设备的 syncRoot，提取相对路径
                var relative = normalized.substring(pRootNorm.length);
                if (relative.charAt(0) === '/') relative = relative.substring(1);

                // 用当前设备的 syncRoot 拼接新路径（myRootNorm 已在循环外计算，含去连续斜杠）
                var newPath = relative ? (myRootNorm + '/' + relative) : myRootNorm;

                // Windows 路径使用反斜杠
                if (this.isWindows) {
                    newPath = newPath.replace(/\//g, '\\');
                }

                return {
                    newPath: newPath,
                    syncSearchRoot: myRoot,
                    exists: fs && fs.existsSync && fs.existsSync(newPath)
                };
            }
        }
        that._log('_crossSyncRepair: no matching otherRoot found for localPath=' + localPath + ', otherRoots=' + JSON.stringify(otherRoots.map(function(r) { return r.path; })));
        return null;
    }

    /**
     * 获取根路径（跨平台兼容）
     * Windows: C:\ (driveLetter 存盘符字母)
     * macOS/Linux: / 或 /Volumes/xxx (driveLetter 存完整路径)
     */
    getRootPath() {
        if (this.isWindows) return this.driveLetter + ':\\';
        // macOS/Linux: driveLetter 存的已是完整路径（如 '/' 或 '/Volumes/Data'）
        return this.driveLetter || '/';
    }

    /**
     * 从路径同步 driveLetter 和下拉框（跨平台）
     * Windows: 从路径提取盘符字母（如 C:\ → 'C'）
     * macOS: 从路径匹配 /Volumes/xxx 或 /
     * Linux: 从路径匹配 /mnt/xxx 或 /
     * @param {string} filePath - 当前路径
     * @param {boolean} updateSelect - 是否同步更新下拉框
     */
    _syncDriveLetterFromPath(filePath, updateSelect) {
        var newDrive = this.driveLetter;
        if (this.isWindows) {
            var driveMatch = filePath.match(/^([A-Za-z]):/);
            if (driveMatch) {
                newDrive = driveMatch[1].toUpperCase();
            }
        } else if (this.platform === 'darwin') {
            // macOS: 匹配 /Volumes/xxx 或 /
            if (filePath.indexOf('/Volumes/') === 0) {
                var volEnd = filePath.indexOf('/', 9);  // /Volumes/ 后第一个 /
                newDrive = volEnd > 0 ? filePath.substring(0, volEnd) : filePath;
            } else if (filePath.charAt(0) === '/') {
                newDrive = '/';
            }
        } else {
            // Linux: 匹配 /mnt/xxx 或 /media/xxx 或 /
            if (filePath.indexOf('/mnt/') === 0) {
                var mntEnd = filePath.indexOf('/', 6);
                newDrive = mntEnd > 0 ? filePath.substring(0, mntEnd) : filePath;
            } else if (filePath.indexOf('/media/') === 0) {
                // /media/user/device → 取到 /media/user/device
                var parts = filePath.split('/');
                if (parts.length >= 4) {
                    newDrive = '/' + parts[1] + '/' + parts[2] + '/' + parts[3];
                } else if (parts.length >= 3) {
                    newDrive = '/' + parts[1] + '/' + parts[2];
                } else {
                    newDrive = filePath;
                }
            } else if (filePath.indexOf('/home/') === 0) {
                var homeEnd = filePath.indexOf('/', 6);
                newDrive = homeEnd > 0 ? filePath.substring(0, homeEnd) : filePath;
            } else if (filePath.charAt(0) === '/') {
                newDrive = '/';
            }
        }
        if (newDrive !== this.driveLetter) {
            this.driveLetter = newDrive;
        }
        if (updateSelect) {
            var driveSelect = document.getElementById('cd-drive-select');
            if (driveSelect) {
                driveSelect.value = newDrive;
            }
        }
    }

    /**
     * 从 data.json 加载视图设置
     */
    loadViewSettings() {
        var that = this;
        try {
            if (typeof this.loadData === 'function') {
                this.loadData('viewSettings').then(function(data) {
                    if (data && typeof data === 'object' && data.currentView) {
                        that.currentView = data.currentView;
                    }
                }).catch(function() {
                    // 忽略加载失败
                });
            } else {
                var saved = localStorage.getItem('cd_view_settings');
                if (saved) {
                    var parsed = JSON.parse(saved);
                    if (parsed.currentView) that.currentView = parsed.currentView;
                }
            }
        } catch (e) {
            // 忽略错误
        }
    }

    /**
     * 保存视图设置到 data.json
     */
    saveViewSettings() {
        var that = this;
        try {
            var data = { currentView: this.currentView };
            if (typeof this.saveData === 'function') {
                this.saveData('viewSettings', data).catch(function(e) {
                    that._error('save view settings failed:', e);
                });
            } else {
                localStorage.setItem('cd_view_settings', JSON.stringify(data));
            }
        } catch (e) {
            that._error('save view settings error:', e);
        }
    }

    /**
     * 从 data.json 加载文件-文档关联映射（按平台隔离）
     * 存储格式: { "win32": { "C:\\path\\to\\file": "20240101docId", ... }, "darwin": {...}, "linux": {...} }
     */
    loadFileDocMap() {
        var that = this;
        try {
            if (typeof this.loadData === 'function') {
                this.loadData('fileDocMap').then(function(data) {
                    that.fileDocMap = that._extractPlatformData(data);
                }).catch(function() {
                    that.fileDocMap = {};
                });
            } else {
                var saved = localStorage.getItem('cd_file_doc_map');
                if (saved) {
                    try {
                        that.fileDocMap = that._extractPlatformData(JSON.parse(saved));
                    } catch (e) {
                        that.fileDocMap = {};
                    }
                }
            }
        } catch (e) {
            this.fileDocMap = {};
        }
    }

    /**
     * 保存文件-文档关联映射到 data.json（按平台隔离）
     */
    saveFileDocMap() {
        var that = this;
        try {
            var fullData = {};
            if (typeof this.loadData === 'function') {
                // 先读取现有数据，更新当前平台部分，保留其他平台
                this.loadData('fileDocMap').then(function(existing) {
                    if (existing && typeof existing === 'object') {
                        fullData = existing;
                    }
                    fullData[that.platform] = that.fileDocMap;
                    that.saveData('fileDocMap', fullData).catch(function(e) {
                        that._error('saveFileDocMap failed:', e);
                    });
                }).catch(function() {
                    fullData[that.platform] = that.fileDocMap;
                    that.saveData('fileDocMap', fullData).catch(function(e) {
                        that._error('saveFileDocMap failed:', e);
                    });
                });
            } else {
                var saved = localStorage.getItem('cd_file_doc_map');
                if (saved) {
                    try {
                        fullData = JSON.parse(saved);
                    } catch (e) {}
                }
                if (!fullData || typeof fullData !== 'object') fullData = {};
                fullData[this.platform] = this.fileDocMap;
                localStorage.setItem('cd_file_doc_map', JSON.stringify(fullData));
            }
        } catch (e) {
            this._error('saveFileDocMap error:', e);
        }
    }

    /**
     * 从存储数据中解析当前平台的数据（兼容旧格式纯对象）
     */
    _extractPlatformData(data) {
        if (!data) return {};
        // 旧格式兼容：直接是 path→docId 映射
        if (typeof data === 'object' && !data.win32 && !data.darwin && !data.linux) {
            return data;
        }
        // 新格式：按平台分组的字典
        if (data && typeof data === 'object' && typeof data[this.platform] === 'object') {
            return data[this.platform];
        }
        return {};
    }

    /**
     * 移动/重命名文件后，更新 fileDocMap 中的关联路径
     * @param {string} oldPath - 原路径
     * @param {string} newPath - 新路径
     */
    updateFileDocMapPath(oldPath, newPath) {
        if (oldPath === newPath) return;
        var updated = false;
        // 直接匹配：文件本身的关联
        if (this.fileDocMap[oldPath]) {
            this.fileDocMap[newPath] = this.fileDocMap[oldPath];
            delete this.fileDocMap[oldPath];
            updated = true;
        }
        // 前缀匹配：文件夹移动时，其内部文件的关联路径也需要更新
        var oldPrefix = oldPath + path.sep;
        var keys = Object.keys(this.fileDocMap);
        for (var i = 0; i < keys.length; i++) {
            if (keys[i].indexOf(oldPrefix) === 0) {
                var newKey = newPath + keys[i].substring(oldPath.length);
                this.fileDocMap[newKey] = this.fileDocMap[keys[i]];
                delete this.fileDocMap[keys[i]];
                updated = true;
            }
        }
        if (updated) {
            this.saveFileDocMap();
        }
    }

    /**
     * 检查文件是否已关联文档
     */
    isFileDocLinked(filePath) {
        return !!this.fileDocMap[filePath];
    }

    /**
     * 获取文件关联的文档ID
     */
    getLinkedDocId(filePath) {
        return this.fileDocMap[filePath] || null;
    }

    /**
     * 关联文件与当前文档，并在文档第一行插入文件链接
     */
    linkFileToCurrentDoc(filePath) {
        var that = this;
        var docId = that.getCurrentDocId();
        if (!docId) {
            that.showToastMsg('无法获取当前文档 ID，请先打开一个文档');
            return;
        }
        that.fileDocMap[filePath] = docId;
        that.saveFileDocMap();
        that.loadDirectory(that.currentPath); // 刷新文件列表显示关联图标
        that.showToastMsg('已关联当前文档');

        // 在当前文档第一行插入文件链接
        that.insertLinkAtDocTop(docId, filePath);
    }

    /**
     * 在指定文档的第一行插入文件链接
     */
    insertLinkAtDocTop(docId, filePath) {
        var that = this;
        var fileName = require('path').basename(filePath);
        var isDir = false;
        try { isDir = fs.statSync(filePath).isDirectory(); } catch(e) {}

        var markdown = that.buildLocalFileMarkdown(filePath, fileName, isDir);

        // 获取文档第一个子块 ID，用于 nextID 参数将链接插入到第一行
        fetch('/api/block/getChildBlocks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: docId }),
            credentials: 'include'
        }).then(function(resp) {
            return resp.json();
        }).then(function(data) {
            if (data.code === 0 && data.data && data.data.length > 0) {
                var firstBlockId = data.data[0].id;
                // 用 nextID 插入到第一个块前面（即文档第一行）
                return fetch('/api/block/insertBlock', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        data: markdown,
                        dataType: 'markdown',
                        nextID: firstBlockId
                    }),
                    credentials: 'include'
                });
            } else {
                // 文档没有子块（空文档），用 parentID 追加
                return fetch('/api/block/insertBlock', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        data: markdown,
                        dataType: 'markdown',
                        parentID: docId
                    }),
                    credentials: 'include'
                });
            }
        }).then(function(resp) {
            if (resp) return resp.json();
        }).then(function(data) {
            if (data && data.code !== 0) {
                that._log('insertLinkAtDocTop API failed:', data.msg);
            }
        }).catch(function(e) {
            that._error('insertLinkAtDocTop error:', e);
        });
    }

    /**
     * 取消文件与文档的关联
     */
    unlinkFileDoc(filePath) {
        var that = this;
        if (that.fileDocMap[filePath]) {
            delete that.fileDocMap[filePath];
            that.saveFileDocMap();
            that.loadDirectory(that.currentPath); // 刷新文件列表
            that.showToastMsg('已取消关联');
        }
    }

    /**
     * 打开关联的文档
     */
    openLinkedDoc(filePath) {
        var that = this;
        var docId = that.getLinkedDocId(filePath);
        if (!docId) {
            that.showToastMsg('该文件未关联文档');
            return;
        }
        // 使用思源 API 打开文档
        try {
            var app = (window.siyuan && window.siyuan.app) ? window.siyuan.app : null;
            if (window.siyuan && typeof window.siyuan.openTab === 'function' && app) {
                window.siyuan.openTab({
                    app: app,
                    position: 'right',
                    doc: { id: docId },
                    keepCursor: false,
                    removeCurrentTab: false
                });
            } else if (window.siyuan && typeof window.siyuan.openBy === 'function') {
                window.siyuan.openBy({ id: docId, position: 'right' });
            } else {
                // 最终降级方案：使用 siyuan:// 协议链接
                window.open('siyuan://blocks/' + docId);
            }
        } catch (e) {
            that._error('openLinkedDoc error:', e);
            that.showToastMsg('打开文档失败');
        }
    }

    /**
     * 从 data.json 加载收藏夹（按平台隔离）
     * 存储格式: { "win32": [...], "darwin": [...], "linux": [...] }
     */
    loadFavorites() {
        var that = this;
        try {
            if (typeof this.loadData === 'function') {
                this.loadData('favorites').then(function(data) {
                    that.favorites = that._extractPlatformFavorites(data);
                    that.renderFavorites();
                }).catch(function() {
                    that.favorites = [];
                });
            } else {
                var saved = localStorage.getItem('cd_favorites');
                if (saved) {
                    try {
                        var parsed = JSON.parse(saved);
                        that.favorites = that._extractPlatformFavorites(parsed);
                    } catch (e) {
                        that.favorites = [];
                    }
                }
                that.renderFavorites();
            }
        } catch (e) {
            this.favorites = [];
        }
    }

    /**
     * 从存储数据中解析当前平台的收藏夹（兼容旧格式纯数组）
     */
    _extractPlatformFavorites(data) {
        // 旧格式兼容：纯数组 → 归到当前平台
        if (Array.isArray(data)) {
            return data;
        }
        // 新格式：按平台分组的字典
        if (data && typeof data === 'object' && Array.isArray(data[this.platform])) {
            return data[this.platform];
        }
        return [];
    }

    /**
     * 保存收藏夹到 data.json（按平台隔离）
     */
    saveFavorites() {
        var that = this;
        try {
            // 先读取现有数据，更新当前平台部分，保留其他平台
            var fullData = {};
            if (typeof this.loadData === 'function') {
                // 异步读取 → 合并 → 保存
                this.loadData('favorites').then(function(existing) {
                    fullData = that._mergePlatformFavorites(existing, that.favorites);
                    return that.saveData('favorites', fullData);
                }).catch(function() {
                    // 读取失败时直接构造新数据
                    fullData[that.platform] = that.favorites;
                    return that.saveData('favorites', fullData);
                }).catch(function(e) {
                    that._error('save favorites failed:', e);
                });
            } else {
                var saved = localStorage.getItem('cd_favorites');
                if (saved) {
                    try {
                        fullData = that._mergePlatformFavorites(JSON.parse(saved), that.favorites);
                    } catch (e) {
                        fullData = {};
                        fullData[that.platform] = that.favorites;
                    }
                } else {
                    fullData[that.platform] = that.favorites;
                }
                localStorage.setItem('cd_favorites', JSON.stringify(fullData));
            }
        } catch (e) {
            that._error('save favorites error:', e);
        }
        this.renderFavorites();
    }

    /**
     * 将当前平台收藏合并到完整数据中，保留其他平台不变
     */
    _mergePlatformFavorites(existing, currentFavs) {
        var fullData = {};
        if (Array.isArray(existing)) {
            // 旧格式迁移：纯数组归到当前平台
            fullData[this.platform] = existing;
        } else if (existing && typeof existing === 'object') {
            // 新格式：复制现有各平台数据
            var platforms = ['win32', 'darwin', 'linux'];
            for (var i = 0; i < platforms.length; i++) {
                var p = platforms[i];
                if (Array.isArray(existing[p])) {
                    fullData[p] = existing[p];
                }
            }
        }
        fullData[this.platform] = currentFavs;
        return fullData;
    }

    /**
     * 渲染收藏夹列表到面板
     */
    renderFavorites() {
        var that = this;
        var list = document.getElementById('cd-favorites-list');
        if (!list) return;

        list.innerHTML = '';

        if (!this.favorites || this.favorites.length === 0) {
            return;
        }

        for (var i = 0; i < this.favorites.length; i++) {
            var fav = this.favorites[i];
            var btn = document.createElement('div');
            btn.style.cssText = 'display:inline-flex;align-items:center;gap:3px;padding:2px 6px;font-size:10px;background:var(--b3-theme-surface,#f0f0f0);border:1px solid var(--b3-border,#ddd);border-radius:10px;cursor:pointer;white-space:nowrap;max-width:100px;overflow:hidden;text-overflow:ellipsis;transition:background 0.15s;flex-shrink:0;user-select:none';
            btn.title = fav.path;
            btn.draggable = true;
            btn.dataset.favIndex = i;
            btn.innerHTML = '<span style="font-size:10px">⭐</span><span style="overflow:hidden;text-overflow:ellipsis">' + this.escapeHtml(fav.name) + '</span>';

            (function(favPath, favName, btnEl) {
                btnEl.addEventListener('click', function() {
                    that.loadDirectory(favPath);
                });
                btnEl.addEventListener('mouseenter', function() {
                    this.style.background = 'var(--b3-theme-hover,#e3f2fd)';
                });
                btnEl.addEventListener('mouseleave', function() {
                    this.style.background = 'var(--b3-theme-surface,#f0f0f0)';
                });
                btnEl.addEventListener('contextmenu', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    that.removeFavorite(favPath);
                });

                // 拖拽排序
                btnEl.addEventListener('dragstart', function(e) {
                    this.style.opacity = '0.4';
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', favPath);
                    that._dragFavIndex = parseInt(this.dataset.favIndex, 10);
                    that._dragSrcBtn = this;
                });
                btnEl.addEventListener('dragend', function(e) {
                    this.style.opacity = '';
                    that._dragFavIndex = null;
                    that._dragSrcBtn = null;
                    that._dragOverTarget = null;
                    // 清除所有视觉指示器
                    var allBtns = list.querySelectorAll('[data-fav-index]');
                    for (var k = 0; k < allBtns.length; k++) {
                        allBtns[k].classList.remove('cd-fav-drag-before', 'cd-fav-drag-after');
                    }
                });
                btnEl.addEventListener('dragover', function(e) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    if (that._dragFavIndex === null || !that._dragSrcBtn || that._dragSrcBtn === this) return;
                    // 节流：如果目标没变，不做任何操作
                    if (that._dragOverTarget === this) return;
                    that._dragOverTarget = this;
                    var targetIndex = parseInt(this.dataset.favIndex, 10);
                    var srcIndex = parseInt(that._dragSrcBtn.dataset.favIndex, 10);
                    // 清除所有视觉指示器
                    var allBtns = list.querySelectorAll('[data-fav-index]');
                    for (var k = 0; k < allBtns.length; k++) {
                        allBtns[k].classList.remove('cd-fav-drag-before', 'cd-fav-drag-after');
                    }
                    // 只添加视觉指示器，不移动 DOM（避免频繁布局抖动）
                    if (targetIndex < srcIndex) {
                        this.classList.add('cd-fav-drag-before');
                    } else {
                        this.classList.add('cd-fav-drag-after');
                    }
                });
                btnEl.addEventListener('dragleave', function(e) {
                    // 延迟清除，避免鼠标在按钮内部微动时频繁闪烁
                    var btn = this;
                    setTimeout(function() {
                        if (that._dragOverTarget !== btn) {
                            btn.classList.remove('cd-fav-drag-before', 'cd-fav-drag-after');
                        }
                    }, 50);
                });
                btnEl.addEventListener('drop', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    var targetIndex = parseInt(this.dataset.favIndex, 10);
                    var srcIndex = parseInt(that._dragSrcBtn.dataset.favIndex, 10);
                    // 清除视觉指示器
                    this.classList.remove('cd-fav-drag-before', 'cd-fav-drag-after');
                    that._dragOverTarget = null;
                    if (srcIndex === targetIndex) return;
                    // 移动 DOM 元素
                    var listEl = document.getElementById('cd-favorites-list');
                    if (targetIndex < srcIndex) {
                        listEl.insertBefore(that._dragSrcBtn, this);
                    } else {
                        listEl.insertBefore(that._dragSrcBtn, this.nextSibling);
                    }
                    // 按 DOM 顺序的 title 路径匹配重建 favorites 数组
                    var allBtns = listEl.querySelectorAll('[data-fav-index]');
                    var orderedFavs = [];
                    for (var n = 0; n < allBtns.length; n++) {
                        var btnPath = allBtns[n].title;
                        for (var p = 0; p < that.favorites.length; p++) {
                            if (that.favorites[p].path === btnPath) {
                                orderedFavs.push(that.favorites[p]);
                                break;
                            }
                        }
                    }
                    if (orderedFavs.length === that.favorites.length) {
                        that.favorites = orderedFavs;
                        that.saveFavorites();
                    }
                    // 更新 data-fav-index 为新顺序
                    var finalBtns = listEl.querySelectorAll('[data-fav-index]');
                    for (var q = 0; q < finalBtns.length; q++) {
                        finalBtns[q].dataset.favIndex = q;
                    }
                });
            })(fav.path, fav.name, btn);

            list.appendChild(btn);
        }
    }

    /**
     * 检查路径是否已收藏
     */
    isFavorite(dirPath) {
        for (var i = 0; i < this.favorites.length; i++) {
            if (this.favorites[i].path === dirPath) return true;
        }
        return false;
    }

    /**
     * 添加收藏
     */
    addFavorite(dirPath, dirName) {
        if (this.isFavorite(dirPath)) return;
        this.favorites.push({ path: dirPath, name: dirName });
        this.saveFavorites();
        this.loadDirectory(this.currentPath);
    }

    /**
     * 移除收藏
     */
    removeFavorite(dirPath) {
        var removed = null;
        for (var i = this.favorites.length - 1; i >= 0; i--) {
            if (this.favorites[i].path === dirPath) {
                removed = this.favorites[i].name;
                this.favorites.splice(i, 1);
            }
        }
        if (removed) {
            this.saveFavorites();
            this.loadDirectory(this.currentPath);
        }
    }

    getFileIcon(fileName) {
        var ext = fileName.split('.').pop().toLowerCase();
        var icons = {
            'pdf': '📕', 'doc': '📄', 'docx': '📄', 'xls': '📊', 'xlsx': '📊',
            'ppt': '📊', 'pptx': '📊', 'txt': '📝', 'md': '📝',
            'jpg': '🖼️', 'jpeg': '🖼️', 'png': '🖼️', 'gif': '🖼️', 'webp': '🖼️', 'svg': '🖼️', 'bmp': '🖼️', 'heic': '🖼️', 'heif': '🖼️', 'livp': '📷',
            'mp3': '🎵', 'wav': '🎵', 'flac': '🎵', 'aac': '🎵', 'ogg': '🎵', 'wma': '🎵', 'm4a': '🎵', 'ape': '🎵', 'opus': '🎵', 'aiff': '🎵', 'alac': '🎵',
            'mp4': '🎬', 'avi': '🎬', 'mkv': '🎬', 'mov': '🎬',
            'zip': '📦', 'rar': '📦', '7z': '📦', 'tar': '📦', 'gz': '📦',
            'exe': '⚙️', 'dll': '⚙️', 'msi': '⚙️',
            'epub': '📖'
        };
        return icons[ext] || '📄';
    }

    formatSize(bytes) {
        if (bytes === 0) return '0 B';
        if (!bytes) return '';
        var units = ['B', 'KB', 'MB', 'GB', 'TB'];
        var i = 0;
        var size = bytes;
        while (size >= 1024 && i < units.length - 1) {
            size /= 1024;
            i++;
        }
        return size.toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
    }

    /**
     * 显示当前目录文件类型统计面板
     */
    /**
     * 更新底部文件统计栏（自动在加载目录后调用）
     */
    updateFileStats() {
        var that = this;
        var statsText = document.getElementById('cd-stats-text');
        if (!statsText) return;

        var files = that.cachedFiles || [];
        if (files.length === 0) {
            statsText.innerHTML = '📊 目录为空';
            return;
        }

        var categories = {
            '📷': { exts: ['jpg','jpeg','png','gif','webp','svg','bmp','heic','heif','ico','tiff','tif'] },
            '📄': { exts: ['pdf','doc','docx','xls','xlsx','ppt','pptx','txt','md','csv','rtf','odt'] },
            '🎬': { exts: ['mp4','avi','mkv','mov','wmv','flv','webm','m4v','mpg','mpeg'] },
            '🎵': { exts: ['mp3','wav','flac','aac','ogg','wma','m4a','ape'] },
            '📦': { exts: ['zip','rar','7z','tar','gz','bz2','xz','iso'] },
            '💻': { exts: ['js','ts','jsx','tsx','py','java','cpp','c','h','hpp','html','css','json','xml','yaml','yml','go','rs','rb','php','swift','kt'] }
        };

        var stats = {};
        var totalSize = 0;
        var totalFiles = 0;
        var folderCount = 0;

        for (var i = 0; i < files.length; i++) {
            var f = files[i];
            if (f.isDir) {
                folderCount++;
                continue;
            }
            totalFiles++;
            totalSize += f.size || 0;

            var ext = f.name.split('.').pop().toLowerCase();
            var found = false;
            for (var cat in categories) {
                if (categories[cat].exts.indexOf(ext) !== -1) {
                    if (!stats[cat]) stats[cat] = { count: 0, size: 0 };
                    stats[cat].count++;
                    stats[cat].size += f.size || 0;
                    found = true;
                    break;
                }
            }
            if (!found) {
                if (!stats['📎']) stats['📎'] = { count: 0, size: 0 };
                stats['📎'].count++;
                stats['📎'].size += f.size || 0;
            }
        }

        // 按大小降序排列
        var catOrder = [];
        for (var cat in stats) {
            catOrder.push({ name: cat, count: stats[cat].count, size: stats[cat].size });
        }
        catOrder.sort(function(a, b) { return b.size - a.size; });

        var parts = [];
        for (var j = 0; j < catOrder.length; j++) {
            var c = catOrder[j];
            parts.push(c.name + ' ' + c.count + '个/' + that.formatSize(c.size));
        }
        if (folderCount > 0) {
            parts.push('📁 ' + folderCount + '个');
        }

        statsText.innerHTML = '<span title="' + that.escapeHtml(parts.join(' | ')) + '">' +
            '📊 ' + totalFiles + '个文件' +
            (folderCount > 0 ? ' · ' + folderCount + '个文件夹' : '') +
            ' · 共 ' + that.formatSize(totalSize) +
            ' <span style="opacity:0.6">(' + parts.join(' | ') + ')</span>' +
        '</span>';

        // 统计栏高度变化后，同步更新歌词面板的 bottom 定位
        var lrcPanel = document.getElementById('cd-audio-lrc-panel');
        if (lrcPanel && lrcPanel.style.display !== 'none') {
            var statsBar = document.getElementById('cd-stats-bar');
            var audioBar = document.getElementById('cd-audio-bar');
            var newBottom = 4;
            if (statsBar) newBottom += statsBar.offsetHeight;
            if (audioBar) newBottom += audioBar.offsetHeight;
            lrcPanel.style.bottom = newBottom + 'px';
        }
    }

    /**
     * 从图片文件中读取 EXIF 拍摄时间
     * 仅解析 JPEG 的 EXIF IFD，轻量实现无需第三方库
     */
    readExifData(filePath, callback) {
        var that = this;
        try {
            var fs = require('fs');
            // 只读取文件前 64KB，EXIF 数据通常在此范围内
            var buf = Buffer.alloc(65536);
            var fd = fs.openSync(filePath, 'r');
            var bytesRead = fs.readSync(fd, buf, 0, 65536, 0);
            fs.closeSync(fd);
            if (bytesRead < 4) { callback(null); return; }

            try {
                // 检查 JPEG 文件头
                if (buf[0] !== 0xFF || buf[1] !== 0xD8) { callback(null); return; }

                var offset = 2;
                var totalLen = bytesRead;
                while (offset < totalLen - 4) {
                    if (buf[offset] !== 0xFF) break;
                    var marker = buf[offset + 1];
                    // APP1 (EXIF)
                    if (marker === 0xE1) {
                        var segLen = (buf[offset + 2] << 8) | buf[offset + 3];
                        // 检查 "Exif\0\0" 头
                        if (offset + 10 < totalLen &&
                            buf[offset + 4] === 0x45 && buf[offset + 5] === 0x78 &&
                            buf[offset + 6] === 0x69 && buf[offset + 7] === 0x66) {
                            var exifStart = offset + 10;
                            var exifBuf = buf.slice(exifStart, offset + 2 + segLen);
                            var exifResult = that.parseExifIFD(exifBuf);
                            callback(exifResult);
                            return;
                        }
                        offset += 2 + segLen;
                    } else if (marker >= 0xD0 && marker <= 0xD9) {
                        // 无长度的标记 (RST, SOI, EOI 等)
                        offset += 2;
                    } else if (marker === 0xDA) {
                        // SOS - 图像数据开始，后面不是 EXIF
                        break;
                    } else {
                        var segLen2 = (buf[offset + 2] << 8) | buf[offset + 3];
                        offset += 2 + segLen2;
                    }
                }
            } catch (e) { /* 解析失败 */ }
            callback(null);
        } catch (e) {
            callback(null);
        }
    }

    /**
     * 解析 EXIF IFD 数据，提取拍摄时间
     * 返回 { dateTime } 或 null
     */
    parseExifIFD(exifBuf) {
        if (exifBuf.length < 8) return null;
        // 字节序
        var bigEndian = true;
        if (exifBuf[0] === 0x49 && exifBuf[1] === 0x49) bigEndian = false;
        else if (exifBuf[0] === 0x4D && exifBuf[1] === 0x4D) bigEndian = true;
        else return null;

        var get16 = function(buf, off) {
            return bigEndian ? (buf[off] << 8) | buf[off + 1] : buf[off] | (buf[off + 1] << 8);
        };
        var get32 = function(buf, off) {
            return bigEndian ? ((buf[off] << 24) | (buf[off + 1] << 16) | (buf[off + 2] << 8) | buf[off + 3]) >>> 0
                            : ((buf[off + 3] << 24) | (buf[off + 2] << 16) | (buf[off + 1] << 8) | buf[off]) >>> 0;
        };

        var result = { dateTime: null };

        var ifd0Offset = get32(exifBuf, 4);
        if (ifd0Offset + 2 > exifBuf.length) return null;

        var numEntries = get16(exifBuf, ifd0Offset);
        var exifIFDOffset = null;

        // 在 IFD0 中查找 ExifOffset (0x8769)
        for (var i = 0; i < numEntries; i++) {
            var entryOff = ifd0Offset + 2 + i * 12;
            if (entryOff + 12 > exifBuf.length) break;
            var tag = get16(exifBuf, entryOff);
            if (tag === 0x8769) {
                exifIFDOffset = get32(exifBuf, entryOff + 8);
            }
        }

        // 解析 Exif IFD：查找 DateTimeOriginal (0x9003)
        if (exifIFDOffset !== null && exifIFDOffset + 2 <= exifBuf.length) {
            var exifEntries = get16(exifBuf, exifIFDOffset);
            for (var j = 0; j < exifEntries; j++) {
                var eOff = exifIFDOffset + 2 + j * 12;
                if (eOff + 12 > exifBuf.length) break;
                var eTag = get16(exifBuf, eOff);
                if (eTag === 0x9003) {
                    var count = get32(exifBuf, eOff + 4);
                    var valOff = get32(exifBuf, eOff + 8);
                    var strStart = (count <= 4) ? eOff + 8 : valOff;
                    if (strStart + count <= exifBuf.length) {
                        var str = '';
                        for (var k = 0; k < count - 1; k++) {
                            str += String.fromCharCode(exifBuf[strStart + k]);
                        }
                        result.dateTime = str.replace(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/, function(m, y, mo, d, h, mi) {
                            return y + '-' + mo + '-' + d + ' ' + h + ':' + mi;
                        });
                    }
                    break;
                }
            }
        }

        return result.dateTime ? result : null;
    }

    /**
     * 格式化时间戳为友好显示
     */
    formatTime(timestamp) {
        if (!timestamp) return '';
        var date = new Date(timestamp);
        var y = date.getFullYear();
        var m = date.getMonth() + 1;
        var d = date.getDate();
        var hh = date.getHours();
        var mm = date.getMinutes();
        var pad = function(n) { return n < 10 ? '0' + n : n; };

        return y + '-' + pad(m) + '-' + pad(d) + ' ' + pad(hh) + ':' + pad(mm);
    }

    escapeHtml(text) {
        return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    escapeMarkdown(text) {
        // 转义 Markdown 特殊字符：[]()*
        // 反引号 \` 在大多数 Markdown 解析器中不生效，替换为 Unicode 全角反引号
        return String(text).replace(/[\[\]\(\)\*]/g, '\\$&').replace(/`/g, '\uFF40');
    }

    /**
     * 图标视图：渲染一批文件项
     */
    renderIconBatch(fileListEl) {
        var that = this;
        var state = that.iconRenderState;
        if (!state || state.isLoading) return;

        state.isLoading = true;
        state._pendingScroll = false;  // 清除待处理标记
        var files = state.files;
        var currentPath = state.currentPath;
        var batchSize = state.batchSize;
        var startIdx = state.renderedCount;
        var endIdx = Math.min(startIdx + batchSize, files.length);

        if (startIdx >= files.length) {
            state.isLoading = false;
            return;
        }

        var html = '';
        for (var i = startIdx; i < endIdx; i++) {
            html += that.buildIconItem(files[i], currentPath);
        }

        // 使用 insertAdjacentHTML 追加，避免重新渲染已有内容
        if (startIdx === 0) {
            fileListEl.innerHTML = html;
            // 首批渲染后恢复滚动位置
            that._restoreScrollPosition(fileListEl, currentPath);
        } else {
            fileListEl.insertAdjacentHTML('beforeend', html);
        }

        state.renderedCount = endIdx;

        // 绑定新项的事件
        that.bindItemEvents(fileListEl, files, currentPath);

        // 首次渲染时加载可见缩略图
        that.loadVisibleThumbnails(fileListEl);

        state.isLoading = false;

        // 图标视图主动预加载：始终确保渲染了足够多的内容
        // 不依赖 scrollHeight 触发，保证滚动流畅
        requestAnimationFrame(function() {
            var shouldLoad = false;
            if (fileListEl.scrollHeight <= fileListEl.clientHeight + 200) {
                shouldLoad = true;  // 内容不足以覆盖视口
            }
            // 已渲染内容不足视口高度的 2 倍时继续预加载
            if (state.renderedCount < state.files.length && fileListEl.scrollHeight < fileListEl.clientHeight * 2) {
                shouldLoad = true;
            }
            if (shouldLoad && state.renderedCount < state.files.length) {
                that.renderIconBatch(fileListEl);
            } else if (state._pendingScroll && state.renderedCount < state.files.length) {
                // 滚动事件期间被 isLoading 阻挡的请求，在加载完成后补上
                state._pendingScroll = false;
                that.renderIconBatch(fileListEl);
            }
        });
    }

    /**
     * 加载当前视口内可见的缩略图
     * 只有在视口范围内的占位符才会被替换为真实 <img>
     * 带并发控制，避免同时加载过多图片导致卡顿
     */
    loadVisibleThumbnails(container) {
        if (!container) return;
        var wraps = container.querySelectorAll('.cd-thumb-wrap[data-src]:not([data-loaded]):not([data-large])');
        if (wraps.length === 0) return;

        var containerRect = container.getBoundingClientRect();
        var viewTop = containerRect.top - 50;    // 上方预加载 50px
        var viewBottom = containerRect.bottom + 50; // 下方预加载 50px

        // 收集视口内的缩略图，按从上到下排序
        var visible = [];
        for (var i = 0; i < wraps.length; i++) {
            var wrap = wraps[i];
            var rect = wrap.getBoundingClientRect();
            if (rect.bottom >= viewTop && rect.top <= viewBottom) {
                visible.push({ wrap: wrap, top: rect.top });
            }
        }
        visible.sort(function(a, b) { return a.top - b.top; });

        // 并发控制：同时最多加载 4 个缩略图
        var maxConcurrent = 4;
        var that = this;
        if (!that._thumbQueue) that._thumbQueue = [];
        if (!that._thumbLoading) that._thumbLoading = 0;

        for (var i = 0; i < visible.length; i++) {
            that._thumbQueue.push(visible[i].wrap);
        }

        that._processThumbQueue();
    }

    /**
     * 处理缩略图加载队列，控制并发数
     */
    _processThumbQueue() {
        var that = this;
        if (!that._thumbQueue) return;
        var maxConcurrent = 4;

        while (that._thumbLoading < maxConcurrent && that._thumbQueue.length > 0) {
            var wrap = that._thumbQueue.shift();
            if (!wrap || !wrap.parentNode || wrap.dataset.loaded) continue;

            wrap.dataset.loaded = '1';
            that._thumbLoading++;
            var src = wrap.dataset.src;
            var img = document.createElement('img');
            img.src = src;
            img.decoding = 'async';
            img.loading = 'lazy';
            img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;opacity:0;transition:opacity 0.15s';
            img.onload = function() {
                this.style.opacity = '1';
                that._thumbLoading--;
                that._processThumbQueue();
            };
            img.onerror = function() {
                this.parentNode.innerHTML = '<span class="cd-thumb-placeholder" style="font-size:20px;color:var(--b3-theme-secondary,#999)">🖼️</span>';
                that._thumbLoading--;
                that._processThumbQueue();
            };
            var placeholder = wrap.querySelector('.cd-thumb-placeholder');
            if (placeholder) {
                wrap.replaceChild(img, placeholder);
            } else {
                wrap.innerHTML = '';
                wrap.appendChild(img);
            }
        }
    }

    /**
     * 悬浮时懒加载大图缩略图：Canvas 缩放为 56x56 替换占位符
     */
    loadLargeThumbnail(wrap) {
        if (!wrap || wrap.dataset.loaded === '1') return;
        var that = this;
        var src = wrap.dataset.src;
        if (!src) return;

        wrap.dataset.loaded = '1';

        var img = new Image();
        img.onload = function() {
            var scale = Math.min(56 / img.naturalWidth, 56 / img.naturalHeight);
            var w = Math.round(img.naturalWidth * scale);
            var h = Math.round(img.naturalHeight * scale);
            var canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            var ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            var dataUrl = canvas.toDataURL('image/jpeg', 0.7);

            var thumbImg = document.createElement('img');
            thumbImg.src = dataUrl;
            thumbImg.style.cssText = 'width:100%;height:100%;object-fit:contain;display:block';
            var placeholder = wrap.querySelector('.cd-thumb-placeholder');
            if (placeholder) {
                wrap.replaceChild(thumbImg, placeholder);
            }
        };
        img.onerror = function() {
            // 加载失败保留占位符
        };
        img.src = src;
    }

    /**
     * 图标视图：滚动事件处理（带防抖）
     */
    onIconScroll(e) {
        var that = this;
        var fileListEl = e.target;
        var state = that.iconRenderState;
        if (!state) return;

        // 标记正在滚动，暂停鼠标预览
        that._isScrolling = true;
        if (that._previewTimer) {
            clearTimeout(that._previewTimer);
            that._previewTimer = null;
        }
        that.hideImagePreview();

        // 滚动结束后恢复预览功能 + 加载可见缩略图
        if (that._scrollEndTimer) {
            clearTimeout(that._scrollEndTimer);
        }
        that._scrollEndTimer = setTimeout(function() {
            that._isScrolling = false;
        }, 300);

        // 清除之前的定时器
        if (that._scrollTimer) {
            clearTimeout(that._scrollTimer);
        }

        // 防抖：50ms 后加载缩略图 + 检查是否需要加载更多
        that._scrollTimer = setTimeout(function() {
            // 滚动停止，加载当前视口内的缩略图
            that.loadVisibleThumbnails(fileListEl);

            var scrollTop = fileListEl.scrollTop;
            var clientHeight = fileListEl.clientHeight;
            var scrollHeight = fileListEl.scrollHeight;
            var scrollBottom = scrollTop + clientHeight;
            
            // 提前加载：距离底部 300px 时就开始加载下一批，避免滚到底才加载的卡顿
            var needLoad = false;
            if (scrollHeight <= clientHeight + 50) {
                needLoad = true;
            } else if (scrollBottom >= scrollHeight - 300) {
                needLoad = true;
            }
            
            if (needLoad && state.renderedCount < state.files.length) {
                if (state.isLoading) {
                    // 正在加载中，标记待处理，加载完成后会自动补上
                    state._pendingScroll = true;
                } else {
                    that.renderIconBatch(fileListEl);
                }
            }
        }, 50);
    }

    // ========== 链接状态指示灯 ==========

    /**
     * 更新链接状态指示灯
     */
    _updateLinkIndicator(status) {
        var btn = document.getElementById('cd-relink-btn');
        if (!btn) {
            // 按钮还未渲染，延迟重试（最多 10 次）
            if (!this._linkRetryCount) this._linkRetryCount = 0;
            if (this._linkRetryCount < 10) {
                this._linkRetryCount++;
                var that = this;
                setTimeout(function() { that._updateLinkIndicator(status); }, 1000);
            }
            return;
        }
        this._linkRetryCount = 0;

        var icons = {
            'none':     { emoji: '⚪', color: 'var(--b3-theme-secondary,#999)', title: '无本地链接' },
            'checking': { emoji: '⏳', color: 'var(--b3-theme-secondary,#999)', title: '正在检测链接...' },
            'green':    { emoji: '🟢', color: '#4caf50', title: '本地链接正常 ✅' },
            'yellow':   { emoji: '🟡', color: '#ff9800', title: '有链接需要手动选择 ⚠️' },
            'red':      { emoji: '🔴', color: '#f44336', title: '有链接无法修复 🔗' }
        };

        var info = icons[status] || icons.none;
        btn.textContent = info.emoji;
        btn.style.color = info.color;
        btn.style.borderColor = info.color;
        btn.title = info.title;
        this._linkStatus = status;
    }

    /**
     * 自动检测当前文档的本地链接状态
     */
    async _autoCheckLinks() {
        var that = this;
        // Docker 浏览器模式下无法访问本地文件，链接修复无意义，跳过
        if (that._isDockerBrowser()) {
            that._updateLinkIndicator('none');
            return;
        }
        if (that._autoCheckRunning) return;  // 防止并发执行
        if (!document.getElementById('cd-relink-btn')) return;
        var docId = that.getCurrentDocId();
        if (!docId) {
            // 没有打开文档时显示白灯
            that._updateLinkIndicator('none');
            return;
        }

        if (docId === that._lastCheckedDocId && that._linkStatus !== 'none' && that._linkStatus !== 'checking') return;
        that._log('autoCheckLinks - checking doc:', docId);
        // 切换文档时重置跨端修复循环计数器
        if (docId !== that._lastCheckedDocId && that._crossSyncFixCount) {
            delete that._crossSyncFixCount[that._lastCheckedDocId];
        }
        that._lastCheckedDocId = docId;
        that._autoCheckRunning = true;

        that._updateLinkIndicator('checking');

        try {
            var result = await that.scanBrokenLinks(docId);
            that._log('autoCheckLinks - scan result:', result ? (result.total + ' total, ' + (result.broken ? result.broken.length : 0) + ' broken') : 'null');
            if (!result || result.total === 0) {
                // 没有本地链接时显示白灯
                that._updateLinkIndicator('none');
                return;
            }
            if (!result.broken || result.broken.length === 0) {
                // 有本地链接但都有效，先处理跨端同步直接修复
                if (result.crossSyncFixed && result.crossSyncFixed.length > 0) {
                    // 防止无限循环：如果同一文档连续跨端修复超过2次，说明 replaceLink 没生效，不再重试
                    if (!that._crossSyncFixCount) that._crossSyncFixCount = {};
                    if (!that._crossSyncFixCount[docId]) that._crossSyncFixCount[docId] = 0;
                    that._crossSyncFixCount[docId]++;
                    if (that._crossSyncFixCount[docId] <= 2) {
                        for (var csf0 = 0; csf0 < result.crossSyncFixed.length; csf0++) {
                            var csf0Item = result.crossSyncFixed[csf0];
                            try {
                                await that.replaceLink(docId, csf0Item.oldUrl, csf0Item.newPath, csf0, { silent: true });
                                that._log('autoCheckLinks - cross-sync fixed:', csf0Item.oldUrl, '→', csf0Item.newPath);
                            } catch(e) {
                                that._error('autoCheckLinks - cross-sync fix failed:', csf0Item.oldUrl, e);
                            }
                        }
                        // 跨端修复可能改变了文档内容，重置检查状态
                        that._lastCheckedDocId = '';
                    } else {
                        that._log('autoCheckLinks - cross-sync fix loop detected for doc', docId, '(count=' + that._crossSyncFixCount[docId] + '), skipping re-check');
                    }
                }
                // 显示绿灯
                that._updateLinkIndicator('green');
                return;
            }

            // 后台自动修复每个失效链接
            var autoFixed = 0;
            var needManual = 0;
            var unfixable = 0;

            // 保存未自动修复的链接及其搜索结果，供点击指示灯时复用
            var pendingItems = [];

            // 跨端同步前缀替换直接修复的链接
            if (result.crossSyncFixed && result.crossSyncFixed.length > 0) {
                if (!that._crossSyncFixCount) that._crossSyncFixCount = {};
                if (!that._crossSyncFixCount[docId]) that._crossSyncFixCount[docId] = 0;
                that._crossSyncFixCount[docId]++;
                if (that._crossSyncFixCount[docId] <= 2) {
                    for (var csf = 0; csf < result.crossSyncFixed.length; csf++) {
                        var csfItem = result.crossSyncFixed[csf];
                        try {
                            await that.replaceLink(docId, csfItem.oldUrl, csfItem.newPath, csf, { silent: true });
                            autoFixed++;
                            that._log('autoCheckLinks - cross-sync fixed:', csfItem.oldUrl, '→', csfItem.newPath);
                        } catch(e) {
                            that._error('autoCheckLinks - cross-sync fix failed:', csfItem.oldUrl, e);
                        }
                    }
                } else {
                    that._log('autoCheckLinks - cross-sync fix loop detected (broken branch) for doc', docId, '(count=' + that._crossSyncFixCount[docId] + ')');
                }
            }

            for (var i = 0; i < result.broken.length; i++) {
                var item = result.broken[i];
                that._log('autoCheckLinks - fixing:', item.fileName, 'from', item.localPath);
                var candidates = [];
                var parentDir = '';
                var lastSep = Math.max(item.localPath.lastIndexOf('\\'), item.localPath.lastIndexOf('/'));
                if (lastSep > 0) parentDir = item.localPath.substring(0, lastSep);

                // 跨端同步文件夹：搜索范围改为 syncRoot
                var isCrossSync = !!item._isCrossSync;
                var syncSearchRoot = item._syncSearchRoot || '';

                // R1: 旧路径附近（跨端同步则在 syncRoot 下搜索）
                var r1SearchDir = isCrossSync ? syncSearchRoot : parentDir;
                if (parentDir && !isCrossSync && !(await that._fsExists(parentDir))) {
                    // Docker: 宿主机路径不存在时尝试容器路径
                    var c1 = that.hostToContainer(parentDir);
                    if (c1 !== parentDir && (await that._fsExists(c1))) r1SearchDir = c1;
                }
                if (r1SearchDir && (await that._fsExists(r1SearchDir))) {
                    var r1 = await that.searchFileByName(item.fileName, r1SearchDir, {
                        maxDepth: isCrossSync ? 20 : 2, maxResults: 10, maxDirs: isCrossSync ? 99999 : 50, timeoutMs: isCrossSync ? 60000 : 2000
                    });
                    var r1Exact = r1.filter(function(c) { return c.matchType === 'exact' || c.matchType === 'case-insensitive'; });
                    if (r1Exact.length > 0) candidates = r1Exact;
                }

                // R2: 上级目录（跨端同步时跳过，因为已在 syncRoot 下搜索过）
                if (candidates.length === 0 && parentDir && !isCrossSync) {
                    var grandParent = '';
                    var gpSep = Math.max(parentDir.lastIndexOf('\\'), parentDir.lastIndexOf('/'));
                    if (gpSep > 2) grandParent = parentDir.substring(0, gpSep);
                    if (grandParent && grandParent.length > 3) {
                        var r2SearchDir = grandParent;
                        if (!(await that._fsExists(grandParent))) {
                            var c2 = that.hostToContainer(grandParent);
                            if (c2 !== grandParent && (await that._fsExists(c2))) r2SearchDir = c2;
                        }
                        if (await that._fsExists(r2SearchDir)) {
                            var r2 = await that.searchFileByName(item.fileName, r2SearchDir, {
                                maxDepth: 3, maxResults: 10, maxDirs: 80, timeoutMs: 2000
                            });
                            var r2Exact = r2.filter(function(c) { return c.matchType === 'exact' || c.matchType === 'case-insensitive'; });
                            if (r2Exact.length > 0) candidates = r2Exact;
                        }
                    }
                }

                // R3: 根目录全盘搜索（跨端同步链接不再全盘搜索，R1 已在同步文件夹内搜索过）
                if (candidates.length === 0 && !isCrossSync) {
                    var driveRoot = that.isWindows
                        ? ((item.localPath && item.localPath.charAt(0)) ? (item.localPath.charAt(0) + ':\\') : 'C:\\')
                        : '/';
                    var r3All = [];
                    await new Promise(function(resolve) {
                        that.deepSearch(driveRoot, item.fileName, function(partial, scanned, matched) {}, function(allResults) {
                            for (var ri = 0; ri < allResults.length; ri++) {
                                var r = allResults[ri];
                                if (r.name === item.fileName || (r.name && r.name.toLowerCase() === item.fileName.toLowerCase())) {
                                    r3All.push({ fullPath: r.path, size: r.size || 0, mtime: r.mtime || 0, matchType: 'exact' });
                                }
                            }
                            resolve();
                        });
                    });
                    if (r3All.length > 0) candidates = r3All;
                }

                // macOS firmlink 去重：/System/Volumes/Data/... 和 /... 是同一个文件
                candidates = that._dedupCandidates(candidates);

                if (candidates.length === 0) {
                    unfixable++;
                    item._searchResults = [];
                    pendingItems.push(item);
                } else if (candidates.length === 1) {
                    // 唯一匹配 → 自动修复
                    try {
                        await that.replaceLink(docId, item.oldUrl, candidates[0].fullPath, i, { silent: true });
                        autoFixed++;
                        that._log('autoCheckLinks - auto fixed:', item.fileName, '→', candidates[0].fullPath);
                    } catch(e) {
                        unfixable++;
                        item._searchResults = candidates;
                        pendingItems.push(item);
                        that._error('autoCheckLinks - auto fix failed:', item.fileName, e);
                    }
                } else {
                    // 多个匹配 → 需要手动选择
                    needManual++;
                    item._searchResults = candidates;
                    pendingItems.push(item);
                    that._log('autoCheckLinks - need manual:', item.fileName, candidates.length, 'candidates');
                }
            }

            // 缓存未修复的链接信息，供点击指示灯时复用
            that._cachedBrokenResult = {
                docId: docId,
                broken: pendingItems,
                total: result.total,
                valid: result.valid
            };

            that._log('autoCheckLinks - result: autoFixed=' + autoFixed + ', needManual=' + needManual + ', unfixable=' + unfixable);
            if (unfixable > 0) {
                that._updateLinkIndicator('red');
            } else if (needManual > 0) {
                that._updateLinkIndicator('yellow');
            } else {
                that._updateLinkIndicator('green');
            }

            // 自动修复后重置 _lastCheckedDocId，让下次定时器触发时重新扫描确认
            // （自动修复可能改变了文档内容，需要重新评估链接状态）
            if (autoFixed > 0) {
                that._lastCheckedDocId = '';
            }
        } catch (e) {
            that._error('auto check error:', e);
            that._updateLinkIndicator('none');
        } finally {
            that._autoCheckRunning = false;
        }
    }

    // ========== 失效链接修复功能 ==========

    /**
     * 入口：点击 🔗 按钮触发
     */
    async relinkBrokenLinks() {
        var that = this;
        that._log('relinkBrokenLinks started');

        // 1. 获取当前活动文档 ID
        var docId = that.getCurrentDocId();
        that._log('relinkBrokenLinks - docId:', docId);
        if (!docId) {
            that.showToastMsg('请先打开一个文档');
            return;
        }

        // 2. 尝试复用自动检测缓存的扫描结果
        var result = null;
        var useCache = false;
        if (that._cachedBrokenResult && that._cachedBrokenResult.docId === docId && that._cachedBrokenResult.broken && that._cachedBrokenResult.broken.length > 0) {
            result = that._cachedBrokenResult;
            useCache = true;
            that._log('relinkBrokenLinks - using cached result');
        }

        // 3. 无缓存时重新扫描
        if (!result) {
            try {
                result = await that.scanBrokenLinks(docId);
            } catch(e) {
                that._error('relinkBrokenLinks - scan error:', e);
                that.showToastMsg('扫描链接失败：' + (e.message || e));
                return;
            }
        }

        if (!result || !result.broken || result.broken.length === 0) {
            if (result && result.total === 0) {
                that.showToastMsg('📄 当前文档没有本地文件链接');
            } else {
                // 所有链接有效，无提示
            }
            return;
        }

        // 4. 弹出对话框显示失效链接列表
        that.showRelinkDialog(result.broken, result.total, result.valid, docId);

        // 5. 在对话框内处理链接
        var dialog = document.getElementById('cd-relink-dialog');
        if (dialog) {
            if (useCache) {
                // 有缓存时，直接展示已有的搜索结果，不再重新搜索
                that._renderCachedResults(result.broken, docId, dialog);
            } else {
                // 无缓存，并行搜索修复
                that._searchAndFixLinks(result, docId, dialog);
            }
        }
    }

    /**
     * 复用缓存结果渲染对话框（点击指示灯时，避免重复扫描和搜索）
     */
    _renderCachedResults(brokenItems, docId, dialog) {
        var that = this;
        var autoFixed = 0;
        var needManual = 0;
        var unfixable = 0;

        for (var i = 0; i < brokenItems.length; i++) {
            var item = brokenItems[i];
            var statusEl = dialog.querySelector('.cd-relink-status[data-index="' + i + '"]');
            var candidateArea = dialog.querySelector('.cd-relink-candidate-area[data-index="' + i + '"]');
            var candidates = item._searchResults || [];

            if (candidates.length === 0) {
                unfixable++;
                if (candidateArea) candidateArea.innerHTML = '<span style="font-size:11px;color:var(--b3-theme-error,#e74c3c)">⚠️ 未找到同名文件</span>';
                if (statusEl) {
                    statusEl.textContent = '🔗 失效';
                    statusEl.style.color = 'var(--b3-theme-error,#e74c3c)';
                }
            } else if (candidates.length === 1) {
                // 唯一匹配，显示确认按钮
                var cand = candidates[0];
                var sizeStr = that.formatSize(cand.size);
                var mtime = new Date(cand.mtime);
                var dateStr = mtime.getFullYear() + '/' + (mtime.getMonth()+1) + '/' + mtime.getDate();
                if (candidateArea) {
                    candidateArea.innerHTML = '<div style="font-size:11px;color:var(--b3-theme-secondary,#999)">✅ 找到：' + that.escapeHtml(cand.fullPath) + ' <span>' + sizeStr + '</span> <span style="color:#888">' + dateStr + '</span></div>' +
                        '<button class="cd-relink-confirm-btn" data-index="' + i + '" style="margin-top:4px;padding:3px 10px;font-size:11px;background:var(--b3-theme-primary,#4285f4);color:#fff;border:none;border-radius:4px;cursor:pointer">确认替换</button>';
                    candidateArea._candidates = candidates;
                }
                if (statusEl) {
                    statusEl.textContent = '✅ 可修复';
                    statusEl.style.color = 'var(--b3-theme-success,#52c41a)';
                }
                // 绑定确认按钮
                var confirmBtn = candidateArea ? candidateArea.querySelector('.cd-relink-confirm-btn') : null;
                if (confirmBtn) {
                    (function(idx, cands) {
                        confirmBtn.addEventListener('click', async function() {
                            await that.replaceLink(docId, brokenItems[idx].oldUrl, cands[0].fullPath, idx, { dialog: dialog, brokenLinks: brokenItems });
                            var s = dialog.querySelector('.cd-relink-status[data-index="' + idx + '"]');
                            if (s) { s.textContent = '✅ 已修复'; s.style.color = 'var(--b3-theme-success,#52c41a)'; }
                            that._cachedBrokenResult = null;
                            that._lastCheckedDocId = '';
                            that._autoCheckLinks();
                        });
                    })(i, candidates);
                }
                needManual++;
            } else {
                // 多个匹配，显示选择列表
                needManual++;
                var matchInfo = candidates.length + ' 个精确匹配';
                var candidateHtml = '<div style="margin-top:4px;font-size:11px;color:var(--b3-theme-secondary,#999)">找到 ' + matchInfo + '，请选择：</div>';
                candidateHtml += '<div style="margin-top:4px;max-height:150px;overflow-y:auto;border:1px solid var(--b3-border,#eee);border-radius:4px">';
                for (var c = 0; c < candidates.length; c++) {
                    var cand = candidates[c];
                    var sizeStr = that.formatSize(cand.size);
                    var mtime = new Date(cand.mtime);
                    var dateStr = mtime.getFullYear() + '/' + (mtime.getMonth()+1) + '/' + mtime.getDate();
                    var matchLabel = cand.matchType === 'exact' ? '✅' : '🔤';
                    var fingerprintMatch = false;
                    if (item.fileFingerprint) {
                        if (item.fileFingerprint.size !== null && cand.size === item.fileFingerprint.size) fingerprintMatch = true;
                    }
                    if (fingerprintMatch) matchLabel = '🎯';
                    candidateHtml += '<label style="display:block;padding:4px 8px;cursor:pointer;font-size:11px;border-bottom:1px solid var(--b3-border,#f5f5f5);word-break:break-all;color:#333;background:rgba(82,196,26,0.08)">' +
                        '<input type="radio" name="cd-relink-cand-' + i + '" value="' + c + '" ' + (c === 0 ? 'checked' : '') + ' style="margin-right:4px">' +
                        matchLabel + ' ' + that.escapeHtml(cand.fullPath) + ' <span style="color:var(--b3-theme-secondary,#999)">' + sizeStr + '</span> <span style="color:#888">' + dateStr + (fingerprintMatch ? ' (指纹匹配)' : '') + '</span>' +
                    '</label>';
                }
                candidateHtml += '</div>';
                candidateHtml += '<button class="cd-relink-confirm-btn" data-index="' + i + '" style="margin-top:6px;padding:3px 10px;font-size:11px;background:var(--b3-theme-primary,#4285f4);color:#fff;border:none;border-radius:4px;cursor:pointer">确认替换</button>';
                if (candidateArea) {
                    candidateArea.innerHTML = candidateHtml;
                    candidateArea._candidates = candidates;
                }
                if (statusEl) {
                    statusEl.textContent = '⚠️ 待确认';
                    statusEl.style.color = 'var(--b3-theme-warning,#faad14)';
                }
                var confirmBtn2 = candidateArea ? candidateArea.querySelector('.cd-relink-confirm-btn') : null;
                if (confirmBtn2) {
                    (function(idx, cands) {
                        confirmBtn2.addEventListener('click', async function() {
                            var area = dialog.querySelector('.cd-relink-candidate-area[data-index="' + idx + '"]');
                            var selectedRadio = area.querySelector('input[type="radio"]:checked');
                            if (!selectedRadio) return;
                            var candIdx = parseInt(selectedRadio.value, 10);
                            var chosen = cands[candIdx];
                            await that.replaceLink(docId, brokenItems[idx].oldUrl, chosen.fullPath, idx, { dialog: dialog, brokenLinks: brokenItems });
                            var s = dialog.querySelector('.cd-relink-status[data-index="' + idx + '"]');
                            if (s) { s.textContent = '✅ 已修复'; s.style.color = 'var(--b3-theme-success,#52c41a)'; }
                            that._cachedBrokenResult = null;
                            that._lastCheckedDocId = '';
                            that._autoCheckLinks();
                        });
                    })(i, candidates);
                }
            }
        }

        // 更新底部状态
        var fixAllBtn = dialog.querySelector('#cd-relink-fixall');
        if (fixAllBtn) {
            if (unfixable > 0) {
                fixAllBtn.textContent = unfixable + ' 个无法修复，' + needManual + ' 个待确认';
                fixAllBtn.style.color = 'var(--b3-theme-error,#e74c3c)';
            } else if (needManual > 0) {
                fixAllBtn.textContent = needManual + ' 个待确认';
                fixAllBtn.style.color = 'var(--b3-theme-warning,#faad14)';
            } else {
                fixAllBtn.textContent = '✅ 全部修复完成';
                fixAllBtn.style.color = 'var(--b3-theme-success,#52c41a)';
            }
        }
    }

    /**
     * 无缓存时，并行搜索并修复链接（原 relinkBrokenLinks 的搜索逻辑）
     */
    async _searchAndFixLinks(result, docId, dialog) {
        var that = this;
        try {
            var autoFixed = 0;
            var needManual = [];

                // 定义单个链接的搜索修复函数
                async function processLink(item, i) {
                    var candidates = [];
                    var statusEl = dialog.querySelector('.cd-relink-status[data-index="' + i + '"]');
                    var candidateArea = dialog.querySelector('.cd-relink-candidate-area[data-index="' + i + '"]');
                    // 独立的 abortFlag，避免并行搜索时互相取消
                    var _abortFlag = { cancelled: false };

                    if (statusEl) {
                        statusEl.textContent = '';
                        statusEl.style.color = 'var(--b3-theme-secondary,#999)';
                    }

                    // 对话框已关闭则跳过搜索
                    if (dialog._relinkAborted) {
                        item._searchResults = [];
                        return { manual: true };
                    }

                    // 搜索策略：旧路径附近 → 上级 → 盘符根（逐步扩大）
                    var parentDir = '';
                    var lastSep = Math.max(item.localPath.lastIndexOf('\\'), item.localPath.lastIndexOf('/'));
                    if (lastSep > 0) {
                        parentDir = item.localPath.substring(0, lastSep);
                    }

                    // 跨端同步文件夹：搜索范围改为 syncRoot
                    var isCrossSync = !!item._isCrossSync;
                    var syncSearchRoot = item._syncSearchRoot || '';

                    // 第一轮：旧路径父目录，深度2（跨端同步时搜索 syncRoot）
                    var r1Candidates = [];
                    var r1SearchDir = isCrossSync ? syncSearchRoot : parentDir;
                    if (r1SearchDir) {
                        if (!isCrossSync && !(await that._fsExists(r1SearchDir))) {
                            var d1 = that.hostToContainer(r1SearchDir);
                            if (d1 !== r1SearchDir && (await that._fsExists(d1))) r1SearchDir = d1;
                        }
                        if (await that._fsExists(r1SearchDir)) {
                            r1Candidates = await that.searchFileByName(item.fileName, r1SearchDir, {
                                maxDepth: isCrossSync ? 5 : 2, maxResults: 5, maxDirs: isCrossSync ? 200 : 100, timeoutMs: isCrossSync ? 5000 : 2000,
                                onProgress: function(info) {
                                    if (candidateArea) candidateArea.innerHTML = '<span style="font-size:11px;color:var(--b3-theme-secondary,#999)">🔍 ' + (isCrossSync ? '跨端' : 'R1') + ' 已扫 ' + info.dirsScanned + ' 目录</span>';
                                }
                            });
                        }
                    }
                    var r1Exact = r1Candidates.filter(function(c) { return c.matchType === 'exact' || c.matchType === 'case-insensitive'; });
                    if (r1Exact.length > 0) candidates = r1Exact;

                    // 第二轮：父目录的上级，深度3（跨端同步时跳过，R1 已覆盖 syncRoot）
                    if (candidates.length === 0 && parentDir && !isCrossSync) {
                        var grandParent = '';
                        var gpSep = Math.max(parentDir.lastIndexOf('\\'), parentDir.lastIndexOf('/'));
                        if (gpSep > 2) grandParent = parentDir.substring(0, gpSep);
                        if (grandParent && grandParent.length > 3) {
                            var r2SearchDir = grandParent;
                            if (!(await that._fsExists(grandParent))) {
                                var d2 = that.hostToContainer(grandParent);
                                if (d2 !== grandParent && (await that._fsExists(d2))) r2SearchDir = d2;
                            }
                            if (await that._fsExists(r2SearchDir)) {
                            if (candidateArea) candidateArea.innerHTML = '<span style="font-size:11px;color:var(--b3-theme-secondary,#999)">🔍 R2 搜索中...</span>';
                            var r2Candidates = await that.searchFileByName(item.fileName, r2SearchDir, {
                                maxDepth: 3, maxResults: 5, maxDirs: 150, timeoutMs: 2000,
                                onProgress: function(info) {
                                    if (candidateArea) candidateArea.innerHTML = '<span style="font-size:11px;color:var(--b3-theme-secondary,#999)">🔍 R2 已扫 ' + info.dirsScanned + ' 目录</span>';
                                }
                            });
                            var r2Exact = r2Candidates.filter(function(c) { return c.matchType === 'exact' || c.matchType === 'case-insensitive'; });
                            if (r2Exact.length > 0) candidates = r2Exact;
                        }
                    }
                    }

                    // 第三轮：全盘深度搜索（跨端同步时搜索范围为 syncRoot）
                    if (candidates.length === 0) {
                        var driveRoot = isCrossSync ? syncSearchRoot : (that.isWindows
                            ? ((item.localPath && item.localPath.charAt(0)) ? (item.localPath.charAt(0) + ':\\') : 'C:\\')
                            : '/');
                        var r3AllCandidates = [];
                        var r3TotalSearched = 0;
                        var r3TotalMatched = 0;

                        if (candidateArea) candidateArea.innerHTML = '<span style="font-size:11px;color:var(--b3-theme-secondary,#999)">' + (isCrossSync ? '跨端' : 'R3') + ' 深度搜索...</span>';

                        await new Promise(function(resolve) {
                            that.deepSearch(driveRoot, item.fileName, function(partialResults, dirsScanned, matchedFiles) {
                                r3TotalSearched = dirsScanned || r3TotalSearched;
                                r3TotalMatched = matchedFiles || r3TotalMatched;
                                if (candidateArea) {
                                    candidateArea.innerHTML = '<span style="font-size:11px;color:var(--b3-theme-secondary,#999)">🔍 R3 已扫 ' + r3TotalSearched + ' 目录' + (r3TotalMatched > 0 ? '·' + r3TotalMatched + '个' : '') + '</span>';
                                }
                            }, function(allResults, wasCancelled) {
                                for (var ri = 0; ri < allResults.length; ri++) {
                                    var r = allResults[ri];
                                    if (r.name === item.fileName || (r.name && r.name.toLowerCase() === item.fileName.toLowerCase())) {
                                        r3AllCandidates.push({
                                            fullPath: r.path, size: r.size || 0, mtime: r.mtime || 0,
                                            matchType: r.name === item.fileName ? 'exact' : 'case-insensitive',
                                            similarity: r.name === item.fileName ? 1 : 0.95
                                        });
                                    }
                                }
                                resolve(true);
                            }, _abortFlag);
                        });

                        // 网盘兼容：枚举根目录子目录分别搜索
                        if (r3AllCandidates.length === 0) {
                            try {
                                var rootEntries = await that._fsReaddir(driveRoot);
                                var subDirs = [];
                                for (var ei = 0; ei < rootEntries.length; ei++) {
                                    var e = rootEntries[ei];
                                    var isDir = typeof e.isDirectory === 'function' ? e.isDirectory() : e.isDir;
                                    if (!isDir) {
                                        try { var est = await that._fsStat(driveRoot + e.name).catch(function(){}); if (est && est.isDirectory()) isDir = true; } catch(err) {}
                                    }
                                    if (isDir) subDirs.push(driveRoot + e.name);
                                }
                                for (var si = 0; si < subDirs.length && r3AllCandidates.length < 10; si++) {
                                    await new Promise(function(resolve) {
                                        that.deepSearch(subDirs[si], item.fileName, function(partialResults, dirsScanned, matchedFiles) {
                                            r3TotalSearched += (dirsScanned || 0);
                                            r3TotalMatched += (matchedFiles || 0);
                                            if (candidateArea) {
                                                candidateArea.innerHTML = '<span style="font-size:11px;color:var(--b3-theme-secondary,#999)">🔍 R3 已扫 ' + r3TotalSearched + ' 目录' + (r3TotalMatched > 0 ? '·' + r3TotalMatched + '个' : '') + '</span>';
                                            }
                                        }, function(allResults, wasCancelled) {
                                            for (var ri = 0; ri < allResults.length; ri++) {
                                                var r = allResults[ri];
                                                if (r.name === item.fileName || (r.name && r.name.toLowerCase() === item.fileName.toLowerCase())) {
                                                    r3AllCandidates.push({
                                                        fullPath: r.path, size: r.size || 0, mtime: r.mtime || 0,
                                                        matchType: r.name === item.fileName ? 'exact' : 'case-insensitive',
                                                        similarity: r.name === item.fileName ? 1 : 0.95
                                                    });
                                                }
                                            }
                                            resolve(true);
                                        }, _abortFlag);
                                    });
                                }
                            } catch (e) {}
                        }

                        if (r3AllCandidates.length > 0) candidates = r3AllCandidates;
                        if (candidateArea) candidateArea.innerHTML = '<span style="font-size:11px;color:var(--b3-theme-secondary,#999)">R3 搜索完成（' + r3TotalSearched + ' 目录）</span>';
                    }

                    // macOS firmlink 去重：/System/Volumes/Data/... 和 /... 是同一个文件
                    candidates = that._dedupCandidates(candidates);

                    // 处理搜索结果
                    var exactCandidates = candidates.filter(function(c) { return c.matchType === 'exact' || c.matchType === 'case-insensitive'; });
                    if (item.fileFingerprint && (item.fileFingerprint.size !== null || item.fileFingerprint.mtime !== null)) {
                        exactCandidates.sort(function(a, b) {
                            var aScore = 0, bScore = 0;
                            if (item.fileFingerprint.size !== null && a.size === item.fileFingerprint.size) aScore += 2;
                            if (item.fileFingerprint.mtime !== null && a.mtime === item.fileFingerprint.mtime) aScore += 1;
                            if (item.fileFingerprint.size !== null && b.size === item.fileFingerprint.size) bScore += 2;
                            if (item.fileFingerprint.mtime !== null && b.mtime === item.fileFingerprint.mtime) bScore += 1;
                            if (aScore !== bScore) return bScore - aScore;
                            return b.mtime - a.mtime;
                        });
                    } else {
                        exactCandidates.sort(function(a, b) { return b.mtime - a.mtime; });
                    }

                    item._searchResults = exactCandidates;

                    if (exactCandidates.length === 1) {
                        await that.replaceLink(docId, item.oldUrl, exactCandidates[0].fullPath, i, { dialog: dialog, brokenLinks: result.broken });
                        if (statusEl) {
                            statusEl.textContent = '✅ 已修复';
                            statusEl.style.color = 'var(--b3-theme-success,#52c41a)';
                        }
                        return { fixed: true };
                    } else if (exactCandidates.length > 1) {
                        var matchInfo = exactCandidates.length + ' 个精确匹配';
                        var candidateHtml = '<div style="margin-top:4px;font-size:11px;color:var(--b3-theme-secondary,#999)">找到 ' + matchInfo + '，请选择：</div>';
                        candidateHtml += '<div style="margin-top:4px;max-height:150px;overflow-y:auto;border:1px solid var(--b3-border,#eee);border-radius:4px">';
                        for (var c = 0; c < exactCandidates.length; c++) {
                            var cand = exactCandidates[c];
                            var sizeStr = that.formatSize(cand.size);
                            var mtime = new Date(cand.mtime);
                            var dateStr = mtime.getFullYear() + '/' + (mtime.getMonth()+1) + '/' + mtime.getDate();
                            var matchLabel = cand.matchType === 'exact' ? '✅' : '🔤';
                            var fingerprintMatch = false;
                            if (item.fileFingerprint) {
                                if (item.fileFingerprint.size !== null && cand.size === item.fileFingerprint.size &&
                                    item.fileFingerprint.mtime !== null && cand.mtime === item.fileFingerprint.mtime) {
                                    fingerprintMatch = true;
                                } else if (item.fileFingerprint.size !== null && cand.size === item.fileFingerprint.size) {
                                    fingerprintMatch = true;
                                }
                            }
                            if (fingerprintMatch) matchLabel = '🎯';
                            var rowBg = ';background:rgba(82,196,26,0.08)';
                            candidateHtml += '<label style="display:block;padding:4px 8px;cursor:pointer;font-size:11px;border-bottom:1px solid var(--b3-border,#f5f5f5);word-break:break-all;color:#333' + rowBg + '">' +
                                '<input type="radio" name="cd-relink-cand-' + i + '" value="' + c + '" ' + (c === 0 ? 'checked' : '') + ' style="margin-right:4px">' +
                                matchLabel + ' ' + that.escapeHtml(cand.fullPath) + ' <span style="color:var(--b3-theme-secondary,#999)">' + sizeStr + '</span> <span style="color:#888">' + dateStr + (fingerprintMatch ? ' (指纹匹配)' : '') + '</span>' +
                            '</label>';
                        }
                        candidateHtml += '</div>';
                        candidateHtml += '<button class="cd-relink-confirm-btn" data-index="' + i + '" style="margin-top:6px;padding:3px 10px;font-size:11px;background:var(--b3-theme-primary,#4285f4);color:#fff;border:none;border-radius:4px;cursor:pointer">确认替换</button>';
                        if (candidateArea) {
                            candidateArea.innerHTML = candidateHtml;
                            candidateArea._candidates = exactCandidates;
                        }
                        if (statusEl) {
                            statusEl.textContent = '⚠️ 待确认';
                            statusEl.style.color = 'var(--b3-theme-warning,#faad14)';
                        }
                        var confirmBtn = candidateArea ? candidateArea.querySelector('.cd-relink-confirm-btn') : null;
                        if (confirmBtn) {
                            confirmBtn.addEventListener('click', async function() {
                                var idx = parseInt(this.getAttribute('data-index'), 10);
                                var area = dialog.querySelector('.cd-relink-candidate-area[data-index="' + idx + '"]');
                                var selectedRadio = area.querySelector('input[type="radio"]:checked');
                                if (!selectedRadio) return;
                                var candIdx = parseInt(selectedRadio.value, 10);
                                var chosen = area._candidates[candIdx];
                                await that.replaceLink(docId, result.broken[idx].oldUrl, chosen.fullPath, idx, { dialog: dialog, brokenLinks: result.broken });
                                // 刷新底部状态统计
                                var allStatusEls = dialog.querySelectorAll('.cd-relink-status');
                                var newFixed = 0, newPending = 0;
                                for (var s = 0; s < allStatusEls.length; s++) {
                                    if (allStatusEls[s].textContent === '✅ 已修复') newFixed++;
                                    else if (allStatusEls[s].textContent === '⚠️ 待确认') newPending++;
                                }
                                var bottomSpan = dialog.querySelector('#cd-relink-fixall');
                                if (bottomSpan) {
                                    if (newPending === 0) {
                                        bottomSpan.textContent = '✅ 全部修复完成';
                                        bottomSpan.style.color = 'var(--b3-theme-success,#52c41a)';
                                    } else {
                                        bottomSpan.textContent = '已自动修复 ' + newFixed + '/' + result.broken.length + ' 个，' + newPending + ' 个待确认';
                                        bottomSpan.style.color = 'var(--b3-theme-warning,#faad14)';
                                    }
                                }
                            });
                        }
                        return { manual: true };
                    } else {
                        item._searchResults = [];
                        if (candidateArea) candidateArea.innerHTML = '<span style="font-size:11px;color:var(--b3-theme-error,#e74c3c)">⚠️ 未找到同名文件</span>';
                        if (statusEl) {
                            statusEl.textContent = '🔗 失效';
                            statusEl.style.color = 'var(--b3-theme-error,#e74c3c)';
                        }
                        return { manual: true };
                    }
                }

                // 并行启动所有链接的搜索修复（每个链接的错误隔离，避免一个失败导致全部中断）
                var processPromises = [];
                for (var i = 0; i < result.broken.length; i++) {
                    (function(idx) {
                        processPromises.push(
                            processLink(result.broken[idx], idx).catch(function(e) {
                                that._error('processLink error for item', idx, e);
                                // 更新 UI 显示错误状态
                                var errStatusEl = dialog.querySelector('.cd-relink-status[data-index="' + idx + '"]');
                                var errCandidateArea = dialog.querySelector('.cd-relink-candidate-area[data-index="' + idx + '"]');
                                if (errStatusEl) {
                                    errStatusEl.textContent = '⚠️ 出错';
                                    errStatusEl.style.color = 'var(--b3-theme-warning,#faad14)';
                                }
                                if (errCandidateArea) {
                                    errCandidateArea.innerHTML = '<span style="font-size:11px;color:var(--b3-theme-warning,#faad14)">⚠️ 搜索出错：' + (e.message || '未知错误') + '</span>';
                                }
                                return { error: true, message: e.message, index: idx };
                            })
                        );
                    })(i);
                }
                var results = await Promise.all(processPromises);

                // 统计结果
                for (var ri = 0; ri < results.length; ri++) {
                    if (results[ri].error) {
                        // 发生错误，标记为需要手动处理
                        needManual.push(result.broken[ri]);
                    } else if (results[ri].fixed) autoFixed++;
                    else if (results[ri].manual) needManual.push(result.broken[ri]);
                }

                // 更新状态信息
                var fixAllBtn = dialog.querySelector('#cd-relink-fixall');
                if (fixAllBtn) {
                    if (needManual.length === 0) {
                        fixAllBtn.textContent = '✅ 全部修复完成';
                        fixAllBtn.style.color = 'var(--b3-theme-success,#52c41a)';
                    } else {
                        fixAllBtn.textContent = '已自动修复 ' + autoFixed + '/' + result.broken.length + ' 个，' + needManual.length + ' 个待确认';
                        fixAllBtn.style.color = 'var(--b3-theme-warning,#faad14)';
                    }
                }

                // 修复完成后重扫链接状态，更新指示灯
                that._lastCheckedDocId = '';
                that._autoCheckLinks();
        } catch (e) {
            that._error('relink scan error:', e);
            that.showToastMsg('扫描链接失败：' + (e.message || e));
        }
    }

    /**
     * 获取光标所在块的 block ID
     * 用于 insertBlock API 的 previousID 参数，实现插入到光标位置
     */
    getFocusBlockId() {
        try {
            var selection = window.getSelection();
            if (!selection || selection.rangeCount === 0) return null;
            var range = selection.getRangeAt(0);
            var node = range.startContainer;

            // 从光标位置向上查找带 data-node-id 的块元素
            while (node && node !== document) {
                if (node.nodeType === 1 && node.getAttribute && node.getAttribute('data-node-id')) {
                    var nodeId = node.getAttribute('data-node-id');
                    // 排除文档标题块（它的 ID 等于 docId，插入到它后面会插入到文档开头）
                    // 只返回内容块的 ID
                    if (node.classList && node.classList.contains('protyle-title')) {
                        // 光标在标题上，返回 null，让调用方用 parentID
                        return null;
                    }
                    return nodeId;
                }
                node = node.parentNode;
            }
            return null;
        } catch (e) {
            console.warn('[LocalBrowse] getFocusBlockId error:', e);
            return null;
        }
    }

    /**
     * 获取当前活动文档的 block ID
     */
    getCurrentDocId() {
        var that = this;
        try {
            // 方式1：通过思源布局 API 获取当前活动文档（最可靠）
            if (window.siyuan && window.siyuan.layout && window.siyuan.layout.centerLayout) {
                try {
                    var currDoc = window.siyuan.layout.centerLayout.children.map(function(item) {
                        return item.children.find(function(child) {
                            return child.headElement && child.headElement.classList.contains('item--focus') &&
                                   (child.panelElement.closest('.layout__wnd--active') || child.panelElement.closest('[data-type="wnd"]'));
                        });
                    }).find(function(item) { return item; });
                    if (currDoc && currDoc.model && currDoc.model.editor && currDoc.model.editor.protyle) {
                        var protyleEl = currDoc.model.editor.protyle.element;
                        if (protyleEl) {
                            var titleEl = protyleEl.querySelector('.protyle-title');
                            if (titleEl && titleEl.dataset && titleEl.dataset.nodeId) {
                                return titleEl.dataset.nodeId;
                            }
                        }
                    }
                } catch (e2) {
                    that._log('getCurrentDocId - method1 error:', e2.message);
                }
            }

            // 方式2：通过 DOM 查询 .protyle-title[data-node-id]
            var activeProtyl = document.querySelector('[data-type="wnd"].layout__wnd--active .protyle:not(.fn__none)') ||
                               document.querySelector('[data-type="wnd"] .protyle:not(.fn__none)');
            if (activeProtyl) {
                var titleEl2 = activeProtyl.querySelector('.protyle-title');
                if (titleEl2 && titleEl2.dataset && titleEl2.dataset.nodeId) {
                    return titleEl2.dataset.nodeId;
                }
            }

            // 方式3：从 protyle-wysiwyg 向上找 .protyle，再找 .protyle-title
            var wysiwyg = document.querySelector('.protyle-wysiwyg[contenteditable="true"]');
            if (wysiwyg) {
                var container = wysiwyg.closest('.protyle');
                if (container) {
                    var titleEl3 = container.querySelector('.protyle-title');
                    if (titleEl3 && titleEl3.dataset && titleEl3.dataset.nodeId) {
                        that._log('getCurrentDocId - method3 (wysiwyg→title):', titleEl3.dataset.nodeId);
                        return titleEl3.dataset.nodeId;
                    }
                }
            }

            that._log('getCurrentDocId - all methods failed');
            return null;
        } catch (e) {
            that._error('getCurrentDocId error:', e);
            return null;
        }
    }

    /**
     * 扫描文档中的 file:/// 链接，检测失效链接
     */
    async scanBrokenLinks(docId) {
        var that = this;

        // Docker 浏览器模式下无法访问本地文件，链接修复无意义，跳过
        if (that._isDockerBrowser()) {
            return null;
        }

        // 获取文档 Kramdown 内容
        var resp = await fetch('/api/block/getBlockKramdown', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: docId })
        });
        var data = await resp.json();
        if (data.code !== 0 || !data.data || !data.data.kramdown) {
            throw new Error('获取文档内容失败');
        }
        var kramdown = data.data.kramdown;

        // 匹配所有 file:/// 链接（支持路径中包含括号）
        // 策略：先找到 [text](file:///... ) 的整体，再提取 URL
        var broken = [];
        var total = 0;
        var valid = 0;
        var seen = {}; // 去重
        var crossSyncFixed = null; // 跨端同步前缀替换直接修复的链接列表

        // 用更可靠的方式：找到所有 file:/// 出现的位置，然后向前找匹配的 )
        var fileUrlRegex = /file:\/\/\//g;
        var urlMatch;
        while ((urlMatch = fileUrlRegex.exec(kramdown)) !== null) {
            var urlStart = urlMatch.index;
            // 从 urlStart 向后找，找到对应的 )（考虑括号嵌套）
            var depth = 0;
            var urlEnd = urlStart;
            for (var ci = urlStart; ci < kramdown.length; ci++) {
                var ch = kramdown.charAt(ci);
                if (ch === '(') depth++;
                else if (ch === ')') {
                    if (depth === 0) {
                        urlEnd = ci;
                        break;
                    }
                    depth--;
                }
            }
            var urlPart = kramdown.substring(urlStart, urlEnd);
            // 从 URL 部分提取 title（如果有）：file:///path "title"
            // urlPart 格式: file:///path 或 file:///path "title"
            var titleMatch = urlPart.match(/\s+"([^"]*)"\s*$/);
            var linkTitle = titleMatch ? titleMatch[1] : '';
            // 去掉 title 后的纯 URL（找到 title 前的引号位置，截断）
            var urlWithoutTitle = urlPart;
            if (linkTitle) {
                var quoteIdx = urlPart.lastIndexOf('"' + linkTitle + '"');
                if (quoteIdx !== -1) {
                    urlWithoutTitle = urlPart.substring(0, quoteIdx).trim();
                }
            }
            var fullUrl = urlWithoutTitle;

            // 向前找 [displayText]
            var bracketStart = kramdown.lastIndexOf('[', urlStart);
            var bracketEnd = kramdown.indexOf(']', bracketStart);
            var displayText = '';
            if (bracketStart >= 0 && bracketEnd > bracketStart && bracketEnd < urlStart) {
                displayText = kramdown.substring(bracketStart + 1, bracketEnd);
            }

            // 从链接 title 中提取文件指纹（size & mtime），用于精确定位同名文件
            // 注意：kramdown 中 & 可能被编码为 &amp;，需要解码
            var decodedLinkTitle = linkTitle.replace(/&amp;/g, '&');
            var fileFingerprint = { size: null, mtime: null };
            if (decodedLinkTitle) {
                var sizeMatch = decodedLinkTitle.match(/size=(\d+)/);
                var mtimeMatch = decodedLinkTitle.match(/mtime=(\d+)/);
                if (sizeMatch) fileFingerprint.size = parseInt(sizeMatch[1], 10);
                if (mtimeMatch) fileFingerprint.mtime = parseInt(mtimeMatch[1], 10);
            }

            // 去重：同一个 URL 只检测一次
            if (seen[fullUrl]) continue;
            seen[fullUrl] = true;
            total++;

            // URL 转本地路径
            var localPath = that.fileUrlToLocalPath(fullUrl);

            // 检测文件是否存在
            var localExists = await that._fsExists(localPath);
            if (localExists) {
                valid++;
            } else {
                // Docker 路径映射：宿主机路径不存在时，尝试容器路径
                var mappedCheckPath = that.hostToContainer(localPath);
                if (mappedCheckPath !== localPath && (await that._fsExists(mappedCheckPath))) {
                    valid++;
                } else {
                    // 提取文件名（去掉 ? 后面的 URL 参数，如 ?t=0:05）
                    var fileName = localPath.split('\\').pop().split('/').pop().split('?')[0];

                    // 跨端同步文件夹判断
                    if (!that._isCurrentPlatformLink(localPath)) {
                        // 不是当前平台的链接格式
                        var inSync = that._isInSyncFolder(localPath);
                        that._log('cross-platform link: ' + localPath + ', isInSync=' + inSync + ', mySyncRoot=' + that._getMySyncRoot());
                        if (inSync) {
                            // 在同步文件夹内 → 尝试跨端修复
                            var crossResult = that._crossSyncRepair(localPath, fileName);
                            that._log('crossSyncRepair result: ' + (crossResult ? ('newPath=' + crossResult.newPath + ', exists=' + crossResult.exists) : 'null'));
                            if (crossResult && crossResult.exists) {
                                // 前缀替换后文件存在 → 直接修复，不加入 broken
                                if (!crossSyncFixed) crossSyncFixed = [];
                                crossSyncFixed.push({
                                    oldUrl: fullUrl,
                                    newPath: crossResult.newPath
                                });
                                valid++;  // 算作有效链接
                                continue;  // 不加入 broken
                            } else if (crossResult) {
                                // 前缀替换后文件不存在 → 加入 broken，标记为跨端
                                broken.push({
                                    oldUrl: fullUrl,
                                    localPath: crossResult.newPath,  // 使用替换后的路径（搜索用）
                                    fileName: fileName,
                                    displayText: displayText,
                                    fileFingerprint: fileFingerprint,
                                    _isCrossSync: true,
                                    _syncSearchRoot: crossResult.syncSearchRoot,
                                    _originalLocalPath: localPath  // 保留原始路径供 replaceLink 用
                                });
                                continue;
                            }
                            // crossResult 为 null（无法匹配任何平台的 syncRoot）→ 忽略
                            that._log('cross-platform link SILENTLY IGNORED (crossResult=null): ' + localPath + ' — likely _getMySyncRoot() returned empty on this device');
                        }
                        // 不是当前平台格式且不在同步文件夹内 → 忽略（不加入 broken，不修复）
                        continue;
                    }

                    // 当前平台格式的链接：先检查是否属于其他设备的同步文件夹（同平台跨设备场景）
                    // 例：A 电脑 D:\BaiduSyncdisk → B 电脑 E:\BaiduSyncdisk，链接格式相同但盘符不同
                    if (that._isInSyncFolder(localPath)) {
                        var crossResult2 = that._crossSyncRepair(localPath, fileName);
                        if (crossResult2 && crossResult2.exists) {
                            // 前缀替换后文件存在 → 直接修复
                            if (!crossSyncFixed) crossSyncFixed = [];
                            crossSyncFixed.push({
                                oldUrl: fullUrl,
                                newPath: crossResult2.newPath
                            });
                            valid++;  // 算作有效链接
                            continue;
                        } else if (crossResult2) {
                            // 前缀替换后文件不存在 → 加入 broken，标记为跨端
                            broken.push({
                                oldUrl: fullUrl,
                                localPath: crossResult2.newPath,
                                fileName: fileName,
                                displayText: displayText,
                                fileFingerprint: fileFingerprint,
                                _isCrossSync: true,
                                _syncSearchRoot: crossResult2.syncSearchRoot,
                                _originalLocalPath: localPath
                            });
                            continue;
                        }
                        // 在同步文件夹内但无法匹配其他设备 → 走普通修复
                    }

                    // 当前平台格式的链接 → 正常加入 broken，走 R1-R2-R3
                    broken.push({
                        oldUrl: fullUrl,
                        localPath: localPath,
                        fileName: fileName,
                        displayText: displayText,
                        fileFingerprint: fileFingerprint  // 保存文件指纹，用于搜索时精确匹配
                    });
                }
            }
        }

        return { broken: broken, total: total, valid: valid, crossSyncFixed: crossSyncFixed };
    }

    /**
     * file:/// URL 转本地路径
     */
    fileUrlToLocalPath(url) {
        var that = this;
        // 先去掉 URL fragment（#size=xxx&mtime=xxx），避免误判文件不存在
        var urlWithoutFragment = url.split('#')[0];
        var decoded;
        try {
            decoded = decodeURIComponent(urlWithoutFragment);
        } catch (e) {
            // 非法编码序列，使用原始字符串
            decoded = urlWithoutFragment;
        }
        // file:///D:/docs/file.pdf → D:\docs\file.pdf (Windows) 或 D:/docs/file.pdf (macOS/Linux 跨端)
        // file:///Users/mac/docs → /Users/mac/docs (Unix，保留前导 / 用于跨端匹配)
        var local = decoded.replace(/^file:\/\//, '');
        // Windows 盘符路径 (file:///D:/...): 去掉前导 /，统一为 D:/ 或 D:\ 格式
        if (/^\/[A-Za-z]:/.test(local)) {
            local = local.substring(1);
            if (that.isWindows) {
                local = local.replace(/\//g, '\\');
            }
        }
        return local;
    }

    /**
     * 本地路径转 file:/// URL（URL 编码版本，用于 Kramdown/Markdown）
     */
    localPathToFileUrl(localPath) {
        // D:\腾讯电脑管家截图文件\局部截取_20250918_131642.png
        // → file:///D:/%E8%85%BE%E8%AE%AF.../局部截取_20250918_131642.png
        var normalized = localPath.replace(/\\/g, '/').replace(/\/+/g, '/');  // 统一斜杠 + 去连续斜杠
        // 只对路径中的每个段做编码，不编码 / 和 :
        // 修复：Unix 绝对路径以 / 开头，split 后第一个为空字符串，join 后仍是 /xxx
        // 再加 file:/// 会变成 file:////xxx（4个斜杠）。去掉开头 / 再 split
        var segments = normalized.replace(/^\//, '').split('/');
        var encodedSegments = segments.map(function(s, idx) {
            // 空段保留
            if (s === '') return s;
            // 如果段包含 :（如 D:），不编码
            if (/^[a-zA-Z]:$/.test(s)) return s;
            // 否则对段内字符编码，但保留 / 和 :
            return encodeURIComponent(s).replace(/%2F/g, '/').replace(/%3A/g, ':');
        });
        return 'file:///' + encodedSegments.join('/');
    }

    /**
     * 本地路径转 file:/// URL（不编码版本，用于 DOM 替换）
     * 思源 DOM 中的 data-src 等属性里，中文路径不编码
     */
    localPathToFileUrlRaw(localPath) {
        // D:\腾讯电脑管家截图文件\局部截取_20250918_131642.png
        // → file:///D:/腾讯电脑管家截图文件/局部截取_20250918_131642.png
        var normalized = localPath.replace(/\\/g, '/').replace(/\/+/g, '/');  // 统一斜杠 + 去连续斜杠
        // 修复：Unix 绝对路径 /Users/mac/... 直接加 file:/// 会变成 file:////Users/...（4个斜杠）
        // 去掉开头 / 再加，得到 file:///Users/...（3个斜杠）
        var withoutLeadingSlash = normalized.replace(/^\//, '');
        return 'file:///' + withoutLeadingSlash;
    }

    /**
     * 显示修复失效链接对话框
     */
    showRelinkDialog(brokenLinks, total, valid, docId) {
        var that = this;

        // 构建失效链接列表 HTML
        var listHtml = '';
        for (var i = 0; i < brokenLinks.length; i++) {
            var item = brokenLinks[i];
            listHtml += '<div class="cd-relink-item" data-index="' + i + '" style="padding:10px 12px;border-bottom:1px solid var(--b3-border,#eee)">' +
                '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">' +
                    '<span style="font-size:14px">📄</span>' +
                    '<span style="font-weight:bold;font-size:13px;word-break:break-all">' + that.escapeHtml(item.fileName) + '</span>' +
                    '<span class="cd-relink-status" data-index="' + i + '" style="margin-left:auto;font-size:11px;color:var(--b3-theme-secondary,#999);white-space:nowrap">🔗 失效</span>' +
                '</div>' +
                '<div style="font-size:11px;color:var(--b3-theme-secondary,#999);word-break:break-all;margin-bottom:6px;padding-left:20px">旧路径：' + that.escapeHtml(item.localPath) + '</div>' +
                '<div class="cd-relink-candidate-area" data-index="' + i + '" style="padding-left:20px;font-size:11px;color:var(--b3-theme-secondary,#999);max-width:480px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></div>' +
            '</div>';
        }

        var contentHtml = '<div style="padding:16px;min-width:420px;max-width:560px;max-height:80vh;display:flex;flex-direction:column">' +
            '<div style="font-weight:bold;font-size:14px;margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid var(--b3-border,#eee)">🔧 修复失效链接</div>' +
            '<div style="font-size:12px;color:var(--b3-theme-secondary,#999);margin-bottom:10px">找到 <b style="color:var(--b3-theme-error,#e74c3c)">' + brokenLinks.length + '</b> 个失效链接（共 ' + total + ' 个本地链接，<b style="color:var(--b3-theme-success,#52c41a)">' + valid + '</b> 个有效）</div>' +
            '<div class="cd-relink-list" style="flex:1;overflow-y:auto;min-height:0">' + listHtml +             '</div>' +
            '<div style="margin-top:12px;display:flex;justify-content:flex-end;gap:8px">' +
                '<span id="cd-relink-fixall" style="padding:5px 16px;font-size:12px;background:transparent;color:var(--b3-theme-secondary,#999);border-radius:4px;pointer-events:none;user-select:none"></span>' +
                '<button id="cd-relink-close" style="padding:5px 16px;font-size:12px;background:var(--b3-theme-background,#fff);color:var(--b3-theme-on-background,#333);border:1px solid var(--b3-border,#ddd);border-radius:4px;cursor:pointer">关闭</button>' +
            '</div>' +
        '</div>';

        var dialog = document.createElement('div');
        dialog.id = 'cd-relink-dialog';
        dialog._relinkAborted = false;
        dialog.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.35);z-index:10000;display:flex;align-items:center;justify-content:center';
        dialog.innerHTML = '<div style="background:var(--b3-theme-background,#fff);border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,0.2);max-width:90vw;max-height:90vh;overflow:auto">' + contentHtml + '</div>';
        document.body.appendChild(dialog);

        // 存储上下文
        var context = {
            dialog: dialog,
            brokenLinks: brokenLinks,
            docId: docId
        };

        // 点击遮罩关闭
        dialog.addEventListener('click', function(e) {
            if (e.target === dialog) {
                dialog._relinkAborted = true;
                document.body.removeChild(dialog);
            }
        });

        // 关闭按钮
        var closeBtn = dialog.querySelector('#cd-relink-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', function() {
                dialog._relinkAborted = true;
                if (dialog.parentNode) document.body.removeChild(dialog);
            });
        }
    }

    /**
     * 一键修复所有失效链接
     */
    async relinkFixAll(context) {
        var that = this;
        var brokenLinks = context.brokenLinks;
        var docId = context.docId;
        var dialog = context.dialog;
        var fixAllBtn = dialog.querySelector('#cd-relink-fixall');

        if (fixAllBtn) {
            fixAllBtn.disabled = true;
            fixAllBtn.textContent = '🔧 修复中...';
        }

        var fixed = 0;
        var failed = 0;

        for (var i = 0; i < brokenLinks.length; i++) {
            var item = brokenLinks[i];
            var statusEl = dialog.querySelector('.cd-relink-status[data-index="' + i + '"]');
            var candidateArea = dialog.querySelector('.cd-relink-candidate-area[data-index="' + i + '"]');

            // 复用对话框打开时已经搜索到的结果
            var exactCandidates = item._searchResults || [];

            if (exactCandidates.length === 1) {
                // 唯一精确匹配，直接替换
                if (statusEl) {
                    statusEl.textContent = '🔧 修复中...';
                    statusEl.style.color = 'var(--b3-theme-secondary,#999)';
                }
                await that.replaceLink(docId, item.oldUrl, exactCandidates[0].fullPath, i, context);
                if (statusEl) {
                    statusEl.textContent = '✅ 已修复';
                    statusEl.style.color = 'var(--b3-theme-success,#52c41a)';
                }
                fixed++;
            } else if (exactCandidates.length > 1) {
                // 多个精确匹配，显示让用户选择（如果还没展示）
                if (statusEl) {
                    statusEl.textContent = '⚠️ 待确认';
                    statusEl.style.color = 'var(--b3-theme-warning,#faad14)';
                }
                if (candidateArea && !candidateArea.querySelector('input[type="radio"]')) {
                    var matchInfo = exactCandidates.length + ' 个精确匹配';
                    var candidateHtml = '<div style="margin-top:4px;font-size:11px;color:var(--b3-theme-secondary,#999)">找到 ' + matchInfo + '，请选择：</div>';
                    candidateHtml += '<div style="margin-top:4px;max-height:150px;overflow-y:auto;border:1px solid var(--b3-border,#eee);border-radius:4px">';
                    for (var c = 0; c < exactCandidates.length; c++) {
                        var cand = exactCandidates[c];
                        var sizeStr = that.formatSize(cand.size);
                        var mtime = new Date(cand.mtime);
                        var dateStr = mtime.getFullYear() + '/' + (mtime.getMonth()+1) + '/' + mtime.getDate();
                        var matchLabel = cand.matchType === 'exact' ? '✅' : '🔤';
                        var fingerprintMatch = false;
                        if (item.fileFingerprint) {
                            if (item.fileFingerprint.size !== null && cand.size === item.fileFingerprint.size &&
                                item.fileFingerprint.mtime !== null && cand.mtime === item.fileFingerprint.mtime) {
                                fingerprintMatch = true;
                            } else if (item.fileFingerprint.size !== null && cand.size === item.fileFingerprint.size) {
                                fingerprintMatch = true;
                            }
                        }
                        if (fingerprintMatch) matchLabel = '🎯';
                        var rowBg = ';background:rgba(82,196,26,0.08)';
                        candidateHtml += '<label style="display:block;padding:4px 8px;cursor:pointer;font-size:11px;border-bottom:1px solid var(--b3-border,#f5f5f5);word-break:break-all;color:#333' + rowBg + '">' +
                            '<input type="radio" name="cd-relink-cand-' + i + '" value="' + c + '" ' + (c === 0 ? 'checked' : '') + ' style="margin-right:4px">' +
                            matchLabel + ' ' + that.escapeHtml(cand.fullPath) + ' <span style="color:var(--b3-theme-secondary,#999)">' + sizeStr + '</span> <span style="color:#888">' + dateStr + (fingerprintMatch ? ' (指纹匹配)' : '') + '</span>' +
                        '</label>';
                    }
                    candidateHtml += '</div>';
                    candidateHtml += '<button class="cd-relink-confirm-btn" data-index="' + i + '" style="margin-top:6px;padding:3px 10px;font-size:11px;background:var(--b3-theme-primary,#4285f4);color:#fff;border:none;border-radius:4px;cursor:pointer">确认替换</button>';
                    if (candidateArea) {
                        candidateArea.innerHTML = candidateHtml;
                        candidateArea._candidates = exactCandidates;
                    }

                    var confirmBtn = candidateArea ? candidateArea.querySelector('.cd-relink-confirm-btn') : null;
                    if (confirmBtn) {
                        confirmBtn.addEventListener('click', async function() {
                            var idx = parseInt(this.getAttribute('data-index'), 10);
                            var area = dialog.querySelector('.cd-relink-candidate-area[data-index="' + idx + '"]');
                            var selectedRadio = area.querySelector('input[type="radio"]:checked');
                            if (!selectedRadio) return;
                            var candIdx = parseInt(selectedRadio.value, 10);
                            var chosen = area._candidates[candIdx];
                            await that.replaceLink(docId, brokenLinks[idx].oldUrl, chosen.fullPath, idx, context);
                        });
                    }
                }
                failed++;
            } else {
                // 未找到
                if (statusEl) {
                    statusEl.textContent = '🔗 失效';
                    statusEl.style.color = 'var(--b3-theme-error,#e74c3c)';
                }
                if (candidateArea) {
                    candidateArea.innerHTML = '<span style="color:var(--b3-theme-error,#e74c3c)">🔗 未找到同名文件</span>';
                }
                failed++;
            }
        }

        if (fixAllBtn) {
            fixAllBtn.disabled = false;
            if (failed === 0) {
                fixAllBtn.textContent = '✅ 全部修复完成';
                fixAllBtn.style.background = 'var(--b3-theme-success,#52c41a)';
            } else {
                fixAllBtn.textContent = '🔧 一键修复 (' + fixed + '/' + brokenLinks.length + ')';
            }
        }

        // 修复完成后重扫链接状态
        that._lastCheckedDocId = '';
        that._autoCheckLinks();

        if (failed > 0) {
            that.showToastMsg('已修复 ' + fixed + ' 个，' + failed + ' 个需要手动处理');
        } else if (fixed === 0) {
            that.showToastMsg('未找到可自动修复的链接');
        }
        // 全部修复成功时，无提示
    }

    /**
     * 为某条失效链接执行查找新位置
     */
    relinkSearchForItem(itemIndex, context) {
        var that = this;
        var item = context.brokenLinks[itemIndex];
        var dialog = context.dialog;
        var searchBtn = dialog.querySelector('.cd-relink-search-btn[data-index="' + itemIndex + '"]');
        var candidateArea = dialog.querySelector('.cd-relink-candidate-area[data-index="' + itemIndex + '"]');

        if (!searchBtn || !candidateArea) return;

        // 弹出目录选择器
        that.pickDirectory(item.localPath, function(searchDir) {
            if (!searchDir) return; // 用户取消

            searchBtn.disabled = true;
            searchBtn.textContent = '搜索中...';
            if (candidateArea) {
                candidateArea.innerHTML = '<span style="font-size:11px;color:var(--b3-theme-secondary,#999)">🔍 正在搜索...</span>';
            }

            // 异步搜索
            that.searchFileByName(item.fileName, searchDir, {
                maxDepth: 5, maxResults: 20,
                onProgress: function(info) {
                    if (candidateArea) {
                        candidateArea.innerHTML = '<span style="font-size:11px;color:var(--b3-theme-secondary,#999)">🔍 已扫 ' + info.dirsScanned + ' 目录，精确 ' + info.exactCount + ' 模糊 ' + info.fuzzyCount + '</span>';
                    }
                }
            }).then(function(candidates) {
                if (candidates.length === 0) {
                    if (candidateArea) {
                        candidateArea.innerHTML = '<span style="font-size:11px;color:var(--b3-theme-error,#e74c3c)">未找到同名或相似文件</span>';
                    }
                    searchBtn.disabled = false;
                    searchBtn.textContent = '查找新位置';
                    return;
                }

                // 区分精确和模糊匹配
                var exactCount = candidates.filter(function(c) { return c.matchType === 'exact' || c.matchType === 'case-insensitive'; }).length;
                var fuzzyCount = candidates.filter(function(c) { return c.matchType === 'fuzzy'; }).length;
                var matchInfo = exactCount + ' 精确' + (fuzzyCount > 0 ? ' + ' + fuzzyCount + ' 模糊' : '');

                // 显示候选列表
                var candidateHtml = '<div style="margin-top:8px;font-size:11px;color:var(--b3-theme-secondary,#999)">找到 ' + matchInfo + '：</div>';
                candidateHtml += '<div style="margin-top:4px;max-height:160px;overflow-y:auto;border:1px solid var(--b3-border,#eee);border-radius:4px">';
                for (var c = 0; c < candidates.length; c++) {
                    var cand = candidates[c];
                    var selected = c === 0 ? 'checked' : '';
                    var sizeStr = that.formatSize(cand.size);
                    var mtime = new Date(cand.mtime);
                    var dateStr = mtime.getFullYear() + '/' + (mtime.getMonth()+1) + '/' + mtime.getDate();
                    var matchLabel = cand.matchType === 'exact' ? '✅' : (cand.matchType === 'case-insensitive' ? '🔤' : '📎');
                    var simStr = cand.matchType === 'fuzzy' ? ' <span style="color:var(--b3-theme-warning,#faad14)">~' + Math.round(cand.similarity * 100) + '%</span>' : '';
                    candidateHtml += '<label style="display:block;padding:4px 8px;cursor:pointer;font-size:11px;border-bottom:1px solid var(--b3-border,#f5f5f5);word-break:break-all;background:rgba(82,196,26,0.08)">' +
                        '<input type="radio" name="cd-relink-cand-' + itemIndex + '" value="' + c + '" ' + selected + ' style="margin-right:4px">' +
                        matchLabel + ' ' + that.escapeHtml(cand.fullPath) +
                        ' <span style="color:var(--b3-theme-secondary,#999)">' + sizeStr + '</span> <span style="color:#888">' + dateStr + '</span>' + simStr +
                    '</label>';
                }
                candidateHtml += '</div>';
                candidateHtml += '<div style="margin-top:6px;display:flex;gap:6px">' +
                    '<button class="cd-relink-confirm-btn" data-index="' + itemIndex + '" style="padding:3px 10px;font-size:11px;background:var(--b3-theme-primary,#4285f4);color:#fff;border:none;border-radius:4px;cursor:pointer">确认替换</button>' +
                    '<button class="cd-relink-cancel-btn" data-index="' + itemIndex + '" style="padding:3px 10px;font-size:11px;background:transparent;color:var(--b3-theme-on-background,#333);border:1px solid var(--b3-border,#ddd);border-radius:4px;cursor:pointer">取消</button>' +
                '</div>';
                if (candidateArea) {
                    candidateArea.innerHTML = candidateHtml;
                    // 存储候选数据
                    candidateArea._candidates = candidates;
                }

                // 绑定 radio 点击高亮
                var radios = candidateArea ? candidateArea.querySelectorAll('input[type="radio"]') : [];
                var labels = candidateArea ? candidateArea.querySelectorAll('label') : [];
                for (var r = 0; r < radios.length; r++) {
                    (function(radio, label) {
                        radio.addEventListener('change', function() {
                            for (var l = 0; l < labels.length; l++) {
                                labels[l].style.background = '';
                            }
                            label.style.background = 'var(--b3-theme-primary-light,#bbdefb)';
                        });
                    })(radios[r], labels[r]);
                }

                // 确认替换按钮
                var confirmBtn = candidateArea ? candidateArea.querySelector('.cd-relink-confirm-btn') : null;
                if (confirmBtn) {
                    confirmBtn.addEventListener('click', function() {
                        var selectedRadio = candidateArea ? candidateArea.querySelector('input[type="radio"]:checked') : null;
                        if (!selectedRadio) return;
                        var candIdx = parseInt(selectedRadio.value, 10);
                        var chosen = candidateArea ? candidateArea._candidates[candIdx] : null;
                        if (chosen) {
                            that.replaceLink(context.docId, item.oldUrl, chosen.fullPath, itemIndex, context);
                        }
                    });
                }

                // 取消按钮
                var cancelBtn = candidateArea ? candidateArea.querySelector('.cd-relink-cancel-btn') : null;
                if (cancelBtn) {
                    cancelBtn.addEventListener('click', function() {
                        if (candidateArea) candidateArea.innerHTML = '';
                        searchBtn.disabled = false;
                        searchBtn.textContent = '查找新位置';
                    });
                }

                searchBtn.disabled = false;
                searchBtn.textContent = '重新查找';
            }).catch(function(e) {
                if (candidateArea) {
                    candidateArea.innerHTML = '<span style="font-size:11px;color:var(--b3-theme-error,#e74c3c)">搜索出错：' + that.escapeHtml(e.message || String(e)) + '</span>';
                }
                searchBtn.disabled = false;
                searchBtn.textContent = '查找新位置';
            });
        });
    }

    /**
     * 目录选择器 - 弹出小型模态框
     * defaultPath: 初始路径（旧链接的父目录）
     * callback(selectedDir): 选中后回调，null 表示取消
     */
    pickDirectory(defaultPath, callback) {
        var that = this;

        // 计算初始目录：旧路径的父目录
        var initialDir = '';
        if (defaultPath) {
            var sep = defaultPath.lastIndexOf('\\');
            if (sep > 0) {
                initialDir = defaultPath.substring(0, sep);
            } else {
                sep = defaultPath.lastIndexOf('/');
                if (sep > 0) {
                    initialDir = defaultPath.substring(0, sep);
                }
            }
        }

        var contentHtml = '<div style="padding:16px;min-width:380px;max-width:500px">' +
            '<div style="font-weight:bold;font-size:14px;margin-bottom:12px">📁 选择搜索目录</div>' +
            '<div style="margin-bottom:8px;font-size:12px;color:var(--b3-theme-secondary,#999)">在此目录下递归搜索同名文件（最多5层深度）</div>' +
            '<div style="display:flex;gap:4px;margin-bottom:10px">' +
                '<select id="cd-pick-drive" style="padding:4px 6px;font-size:12px;border:1px solid var(--b3-border,#ddd);border-radius:4px;background:var(--b3-theme-background,#fff);color:var(--b3-theme-on-background,#333);cursor:pointer;outline:none;min-width:50px"></select>' +
                '<input id="cd-pick-path" type="text" value="' + that.escapeHtml(initialDir) + '" placeholder="输入或选择目录路径" style="flex:1;padding:6px 10px;font-size:12px;border:1px solid var(--b3-border,#ddd);border-radius:4px;background:var(--b3-theme-background,#fff);color:var(--b3-theme-on-background,#333);outline:none">' +
            '</div>' +
            '<div id="cd-pick-subdirs" style="max-height:200px;overflow-y:auto;border:1px solid var(--b3-border,#eee);border-radius:4px;margin-bottom:10px;font-size:12px">' +
                '<div style="padding:8px;color:var(--b3-theme-secondary,#999);text-align:center">加载中...</div>' +
            '</div>' +
            '<div style="display:flex;justify-content:flex-end;gap:8px">' +
                '<button id="cd-pick-cancel" style="padding:5px 14px;font-size:12px;background:transparent;color:var(--b3-theme-on-background,#333);border:1px solid var(--b3-border,#ddd);border-radius:4px;cursor:pointer">取消</button>' +
                '<button id="cd-pick-ok" style="padding:5px 14px;font-size:12px;background:var(--b3-theme-primary,#4285f4);color:#fff;border:none;border-radius:4px;cursor:pointer">选择此目录</button>' +
            '</div>' +
        '</div>';

        var picker = document.createElement('div');
        picker.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.35);z-index:10001;display:flex;align-items:center;justify-content:center';
        picker.innerHTML = '<div style="background:var(--b3-theme-background,#fff);border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,0.2)">' + contentHtml + '</div>';
        document.body.appendChild(picker);

        var pathInput = picker.querySelector('#cd-pick-path');
        var driveSelect = picker.querySelector('#cd-pick-drive');
        var subdirsDiv = picker.querySelector('#cd-pick-subdirs');
        var currentBrowsePath = initialDir;

        // 加载存储列表（跨平台）
        that.detectDrives(function(drives) {
            if (driveSelect) {
                driveSelect.innerHTML = '';
                for (var d = 0; d < drives.length; d++) {
                    var opt = document.createElement('option');
                    opt.value = drives[d].value;
                    opt.textContent = drives[d].label;
                    // 根据初始路径匹配存储项
                    if (initialDir && initialDir.indexOf(drives[d].value) === 0) {
                        opt.selected = true;
                    }
                    driveSelect.appendChild(opt);
                }
            }
        });

        // 存储切换（跨平台）
        if (driveSelect) {
            driveSelect.addEventListener('change', function() {
                var selectedValue = this.value;
                var newPath;
                if (that.isWindows) {
                    newPath = selectedValue + ':\\';
                } else {
                    // macOS/Linux: value 已经是完整路径
                    newPath = selectedValue.endsWith('/') ? selectedValue : selectedValue + '/';
                }
                pathInput.value = newPath;
                currentBrowsePath = newPath;
                that.loadPickerSubdirs(subdirsDiv, newPath, pathInput);
            });
        }

        // 加载子目录列表
        function loadSubdirs(dirPath) {
            that.loadPickerSubdirs(subdirsDiv, dirPath, pathInput);
        }

        // 初始加载子目录
        if (initialDir) {
            loadSubdirs(initialDir);
        }

        // 选择此目录按钮
        var okBtn = picker.querySelector('#cd-pick-ok');
        if (okBtn) {
            okBtn.addEventListener('click', function() {
                var selectedDir = pathInput.value.trim();
                if (!selectedDir) {
                    that.showToastMsg('请输入目录路径');
                    return;
                }
                if (picker.parentNode) document.body.removeChild(picker);
                if (callback) callback(selectedDir);
            });
        }

        // 取消按钮
        var cancelBtn = picker.querySelector('#cd-pick-cancel');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', function() {
                if (picker.parentNode) document.body.removeChild(picker);
                if (callback) callback(null);
            });
        }

        // 点击遮罩关闭（等同取消）— stopPropagation 防止冒泡到 document 关闭同步面板
        picker.addEventListener('click', function(e) {
            e.stopPropagation();
            if (e.target === picker) {
                if (picker.parentNode) document.body.removeChild(picker);
                if (callback) callback(null);
            }
        });
    }

    /**
     * 加载目录选择器中的子目录列表
     */
    loadPickerSubdirs(container, dirPath, pathInput) {
        var that = this;
        container.innerHTML = '<div style="padding:8px;color:var(--b3-theme-secondary,#999);text-align:center">加载中...</div>';

        that._fsExists(dirPath, true).then(function(exists) {
            if (!exists) {
                container.innerHTML = '<div style="padding:8px;color:var(--b3-theme-secondary,#999);text-align:center">目录不存在</div>';
                return;
            }

            return that._fsReaddir(dirPath);
        }).then(function(entries) {
            if (!entries) return;
            var dirs = [];
            for (var i = 0; i < entries.length; i++) {
                var isDir = typeof entries[i].isDirectory === 'function' ? entries[i].isDirectory() : entries[i].isDir;
                if (isDir) {
                    dirs.push(entries[i].name);
                }
            }
            dirs.sort(function(a, b) { return a.localeCompare(b); });

            if (dirs.length === 0) {
                container.innerHTML = '<div style="padding:8px;color:var(--b3-theme-secondary,#999);text-align:center">无子目录</div>';
                return;
            }

            var html = '';
            var parentDir = path ? path.dirname(dirPath) : (function() { var s = dirPath.indexOf('\\') >= 0 ? '\\' : '/'; var idx = dirPath.replace(/[\\\/]+$/, '').lastIndexOf(s); return idx > 0 ? dirPath.substring(0, idx) : dirPath; })();
            if (parentDir && parentDir !== dirPath) {
                html += '<div class="cd-pick-dir-item" data-dir="' + that.escapeHtml(parentDir) + '" style="padding:5px 10px;cursor:pointer;border-bottom:1px solid var(--b3-border,#f5f5f5);color:var(--b3-theme-secondary,#999)">📁 ..</div>';
            }
            for (var d = 0; d < dirs.length; d++) {
                var fullPath = dirPath + that._sep + dirs[d];
                html += '<div class="cd-pick-dir-item" data-dir="' + that.escapeHtml(fullPath) + '" style="padding:5px 10px;cursor:pointer;border-bottom:1px solid var(--b3-border,#f5f5f5)">📁 ' + that.escapeHtml(dirs[d]) + '</div>';
            }
            container.innerHTML = html;

            var dirItems = container.querySelectorAll('.cd-pick-dir-item');
            for (var j = 0; j < dirItems.length; j++) {
                (function(item) {
                    item.addEventListener('click', function() {
                        var newDir = item.getAttribute('data-dir');
                        if (pathInput) pathInput.value = newDir;
                        that.loadPickerSubdirs(container, newDir, pathInput);
                    });
                    item.addEventListener('mouseover', function() {
                        item.style.background = 'var(--b3-theme-primary-light,#bbdefb)';
                    });
                    item.addEventListener('mouseout', function() {
                        item.style.background = '';
                    });
                })(dirItems[j]);
            }
        }).catch(function(e) {
            container.innerHTML = '<div style="padding:8px;color:var(--b3-theme-error,#e74c3c);text-align:center">无法读取目录</div>';
        });
    }

    /**
     * 计算两个字符串的相似度（0~1），基于 Levenshtein 距离
     */
    stringSimilarity(a, b) {
        if (a === b) return 1;
        if (!a || !b) return 0;
        var la = a.length, lb = b.length;
        if (Math.abs(la - lb) > Math.max(la, lb) * 0.5) return 0; // 长度差太大直接跳过
        var dp = [];
        for (var i = 0; i <= la; i++) {
            dp[i] = [i];
        }
        for (var j = 0; j <= lb; j++) {
            dp[0][j] = j;
        }
        for (var i = 1; i <= la; i++) {
            for (var j = 1; j <= lb; j++) {
                dp[i][j] = Math.min(
                    dp[i - 1][j] + 1,
                    dp[i][j - 1] + 1,
                    dp[i - 1][j - 1] + (a.charAt(i - 1).toLowerCase() === b.charAt(j - 1).toLowerCase() ? 0 : 1)
                );
            }
        }
        var dist = dp[la][lb];
        return 1 - dist / Math.max(la, lb);
    }

    /**
     * 按文件名递归搜索（支持模糊匹配）
     * options:
     *   maxDepth, maxResults, maxDirs, timeoutMs — 同前
     *   fuzzy: true/false — 是否启用模糊匹配（默认 true）
     *   fuzzyThreshold: 0~1 — 模糊匹配相似度阈值（默认 0.6）
     *   onProgress: function(info) — 进度回调，info = { dirsScanned, currentDir, exactCount, fuzzyCount }
     */
    async searchFileByName(fileName, searchDir, options) {
        var that = this;
        var exactResults = [];   // 精确匹配
        var fuzzyResults = [];   // 模糊匹配
        var opts = options || {};
        var maxDepth = opts.maxDepth || 5;
        var maxResults = opts.maxResults || 20;
        var maxDirs = opts.maxDirs || 200;
        var timeoutMs = opts.timeoutMs || 3000;
        var enableFuzzy = opts.fuzzy !== false;  // 默认开启
        var fuzzyThreshold = opts.fuzzyThreshold || 0.6;
        var onProgress = opts.onProgress || null;
        var fileNameLower = fileName.toLowerCase();
        var useApi = that._fsMode() === 'api';

        // 检查搜索目录是否存在
        var dirExists = await that._fsExists(searchDir, true);
        if (!dirExists) {
            return exactResults;
        }

        var startTime = Date.now();
        var queue = [{ dir: searchDir, depth: 0 }];
        var dirsScanned = 0;
        var YIELD_INTERVAL = 5;

        while (queue.length > 0 && (exactResults.length + fuzzyResults.length) < maxResults) {
            if (Date.now() - startTime > timeoutMs) {
                break;
            }
            if (dirsScanned >= maxDirs) {
                break;
            }

            var item = queue.shift();
            if (item.depth > maxDepth) continue;

            try {
                var entries = await that._fsReaddir(item.dir);
                for (var i = 0; i < entries.length; i++) {
                    if ((exactResults.length + fuzzyResults.length) >= maxResults) break;
                    var entry = entries[i];
                    var isDir = typeof entry.isDirectory === 'function' ? entry.isDirectory() : entry.isDir;
                    var isFile = !isDir;
                    var isSymlink = typeof entry.isSymlink === 'function' ? entry.isSymlink() : entry.isSymlink;
                    try {
                        if (isFile) {
                            var matchType = null;

                            // 精确匹配
                            if (entry.name === fileName) {
                                matchType = 'exact';
                            }
                            // 大小写不敏感匹配
                            else if (entry.name.toLowerCase() === fileNameLower) {
                                matchType = 'case-insensitive';
                            }
                            // 模糊匹配
                            else if (enableFuzzy && that.stringSimilarity(entry.name, fileName) >= fuzzyThreshold) {
                                matchType = 'fuzzy';
                            }

                            if (matchType) {
                                var fullPath = path ? path.join(item.dir, entry.name) : (item.dir.replace(/[\\\/]+$/, '') + that._sep + entry.name);
                                var stat = await that._fsStat(fullPath).catch(function() { return null; });
                                var result = {
                                    fullPath: fullPath,
                                    size: stat ? stat.size : 0,
                                    mtime: stat && stat.mtime ? stat.mtime.getTime() : 0,
                                    matchType: matchType,
                                    similarity: matchType === 'exact' ? 1 : (matchType === 'case-insensitive' ? 0.95 : that.stringSimilarity(entry.name, fileName))
                                };
                                if (matchType === 'exact' || matchType === 'case-insensitive') {
                                    exactResults.push(result);
                                } else {
                                    fuzzyResults.push(result);
                                }
                            }
                        } else if (isDir) {
                            if (entry.name.charAt(0) === '.' || entry.name === '$RECYCLE.BIN' || entry.name === 'System Volume Information' || entry.name === 'node_modules' || entry.name === '.git') continue;
                            // macOS APFS firmlink: /System/Volumes/Data 镜像根文件系统，跳过避免重复扫描
                            var nextDir = path ? path.join(item.dir, entry.name) : (item.dir.replace(/[\\\/]+$/, '') + that._sep + entry.name);
                            if (entry.name === 'Data' && item.dir === '/System/Volumes') continue;
                            queue.push({ dir: nextDir, depth: item.depth + 1 });
                        } else if (isSymlink) {
                            // 符号链接，尝试判断是否为目录
                            try {
                                var st = await that._fsStat(path.join(item.dir, entry.name)).catch(function() { return null; });
                                if (st && st.isDirectory()) {
                                    queue.push({ dir: path.join(item.dir, entry.name), depth: item.depth + 1 });
                                }
                            } catch(e) {}
                        }
                    } catch (e) {
                        // 跳过无权限文件
                    }
                }
            } catch (e) {
                // 跳过无权限目录
            }

            dirsScanned++;

            // 进度回调
            if (onProgress && dirsScanned % 3 === 0) {
                onProgress({
                    dirsScanned: dirsScanned,
                    currentDir: item.dir,
                    exactCount: exactResults.length,
                    fuzzyCount: fuzzyResults.length
                });
            }

            if (dirsScanned % YIELD_INTERVAL === 0) {
                await new Promise(function(resolve) { setTimeout(resolve, 0); });
            }
        }

        // 排序：精确匹配在前，然后按修改时间降序
        exactResults.sort(function(a, b) { return b.mtime - a.mtime; });
        fuzzyResults.sort(function(a, b) {
            if (b.similarity !== a.similarity) return b.similarity - a.similarity;
            return b.mtime - a.mtime;
        });

        return exactResults.concat(fuzzyResults);
    }

    /**
     * 全盘深度搜索文件（无深度限制，并发扫描，渐进式进度反馈）
     * 用于失效链接修复 R3 阶段：在盘符根目录下全盘搜索同名文件
     * 融合 deepSearch 的异步高并发架构 + 精确匹配 + 目录过滤 + 早停机制
     * @param {string} fileName - 要搜索的文件名
     * @param {string} searchDir - 搜索根目录（通常是盘符根）
     * @param {Object} options
     *   maxResults: 最大结果数（默认 10）
     *   onProgress: 进度回调 function(info) info = { dirsScanned, matchedCount, currentDir, finished }
     */
    async deepSearchFileByName(fileName, searchDir, options) {
        var that = this;
        var opts = options || {};
        var maxResults = opts.maxResults || 10;
        var onProgress = opts.onProgress || null;
        var fileNameLower = fileName.toLowerCase();


        var exactResults = [];
        var searchedDirs = 0;
        var abortFlag = { cancelled: false };

        // 并发池（同 deepSearch：异步 I/O + 高并发）
        var CONCURRENCY = 16;
        var active = 0;
        var pendingCallbacks = [];
        var pendingTasks = 0;
        var allDoneResolve = null;
        var allDonePromise = new Promise(function(resolve) { allDoneResolve = resolve; });

        function taskStarted() { pendingTasks++; }
        function taskFinished() {
            pendingTasks--;
            if (pendingTasks === 0 && allDoneResolve) {
                allDoneResolve();
                allDoneResolve = null;
            }
        }

        function schedule(fn) {
            return new Promise(function(resolve, reject) {
                function tryRun() {
                    if (abortFlag.cancelled) { taskFinished(); resolve(); return; }
                    if (exactResults.length >= maxResults) { taskFinished(); resolve(); return; }
                    if (active < CONCURRENCY) {
                        active++;
                        fn().then(function(val) {
                            active--;
                            resolve(val);
                            if (pendingCallbacks.length > 0) { var next = pendingCallbacks.shift(); next(); }
                        }, function(err) {
                            active--;
                            reject(err);
                            if (pendingCallbacks.length > 0) { var next = pendingCallbacks.shift(); next(); }
                        });
                    } else {
                        pendingCallbacks.push(tryRun);
                    }
                }
                tryRun();
            });
        }

        // 进度节流：最多每 300ms 回调一次
        var lastProgressTime = 0;
        var progressTimer = null;
        function reportProgress(currentDir) {
            if (!onProgress) return;
            var now = Date.now();
            if (now - lastProgressTime < 300 && !progressTimer) {
                progressTimer = setTimeout(function() {
                    progressTimer = null;
                    lastProgressTime = Date.now();
                    onProgress({
                        dirsScanned: searchedDirs,
                        matchedCount: exactResults.length,
                        currentDir: currentDir || '',
                        finished: false
                    });
                }, 300);
                return;
            }
            lastProgressTime = now;
            onProgress({
                dirsScanned: searchedDirs,
                matchedCount: exactResults.length,
                currentDir: currentDir || '',
                finished: false
            });
        }

        function searchRecursive(currentDir) {
            if (abortFlag.cancelled) return;
            if (exactResults.length >= maxResults) return;

            var normalizedPath = currentDir;
            if (!normalizedPath.endsWith(that._sep)) normalizedPath += that._sep;

            taskStarted();
            schedule(function() {
                if (abortFlag.cancelled) { taskFinished(); return Promise.resolve(); }
                if (exactResults.length >= maxResults) { taskFinished(); return Promise.resolve(); }

                // 异步读取目录（使用插件封装，兼容 Docker/API 模式）
                return that._fsReaddir(normalizedPath.replace(/[\\\/]+$/, '')).then(function(entries) {
                    var subPromises = [];
                    searchedDirs++;

                    for (var i = 0; i < entries.length; i++) {
                        if (abortFlag.cancelled) break;
                        if (exactResults.length >= maxResults) break;

                        var entry = entries[i];
                        var fullPath = normalizedPath + entry.name;
                        var isFile = entry.isFile();
                        var isDir = entry.isDirectory();

                        if (isFile) {
                            // 精确匹配
                            var matchType = null;
                            if (entry.name === fileName) {
                                matchType = 'exact';
                            } else if (entry.name.toLowerCase() === fileNameLower) {
                                matchType = 'case-insensitive';
                            }

                            if (matchType) {
                                // 用 IIFE 捕获 matchType 和 fullPath，避免闭包 bug
                                (function(mt, fp) {
                                    var statP = that._fsStat(fp).then(function(st) {
                                        exactResults.push({
                                            fullPath: fp,
                                            size: st.size,
                                            mtime: st.mtime ? st.mtime.getTime() : 0,
                                            matchType: mt,
                                            similarity: mt === 'exact' ? 1 : 0.95
                                        });
                                    }).catch(function() {});
                                    subPromises.push(statP);
                                })(matchType, fullPath);
                            }
                        }

                        // 目录递归：独立检查 isDirectory()
                        // 也处理 OTHER 类型（symlink/junction 指向目录）
                        if (isDir) {
                            // 目录过滤：跳过系统目录、隐藏目录、开发目录
                            if (entry.name.charAt(0) === '.' || entry.name === '$RECYCLE.BIN' || entry.name === 'System Volume Information' || entry.name === 'node_modules' || entry.name === '.git') continue;
                            // macOS APFS firmlink: /System/Volumes/Data 镜像根文件系统，跳过避免重复扫描
                            if (entry.name === 'Data' && normalizedPath === '/System/Volumes/') continue;
                            searchRecursive(fullPath);
                        } else if (!isFile && !isDir) {
                            // OTHER 类型（symlink/junction）：尝试 fs.statSync 判断是否为目录
                            // Windows 上如 "Documents and Settings"、用户目录下的兼容性链接
                            try {
                                if (!fs || !fs.statSync) { taskFinished(); continue; }
                                var st = fs.statSync(fullPath);
                                if (st && st.isDirectory()) {
                                    if (entry.name.charAt(0) !== '.' && entry.name !== '$RECYCLE.BIN' && entry.name !== 'System Volume Information' && entry.name !== 'node_modules' && entry.name !== '.git') {
                                        searchRecursive(fullPath);
                                    }
                                }
                            } catch(e) {
                                // 无权限等，跳过
                            }
                        }
                    }

                    // 等待当前目录的 stat 完成，确保 matchedCount 准确
                    return Promise.all(subPromises).then(function() {
                        reportProgress(normalizedPath);
                    });
                }).catch(function(err) {
                    // 目录无权限等错误，静默跳过
                }).finally(function() {
                    taskFinished();
                });
            });
        }

        // 强制结束（取消时确保 pendingTasks 归零）
        function forceFinishAll() {
            pendingCallbacks.length = 0;
            if (pendingTasks > 0 && allDoneResolve) {
                pendingTasks = 0;
                allDoneResolve();
                allDoneResolve = null;
            }
        }

        try {
            searchRecursive(searchDir);
            await allDonePromise;
        } catch (e) {
            that._error('deepSearchFileByName error:', e);
        }

        // 网盘兼容：如果递归搜索没找到任何结果，尝试用插件的 deepSearch 方法
        // deepSearch 在网盘上表现更稳定（不做 OTHER 类型 statSync、不过滤目录）
        if (exactResults.length === 0) {
            try {
                var fallbackResults = await new Promise(function(resolve, reject) {
                    var timeout = setTimeout(function() { resolve([]); }, 60000);
                    that.deepSearch(searchDir, fileName, function(partialResults) {
                        // onPartial - 进度回调
                    }, function(allResults, wasCancelled) {
                        clearTimeout(timeout);
                        resolve(allResults || []);
                    }, abortFlag);
                });
                for (var fi = 0; fi < fallbackResults.length && exactResults.length < maxResults; fi++) {
                    var fr = fallbackResults[fi];
                    var frName = fr.name || (fr.path ? fr.path.replace(/\\/g, '/').split('/').pop() : '');
                    if (frName === fileName || frName.toLowerCase() === fileNameLower) {
                        try {
                            var fst = fr.path ? await that._fsStat(fr.path).catch(function() { return null; }) : null;
                            exactResults.push({
                                fullPath: fr.path || '',
                                size: fst ? fst.size : (fr.size || 0),
                                mtime: fst ? (fst.mtime ? fst.mtime.getTime() : 0) : (fr.mtime || 0),
                                matchType: 'exact',
                                similarity: 1
                            });
                        } catch (e) {}
                    }
                }
            } catch (e) {
            }
        }

        // 清理 abort 标记
        if (abortFlag.cancelled) {
            forceFinishAll();
        }

        // 排序：按修改时间降序
        exactResults.sort(function(a, b) { return b.mtime - a.mtime; });

        // 最终进度回调
        if (onProgress) {
            onProgress({
                dirsScanned: searchedDirs,
                matchedCount: exactResults.length,
                currentDir: '',
                finished: true
            });
        }

        return exactResults;
    }

    /**
     * 替换文档中的链接
     * 修复v5：直接修改 block.markdown（思源真正的存储格式），用 dataType:'markdown' 更新
     * 旧版用 dataType:'dom' + DOM字符串替换，但思源内部用 Markdown 存储，
     * DOM 替换后内核从 Markdown 重新渲染会覆盖修改，导致替换不持久
     */
    async replaceLink(docId, oldUrl, newLocalPath, itemIndex, context) {
        var that = this;
        var isSilent = context && context.silent;

        // 为新链接生成文件指纹 title
        var newFingerprintTitle = '';
        try {
            var newStat = await that._fsStat(newLocalPath).catch(function() { return null; });
            if (newStat) {
                newFingerprintTitle = 'size=' + newStat.size + '&mtime=' + (newStat.mtime ? newStat.mtime.getTime() : 0);
            }
        } catch(e) {
            that._log('replaceLink: fs.statSync failed for', newLocalPath, e.message);
        }

        // 修复：改用 toFileUrl（不编码中文），和 insertLocalFileLink 保持一致，避免中文显示为 % 编码乱码
        var newUrl = that.toFileUrl(newLocalPath);
        var newUrlWithTitle = newFingerprintTitle ? (newUrl + ' "' + newFingerprintTitle + '"') : newUrl;

        that._log('replaceLink: docId=' + docId + ', oldUrl=' + oldUrl + ', newUrl=' + newUrl);

        try {

            // === 步骤1：获取文档的所有子块 ===
            var childResp = await fetch('/api/block/getChildBlocks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: docId })
            });
            var childData = await childResp.json();
            if (childData.code !== 0 || !childData.data) {
                that._log('replaceLink: step1 failed - getChildBlocks returned code=' + childData.code);
                if (!isSilent) that.showToastMsg('获取子块失败');
                return;
            }
            var childBlocks = childData.data;

            // === 步骤2：找到包含旧链接的子块 ===
            var targetBlock = null;
            var targetMatchUrl = null;  // 记录实际匹配到的 URL 格式

            // 准备多种可能的 URL 格式用于匹配
            var oldUrlVariants = [oldUrl];
            // 编码版本（空格→%20，中文→UTF-8）— 先解码避免双重编码
            var decodedOldPath = oldUrl.replace(/^file:\/\//, '').replace(/\\/g, '/');
            try { decodedOldPath = decodeURIComponent(decodedOldPath); } catch(e) {}
            oldUrlVariants.push(that.localPathToFileUrl(decodedOldPath));
            // 只编码空格版本（思源有时只编码空格）
            oldUrlVariants.push(oldUrl.replace(/ /g, '%20'));
            // 只编码中文版本
            oldUrlVariants.push(encodeURI(oldUrl).replace(/%25/g, '%'));
            // 去掉 file:/// 前缀的原始路径
            oldUrlVariants.push(oldUrl.replace('file:///', ''));
            // 去掉 file:/// 前缀且斜杠替换为反斜杠
            oldUrlVariants.push(oldUrl.replace('file:///', '').replace(/\//g, '\\'));

            for (var i = 0; i < childBlocks.length; i++) {
                var block = childBlocks[i];
                if (!block.markdown) continue;

                for (var v = 0; v < oldUrlVariants.length; v++) {
                    if (block.markdown.indexOf(oldUrlVariants[v]) !== -1) {
                        targetBlock = block;
                        targetMatchUrl = oldUrlVariants[v];
                        break;
                    }
                }
                if (targetBlock) break;
            }

            if (!targetBlock) {
                that._log('replaceLink: step2 failed - no block contains oldUrl, tried variants:', oldUrlVariants);
                for (var i = 0; i < Math.min(childBlocks.length, 5); i++) {
                    var md = childBlocks[i].markdown || '';
                    that._log('replaceLink: block[' + i + '] md(0..200):', md.substring(0, 200));
                }
                if (!isSilent) that.showToastMsg('未找到包含该链接的块');
                return;
            }
            that._log('replaceLink: step2 found block', targetBlock.id, 'matchUrl=', targetMatchUrl);

            // === 步骤3：在 markdown 中替换链接 ===
            // 直接修改 block.markdown（思源的真正存储格式），然后用 dataType:'markdown' 更新
            var oldMarkdown = targetBlock.markdown;
            var newMarkdown = oldMarkdown;
            var replaced = false;

            function escapeRegex(str) {
                return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            }

            // 策略：在 markdown 中找到旧 URL（含可能的 fragment 或 title），整体替换为新 URL（含新 title）
            // Markdown 中的 file:/// 链接格式：![alt](file:///path) 或 [text](file:///path "title")
            // 匹配模式：URL + 可选的 #fragment + 可选的空格+引号+title+引号

            // 方式1：用 targetMatchUrl（实际在 markdown 中匹配到的格式）替换
            if (targetMatchUrl) {
                var escapedTarget = escapeRegex(targetMatchUrl);
                var regex1 = new RegExp(escapedTarget + '(#[^)"\\s]*)?(\\s+"[^"]*")?');
                newMarkdown = newMarkdown.replace(regex1, function(match, fragment, title) {
                    return newUrlWithTitle;
                });
                if (newMarkdown !== oldMarkdown) {
                    replaced = true;
                } else {
                    // targetMatchUrl 没匹配到（可能 markdown 中 URL 格式略有不同），恢复尝试其他方式
                    newMarkdown = oldMarkdown;
                }
            }

            // 方式2：直接替换旧 URL（原始格式）
            if (!replaced) {
                var escapedOld = escapeRegex(oldUrl);
                var regex2 = new RegExp(escapedOld + '(#[^)"\\s]*)?(\\s+"[^"]*")?');
                var testReplace = oldMarkdown.replace(regex2, newUrlWithTitle);
                if (testReplace !== oldMarkdown) {
                    newMarkdown = testReplace;
                    replaced = true;
                }
            }

            // 方式3：编码版本替换
            if (!replaced) {
                var decodedOldPath2 = oldUrl.replace(/^file:\/\//, '').replace(/\\/g, '/');
                try { decodedOldPath2 = decodeURIComponent(decodedOldPath2); } catch(e) {}
                var oldEncoded = that.localPathToFileUrl(decodedOldPath2);
                var escapedEncoded = escapeRegex(oldEncoded);
                var regex3 = new RegExp(escapedEncoded + '(#[^)"\\s]*)?(\\s+"[^"]*")?');
                var testReplace3 = oldMarkdown.replace(regex3, newUrlWithTitle);
                if (testReplace3 !== oldMarkdown) {
                    newMarkdown = testReplace3;
                    replaced = true;
                }
            }

            // 方式4：只编码空格版本
            if (!replaced) {
                var oldSpaceEncoded = oldUrl.replace(/ /g, '%20');
                var escapedSpace = escapeRegex(oldSpaceEncoded);
                var regex4 = new RegExp(escapedSpace + '(#[^)"\\s]*)?(\\s+"[^"]*")?');
                var testReplace4 = oldMarkdown.replace(regex4, newUrlWithTitle);
                if (testReplace4 !== oldMarkdown) {
                    newMarkdown = testReplace4;
                    replaced = true;
                }
            }

            if (!replaced) {
                that._log('replaceLink: step3 failed - no markdown replacement matched');
                if (!isSilent) that.showToastMsg('未找到需要替换的链接');
                return;
            }
            that._log('replaceLink: step3 markdown replacement succeeded');

            // === 步骤4：用 dataType: 'markdown' 更新该子块 ===
            var updateResp = await fetch('/api/block/updateBlock', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: targetBlock.id,
                    dataType: 'markdown',
                    data: newMarkdown
                })
            });
            var updateData = await updateResp.json();
            if (updateData.code !== 0) {
                that._log('replaceLink: step4 updateBlock failed - code=' + updateData.code + ', msg=' + (updateData.msg || ''));
                if (!isSilent) that.showToastMsg('替换链接失败：' + (updateData.msg || '未知错误'));
                return;
            }
            that._log('replaceLink: step4 updateBlock (markdown) succeeded, blockId=' + targetBlock.id);

            // 替换成功，更新 UI
            if (context && context.dialog) {
                var statusEl = context.dialog.querySelector('.cd-relink-status[data-index="' + itemIndex + '"]');
                var candidateArea = context.dialog.querySelector('.cd-relink-candidate-area[data-index="' + itemIndex + '"]');

                if (statusEl) {
                    statusEl.textContent = '✅ 已修复';
                    statusEl.style.color = 'var(--b3-theme-success,#52c41a)';
                }
                if (candidateArea) {
                    candidateArea.innerHTML = '<span style="font-size:11px;color:var(--b3-theme-success,#52c41a)">→ ' + that.escapeHtml(newLocalPath) + '</span>';
                }
            }

            if (!isSilent) {
                // 链接修复成功，无提示（已在 UI 中显示状态）
            }

        } catch (e) {
            that._error('replaceLink error:', e);
            if (!isSilent) {
                that.showToastMsg('替换链接失败：' + (e.message || e));
            }
        }
    }

    // ==================== Assets Manager (内部资源管理) ====================

    /**
     * Tab 切换
     */
    _switchTab(tabName) {
        var that = this;
        that._activeTab = tabName;
        try {
            localStorage.setItem('cd-active-tab', tabName);
        } catch (e) {}

        var tabs = ['local', 'assets'];
        tabs.forEach(function(t) {
            var panel = document.getElementById('cd-panel-' + t);
            var btn = document.querySelector('.cd-tab-btn[data-tab="' + t + '"]');
            if (panel) {
                panel.style.display = (t === tabName) ? 'flex' : 'none';
            }
            if (btn) {
                if (t === tabName) {
                    btn.style.color = 'var(--b3-theme-primary,#4285f4)';
                    btn.style.borderBottomColor = 'var(--b3-theme-primary,#4285f4)';
                    btn.classList.add('cd-tab-active');
                } else {
                    btn.style.color = 'var(--b3-theme-secondary,#999)';
                    btn.style.borderBottomColor = 'transparent';
                    btn.classList.remove('cd-tab-active');
                }
            }
        });

        // 将音频播放器移到当前活动面板内，统计栏上方（歌词面板保持在外部避免被裁切）
        var audioBar = document.getElementById('cd-audio-bar');
        var activePanel = document.getElementById('cd-panel-' + tabName);
        if (activePanel) {
            var statsBar = activePanel.querySelector('#cd-stats-bar, #cd-assets-stats-bar');
            if (statsBar && audioBar) {
                activePanel.insertBefore(audioBar, statsBar);
            }
        }

        // 首次切换到 assets 面板时加载数据
        if (tabName === 'assets' && !that._assetsLoaded) {
            that._loadAssets();
        }
    }

    /**
     * 获取 assets 目录路径（供思源文件 API 使用）
     * 思源 /api/file/readDir API 会把传入路径拼接到工作区根目录后
     * 所以需要用 data/assets/ 才能指向正确的目录
     */
    _getAssetsPath() {
        return 'data/assets/';
    }

    /**
     * 加载 assets/ 目录文件列表
     */
    async _loadAssets() {
        var that = this;
        var listEl = document.getElementById('cd-assets-list');

        // 辅助：思源 updated 字段 YYYYMMDDHHmmss → 毫秒时间戳
        function parseSiyuanTime(ts) {
            if (!ts) return 0;
            if (typeof ts === 'number') return ts;
            if (/^\d{14}$/.test(ts)) {
                var y = ts.slice(0,4), m = ts.slice(4,6), d = ts.slice(6,8);
                var h = ts.slice(8,10), mi = ts.slice(10,12), s = ts.slice(12,14);
                var date = new Date(y+'-'+m+'-'+d+'T'+h+':'+mi+':'+s);
                return isNaN(date.getTime()) ? 0 : date.getTime();
            }
            var date2 = new Date(ts);
            return isNaN(date2.getTime()) ? 0 : date2.getTime();
        }

        // === 阶段0：localStorage 缓存秒开 ===
        try {
            var cached = localStorage.getItem('cd_assets_cache');
            if (cached) {
                var cacheData = JSON.parse(cached);
                if (cacheData && cacheData.tree && cacheData.tree.length > 0) {
                    that._assetsTree = cacheData.tree;
                    that._assetsFileMap = cacheData.fileMap || {};
                    that._assetBlockMap = cacheData.blockMap || {};
                    that._assetsExpanded = new Set(cacheData.expanded || []);
                    that._selectedDocId = cacheData.selectedDocId || null;
                    that._assetsSortBy = cacheData.sortBy || 'time';
                    that._assetsSortOrder = cacheData.sortOrder || 'desc';
                    that._assetsNavStack = cacheData.navStack || [];
                    that._assetsLoaded = true;
                    that._assetsFilter = cacheData.filter || 'all';
                    that._assetsExtFilter = cacheData.extFilter || null;
                    that._assetsSizeFilter = cacheData.sizeFilter || 0;
                    that._assetsSearch = '';
                    that._updateAssetsFilterOptions();
                    that._renderAssetsTree();
                    that._bindAssetsEvents();
                    // 缓存秒开后，后台静默刷新（保留展开/选中状态）
                    that._refreshAssetsInBackground();
                    return;
                }
            }
        } catch (e) {
            that._log('_loadAssets: cache read failed', e);
        }

        if (listEl) {
            listEl.innerHTML = '<div style="padding:20px;text-align:center;color:#999">📦 加载文档资源树...</div>';
        }

        try {
            // === 阶段1：并行 Promise.all 发5个请求 ===
            var nbPromise = fetch('/api/notebook/lsNotebooks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include'
            }).then(function(r) { return r.json(); });

            var docPromise = fetch('/api/query/sql', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ stmt: "SELECT id, content, parent_id, box, updated FROM blocks WHERE type = 'd' LIMIT 10000" }),
                credentials: 'include'
            }).then(function(r) { return r.json(); });

            // 渠道A：assets 表关联
            var channelAPromise = fetch('/api/query/sql', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ stmt: "SELECT a.name, b.root_id, b.id AS block_id FROM assets AS a JOIN blocks AS b ON a.block_id = b.id LIMIT 100000" }),
                credentials: 'include'
            }).then(function(r) { return r.json(); });

            // 渠道B：blocks 内容含 assets/ 路径
            var channelBPromise = fetch('/api/query/sql', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ stmt: "SELECT id, root_id, content FROM blocks WHERE content LIKE '%assets/%' LIMIT 100000" }),
                credentials: 'include'
            }).then(function(r) { return r.json(); });

            // 资源文件读取
            var assetsPath = that._getAssetsPath();
            var filePromise;
            if (fs && fs.readdirSync && fs.statSync) {
                // 桌面版：用 fs 模块读取（同步，包装为 Promise）
                filePromise = new Promise(function(resolve) {
                    var fileMap = {};
                    try {
                        var dataDir = '';
                        try {
                            if (window.siyuan && window.siyuan.config && window.siyuan.config.system && window.siyuan.config.system.dataDir) {
                                dataDir = window.siyuan.config.system.dataDir;
                            }
                        } catch (e) {}
                        if (dataDir) {
                            var assetsDir = dataDir.replace(/\\/g, '/').replace(/\/+$/, '') + '/assets/';
                            (function readDirRecursive(dirPath, basePath) {
                                var items;
                                try { items = fs.readdirSync(dirPath); } catch (e) { return; }
                                items.forEach(function(item) {
                                    if (item.charAt(0) === '.') return;
                                    var fullPath = dirPath + '/' + item;
                                    var relPath = basePath ? basePath + '/' + item : item;
                                    try {
                                        var st = fs.statSync(fullPath);
                                        if (st.isDirectory()) {
                                            readDirRecursive(fullPath, relPath);
                                        } else {
                                            fileMap[item] = {
                                                name: item,
                                                relPath: relPath,
                                                size: st.size || 0,
                                                updated: st.mtime ? st.mtime.getTime() : 0,
                                                ext: (item.split('.').pop() || '').toLowerCase()
                                            };
                                        }
                                    } catch (e) {}
                                });
                            })(assetsDir, '');
                        }
                    } catch (e) {}
                    resolve(fileMap);
                });
            } else {
                // Web/Docker 版回退
                filePromise = fetch('/api/file/readDir', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: assetsPath }),
                    credentials: 'include'
                }).then(function(r) { return r.json(); }).then(function(data) {
                    var fileMap = {};
                    if (data.code === 0 && Array.isArray(data.data)) {
                        data.data.forEach(function(f) {
                            if (!f.name || f.name.charAt(0) === '.') return;
                            var rawTime = f.updated || f.mtime || 0;
                            var timeMs = rawTime;
                            if (rawTime && rawTime < 10000000000) timeMs = rawTime * 1000;
                            fileMap[f.name] = {
                                name: f.name,
                                relPath: f.name,
                                size: f.size || 0,
                                updated: timeMs,
                                ext: (f.name.split('.').pop() || '').toLowerCase()
                            };
                        });
                    }
                    return fileMap;
                }).catch(function() { return {}; });
            }

            var results = await Promise.all([nbPromise, docPromise, channelAPromise, channelBPromise, filePromise]);
            var nbData = results[0];
            var docData = results[1];
            var channelAData = results[2];
            var channelBData = results[3];
            var fileMap = results[4];

            // === 1. 解析笔记本列表 ===
            var notebooks = {};
            if (nbData.code === 0 && nbData.data && Array.isArray(nbData.data.notebooks)) {
                nbData.data.notebooks.forEach(function(n) {
                    if (!n.closed) {
                        notebooks[n.id] = n.name || n.id;
                    }
                });
            } else {
                that._log('_loadAssets: lsNotebooks API failed', nbData);
            }

            // === 2. 解析文档列表 ===
            var docMap = {};
            var allDocs = [];
            if (docData.code === 0 && Array.isArray(docData.data)) {
                docData.data.forEach(function(d) {
                    docMap[d.id] = {
                        id: d.id,
                        name: d.content || d.id,
                        parent_id: d.parent_id,
                        box: d.box,
                        updated: parseSiyuanTime(d.updated),
                        assets: []
                    };
                    allDocs.push(docMap[d.id]);
                });
            } else {
                that._log('_loadAssets: blocks query failed', docData);
            }

            // === 3. 组装 assetFiles（fileMap → assetFiles，必须在渠道B之前） ===
            var assetFiles = {};
            Object.keys(fileMap).forEach(function(name) {
                var f = fileMap[name];
                var type = that._getAssetType(f.ext);
                assetFiles[name] = {
                    name: name,
                    relPath: f.relPath || name,
                    size: f.size,
                    updated: f.updated,
                    type: type,
                    ext: f.ext
                };
            });

            // === 4. 渠道A：assets 表关联 ===
            var assetDocMap = {};
            var assetBlockMap = {};
            if (channelAData.code === 0 && Array.isArray(channelAData.data)) {
                channelAData.data.forEach(function(row) {
                    var docId = row.root_id;
                    var blockId = row.block_id;
                    var name = row.name || '';
                    var basename = name.split('/').pop();
                    if (!basename || !docId) return;
                    if (!assetDocMap[docId]) assetDocMap[docId] = {};
                    assetDocMap[docId][basename] = true;
                    if (blockId) {
                        assetBlockMap[basename] = blockId;
                    }
                });
            } else {
                that._log('_loadAssets: channel A (assets table) failed', channelAData);
            }

            // === 5. 渠道B：blocks 内容扫描（B1: assets/路径 + B2: href/src超链接） ===
            if (channelBData.code === 0 && Array.isArray(channelBData.data)) {
                channelBData.data.forEach(function(row) {
                    var blockId = row.id;
                    var rootId = row.root_id;
                    var content = row.content || '';

                    // B1: assets/路径匹配 — [text](assets/filename)
                    var assetsPathRegex = /assets\/([^\s"'<>)}\]]+)/g;
                    var match;
                    while ((match = assetsPathRegex.exec(content)) !== null) {
                        var filename = match[1];
                        var basename = filename.split('/').pop();
                        if (!basename) continue;
                        // 仅关联实际存在的文件（fileMap 已在步骤3构建）
                        if (fileMap[basename] || assetFiles[basename]) {
                            if (!assetDocMap[rootId]) assetDocMap[rootId] = {};
                            assetDocMap[rootId][basename] = true;
                            if (blockId && !assetBlockMap[basename]) {
                                assetBlockMap[basename] = blockId;
                            }
                        }
                    }

                    // B2: href=/src= + 文件名匹配 — 嵌入式图片、iframe
                    var hrefSrcRegex = /(?:href|src)=["']([^"']+)["']/g;
                    while ((match = hrefSrcRegex.exec(content)) !== null) {
                        var url = match[1];
                        var urlBasename = url.split('/').pop();
                        if (!urlBasename) continue;
                        // 跳过外部链接
                        if (url.indexOf('http') === 0 || url.indexOf('//') === 0) continue;
                        if (fileMap[urlBasename] || assetFiles[urlBasename]) {
                            if (!assetDocMap[rootId]) assetDocMap[rootId] = {};
                            assetDocMap[rootId][urlBasename] = true;
                            if (blockId && !assetBlockMap[urlBasename]) {
                                assetBlockMap[urlBasename] = blockId;
                            }
                        }
                    }
                });
            } else {
                that._log('_loadAssets: channel B (blocks scan) failed', channelBData);
            }

            // === 6. 把资源分配到对应文档 ===
            Object.keys(assetDocMap).forEach(function(docId) {
                var doc = docMap[docId];
                if (!doc) return;
                Object.keys(assetDocMap[docId]).forEach(function(name) {
                    var file = assetFiles[name];
                    if (file) {
                        doc.assets.push(file);
                    }
                });
            });

            // === 7. 标记有资源（包括子文档有资源）的文档 ===
            var hasAssets = {};
            allDocs.forEach(function(doc) {
                if (doc.assets.length > 0) {
                    hasAssets[doc.id] = true;
                }
            });
            function markAncestors(docId) {
                var doc = docMap[docId];
                if (!doc || !doc.parent_id || !docMap[doc.parent_id]) return;
                var parent = docMap[doc.parent_id];
                hasAssets[parent.id] = true;
                markAncestors(parent.id);
            }
            Object.keys(hasAssets).forEach(function(id) {
                markAncestors(id);
            });

            // === 8. 为每个 box 构建文档树 ===
            var tree = [];
            Object.keys(notebooks).forEach(function(boxId) {
                var boxDocs = allDocs.filter(function(d) {
                    return d.box === boxId && hasAssets[d.id];
                });
                if (boxDocs.length === 0) return;

                var boxDocIds = {};
                boxDocs.forEach(function(d) { boxDocIds[d.id] = true; });

                // 找到根文档（parent_id 不在当前 box 的可见文档中）
                var roots = boxDocs.filter(function(d) {
                    return !d.parent_id || !boxDocIds[d.parent_id];
                });

                function buildTree(doc, depth) {
                    var children = boxDocs.filter(function(d) {
                        return d.parent_id === doc.id;
                    }).map(function(d) {
                        return buildTree(d, depth + 1);
                    });
                    return {
                        type: 'doc',
                        id: doc.id,
                        name: doc.name,
                        depth: depth,
                        assets: doc.assets,
                        updated: doc.updated || 0,
                        children: children,
                        expanded: false
                    };
                }

                var docTree = roots.map(function(r) {
                    return buildTree(r, 0);
                });

                // 统计资源数 及 各文档树最新更新时间
                var totalAssets = 0;
                function countAssets(node) {
                    if (node.type === 'doc') {
                        totalAssets += node.assets.length;
                        node.children.forEach(countAssets);
                    }
                }
                docTree.forEach(countAssets);

                // 计算笔记本最新更新时间（取所有子文档的最大 updated）
                var nbUpdated = 0;
                function calcMaxUpdated(node) {
                    var max = node.updated || 0;
                    node.children.forEach(function(c) {
                        var childMax = calcMaxUpdated(c);
                        if (childMax > max) max = childMax;
                    });
                    node.updated = max;
                    return max;
                }
                docTree.forEach(function(root) {
                    var rootMax = calcMaxUpdated(root);
                    if (rootMax > nbUpdated) nbUpdated = rootMax;
                });

                tree.push({
                    type: 'notebook',
                    id: boxId,
                    name: notebooks[boxId],
                    children: docTree,
                    expanded: false,
                    assetCount: totalAssets,
                    updated: nbUpdated
                });
            });

            that._assetsTree = tree;
            that._assetsFileMap = assetFiles;
            that._assetBlockMap = assetBlockMap;
            that._assetsExpanded = new Set();
            that._assetsNavStack = []; // 数据刷新后重置导航栈
            that._assetsLoaded = true;
            that._assetsFilter = 'all';
            that._assetsExtFilter = null;
            that._assetsSizeFilter = 0;
            that._assetsSearch = '';

            // 更新底部状态栏
            var totalFiles = Object.keys(assetFiles).length;
            var totalSize = Object.values(assetFiles).reduce(function(sum, f) { return sum + f.size; }, 0);
            that._assetsTotalFiles = totalFiles;
            that._assetsTotalSize = totalSize;
            var statsText = document.getElementById('cd-assets-stats-text');
            if (statsText) {
                statsText.innerHTML = '共 <b>' + totalFiles + '</b> 个文件，<b>' + tree.length + '</b> 个笔记本，占用 <b>' + that._formatSize(totalSize) + '</b>';
            }

            // 如果树为空但文件存在，可能是 SQL 查询失败，显示调试信息和降级列表
            if (tree.length === 0 && totalFiles > 0) {
                var debugHtml = '<div style="padding:16px;color:var(--b3-theme-secondary,#999);font-size:12px">';
                debugHtml += '<div style="margin-bottom:8px;color:var(--b3-theme-error,#d32f2f)">⚠️ 未能按文档树组织资源</div>';
                debugHtml += '<div style="margin-bottom:4px">笔记本: ' + Object.keys(notebooks).length + ' 个</div>';
                debugHtml += '<div style="margin-bottom:4px">文档: ' + allDocs.length + ' 个</div>';
                debugHtml += '<div style="margin-bottom:4px">资源映射: ' + Object.keys(assetDocMap).length + ' 个文档</div>';
                debugHtml += '<div style="margin-bottom:8px">文件: ' + totalFiles + ' 个</div>';
                debugHtml += '<div style="color:var(--b3-theme-secondary,#999);font-size:11px">可能是 SQL 查询被限制，以下为全部资源列表：</div>';
                debugHtml += '</div>';
                var flatData = Object.values(assetFiles);
                that._assetsData = flatData;
                that._sortAssetsData();
                listEl.innerHTML = debugHtml;
                that._renderAssetsFlatList();
                that._bindAssetsEvents();
                return;
            }

            // 默认折叠：只显示笔记本层级
            that._saveAssetsCache();
            that._updateAssetsFilterOptions();
            that._renderAssetsTree();
            that._bindAssetsEvents();

        } catch (e) {
            that._error('_loadAssets error:', e);
            if (listEl) listEl.innerHTML = '<div style="padding:20px;text-align:center;color:var(--b3-theme-error,#d32f2f)">❌ 加载失败: ' + (e.message || e) + '</div>';
        }
    }

    /**
     * 后台静默刷新资源数据（保留展开/选中状态）
     */
    async _refreshAssetsInBackground() {
        var that = this;
        try {
            var savedExpanded = new Set(that._assetsExpanded);
            var savedSelected = that._selectedDocId;
            var savedNavStack = that._assetsNavStack.slice();

            // 临时标记为未加载，重用 _loadAssets 的数据获取逻辑
            that._assetsLoaded = false;
            // 清除缓存避免再次秒开
            localStorage.removeItem('cd_assets_cache');
            await that._loadAssets();

            // 恢复展开/选中/导航状态
            that._assetsExpanded = savedExpanded;
            that._selectedDocId = savedSelected;
            that._assetsNavStack = savedNavStack;
            that._saveAssetsCache();
            that._renderAssetsTree();
        } catch (e) {
            that._log('_refreshAssetsInBackground error', e);
        }
    }

    /**
     * 保存资源缓存到 localStorage
     */
    _saveAssetsCache() {
        try {
            localStorage.setItem('cd_assets_cache', JSON.stringify({
                tree: this._assetsTree,
                fileMap: this._assetsFileMap || {},
                blockMap: this._assetBlockMap || {},
                expanded: Array.from(this._assetsExpanded || []),
                selectedDocId: this._selectedDocId || null,
                sortBy: this._assetsSortBy || 'time',
                sortOrder: this._assetsSortOrder || 'desc',
                navStack: this._assetsNavStack || [],
                filter: this._assetsFilter || 'all',
                extFilter: this._assetsExtFilter || null,
                sizeFilter: this._assetsSizeFilter || 0,
                ts: Date.now()
            }));
        } catch (e) {
            this._log('_saveAssetsCache: save failed', e);
        }
    }

    /**
     * 更新类型统计数量（显示在下拉框后方，可点击筛选）
     */
    _updateAssetsFilterOptions() {
        var that = this;
        var map = this._assetsFileMap || {};
        var counts = { image: 0, video: 0, audio: 0, doc: 0, other: 0 };
        var bigFileCount = 0;
        var BIG_THRESHOLD = that._bigFileThreshold;
        Object.values(map).forEach(function(f) {
            var t = f.type || 'other';
            if (counts[t] !== undefined) counts[t]++;
            else counts.other++;
            if (f.size && f.size > BIG_THRESHOLD) bigFileCount++;
        });
        var statsEl = document.getElementById('cd-assets-type-stats');
        if (!statsEl) return;
        var items = [
            { icon: '\ud83d\uddbc\ufe0f', key: 'image', label: '\u56fe\u7247' },
            { icon: '\ud83c\udfac', key: 'video', label: '\u89c6\u9891' },
            { icon: '\ud83c\udfb5', key: 'audio', label: '\u97f3\u9891' },
            { icon: '\ud83d\udcc4', key: 'doc', label: '\u6587\u6863' },
            { icon: '\ud83d\udce6', key: 'other', label: '\u5176\u4ed6' }
        ];
        var activeFilter = that._assetsFilter || 'all';

        // 如果筛选了具体类型，显示格式标签
        if (activeFilter !== 'all') {
            var activeItem = items.find(function(it) { return it.key === activeFilter; });
            if (activeItem) {
                // 统计该类型下各后缀名分布（基于树中的资源，确保和树视图显示一致）
                var extCounts = {};
                function countExtInTree(node) {
                    if (node.assets) {
                        node.assets.forEach(function(a) {
                            if ((a.type || 'other') === activeFilter) {
                                var ext = a.ext || 'unknown';
                                extCounts[ext] = (extCounts[ext] || 0) + 1;
                            }
                        });
                    }
                    if (node.children) {
                        node.children.forEach(countExtInTree);
                    }
                }
                if (that._assetsTree) {
                    that._assetsTree.forEach(countExtInTree);
                }
                // 按数量从大到小排序，全部显示（超出宽度可横向滑动）
                var extList = Object.keys(extCounts).map(function(e) { return { ext: e, count: extCounts[e] }; });
                extList.sort(function(a, b) { return b.count - a.count; });
                var activeExt = that._assetsExtFilter;
                var extHtml = extList.map(function(e) {
                    var isActiveExt = activeExt === e.ext;
                    var bg = isActiveExt ? 'var(--b3-theme-primary,#4285f4)' : 'transparent';
                    var fg = isActiveExt ? '#fff' : 'var(--b3-theme-on-background,#333)';
                    var border = isActiveExt ? 'var(--b3-theme-primary,#4285f4)' : 'var(--b3-border,#ddd)';
                    return '<span class="cd-type-stat-btn cd-ext-stat-btn" data-ext="' + that.escapeHtml(e.ext) + '" style="display:inline-flex;align-items:center;gap:2px;cursor:pointer;padding:0 4px;border-radius:8px;border:1px solid ' + border + ';background:' + bg + ';color:' + fg + ';transition:all 0.15s;user-select:none;font-size:11px;vertical-align:middle">' +
                        '<span style="font-weight:500">' + that.escapeHtml(e.ext.toUpperCase()) + '</span>' +
                        '<span style="opacity:0.7">' + e.count + '</span>' +
                        '</span>';
                }).join('<span style="margin:0 2px;color:var(--b3-border,#ddd);vertical-align:middle;display:inline-block">|</span>');

                statsEl.innerHTML = extHtml;
                return;
            }
        }

        // 全部类型：显示所有类型统计 + 大文件标签
        var isBigActive = that._assetsSizeFilter > 0;
        var bigBg = isBigActive ? 'var(--b3-theme-primary,#4285f4)' : 'transparent';
        var bigFg = isBigActive ? '#fff' : 'var(--b3-theme-on-background,#333)';
        var bigBorder = isBigActive ? 'var(--b3-theme-primary,#4285f4)' : 'var(--b3-border,#ddd)';
        var bigHtml = '<span class="cd-type-stat-btn cd-bigfile-stat-btn" data-big="1" style="display:inline-flex;align-items:center;gap:2px;cursor:pointer;padding:0 4px;border-radius:8px;border:1px solid ' + bigBorder + ';background:' + bigBg + ';color:' + bigFg + ';transition:all 0.15s;user-select:none;font-size:11px;vertical-align:middle" title="大于10MB的文件">' +
            '<span style="font-size:12px">🐘</span>' +
            '<span style="font-weight:600">' + bigFileCount + '</span>' +
            '</span>';

        var typeHtml = items.map(function(it) {
            var isActive = activeFilter === it.key;
            var bg = isActive ? 'var(--b3-theme-primary,#4285f4)' : 'transparent';
            var fg = isActive ? '#fff' : 'var(--b3-theme-on-background,#333)';
            var border = isActive ? 'var(--b3-theme-primary,#4285f4)' : 'var(--b3-border,#ddd)';
            return '<span class="cd-type-stat-btn" data-type="' + it.key + '" style="display:inline-flex;align-items:center;gap:1px;cursor:pointer;padding:0 3px;border-radius:8px;border:1px solid ' + border + ';background:' + bg + ';color:' + fg + ';transition:all 0.15s;user-select:none;vertical-align:middle;font-size:11px" title="' + it.label + '">' +
                '<span style="font-size:12px">' + it.icon + '</span>' +
                '<span style="font-weight:600">' + counts[it.key] + '</span>' +
                '</span>';
        }).join('<span style="margin:0 2px"></span>');

        statsEl.innerHTML = typeHtml + '<span style="margin:0 2px;color:var(--b3-border,#ddd);vertical-align:middle;display:inline-block">|</span>' + bigHtml;

        // 按需绑定滚轮横向滚动事件
        if (!statsEl._wheelBound) {
            statsEl._wheelBound = true;
            statsEl.addEventListener('wheel', function(e) {
                if (Math.abs(e.deltaY) > 0) {
                    e.preventDefault();
                    this.scrollLeft += e.deltaY;
                }
            }, { passive: false });
        }
    }

    /**
     * 用 fs.statSync 补充文件列表的大小（桌面版）
     */
    _enrichFileSizes(files) {
        if (!files || !files.length) return;
        if (!fs || !fs.statSync) return;
        try {
            var dataDir = '';
            try {
                if (window.siyuan && window.siyuan.config && window.siyuan.config.system && window.siyuan.config.system.dataDir) {
                    dataDir = window.siyuan.config.system.dataDir;
                }
            } catch (e) {}
            if (!dataDir) return;
            var assetsDir = dataDir.replace(/\\/g, '/').replace(/\/+$/, '') + '/assets/';
            files.forEach(function(f) {
                try {
                    var st = fs.statSync(assetsDir + f.name);
                    if (st && st.size) f.size = st.size;
                } catch (e) {}
            });
        } catch (e) {}
    }

    /**
     * 获取资源类型
     */
    _getAssetType(ext) {
        var imageExts = ['jpg','jpeg','png','gif','svg','webp','bmp','ico','tiff'];
        var videoExts = ['mp4','avi','mkv','mov','wmv','flv','webm','m4v','mpg','mpeg'];
        var audioExts = ['mp3','wav','flac','ogg','aac','m4a','wma','ape'];
        var docExts = ['pdf','doc','docx','xls','xlsx','ppt','pptx','txt','md','csv','json','xml','html','zip','rar','7z','tar','gz','epub','mobi','azw3','azw','djvu','rtf'];
        if (imageExts.indexOf(ext) >= 0) return 'image';
        if (videoExts.indexOf(ext) >= 0) return 'video';
        if (audioExts.indexOf(ext) >= 0) return 'audio';
        if (docExts.indexOf(ext) >= 0) return 'doc';
        return 'other';
    }

    /**
     * 格式化文件大小
     */
    _formatSize(bytes) {
        if (bytes === 0) return '0 B';
        var units = ['B','KB','MB','GB','TB'];
        var i = Math.floor(Math.log(bytes) / Math.log(1024));
        i = Math.min(i, units.length - 1);
        return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 2) + ' ' + units[i];
    }

    /**
     * 格式化时间
     */
    _formatTime(ts) {
        if (!ts) return '';
        var d = new Date(ts);
        if (isNaN(d.getTime())) return '';
        return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0') + ' ' +
               String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
    }

    /**
     * 对平铺 assets 数据排序（降级显示用）
     */
    _sortAssetsData() {
        var that = this;
        if (!that._assetsData) return;
        var sortBy = that._assetsSortBy || 'time';
        var order = that._assetsSortOrder || 'desc';
        var mult = order === 'asc' ? 1 : -1;
        that._assetsData.sort(function(a, b) {
            var cmp = 0;
            if (sortBy === 'name') {
                cmp = a.name.localeCompare(b.name);
            } else if (sortBy === 'size') {
                cmp = (a.size || 0) - (b.size || 0);
            } else if (sortBy === 'time') {
                cmp = (a.updated || 0) - (b.updated || 0);
            }
            return cmp * mult;
        });
    }

    /**
     * 渲染平铺资源列表（降级显示用，当文档树构建失败时）
     */
    _renderAssetsFlatList() {
        var that = this;
        var listEl = document.getElementById('cd-assets-list');
        if (!listEl || !that._assetsData) return;

        var filtered = that._assetsData.filter(function(f) {
            if (that._assetsFilter && that._assetsFilter !== 'all' && f.type !== that._assetsFilter) return false;
            if (that._assetsExtFilter && f.ext !== that._assetsExtFilter) return false;
            if (that._assetsSizeFilter > 0 && (!f.size || f.size <= that._assetsSizeFilter)) return false;
            if (that._assetsSearch) {
                var q = that._assetsSearch.toLowerCase();
                return f.name.toLowerCase().indexOf(q) >= 0;
            }
            return true;
        });

        if (filtered.length === 0) {
            listEl.innerHTML += '<div style="padding:40px 20px;text-align:center;color:var(--b3-theme-secondary,#999)">没有找到匹配的资源</div>';
            return;
        }

        var html = '<div style="display:flex;flex-direction:column">';
        filtered.forEach(function(f) {
            var thumbHtml;
            if (f.type === 'image') {
                thumbHtml = '<img src="/assets/' + encodeURIComponent(f.name) + '" style="width:40px;height:40px;object-fit:cover;border-radius:3px;display:block;flex-shrink:0" loading="lazy" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'inline\'">' +
                    '<span style="font-size:18px;margin-right:10px;flex-shrink:0;width:24px;text-align:center;display:none">🖼️</span>';
            } else {
                var icon = that._getAssetIcon(f.type, f.ext);
                thumbHtml = '<span style="font-size:18px;margin-right:10px;flex-shrink:0;width:24px;text-align:center">' + icon + '</span>';
            }
            html += '<div class="cd-asset-item" data-name="' + that.escapeHtml(f.name) + '" data-type="' + f.type + '" style="display:flex;align-items:center;padding:6px 12px;border-bottom:1px solid var(--b3-border,#eee);cursor:pointer;transition:background 0.15s;user-select:none" onmouseenter="this.style.background=\'var(--b3-theme-hover,#e3f2fd)\'" onmouseleave="this.style.background=\'\'">' +
                thumbHtml +
                '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;color:var(--b3-theme-on-background,#333);margin-left:8px" title="' + that.escapeHtml(f.name) + '">' + that.escapeHtml(f.name) + '</span>' +
                '<span style="font-size:11px;color:var(--b3-theme-secondary,#999);margin-right:12px;flex-shrink:0;min-width:60px;text-align:right">' + that._formatSize(f.size) + '</span>' +
                '<span style="font-size:11px;color:var(--b3-theme-secondary,#999);margin-right:12px;flex-shrink:0;min-width:80px;text-align:right">' + that._formatTime(f.updated) + '</span>' +
                '</div>';
        });
        html += '</div>';
        listEl.innerHTML += html;

        // 绑定点击事件
        var items = listEl.querySelectorAll('.cd-asset-item');
        items.forEach(function(item) {
            item.addEventListener('click', function(e) {
                var name = this.getAttribute('data-name');
                that._onAssetClick(name, e);
            });
            item.addEventListener('dblclick', function(e) {
                var name = this.getAttribute('data-name');
                that._onAssetDblClick(name);
            });
            item.addEventListener('contextmenu', function(e) {
                e.preventDefault();
                var name = this.getAttribute('data-name');
                that._showAssetContextMenu(name, e);
            });
        });
    }

    /**
     * 对文档资源树排序
     */
    _sortAssetsTree() {
        var that = this;
        if (!that._assetsTree) return;
        var sortBy = that._assetsSortBy || 'time';
        var order = that._assetsSortOrder || 'desc';
        var mult = order === 'asc' ? 1 : -1;

        function sortDocs(docs) {
            docs.sort(function(a, b) {
                var cmp = 0;
                if (sortBy === 'name') {
                    cmp = a.name.localeCompare(b.name);
                } else if (sortBy === 'size') {
                    var sa = a.assets.reduce(function(s, f) { return s + (f.size || 0); }, 0);
                    var sb = b.assets.reduce(function(s, f) { return s + (f.size || 0); }, 0);
                    cmp = sa - sb;
                } else if (sortBy === 'time') {
                    var ta = a.assets.length > 0 ? Math.max.apply(null, a.assets.map(function(f) { return f.updated || 0; })) : 0;
                    var tb = b.assets.length > 0 ? Math.max.apply(null, b.assets.map(function(f) { return f.updated || 0; })) : 0;
                    cmp = ta - tb;
                }
                return cmp * mult;
            });
            docs.forEach(function(d) {
                if (d.children && d.children.length > 0) sortDocs(d.children);
            });
        }

        // 排序文档（笔记本固定按名称）
        that._assetsTree.forEach(function(nb) {
            if (nb.children && nb.children.length > 0) sortDocs(nb.children);
        });
    }

    /**
     * 获取当前导航位置的节点
     */
    _getCurrentAssetsNode() {
        var that = this;
        if (!that._assetsTree || that._assetsNavStack.length === 0) return null;
        var last = that._assetsNavStack[that._assetsNavStack.length - 1];
        return last.node || null;
    }

    /**
     * 更新本地文件面包屑小房子状态（展开/折叠后动态调用）
     */
    _updateBreadcrumbHomeState() {
        var homeEl = document.getElementById('cd-breadcrumb-home');
        if (!homeEl) return;
        var hasExpanded = this._expandedDirs && this._expandedDirs.size > 0;
        var breadcrumbEl = document.getElementById('cd-breadcrumb');
        // 判断当前是否在物理根目录
        var isRootDir = false;
        if (breadcrumbEl) {
            // 没有子路径分隔符 → 在根目录
            var pathSpans = breadcrumbEl.querySelectorAll('span[style*="font-weight"]');
            isRootDir = pathSpans.length === 0;
        }
        if (hasExpanded || !isRootDir) {
            homeEl.style.color = 'var(--b3-theme-primary,#4285f4)';
            homeEl.style.cursor = 'pointer';
            homeEl.style.textDecoration = 'underline';
        } else {
            homeEl.style.color = 'var(--b3-theme-secondary,#999)';
            homeEl.style.cursor = 'default';
            homeEl.style.textDecoration = '';
        }
    }

    /**
     * 更新内部资源面包屑
     */
    _updateAssetsBreadcrumb() {
        var that = this;
        var el = document.getElementById('cd-assets-breadcrumb');
        if (!el) return;
        el.innerHTML = '';
        el.style.cursor = 'default';

        // 根项（小房子）
        var hasNav = that._assetsNavStack.length > 0;
        var hasExpanded = that._assetsExpanded && that._assetsExpanded.size > 0;
        var isRoot = !hasNav && !hasExpanded;
        var homeIcon = '<svg viewBox="0 0 24 24" style="width:14px;height:14px;display:inline-block;vertical-align:middle;fill:currentColor"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>';
        var rootSpan = document.createElement('span');
        rootSpan.innerHTML = homeIcon;
        rootSpan.style.display = 'inline-block';
        if (isRoot) {
            // 全部折叠：灰色，不响应点击
            rootSpan.style.color = 'var(--b3-theme-secondary,#999)';
            rootSpan.style.cursor = 'default';
        } else {
            // 有展开：亮起，点击折叠一层
            rootSpan.style.color = 'var(--b3-theme-primary,#4285f4)';
            rootSpan.style.cursor = 'pointer';
            rootSpan.style.textDecoration = 'underline';
            rootSpan.addEventListener('click', function(e) {
                e.stopPropagation();
                if (that._assetsNavStack.length > 0) {
                    that._assetsNavStack.pop();
                } else if (that._assetsExpanded && that._assetsExpanded.size > 0) {
                    var expandedArr = Array.from(that._assetsExpanded);
                    that._assetsExpanded.delete(expandedArr[expandedArr.length - 1]);
                }
                that._renderAssetsTree();
            });
        }
        el.appendChild(rootSpan);

        that._assetsNavStack.forEach(function(item, idx) {
            var sep = document.createElement('span');
            sep.innerHTML = '<svg viewBox="0 0 24 24" style="width:12px;height:12px;display:inline-block;fill:currentColor;vertical-align:middle"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z"/></svg>';
            sep.style.display = 'inline-block';
            sep.style.margin = '0 5px';
            sep.style.color = 'var(--b3-theme-primary,#4285f4)';
            el.appendChild(sep);

            var isLast = (idx === that._assetsNavStack.length - 1);
            var span = document.createElement('span');
            span.textContent = item.name;
            span.style.display = 'inline-block';
            if (isLast) {
                span.style.fontWeight = 'bold';
                span.style.color = 'var(--b3-theme-on-background,#333)';
            } else {
                span.style.cursor = 'pointer';
                span.style.color = 'var(--b3-theme-primary,#4285f4)';
                span.style.textDecoration = 'underline';
                span.style.marginRight = '2px';
                (function(targetIdx) {
                    span.addEventListener('click', function(e) {
                        e.stopPropagation();
                        that._assetsNavStack = that._assetsNavStack.slice(0, targetIdx + 1);
                        that._renderAssetsTree();
                    });
                })(idx);
            }
            el.appendChild(span);
        });
    }

    /**
     * 进入内部资源目录（笔记本或文档）
     */
    _enterAssetsDir(type, id, name, node) {
        var that = this;
        that._assetsNavStack.push({ type: type, id: id, name: name, node: node });
        that._renderAssetsTree();
    }

    /**
     * 返回内部资源上级目录
     */
    _goBackAssets() {
        var that = this;
        if (that._assetsNavStack.length > 0) {
            that._assetsNavStack.pop();
            that._renderAssetsTree();
        }
    }

    /**
     * 渲染文档资源树（路径导航模式）
     */
    _renderAssetsTree() {
        var that = this;
        // 防递归守卫：连续重置导航栈后最多递归 3 次
        if (!that._renderTreeDepth) that._renderTreeDepth = 0;
        that._renderTreeDepth++;
        var isRecursive = that._renderTreeDepth > 1;
        var listEl = document.getElementById('cd-assets-list');
        if (!listEl || !that._assetsTree) return;

        var hasFilter = (that._assetsFilter && that._assetsFilter !== 'all') || that._assetsExtFilter || that._assetsSizeFilter > 0;
        var hasSearch = that._assetsSearch && that._assetsSearch.trim();

        var totalAssets = 0;
        var totalSize = 0;

        var html = '<div style="display:flex;flex-direction:column;font-size:13px">';

        // 统一的列表项样式（与本地文件列表 renderListBatch 一致）
        var itemBaseStyle = 'display:flex;align-items:center;padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--b3-border,#eee);transition:background 0.15s;font-size:13px;user-select:none';
        var arrowWrapStyle = 'width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;margin-right:2px;cursor:pointer;vertical-align:middle';
        var iconBaseStyle = 'font-size:16px;margin-right:6px;flex-shrink:0';
        var nameBaseStyle = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;color:var(--b3-theme-on-background,#333)';
        var metaBaseStyle = 'font-size:11px;color:var(--b3-theme-secondary,#999);margin-left:8px;flex-shrink:0;white-space:nowrap';
        var timeStyle = 'font-size:11px;color:#999;margin-left:8px;flex-shrink:0;white-space:nowrap';

        // 与本地文件列表一致的 SVG 箭头
        function svgArrow(rotated) {
            return '<svg viewBox="0 0 32 32" style="width:10px;height:10px;color:var(--b3-theme-on-surface,#666);transition:transform 0.15s;fill:currentColor;pointer-events:none' + (rotated ? ';transform:rotate(90deg)' : '') + '"><path d="M21.964 16.874l-10.453 10.453c-0.737 0.737-1.942 0.737-2.678 0s-0.737-1.942 0-2.678l9.114-9.114-9.114-9.114c-0.737-0.737-0.737-1.942 0-2.678s1.942-0.737 2.678 0l10.453 10.453c0.369 0.369 0.553 0.861 0.553 1.339s-0.184 0.97-0.553 1.339z"></path></svg>';
        }
        var emptyArrow = '<span style="width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;margin-right:2px;vertical-align:middle"></span>';

        // 辅助函数：过滤文档的资源
        function filterAssets(nodeAssets) {
            var va = nodeAssets.slice();
            if (that._assetsFilter && that._assetsFilter !== 'all') {
                va = va.filter(function(a) { return a.type === that._assetsFilter; });
            }
            if (that._assetsExtFilter) {
                va = va.filter(function(a) { return a.ext === that._assetsExtFilter; });
            }
            if (that._assetsSizeFilter > 0) {
                va = va.filter(function(a) { return a.size && a.size > that._assetsSizeFilter; });
            }
            if (hasSearch) {
                var q = that._assetsSearch.toLowerCase();
                va = va.filter(function(a) { return a.name.toLowerCase().indexOf(q) >= 0; });
            }
            return va;
        }

        // 辅助函数：检查节点（含后代）是否有可见资源
        function nodeHasVisibleAssets(n) {
            var va = filterAssets(n.assets || []);
            if (va.length > 0) return true;
            if (!n.children || n.children.length === 0) return false;
            return n.children.some(nodeHasVisibleAssets);
        }

        // 辅助函数：计算节点（含后代）的可见资源总数
        function countVisibleAssets(n) {
            var count = filterAssets(n.assets || []).length;
            if (n.children) {
                n.children.forEach(function(c) { count += countVisibleAssets(c); });
            }
            return count;
        }

        // 渲染资源项
        function renderAssetItem(asset, indent) {
            totalAssets++;
            if (asset.size) totalSize += asset.size;
            var icon = that._getAssetIcon(asset.type, asset.ext);
            return '<div class="cd-asset-file cd-asset-item" data-name="' + that.escapeHtml(asset.name) + '" data-type="' + asset.type + '" style="' + itemBaseStyle + ';padding-left:' + indent + 'px" onmouseenter="this.style.background=\'var(--b3-theme-hover,#e3f2fd)\'" onmouseleave="this.style.background=\'\'">' +
                '<span style="width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;margin-right:2px"></span>' +
                '<span style="' + iconBaseStyle + '">' + icon + '</span>' +
                '<span style="' + nameBaseStyle + ';margin-left:0" title="' + that.escapeHtml(asset.name) + '">' + that.escapeHtml(asset.name) + '</span>' +
                '<span style="' + metaBaseStyle + ';min-width:50px;text-align:right">' + that._formatSize(asset.size) + '</span>' +
                '<span style="' + timeStyle + '">' + that._formatTime(asset.updated) + '</span>' +
                '</div>';
        }

        // 渲染文档项（作为文件夹）
        function renderDocItem(node, indent, isExpandable) {
            var visibleAssets = filterAssets(node.assets || []);
            var hasVisibleChildren = node.children && node.children.length > 0 ? node.children.some(nodeHasVisibleAssets) : false;
            if (visibleAssets.length === 0 && !hasVisibleChildren && (hasFilter || hasSearch)) return '';

            var isExpanded = that._assetsExpanded.has('doc:' + node.id);
            var hasChildren = node.children && node.children.length > 0;
            var arrow = (isExpandable && (hasChildren || visibleAssets.length > 0))
                ? '<span class="cd-asset-doc-arrow" data-doc="' + that.escapeHtml(node.id) + '" style="' + arrowWrapStyle + '">' + svgArrow(isExpanded) + '</span>'
                : emptyArrow;

            var timeStr = node.updated ? that._formatTime(node.updated) : '';

            var html = '<div class="cd-asset-doc cd-asset-item" data-doc="' + that.escapeHtml(node.id) + '" data-expandable="' + (isExpandable ? '1' : '0') + '" style="' + itemBaseStyle + ';padding-left:' + indent + 'px" onmouseenter="this.style.background=\'var(--b3-theme-hover,#e3f2fd)\'" onmouseleave="this.style.background=\'\'">' +
                arrow +
                '<span style="' + iconBaseStyle + '">📁</span>' +
                '<span style="' + nameBaseStyle + '">' + that.escapeHtml(node.name) + ' <span style="color:var(--b3-theme-secondary,#999);font-weight:400">(' + visibleAssets.length + ')</span></span>' +
                (timeStr ? '<span style="' + timeStyle + '">' + timeStr + '</span>' : '') +
                '</div>';

            // 如果展开，在当前层级渲染资源和子文档
            if (isExpanded && isExpandable) {
                var childIndent = indent + 22;
                visibleAssets.forEach(function(asset) {
                    html += renderAssetItem(asset, childIndent);
                });
                if (node.children) {
                    node.children.forEach(function(child) {
                        html += renderDocItem(child, childIndent, true);
                    });
                }
            }
            return html;
        }

        var navDepth = that._assetsNavStack.length;

        if (navDepth === 0) {
            // === 根级：显示笔记本列表 ===
            if (that._assetsCurrentView === 'icon') {
                // 图标视图：笔记本平铺网格
                html += '</div><div style="display:flex;flex-wrap:wrap;align-content:flex-start;padding:8px;gap:4px;overflow-y:auto">';
                that._assetsTree.forEach(function(nb) {
                    if ((hasFilter || hasSearch) && !nodeHasVisibleAssets(nb)) return;
                    var displayCount = (hasFilter || hasSearch) ? countVisibleAssets(nb) : nb.assetCount;
                    html += '<div class="cd-asset-icon-item cd-asset-icon-notebook" data-nb="' + that.escapeHtml(nb.id) + '" style="display:flex;flex-direction:column;align-items:center;justify-content:flex-start;padding:6px 4px;cursor:pointer;border-radius:4px;transition:background 0.15s;height:110px;width:80px;box-sizing:border-box;overflow:hidden">' +
                        '<div style="width:56px;height:56px;display:flex;align-items:center;justify-content:center;margin-bottom:4px;flex-shrink:0"><span style="font-size:36px;line-height:1;display:block">📁</span></div>' +
                        '<span style="font-size:11px;text-align:center;word-break:break-all;line-height:1.2;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;width:100%;flex-shrink:0">' + that.escapeHtml(nb.name) + '</span>' +
                        '<span style="font-size:10px;color:var(--b3-theme-secondary,#999)">(' + displayCount + ')</span>' +
                        '</div>';
                });
                html += '</div><div style="display:none">'; // 闭合外部容器（占位）
            } else {
                // 列表视图（默认）
                that._assetsTree.forEach(function(nb) {
                    if ((hasFilter || hasSearch) && !nodeHasVisibleAssets(nb)) return;
                    var isExpanded = that._assetsExpanded.has('nb:' + nb.id);
                    var hasChildren = nb.children && nb.children.length > 0;
                    var arrow = hasChildren ? '<span class="cd-asset-arrow" data-nb="' + that.escapeHtml(nb.id) + '" style="' + arrowWrapStyle + '">' + svgArrow(isExpanded) + '</span>' : emptyArrow;
                    var displayCount = (hasFilter || hasSearch) ? countVisibleAssets(nb) : nb.assetCount;
                    var nbTimeStr = nb.updated ? that._formatTime(nb.updated) : '';
                    html += '<div class="cd-asset-notebook cd-asset-item" data-nb="' + that.escapeHtml(nb.id) + '" data-expandable="' + (hasChildren ? '1' : '0') + '" style="' + itemBaseStyle + ';font-weight:600" onmouseenter="this.style.background=\'var(--b3-theme-hover,#e3f2fd)\'" onmouseleave="this.style.background=\'\'">' +
                        arrow +
                        '<span style="' + iconBaseStyle + '">📁</span>' +
                        '<span style="' + nameBaseStyle + '">' + that.escapeHtml(nb.name) + ' <span style="color:var(--b3-theme-secondary,#999);font-weight:400">(' + displayCount + ')</span></span>' +
                        (nbTimeStr ? '<span style="' + timeStyle + '">' + nbTimeStr + '</span>' : '') +
                        '</div>';
                    if (isExpanded && hasChildren) {
                        nb.children.forEach(function(child) {
                            html += renderDocItem(child, 12 + 22, true);
                        });
                    }
                });
            }
        } else {
            // === 笔记本级或文档级：显示当前节点下的内容 ===
            var currentNode = that._getCurrentAssetsNode();
            if (!currentNode) {
                // 节点丢失，回退到根级
                that._assetsNavStack = [];
                if (that._renderTreeDepth <= 3) {
                    that._renderAssetsTree();
                }
                return;
            }

            var children = currentNode.children || [];

            if (that._assetsCurrentView === 'icon') {
                // === 图标视图：平铺网格 ===
                html += '</div><div style="display:flex;flex-wrap:wrap;align-content:flex-start;padding:8px;gap:4px;overflow-y:auto">';

                // 子文档渲染为文件夹图标
                children.forEach(function(child) {
                    var visibleAssets = filterAssets(child.assets || []);
                    var hasVisibleChildren = child.children && child.children.length > 0 ? child.children.some(nodeHasVisibleAssets) : false;
                    if (visibleAssets.length === 0 && !hasVisibleChildren && (hasFilter || hasSearch)) return;
                    html += '<div class="cd-asset-icon-item cd-asset-icon-dir" data-doc="' + that.escapeHtml(child.id) + '" style="display:flex;flex-direction:column;align-items:center;justify-content:flex-start;padding:6px 4px;cursor:pointer;border-radius:4px;transition:background 0.15s;height:110px;width:80px;box-sizing:border-box;overflow:hidden">' +
                        '<div style="width:56px;height:56px;display:flex;align-items:center;justify-content:center;margin-bottom:4px;flex-shrink:0"><span style="font-size:36px;line-height:1;display:block">📁</span></div>' +
                        '<span style="font-size:11px;text-align:center;word-break:break-all;line-height:1.2;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;width:100%;flex-shrink:0">' + that.escapeHtml(child.name) + '</span>' +
                        '</div>';
                });

                // 资源文件渲染为图标
                var currentAssets = filterAssets(currentNode.assets || []);
                currentAssets.forEach(function(asset) {
                    totalAssets++;
                    if (asset.size) totalSize += asset.size;
                    var iconHtml;
                    if (asset.type === 'image') {
                        iconHtml = '<div class="cd-thumb-wrap" style="width:56px;height:56px;border-radius:4px;background:var(--b3-theme-surface,#f0f0f0);overflow:hidden;position:relative;flex-shrink:0;display:flex;align-items:center;justify-content:center">' +
                            '<img src="/assets/' + encodeURIComponent(asset.name) + '" style="width:100%;height:100%;object-fit:cover;display:block" loading="lazy" onerror="this.style.display=\'none\';this.parentElement.querySelector(\'.cd-thumb-placeholder\').style.display=\'inline\'">' +
                            '<span class="cd-thumb-placeholder" style="font-size:20px;color:var(--b3-theme-secondary,#999);display:none">🖼️</span>' +
                            '</div>';
                    } else {
                        var icon = that._getAssetIcon(asset.type, asset.ext);
                        iconHtml = '<span style="font-size:36px;line-height:1;display:block">' + icon + '</span>';
                    }
                    html += '<div class="cd-asset-icon-item cd-asset-icon-file" data-name="' + that.escapeHtml(asset.name) + '" data-type="' + asset.type + '" style="display:flex;flex-direction:column;align-items:center;justify-content:flex-start;padding:6px 4px;cursor:pointer;border-radius:4px;transition:background 0.15s;height:110px;width:80px;box-sizing:border-box;overflow:hidden">' +
                        '<div style="width:56px;height:56px;display:flex;align-items:center;justify-content:center;margin-bottom:4px;flex-shrink:0">' + iconHtml + '</div>' +
                        '<span style="font-size:11px;text-align:center;word-break:break-all;line-height:1.2;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;width:100%;flex-shrink:0">' + that.escapeHtml(asset.name) + '</span>' +
                        '</div>';
                });

                html += '</div><div style="display:none">'; // 闭合外部容器（占位）
            } else {
                // === 列表视图（默认）===
                // 先渲染子文档（作为文件夹项）
                children.forEach(function(child) {
                    html += renderDocItem(child, 12, true);
                });

                // 再渲染当前节点的资源
                var currentAssets = filterAssets(currentNode.assets || []);
                currentAssets.forEach(function(asset) {
                    html += renderAssetItem(asset, 12);
                });
            }
        }

        // 空状态检测：兼容列表视图和图标视图
        var isEmpty = false;
        if (that._assetsCurrentView === 'icon') {
            // 图标视图：检查是否有任何图标项被渲染
            isEmpty = html.indexOf('cd-asset-icon-') === -1;
        } else {
            isEmpty = html === '<div style="display:flex;flex-direction:column;font-size:13px">';
        }
        if (isEmpty) {
            if ((hasFilter || hasSearch) && navDepth > 0) {
                // 当前位置没有匹配资源，自动回到根级查看全部
                that._assetsNavStack = [];
                if (that._renderTreeDepth <= 3) {
                    that._renderAssetsTree();
                }
                return;
            }
            html += '<div style="padding:40px 20px;text-align:center;color:var(--b3-theme-secondary,#999)">没有找到资源</div>';
        }

        html += '</div>';
        listEl.innerHTML = html;

        // 更新面包屑
        that._updateAssetsBreadcrumb();

        // 更新底部状态栏
        var statsText = document.getElementById('cd-assets-stats-text');
        if (statsText) {
            var nbCount = that._assetsTree.length;
            var baseHtml = '';
            if (that._assetsTotalFiles) {
                baseHtml = '共 <b>' + that._assetsTotalFiles + '</b> 个文件，<b>' + nbCount + '</b> 个笔记本，占用 <b>' + that._formatSize(that._assetsTotalSize || 0) + '</b>';
            }
            if (hasFilter || hasSearch) {
                baseHtml += ' · 当前显示 ' + totalAssets + ' 个资源';
            }
            if (navDepth > 0) {
                baseHtml += ' · 当前位置: ' + that._assetsNavStack.map(function(s) { return s.name; }).join(' > ');
            }
            statsText.innerHTML = baseHtml || '📊 ' + nbCount + ' 个笔记本 · ' + totalAssets + ' 个资源 · 共 ' + that._formatSize(totalSize);
        }

        // 绑定笔记本项：箭头展开/折叠（零延迟），名称进入
        listEl.querySelectorAll('.cd-asset-notebook').forEach(function(el) {
            var nbId = el.getAttribute('data-nb');
            var expandable = el.getAttribute('data-expandable') === '1';

            el.addEventListener('click', function(e) {
                e.stopPropagation();
                if (!expandable) return;
                // 判断点击的是箭头还是名称区域
                var arrowEl = e.target.closest ? e.target.closest('.cd-asset-arrow') : null;
                if (!arrowEl && e.target.parentElement && e.target.parentElement.classList && e.target.parentElement.classList.contains('cd-asset-arrow')) {
                    arrowEl = e.target.parentElement;
                }
                if (arrowEl) {
                    // 点击箭头 → 展开/折叠（零延迟）
                    that._toggleAssetsNode('nb:' + nbId, nbId);
                } else {
                    // 点击名称区域 → 进入笔记本
                    var nb = that._assetsTree.find(function(n) { return n.id === nbId; });
                    if (nb) {
                        that._enterAssetsDir('notebook', nb.id, nb.name, nb);
                    }
                }
            });

            // 双击：进入笔记本（双击箭头时忽略）
            el.addEventListener('dblclick', function(e) {
                e.preventDefault();
                e.stopPropagation();
                var arrowEl = e.target.closest ? e.target.closest('.cd-asset-arrow') : null;
                if (!arrowEl && e.target.parentElement && e.target.parentElement.classList && e.target.parentElement.classList.contains('cd-asset-arrow')) {
                    arrowEl = e.target.parentElement;
                }
                if (arrowEl) return;
                var nb = that._assetsTree.find(function(n) { return n.id === nbId; });
                if (nb) {
                    that._enterAssetsDir('notebook', nb.id, nb.name, nb);
                }
            });
        });

        // 绑定图标视图中的笔记本项（点击进入）
        listEl.querySelectorAll('.cd-asset-icon-notebook').forEach(function(el) {
            var nbId = el.getAttribute('data-nb');
            el.addEventListener('click', function(e) {
                e.stopPropagation();
                var nb = that._assetsTree.find(function(n) { return n.id === nbId; });
                if (nb) {
                    that._enterAssetsDir('notebook', nb.id, nb.name, nb);
                }
            });
            el.addEventListener('dblclick', function(e) {
                e.preventDefault();
                e.stopPropagation();
                var nb = that._assetsTree.find(function(n) { return n.id === nbId; });
                if (nb) {
                    that._enterAssetsDir('notebook', nb.id, nb.name, nb);
                }
            });
        });

        // 绑定文档项：箭头展开/折叠（零延迟），名称进入
        listEl.querySelectorAll('.cd-asset-doc').forEach(function(el) {
            var docId = el.getAttribute('data-doc');

            el.addEventListener('click', function(e) {
                e.stopPropagation();
                // 判断点击的是箭头还是名称区域
                var arrowEl = e.target.closest ? e.target.closest('.cd-asset-doc-arrow') : null;
                if (!arrowEl && e.target.parentElement && e.target.parentElement.classList && e.target.parentElement.classList.contains('cd-asset-doc-arrow')) {
                    arrowEl = e.target.parentElement;
                }
                if (arrowEl) {
                    // 点击箭头 → 展开/折叠（零延迟）
                    that._toggleAssetsNode('doc:' + docId);
                } else {
                    // 点击名称区域 → 进入文档
                    var node = that._findDocNode(docId);
                    if (node) {
                        that._enterAssetsDir('doc', node.id, node.name, node);
                    }
                }
            });

            // 双击：进入文档（双击箭头时忽略）
            el.addEventListener('dblclick', function(e) {
                e.preventDefault();
                e.stopPropagation();
                var arrowEl = e.target.closest ? e.target.closest('.cd-asset-doc-arrow') : null;
                if (!arrowEl && e.target.parentElement && e.target.parentElement.classList && e.target.parentElement.classList.contains('cd-asset-doc-arrow')) {
                    arrowEl = e.target.parentElement;
                }
                if (arrowEl) return;
                var node = that._findDocNode(docId);
                if (node) {
                    that._enterAssetsDir('doc', node.id, node.name, node);
                }
            });
        });

        // 绑定资源点击（单击延迟250ms，避免双击冲突）
        listEl.querySelectorAll('.cd-asset-file').forEach(function(el) {
            el.addEventListener('click', function(e) {
                e.stopPropagation();
                var name = this.getAttribute('data-name');
                if (that._assetClickTimer) clearTimeout(that._assetClickTimer);
                that._assetClickTimer = setTimeout(function() {
                    that._onAssetClick(name, e);
                }, 250);
            });
            el.addEventListener('dblclick', function(e) {
                e.stopPropagation();
                var name = this.getAttribute('data-name');
                if (that._assetClickTimer) clearTimeout(that._assetClickTimer);
                that._onAssetDblClick(name);
            });
            el.addEventListener('contextmenu', function(e) {
                e.preventDefault();
                e.stopPropagation();
                var name = this.getAttribute('data-name');
                that._showAssetContextMenu(name, e);
            });
        });

        // 绑定图标视图中的子文档文件夹项
        listEl.querySelectorAll('.cd-asset-icon-dir').forEach(function(el) {
            var docId = el.getAttribute('data-doc');
            el.addEventListener('click', function(e) {
                e.stopPropagation();
                var node = that._findDocNode(docId);
                if (node) {
                    that._enterAssetsDir('doc', node.id, node.name, node);
                }
            });
            el.addEventListener('dblclick', function(e) {
                e.preventDefault();
                e.stopPropagation();
                var node = that._findDocNode(docId);
                if (node) {
                    that._enterAssetsDir('doc', node.id, node.name, node);
                }
            });
        });

        // 绑定图标视图中的资源文件项
        listEl.querySelectorAll('.cd-asset-icon-file').forEach(function(el) {
            el.addEventListener('click', function(e) {
                e.stopPropagation();
                var name = this.getAttribute('data-name');
                if (that._assetClickTimer) clearTimeout(that._assetClickTimer);
                that._assetClickTimer = setTimeout(function() {
                    that._onAssetClick(name, e);
                }, 250);
            });
            el.addEventListener('dblclick', function(e) {
                e.stopPropagation();
                var name = this.getAttribute('data-name');
                if (that._assetClickTimer) clearTimeout(that._assetClickTimer);
                that._onAssetDblClick(name);
            });
            el.addEventListener('contextmenu', function(e) {
                e.preventDefault();
                e.stopPropagation();
                var name = this.getAttribute('data-name');
                that._showAssetContextMenu(name, e);
            });
        });

        // 更新排序按钮文字
        that._updateAssetsSortBtn();
        that._syncExpandToggleBtn();

        // 重置递归深度守卫
        that._renderTreeDepth = 0;
    }

    /**
     * 在资源树中查找指定 id 的文档节点
     */
    _findDocNode(docId, nodes) {
        var that = this;
        var searchNodes;
        if (nodes) {
            searchNodes = nodes;
        } else if (that._assetsTree) {
            searchNodes = [];
            that._assetsTree.forEach(function(nb) {
                if (nb.children) {
                    nb.children.forEach(function(c) { searchNodes.push(c); });
                }
            });
        } else {
            searchNodes = [];
        }
        for (var i = 0; i < searchNodes.length; i++) {
            var node = searchNodes[i];
            if (node.id === docId) return node;
            if (node.children && node.children.length > 0) {
                var found = that._findDocNode(docId, node.children);
                if (found) return found;
            }
        }
        return null;
    }

    /**
     * 更新内部资源排序按钮文字
     */
    _updateAssetsSortBtn(btn) {
        var that = this;
        if (!btn) btn = document.getElementById('cd-assets-sort-btn');
        if (!btn) return;
        var sortLabels = { name: '名称', size: '大小', time: '修改时间' };
        var label = sortLabels[that._assetsSortBy || 'time'] || '名称';
        var arrow = (that._assetsSortOrder || 'desc') === 'asc' ? '↑' : '↓';
        btn.textContent = '⇅ ' + label + ' ' + arrow;
    }

    /**
     * 显示内部资源排序菜单
     */
    _showAssetsSortMenu(targetBtn) {
        var that = this;
        var menu = document.getElementById('cd-context-menu');
        if (!menu) return;

        var items = [
            { key: 'name', label: '名称' },
            { key: 'size', label: '大小' },
            { key: 'time', label: '修改时间' }
        ];

        menu.innerHTML = '';
        items.forEach(function(item) {
            var div = document.createElement('div');
            var isActive = that._assetsSortBy === item.key;
            var isAsc = that._assetsSortOrder === 'asc';
            var arrow = isActive ? (isAsc ? ' ↑' : ' ↓') : '';
            div.style.cssText = 'padding:6px 16px;cursor:pointer;font-size:13px;white-space:nowrap;color:' + (isActive ? 'var(--b3-theme-primary,#4285f4)' : 'var(--b3-theme-on-background,#333)');
            div.textContent = item.label + arrow;
            div.addEventListener('mouseenter', function() { this.style.background = 'var(--b3-theme-hover,#e3f2fd)'; });
            div.addEventListener('mouseleave', function() { this.style.background = ''; });
            div.addEventListener('click', function() {
                menu.style.display = 'none';
                if (that._assetsSortBy === item.key) {
                    that._assetsSortOrder = isAsc ? 'desc' : 'asc';
                } else {
                    that._assetsSortBy = item.key;
                    that._assetsSortOrder = 'desc';
                }
                that._sortAssetsTree();
                that._renderAssetsTree();
            });
            menu.appendChild(div);
        });

        var rect = targetBtn.getBoundingClientRect();
        menu.style.display = 'block';
        menu.style.left = rect.left + 'px';
        menu.style.top = (rect.bottom + 2) + 'px';

        var closeMenu = function() {
            menu.style.display = 'none';
            document.removeEventListener('click', closeMenu);
        };
        setTimeout(function() {
            document.addEventListener('click', closeMenu);
        }, 0);
    }

    /**
     * 获取资源图标
     */
    _getAssetIcon(type, ext) {
        if (type === 'doc' && ext) {
            var e = ext.toLowerCase();
            if (e === 'pdf') return '📕';
            if (e === 'xls' || e === 'xlsx') return '📊';
            if (e === 'ppt' || e === 'pptx') return '📊';
            if (e === 'zip' || e === 'rar' || e === '7z' || e === 'tar' || e === 'gz') return '📦';
            if (e === 'epub' || e === 'mobi' || e === 'azw3' || e === 'azw' || e === 'djvu') return '📖';
            if (e === 'txt' || e === 'md' || e === 'csv' || e === 'json' || e === 'xml' || e === 'html' || e === 'rtf') return '📝';
        }
        var map = {
            image: '🖼️', video: '🎬', audio: '🎵', doc: '📄', other: '📦'
        };
        return map[type] || '📦';
    }

    /**
     * 展开/折叠资源树节点（同步 _assetsExpanded 和 node.expanded）
     */
    _toggleAssetsNode(key, nbId) {
        var that = this;
        var isExpanded = that._assetsExpanded.has(key);
        if (isExpanded) {
            that._assetsExpanded.delete(key);
            // 记录用户主动折叠（筛选模式下尊重此选择）
            if (!that._assetsUserCollapsed) that._assetsUserCollapsed = new Set();
            that._assetsUserCollapsed.add(key);
        } else {
            that._assetsExpanded.add(key);
            if (that._assetsUserCollapsed) that._assetsUserCollapsed.delete(key);
        }
        // 同步 node.expanded 属性（笔记本节点）
        if (nbId && that._assetsTree) {
            that._assetsTree.forEach(function(nb) {
                if (nb.id === nbId) {
                    nb.expanded = !isExpanded;
                }
            });
        }
        that._saveAssetsCache();
        that._renderAssetsTree();
        that._syncExpandToggleBtn();
    }

    /**
     * 同步展开/折叠按钮图标与列表实际状态
     */
    _syncExpandToggleBtn() {
        var btn = document.getElementById('cd-assets-expand-toggle');
        if (!btn) return;
        var expanded = this._assetsExpanded;
        var anyExpanded = false;
        if (this._assetsTree) {
            this._assetsTree.forEach(function(nb) {
                if (expanded.has('nb:' + nb.id)) anyExpanded = true;
                if (nb.children) {
                    nb.children.forEach(function(c) {
                        if (expanded.has('doc:' + c.id)) anyExpanded = true;
                    });
                }
            });
        }
        if (anyExpanded) {
            btn.textContent = '⊖';
            btn.title = '折叠全部';
        } else {
            btn.textContent = '⊕';
            btn.title = '展开全部';
        }
    }

    /**
     * 绑定 Assets 面板事件
     */
    _bindAssetsEvents() {
        var that = this;
        if (that._assetsEventsBound) return;
        that._assetsEventsBound = true;

        // 注入类型统计栏滚动条隐藏样式（仅一次）
        if (!document.getElementById('cd-type-stats-scroll-style')) {
            var tsStyle = document.createElement('style');
            tsStyle.id = 'cd-type-stats-scroll-style';
            tsStyle.textContent = '#cd-assets-type-stats::-webkit-scrollbar{display:none}';
            document.head.appendChild(tsStyle);
        }

        // 类型过滤（下拉框）
        var filterSelect = document.getElementById('cd-assets-filter');
        if (filterSelect) {
            filterSelect.addEventListener('change', function() {
                that._assetsFilter = this.value;
                // 切换类型时清除扩展名和大文件筛选，避免"全部类型"时仍被之前的扩展名过滤
                that._assetsExtFilter = null;
                that._assetsSizeFilter = 0;
                that._updateAssetsFilterOptions();
                that._renderAssetsTree();
            });
        }

        // 类型统计图标点击筛选
        var typeStatsEl = document.getElementById('cd-assets-type-stats');
        if (typeStatsEl) {
            typeStatsEl.addEventListener('click', function(e) {
                var btn = e.target.closest('.cd-type-stat-btn');
                if (!btn) return;

                // 点击格式标签
                var ext = btn.getAttribute('data-ext');
                if (ext) {
                    if (that._assetsExtFilter === ext) {
                        that._assetsExtFilter = null;
                    } else {
                        that._assetsExtFilter = ext;
                    }
                    that._updateAssetsFilterOptions();
                    that._renderAssetsTree();
                    return;
                }

                // 点击大文件标签
                var isBig = btn.getAttribute('data-big');
                if (isBig) {
                    var BIG_THRESHOLD = that._bigFileThreshold;
                    if (that._assetsSizeFilter > 0) {
                        that._assetsSizeFilter = 0;
                    } else {
                        that._assetsSizeFilter = BIG_THRESHOLD;
                    }
                    that._updateAssetsFilterOptions();
                    that._renderAssetsTree();
                    return;
                }

                // 点击类型图标
                var type = btn.getAttribute('data-type');
                if (that._assetsFilter === type) {
                    that._assetsFilter = 'all';
                    that._assetsExtFilter = null;
                } else {
                    that._assetsFilter = type;
                    that._assetsExtFilter = null;
                }
                if (filterSelect) filterSelect.value = that._assetsFilter;
                that._updateAssetsFilterOptions();
                that._renderAssetsTree();
            });
        }

        // 搜索
        var searchInput = document.getElementById('cd-assets-search');
        var searchClear = document.getElementById('cd-assets-search-clear');
        if (searchInput) {
            searchInput.addEventListener('input', function() {
                var q = this.value.trim();
                that._assetsSearch = q;
                if (searchClear) searchClear.style.display = q ? 'block' : 'none';
                that._renderAssetsTree();
            });
        }
        if (searchClear) {
            searchClear.addEventListener('click', function() {
                if (searchInput) {
                    searchInput.value = '';
                    that._assetsSearch = '';
                    searchClear.style.display = 'none';
                    that._renderAssetsTree();
                }
            });
        }

        // 展开/折叠全部按钮
        var expandToggleBtn = document.getElementById('cd-assets-expand-toggle');
        if (expandToggleBtn) {
            expandToggleBtn.addEventListener('click', function() {
                if (!that._assetsTree || that._assetsTree.length === 0) return;
                var expanded = that._assetsExpanded;
                // 收集所有已展开的 doc key
                var expandedDocs = [];
                function collectDocs(node) {
                    if (node.type === 'doc' && expanded.has('doc:' + node.id)) {
                        expandedDocs.push('doc:' + node.id);
                    }
                    if (node.children) node.children.forEach(collectDocs);
                }
                that._assetsTree.forEach(function(nb) {
                    collectDocs(nb);
                    nb.children.forEach(collectDocs);
                });
                // 按深度折叠：先折叠 doc，再折叠 nb，全部折叠后全部展开
                if (expandedDocs.length > 0) {
                    // 折叠所有 doc
                    expandedDocs.forEach(function(k) { expanded.delete(k); });
                } else {
                    // 检查是否有 nb 展开
                    var expandedNbs = that._assetsTree.filter(function(nb) {
                        return expanded.has('nb:' + nb.id);
                    });
                    if (expandedNbs.length > 0) {
                        // 折叠所有 nb
                        that._assetsTree.forEach(function(nb) {
                            expanded.delete('nb:' + nb.id);
                        });
                    } else {
                        // 全部展开（nb + doc）
                        that._assetsTree.forEach(function(nb) {
                            expanded.add('nb:' + nb.id);
                            nb.children.forEach(function(c) {
                                expanded.add('doc:' + c.id);
                            });
                        });
                    }
                }
                that._renderAssetsTree();
            });
        }

        // 视图切换按钮
        var viewToggleBtn = document.getElementById('cd-assets-view-toggle');
        if (viewToggleBtn) {
            viewToggleBtn.textContent = that._assetsCurrentView === 'icon' ? '⊞' : '☰';
            viewToggleBtn.title = that._assetsCurrentView === 'icon' ? '切换为列表视图' : '切换为图标视图';
            viewToggleBtn.addEventListener('click', function() {
                that._assetsCurrentView = (that._assetsCurrentView === 'list') ? 'icon' : 'list';
                this.textContent = that._assetsCurrentView === 'icon' ? '⊞' : '☰';
                this.title = that._assetsCurrentView === 'icon' ? '切换为列表视图' : '切换为图标视图';
                that._renderAssetsTree();
            });
        }

        // 排序按钮
        var sortBtn = document.getElementById('cd-assets-sort-btn');
        if (sortBtn) {
            that._updateAssetsSortBtn(sortBtn);
            sortBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                that._showAssetsSortMenu(this);
            });
        }
    }

    /**
     * 资源单击 - 预览图片
     */
    _onAssetClick(name, e) {
        var that = this;
        var asset = that._assetsFileMap && that._assetsFileMap[name];
        if (!asset) return;

        if (asset.type === 'image') {
            // 预览图片
            var preview = document.getElementById('cd-image-preview');
            var img = document.getElementById('cd-preview-img');
            var nameEl = document.getElementById('cd-preview-name');
            if (preview && img) {
                img.src = '/assets/' + encodeURIComponent(name);
                if (nameEl) nameEl.textContent = name;
                preview.style.display = 'block';
                if (e && e.clientX !== undefined) {
                    preview.style.left = (e.clientX + 20) + 'px';
                    preview.style.top = (e.clientY - 100) + 'px';
                }
                // 3秒后自动隐藏
                setTimeout(function() {
                    preview.style.display = 'none';
                }, 3000);
            }
        } else if (asset.type === 'audio') {
            // 播放内部音频资源
            var dataDir = '';
            try {
                if (window.siyuan && window.siyuan.config && window.siyuan.config.system && window.siyuan.config.system.dataDir) {
                    dataDir = window.siyuan.config.system.dataDir;
                }
            } catch (e) {}
            if (dataDir) {
                var sep = that._sep || (that.isWindows ? '\\' : '/');
                var assetPath = dataDir + sep + 'assets' + sep + name.replace(/\//g, sep);
                that.playAudio(assetPath, name);
            }
        }
    }

    /**
     * 资源双击 - 打开引用文档
     */
    async _onAssetDblClick(name) {
        var that = this;
        try {
            // 优先使用缓存中的 block_id 精确定位
            var blockId = that._assetBlockMap && that._assetBlockMap[name];
            if (blockId) {
                window.open('siyuan://blocks/' + blockId);
                return;
            }

            that.showToastMsg('正在查找引用文档...');

            // 渠道A回退：查 assets 表获取 block_id
            var escapedName = name.replace(/'/g, "''").replace(/\\/g, "\\\\");
            var resp = await fetch('/api/query/sql', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ stmt: "SELECT b.id AS block_id, b.root_id FROM assets AS a JOIN blocks AS b ON a.block_id = b.id WHERE a.name = '" + escapedName + "' OR a.name = 'assets/" + escapedName + "' LIMIT 1" }),
                credentials: 'include'
            });
            var data = await resp.json();
            if (data.code === 0 && data.data && data.data.length > 0) {
                var row = data.data[0];
                if (row.block_id) {
                    window.open('siyuan://blocks/' + row.block_id);
                } else if (row.root_id) {
                    window.open('siyuan://blocks/' + row.root_id);
                }
                return;
            }

            // 渠道B回退：查 blocks 内容包含文件名
            var bn = name.split('/').pop().replace(/'/g, "''").replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
            var resp2 = await fetch('/api/query/sql', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ stmt: "SELECT id, root_id FROM blocks WHERE content LIKE '%" + bn + "%' AND type != 'd' LIMIT 1" }),
                credentials: 'include'
            });
            var data2 = await resp2.json();
            if (data2.code === 0 && data2.data && data2.data.length > 0) {
                var blockRow = data2.data[0];
                if (blockRow.id) {
                    window.open('siyuan://blocks/' + blockRow.id);
                } else if (blockRow.root_id) {
                    window.open('siyuan://blocks/' + blockRow.root_id);
                }
                return;
            }

            that.showToastMsg('该资源未被任何文档引用');
        } catch (e) {
            that._error('_onAssetDblClick error:', e);
        }
    }

    /**
     * 资源右键菜单
     */
    _showAssetContextMenu(name, e) {
        var that = this;
        var menu = document.getElementById('cd-context-menu');
        if (!menu) return;

        var items = [
            { label: '📋 打开文件', action: function() {
                var dataDir = '';
                try {
                    if (window.siyuan && window.siyuan.config && window.siyuan.config.system && window.siyuan.config.system.dataDir) {
                        dataDir = window.siyuan.config.system.dataDir;
                    }
                } catch (e) {}
                if (dataDir) {
                    var asset = that._assetsFileMap && that._assetsFileMap[name];
                    var relName = asset && asset.relPath ? asset.relPath : name;
                    var fullPath;
                    try {
                        var path = require('path');
                        fullPath = path.join(dataDir, 'assets', relName);
                    } catch (e) {
                        var sep = that._sep || '\\';
                        fullPath = dataDir.replace(/[\/\\]+$/, '') + sep + 'assets' + sep + relName;
                    }
                    that._openAssetFile(fullPath);
                } else {
                    that.showToastMsg('无法获取 assets 路径');
                }
            } },
            { label: '📂 打开文件位置', action: function() {
                var dataDir = '';
                try {
                    if (window.siyuan && window.siyuan.config && window.siyuan.config.system && window.siyuan.config.system.dataDir) {
                        dataDir = window.siyuan.config.system.dataDir;
                    }
                } catch (e) {}
                if (dataDir) {
                    var asset = that._assetsFileMap && that._assetsFileMap[name];
                    var relName = asset && asset.relPath ? asset.relPath : name;
                    var fullPath;
                    try {
                        var path = require('path');
                        fullPath = path.join(dataDir, 'assets', relName);
                    } catch (e) {
                        // path 模块不可用时手动拼接
                        var sep = that._sep || '\\';
                        fullPath = dataDir.replace(/[\/\\]+$/, '') + sep + 'assets' + sep + relName;
                    }
                    console.log('[localbrowse] openContainingFolder path:', fullPath);
                    that.openContainingFolder(fullPath);
                } else {
                    that.showToastMsg('无法获取 assets 路径');
                }
            } },
            { label: '📄 打开引用文档', action: function() { that._onAssetDblClick(name); } },
            { label: '🗑️ 删除', action: function() { that._deleteAsset(name); }, danger: true }
        ];

        menu.innerHTML = '';
        items.forEach(function(item) {
            var div = document.createElement('div');
            div.style.cssText = 'padding:6px 16px;cursor:pointer;font-size:13px;white-space:nowrap;color:' + (item.danger ? 'var(--b3-theme-error,#d32f2f)' : 'var(--b3-theme-on-background,#333)');
            div.textContent = item.label;
            div.addEventListener('mouseenter', function() { this.style.background = 'var(--b3-theme-hover,#e3f2fd)'; });
            div.addEventListener('mouseleave', function() { this.style.background = ''; });
            div.addEventListener('click', function() {
                menu.style.display = 'none';
                item.action();
            });
            menu.appendChild(div);
        });

        menu.style.display = 'block';
        menu.style.left = e.clientX + 'px';
        menu.style.top = e.clientY + 'px';

        // 点击外部关闭
        var closeMenu = function() {
            menu.style.display = 'none';
            document.removeEventListener('click', closeMenu);
        };
        setTimeout(function() {
            document.addEventListener('click', closeMenu, { once: true });
        }, 10);
    }

    /**
     * 删除单个资源
     */
    async _deleteAsset(name) {
        var that = this;
        if (!confirm('确定要删除资源 "' + name + '" 吗？\n此操作不可恢复！')) return;

        var assetsPath = that._getAssetsPath();
        if (!assetsPath) {
            that.showToastMsg('无法获取 assets 路径');
            return;
        }

        try {
            var resp = await fetch('/api/file/removeFile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: assetsPath + name }),
                credentials: 'include'
            });
            var data = await resp.json();
            if (data.code === 0) {
                that.showToastMsg('已删除: ' + name);
                // 从文件映射中移除
                if (that._assetsFileMap && that._assetsFileMap[name]) {
                    delete that._assetsFileMap[name];
                }
                // 重新加载树以更新显示
                that._assetsLoaded = false;
                that._loadAssets();
            } else {
                that.showToastMsg('删除失败: ' + (data.msg || '未知错误'));
            }
        } catch (e) {
            that._error('_deleteAsset error:', e);
            that.showToastMsg('删除失败: ' + (e.message || e));
        }
    }

}

module.exports = LocalBrowsePlugin;

// console.log("[LocalBrowse] === LOADED ===");
