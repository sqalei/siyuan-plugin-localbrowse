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
    console.error("[LocalBrowse] Failed to load Node.js modules:", e);
}

class LocalBrowsePlugin extends Plugin {
    constructor(options) {
        super(options);
        this.dockPanel = null;
        this.currentPath = '';
        this.driveLetter = 'C';
        this.workspacePath = '';
        this.assetsPath = '';
        this.cachedFiles = [];      // 当前目录完整文件列表（用于搜索过滤）
        this.cachedPath = '';       // 当前缓存对应的目录路径
        this.isDeepSearchMode = false; // 是否处于深度搜索模式
        this.preSearchPath = '';    // 深度搜索前所在的目录，用于返回
        this.availableDrives = [];  // 可用盘符列表
        this.favorites = [];        // 收藏的文件夹列表 [{path, name}]
        this.currentView = 'list';  // 当前视图模式：list 或 icon
        this.sortBy = 'name';       // 排序方式：name | size | mtime
        this.sortOrder = 'asc';     // 排序顺序：asc | desc
        this.iconRenderState = null; // 图标视图滚动渲染状态
        this._isScrolling = false;   // 是否正在滚动中（滚动时暂停预览）
        this._scrollEndTimer = null; // 滚动结束检测计时器
        // 在构造函数中一次性绑定滚动处理函数，避免每次切换视图时重复创建引用
        this._boundIconScroll = this.onIconScroll.bind(this);
    }

    onload() {
        console.log("[LocalBrowse] onload");
        this.registerIcons();
        this.loadFavorites();
        this.loadSortSettings();
        this.loadDriveSettings();
        this.loadViewSettings();
        this.loadPathSettings();
        this.registerDock();
    }

    onunload() {
        console.log("[LocalBrowse] onunload");
        // 清理右键菜单残留的 document 级监听器
        this.hideContextMenu();
        // 清理滚动监听器
        if (this._boundIconScroll) {
            var fileListEl = document.getElementById('cd-file-list');
            if (fileListEl) {
                fileListEl.removeEventListener('scroll', this._boundIconScroll);
            }
            this._boundIconScroll = null;
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
    }

    uninstall() {
        console.log("[LocalBrowse] uninstall");
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
            console.error("[LocalBrowse] addIcons failed:", e);
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
                    console.log('[LocalBrowse] Dock destroyed');
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
            console.log("[LocalBrowse] Dock registered");
        } catch (e) {
            console.error("[LocalBrowse] addDock failed:", e);
        }
    }

    renderFileTree() {
        if (!this.dockPanel || !this.dockPanel.element) return;
        
        var that = this;
        var el = this.dockPanel.element;
        
        el.innerHTML = '<div class="cd-container" style="height:100%;display:flex;flex-direction:column;padding:4px;box-sizing:border-box;font-size:13px;overflow:hidden">' +
            '<div style="margin-bottom:2px;display:flex;align-items:center;flex-shrink:0;gap:2px">' +
                '<select id="cd-drive-select" style="padding:3px 6px;font-size:12px;border:1px solid var(--b3-border,#ddd);border-radius:4px;background:var(--b3-theme-background,#fff);color:var(--b3-theme-on-background,#333);cursor:pointer;outline:none;min-width:60px"></select>' +
                '<div id="cd-favorites-list" style="flex:1;display:flex;align-items:center;gap:4px;overflow:hidden;min-width:0"></div>' +
                '<button id="cd-view-toggle" style="padding:4px 8px;font-size:11px;background:transparent;color:var(--b3-theme-secondary,#999);border:1px solid var(--b3-border,#ddd);border-radius:4px;cursor:pointer;opacity:0.6;transition:opacity 0.2s;flex-shrink:0" title="切换视图" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.6">☰</button>' +
                '<button id="cd-refresh" style="padding:4px 8px;font-size:11px;background:transparent;color:var(--b3-theme-secondary,#999);border:1px solid var(--b3-border,#ddd);border-radius:4px;cursor:pointer;opacity:0.6;transition:opacity 0.2s;flex-shrink:0" title="刷新" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.6">↻</button>' +
                '<button id="cd-relink-btn" style="padding:4px 8px;font-size:14px;background:transparent;color:var(--b3-theme-secondary,#999);border:1px solid var(--b3-border,#ddd);border-radius:4px;cursor:pointer;opacity:0.6;transition:opacity 0.2s;flex-shrink:0" title="修复失效链接" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.6">🧲</button>' +
            '</div>' +
            '<div id="cd-search-wrap" style="margin-bottom:2px;position:relative;flex-shrink:0;display:none">' +
                '<input id="cd-search" type="text" placeholder="搜索当前目录（按 Enter 深度搜索）..." style="width:100%;padding:6px 56px 6px 10px;box-sizing:border-box;font-size:12px;border:1px solid var(--b3-border,#ddd);border-radius:4px;background:var(--b3-theme-background,#fff);color:var(--b3-theme-on-background,#333);outline:none">' +
                '<button id="cd-deep-search" style="position:absolute;right:24px;top:50%;transform:translateY(-50%);padding:0 4px;font-size:13px;line-height:1;background:transparent;border:none;color:var(--b3-theme-secondary,#999);cursor:pointer;opacity:0.6;transition:opacity 0.2s" title="深度搜索子目录" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.6">🔍</button>' +
                '<button id="cd-clear-search" style="position:absolute;right:6px;top:50%;transform:translateY(-50%);padding:0 4px;font-size:14px;line-height:1;background:transparent;border:none;color:var(--b3-theme-secondary,#999);cursor:pointer;display:none">×</button>' +
            '</div>' +
            '<div style="margin-bottom:2px;display:flex;align-items:center;gap:2px;flex-shrink:0;background:transparent;border:none">' +
                '<div id="cd-breadcrumb" style="flex:1;padding:0 0 0 8px;font-size:12px;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:transparent;border:none"></div>' +
                '<button id="cd-sort-btn" style="padding:4px 8px;font-size:11px;background:transparent;color:var(--b3-theme-secondary,#999);border:1px solid var(--b3-border,#ddd);border-radius:4px;cursor:pointer;opacity:0.6;transition:opacity 0.2s;flex-shrink:0;white-space:nowrap" title="排序" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.6">⇅ 名称</button>' +
            '</div>' +
            '<div id="cd-file-list" style="flex:1;overflow-y:auto;border:1px solid var(--b3-border,#e0e0e0);border-radius:4px;background:var(--b3-theme-background,#fff);min-height:0">' +
                '<div style="padding:20px;text-align:center;color:#999">Loading...</div>' +
            '</div>' +
            '<div id="cd-context-menu" style="display:none;position:fixed;z-index:9999;background:var(--b3-theme-background,#fff);border:1px solid var(--b3-border,#ddd);border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,0.15);min-width:160px;padding:4px 0;font-size:13px;user-select:none">' +
            '</div>' +
            '<div id="cd-image-preview" style="display:none;position:fixed;z-index:9998;background:var(--b3-theme-background,#fff);border:1px solid var(--b3-border,#ddd);border-radius:6px;box-shadow:0 6px 20px rgba(0,0,0,0.18);padding:6px;pointer-events:none">' +
                '<img id="cd-preview-img" src="" style="display:block;max-width:560px;max-height:480px;border-radius:3px">' +
                '<div id="cd-preview-name" style="margin-top:6px;text-align:center;font-size:12px;color:var(--b3-theme-on-background,#333);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:560px"></div>' +
                '<div id="cd-preview-time" style="text-align:center;font-size:11px;color:var(--b3-theme-secondary,#999);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:560px"></div>' +
            '</div>' +
        '</div>';
        
        // 绑定刷新按钮（innerHTML 已同步渲染，无需 setTimeout）
        var refreshBtn = el.querySelector('#cd-refresh');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', function() {
                that.loadDirectory(that.currentPath || that.driveLetter + ':\\');
            });
        }

        // 绑定修复链接按钮
        var relinkBtn = el.querySelector('#cd-relink-btn');
        if (relinkBtn) {
            relinkBtn.addEventListener('click', function() {
                console.log('[LocalBrowse] relink button clicked');
                that.relinkBrokenLinks().catch(function(e) {
                    console.error('[LocalBrowse] relink error:', e);
                    that.showToastMsg('修复链接出错：' + (e.message || e));
                });
            });
        }

        // 绑定视图切换按钮
        var viewToggleBtn = el.querySelector('#cd-view-toggle');
        if (viewToggleBtn) {
            viewToggleBtn.textContent = that.currentView === 'icon' ? '⊞' : '☰';
            viewToggleBtn.addEventListener('click', function() {
                that.currentView = (that.currentView === 'list') ? 'icon' : 'list';
                this.textContent = that.currentView === 'icon' ? '⊞' : '☰';
                this.title = that.currentView === 'icon' ? '切换为列表视图' : '切换为图标视图';
                that.saveViewSettings();
                // 重新渲染当前目录（先排序，cachedFiles 是未排序的原始列表）
                if (that.cachedFiles.length && that.cachedPath) {
                    var sorted = that.sortFiles(that.cachedFiles.slice());
                    that.doRender(sorted, that.cachedPath, '', that.isDeepSearchMode);
                } else {
                    that.loadDirectory(that.currentPath || that.driveLetter + ':\\');
                }
            });
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


        // 检测并绑定盘符下拉框
        that.detectDrives(function(drives) {
            var driveSelect = el.querySelector('#cd-drive-select');
            if (driveSelect) {
                driveSelect.innerHTML = '';
                if (drives.length === 0) {
                    var defaultLetter = that.driveLetter || 'T';
                    var opt = document.createElement('option');
                    opt.value = defaultLetter;
                    opt.textContent = defaultLetter + ':';
                    driveSelect.appendChild(opt);
                } else {
                    for (var i = 0; i < drives.length; i++) {
                        var opt = document.createElement('option');
                        opt.value = drives[i];
                        opt.textContent = drives[i] + ':';
                        if (drives[i] === that.driveLetter) {
                            opt.selected = true;
                        }
                        driveSelect.appendChild(opt);
                    }
                }
                driveSelect.addEventListener('change', function() {
                    that.driveLetter = this.value;
                    that.saveDriveSettings();
                    that.loadDirectory(that.driveLetter + ':\\');
                });
            }
        });

        // 绑定搜索框
        var searchInput = el.querySelector('#cd-search');
        var clearBtn = el.querySelector('#cd-clear-search');
        var deepSearchBtn = el.querySelector('#cd-deep-search');
        if (searchInput) {
            searchInput.addEventListener('input', function() {
                var query = this.value.trim();
                if (clearBtn) clearBtn.style.display = query ? 'block' : 'none';
                // 仅实时过滤当前目录；回车才触发深度搜索
                that.applyFilter(query);
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

        // 初始加载：优先上次保存的路径，否则加载当前盘符根目录
        this.loadDirectory(this.currentPath || this.driveLetter + ':\\');

        // 渲染收藏夹（DOM 已就绪）
        this.renderFavorites();
    }

    /**
     * 使用 Node.js fs 读取目录
     */
    loadDirectory(dirPath) {
        var that = this;

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

        this.currentPath = dirPath;
        this.savePathSettings();

        // 同步当前路径的盘符到下拉框
        var driveMatch = dirPath.match(/^([A-Za-z]):/);
        if (driveMatch) {
            var newDrive = driveMatch[1].toUpperCase();
            if (newDrive !== that.driveLetter) {
                that.driveLetter = newDrive;
                var driveSelect = document.getElementById('cd-drive-select');
                if (driveSelect) {
                    driveSelect.value = newDrive;
                }
            }
        }

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

            var parts = [];
            var cleanPath = dirPath.endsWith('\\') ? dirPath.slice(0, -1) : dirPath;

            if (/^[A-Za-z]:$/.test(cleanPath)) {
                parts = [{name: '🏠', path: cleanPath + '\\'}];
            } else {
                var segments = cleanPath.split('\\');
                var accumulated = '';
                for (var i = 0; i < segments.length; i++) {
                    if (i === 0) {
                        accumulated = segments[0] + '\\';
                        parts.push({name: '🏠', path: accumulated});
                    } else {
                        accumulated += segments[i] + '\\';
                        parts.push({name: segments[i], path: accumulated});
                    }
                }
            }

            for (var i = 0; i < parts.length; i++) {
                var isLast = (i === parts.length - 1);

                var span = document.createElement('span');
                span.textContent = parts[i].name;
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
                    })(parts[i].path);
                }

                breadcrumbEl.appendChild(span);

                if (!isLast) {
                    var sep = document.createElement('span');
                    sep.textContent = '>';
                    sep.style.margin = '0 6px';
                    sep.style.color = 'var(--b3-theme-secondary,#999)';
                    breadcrumbEl.appendChild(sep);
                }
            }
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
     * 使用 Node.js fs 模块读取目录
     */
    loadDirectoryWithNode(dirPath, fileListEl) {
        var that = this;
        
        try {
            // 标准化路径
            var normalizedPath = dirPath;
            if (!normalizedPath.endsWith('\\')) {
                normalizedPath += '\\';
            }
            
            fs.readdir(normalizedPath, { withFileTypes: true }, function(err, entries) {
                if (err) {
                    // 根目录无法访问是真正的问题；子目录 ENOENT/EPERM 在挂载盘上通常是空文件夹的正常表现
                    var isRootDir = /^[A-Za-z]:\\?$/.test(dirPath);
                    if (err.code === 'ENOENT' || err.code === 'EPERM' || err.code === 'EACCES') {
                        if (isRootDir) {
                            console.error('[LocalBrowse] fs.readdir error:', err);
                            that.showError('无法访问 ' + dirPath + '，请确认挂载盘已启动且驱动器已挂载');
                        } else {
                            that.renderFiles([], normalizedPath);
                        }
                    } else {
                        console.error('[LocalBrowse] fs.readdir error:', err);
                        // 尝试降级到 API
                        that.loadDirectoryWithAPI(dirPath, fileListEl);
                    }
                    return;
                }
                
                var files = [];
                for (var i = 0; i < entries.length; i++) {
                    var entry = entries[i];
                    var fullPath = normalizedPath + entry.name;
                    var stat = null;
                    var size = 0;
                    var mtime = 0;

                    try {
                        stat = fs.statSync(fullPath);
                        size = stat.size;
                        mtime = stat.mtime ? stat.mtime.getTime() : 0;
                    } catch (e) {
                        // 某些文件可能无法获取stat
                    }

                    // 通过 fs.statSync 回退判断（symlink/junction/挂载点等 OTHER 类型）
                    var isDir = entry.isDirectory();
                    if (!isDir && !entry.isFile() && stat) {
                        try { isDir = stat.isDirectory(); } catch(e) {}
                    }

                    files.push({
                        name: entry.name,
                        isDir: isDir,
                        size: size,
                        mtime: mtime,
                        path: fullPath
                    });
                }
                
                that.renderFiles(files, normalizedPath);
            });
        } catch (e) {
            console.error('[LocalBrowse] loadDirectoryWithNode error:', e);
            this.loadDirectoryWithAPI(dirPath, fileListEl);
        }
    }

    /**
     * 降级：使用思源API读取目录
     */
    loadDirectoryWithAPI(dirPath, fileListEl) {
        var that = this;
        
        fetch('/api/file/readDir', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: dirPath }),
            credentials: 'include'
        }).then(function(resp) {
            return resp.json();
        }).then(function(data) {
            if (data.code === 0 && Array.isArray(data.data)) {
                that.renderFiles(data.data, dirPath);
            } else {
                that.showError('API 无法访问外部驱动器: ' + (data.msg || '未知错误'));
            }
        }).catch(function(e) {
            console.error('[LocalBrowse] API error:', e);
            that.showError('网络错误: ' + e.message);
        });
    }

    /**
     * 检测可用盘符（Windows A-Z）
     */
    detectDrives(callback) {
        var that = this;
        var drives = [];

        if (!fs) {
            that.availableDrives = ['T'];
            callback(['T']);
            return;
        }

        var letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        var checked = 0;
        var finished = false;

        // 超时保护：5 秒后强制返回已检测到的盘符（防止网络盘 access 永不回调）
        var timeout = setTimeout(function() {
            if (!finished) {
                finished = true;
                drives.sort();
                if (drives.length === 0) drives.push('T');
                that.availableDrives = drives;
                callback(drives);
            }
        }, 5000);

        function tryFinish() {
            if (finished) return;
            finished = true;
            clearTimeout(timeout);
            drives.sort();
            if (drives.length === 0) drives.push('T');
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
                        drives.push(letter);
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
        // 保存缓存用于搜索过滤
        this.cachedFiles = files.slice();
        this.cachedPath = currentPath;
        // 应用当前排序
        files = this.sortFiles(files);
        this.doRender(files, currentPath);
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
        this.preSearchPath = this.currentPath || this.driveLetter + ':\\';

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

        this.deepSearch(this.currentPath || this.driveLetter + ':\\', query, onPartialResult, function(finalResults, wasCancelled) {
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
            if (!normalizedPath.endsWith('\\')) normalizedPath += '\\';

            taskStarted();
            schedule(function() {
                if (abortFlag.cancelled) { taskFinished(); return Promise.resolve(); }

                return fs.promises.readdir(normalizedPath, { withFileTypes: true }).then(function(entries) {
                    var subPromises = [];
                    var batchResults = [];

                    searchedDirs++;

                    for (var i = 0; i < entries.length; i++) {
                        if (abortFlag.cancelled) break;

                        var entry = entries[i];
                        var fullPath = normalizedPath + entry.name;

                        // 多关键词匹配：所有关键词都必须出现在文件名中
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
                                isDir: entry.isDirectory(),
                                path: fullPath,
                                relativePath: that.getRelativePath(fullPath, dirPath)
                            };
                            if (!entry.isDirectory()) {
                                // 异步取 size 和 mtime
                                var statP = fs.promises.stat(fullPath).then(function(st) {
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

                        if (entry.isDirectory()) {
                            // 子目录递归搜索自行通过 schedule 排队，不阻塞当前目录
                            // 这样并发池能立即释放当前槽位，调度更多目录搜索
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
            console.error('[LocalBrowse] deepSearch error:', e);
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
        if (!normBase.endsWith('\\')) normBase += '\\';
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
                batchSize: 20,  // 每批渲染数量
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

            for (var i = 0; i < files.length; i++) {
                var f = files[i];
                var icon = f.isDir ? '📁' : that.getFileIcon(f.name);
                var name = that.escapeHtml(f.name);
                var itemClass = f.isDir ? 'cd-dir' : 'cd-file';
                var fullPath = f.path || ((currentPath.endsWith('\\') ? currentPath : currentPath + '\\') + f.name);

                var relativePathHtml = '';
                if (isDeepSearch && f.relativePath) {
                    var displayPath = that.escapeHtml(f.relativePath);
                    var lastSlash = displayPath.lastIndexOf('\\');
                    var folderPath = lastSlash > 0 ? displayPath.substring(0, lastSlash) : '';
                    if (folderPath) {
                        relativePathHtml = '<div style="font-size:11px;color:var(--b3-theme-secondary,#999);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">📂 ' + folderPath + '</div>';
                    }
                }

                var timeStr = f.mtime ? that.formatTime(f.mtime) : '';
                var sizeStr = f.isDir ? '' : that.formatSize(f.size);

                if (isDeepSearch && relativePathHtml) {
                    html += '<div class="cd-item ' + itemClass + '" ' +
                        'data-path="' + that.escapeHtml(fullPath) + '" ' +
                        'data-name="' + that.escapeHtml(f.name) + '" ' +
                        'data-isdir="' + f.isDir + '" ' +
                        'style="display:flex;align-items:flex-start;padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--b3-border,#eee);transition:background 0.15s">' +
                        '<span style="font-size:16px;margin-right:8px;flex-shrink:0;margin-top:1px">' + icon + '</span>' +
                        '<span style="flex:1;overflow:hidden;min-width:0">' +
                            '<div style="font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + name + '</div>' +
                            relativePathHtml +
                        '</span>' +
                        (sizeStr ? '<span style="font-size:11px;color:var(--b3-theme-secondary,#999);margin-left:8px;flex-shrink:0;white-space:nowrap;min-width:50px;text-align:right">' + sizeStr + '</span>' : '') +
                        (timeStr ? '<span style="font-size:11px;color:#bbb;margin-left:8px;flex-shrink:0;white-space:nowrap">' + timeStr + '</span>' : '') +
                    '</div>';
                } else {
                    html += '<div class="cd-item ' + itemClass + '" ' +
                        'data-path="' + that.escapeHtml(fullPath) + '" ' +
                        'data-name="' + that.escapeHtml(f.name) + '" ' +
                        'data-isdir="' + f.isDir + '" ' +
                        'style="display:flex;align-items:center;padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--b3-border,#eee);transition:background 0.15s">' +
                        '<span style="font-size:16px;margin-right:8px;flex-shrink:0">' + icon + '</span>' +
                        '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px">' + name + '</span>' +
                        (sizeStr ? '<span style="font-size:11px;color:var(--b3-theme-secondary,#999);margin-left:8px;flex-shrink:0;white-space:nowrap;min-width:50px;text-align:right">' + sizeStr + '</span>' : '') +
                        (timeStr ? '<span style="font-size:11px;color:#bbb;margin-left:8px;flex-shrink:0;white-space:nowrap">' + timeStr + '</span>' : '') +
                    '</div>';
                }
            }
        }

        fileListEl.innerHTML = html;

        // 绑定点击事件
        that.bindItemEvents(fileListEl, files, currentPath);
    }

    /**
     * 构建单个图标项 HTML
     */
    buildIconItem(f, currentPath) {
        var that = this;
        var name = that.escapeHtml(f.name);
        var itemClass = f.isDir ? 'cd-dir' : 'cd-file';
        var fullPath = f.path || ((currentPath.endsWith('\\') ? currentPath : currentPath + '\\') + f.name);
        var isImg = !f.isDir && that.isImageFile(f.name);

        var iconHtml;
        if (isImg) {
            // 大文件（>5MB）或 LIVP 文件显示占位图标，避免加载慢
            var isLargeFile = f.size > 5 * 1024 * 1024;
            var ext = name.split('.').pop().toLowerCase();
            var isLivp = (ext === 'livp');
            if (isLargeFile || isLivp) {
                iconHtml = '<div class="cd-thumb-wrap" style="width:56px;height:56px;border-radius:4px;background:var(--b3-theme-surface,#f0f0f0);overflow:hidden;position:relative;flex-shrink:0;display:flex;align-items:center;justify-content:center">' +
                    '<span style="font-size:28px;color:var(--b3-theme-secondary,#999)">' + (isLivp ? '📷' : '🖼️') + '</span>' +
                    '</div>';
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

        return '<div class="cd-item ' + itemClass + '" ' +
            'data-path="' + that.escapeHtml(fullPath) + '" ' +
            'data-name="' + that.escapeHtml(f.name) + '" ' +
            'data-isdir="' + f.isDir + '" ' +
            'data-isimg="' + isImg + '" ' +
            'style="display:flex;flex-direction:column;align-items:center;justify-content:flex-start;padding:6px 4px;cursor:pointer;border-radius:4px;transition:background 0.15s;height:110px;box-sizing:border-box;overflow:hidden">' +
            '<div style="width:56px;height:56px;display:flex;align-items:center;justify-content:center;margin-bottom:4px;flex-shrink:0">' + iconHtml + '</div>' +
            '<span class="cd-name" style="font-size:11px;text-align:center;word-break:break-all;line-height:1.2;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;width:100%;flex-shrink:0">' + displayName + '</span>' +
        '</div>';
    }


    /**
     * 绑定文件项的点击/双击/悬停/右键事件
     */
    bindItemEvents(fileListEl, files, currentPath) {
        var that = this;
        var items = fileListEl.querySelectorAll('.cd-item:not([data-bound])');
        for (var j = 0; j < items.length; j++) {
            (function(item) {
                item.dataset.bound = 'true';
                item.addEventListener('click', function(e) {
                    e.preventDefault();
                    e.stopPropagation();

                    var isDir = item.dataset.isdir === 'true';
                    var itemPath = item.dataset.path;

                    if (isDir) {
                        that.loadDirectory(itemPath);
                    } else {
                        that.selectItem(item);
                    }
                });

                item.addEventListener('dblclick', function(e) {
                    e.preventDefault();
                    e.stopPropagation();

                    var isDir = item.dataset.isdir === 'true';
                    var itemPath = item.dataset.path;
                    var name = item.dataset.name;

                    if (!isDir) {
                        that.handleFileClick(itemPath, name);
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
                        }, 200);
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
                    that.showContextMenu(e, itemPath, name, isDir);
                });
            })(items[j]);
        }
    }

    /**
     * 处理文件点击：插入本地文件链接
     */
    handleFileClick(filePath, fileName) {
        // 直接插入本地文件链接
        this.insertLocalFileLink(filePath, fileName);
    }

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
            // 其他文件：显示为链接，锚文本干净，标题放指纹
            if (fingerprintTitle) {
                markdown = '[' + linkText + '](' + fileUrl + ' "' + fingerprintTitle + '")';
            } else {
                markdown = '[' + linkText + '](' + fileUrl + ')';
            }
        }
        
        // 尝试插入到编辑器（带重试，首次启动时编辑器可能尚未就绪）
        this.tryInsertToEditor(markdown, function(success) {
            if (success) {
                that.showToastMsg('✅ 已插入链接: ' + fileName);
            } else {
                // 重试全部失败，降级到剪贴板
                that.copyToClipboard(markdown);
                that.showToastMsg('已复制到剪贴板，请 Ctrl+V 粘贴');
            }
        });
    }

    /**
     * 插入资源到编辑器
     */
    insertAssetToEditor(assetPath, fileName) {
        var that = this;
        var markdown;
        
        if (this.isImageFile(fileName)) {
            markdown = '![' + this.escapeMarkdown(fileName) + '](' + assetPath + ')';
        } else {
            markdown = '[' + this.escapeMarkdown(fileName) + '](' + assetPath + ')';
        }
        
        // console.log('[LocalBrowse] Inserting asset:', markdown);
        
        // 尝试插入到编辑器（带重试，首次启动时编辑器可能尚未就绪）
        this.tryInsertToEditor(markdown, function(success) {
            if (success) {
                that.showToastMsg('✅ 已插入: ' + fileName);
            } else {
                // 重试全部失败，降级到剪贴板
                that.copyToClipboard(markdown);
                that.showToastMsg('已复制到剪贴板，请 Ctrl+V 粘贴');
            }
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

        that.showToastMsg('正在复制到 assets: ' + finalName);

        // 优先用思源 API 复制（更安全，不会触发数据保护）
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
                that.showToastMsg('✅ 已复制到 assets: ' + finalName);
                that.insertAssetToEditor('assets/' + finalName, finalName);
            } else {
                console.warn('[LocalBrowse] API copyFile failed:', data.msg);
                that.copyFileToAssetsFallback(filePath, finalName);
            }
        }).catch(function(e) {
            console.warn('[LocalBrowse] API copyFile error:', e);
            that.copyFileToAssetsFallback(filePath, finalName);
        });
    }

    /**
     * 生成唯一的 assets 文件名（处理冲突）
     */
    resolveAssetName(fileName) {
        var dataDir = '';
        try {
            if (window.siyuan && window.siyuan.config && window.siyuan.config.system && window.siyuan.config.system.dataDir) {
                dataDir = window.siyuan.config.system.dataDir;
            }
        } catch (e) {}

        if (!dataDir) return fileName;

        var assetsDir = dataDir.replace(/\\/g, '/') + '/assets';
        var destPath = assetsDir + '/' + fileName;

        // 如果 assets 中不存在同名文件，直接返回
        if (!fs.existsSync(destPath)) return fileName;

        // 存在冲突，添加时间戳
        var ext = '';
        var baseName = fileName;
        var lastDot = fileName.lastIndexOf('.');
        if (lastDot > 0) {
            ext = fileName.substring(lastDot);
            baseName = fileName.substring(0, lastDot);
        }
        var timestamp = new Date().getTime();
        return baseName + '_' + timestamp + ext;
    }

    /**
     * 降级：用 fs 流式复制到 assets（API 失败时使用）
     */
    copyFileToAssetsFallback(filePath, fileName) {
        var that = this;

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
                console.error('[LocalBrowse] read stream error:', err);
                that.showToastMsg('❌ 复制失败: ' + err.message);
            });

            writeStream.on('finish', function() {
                that.showToastMsg('✅ 已复制到 assets: ' + fileName);
                that.insertAssetToEditor('assets/' + fileName, fileName);
            });

            writeStream.on('error', function(err) {
                console.error('[LocalBrowse] write stream error:', err);
                that.showToastMsg('❌ 复制失败: ' + err.message);
            });

            readStream.pipe(writeStream);
        } catch (e) {
            console.error('[LocalBrowse] fallback copy failed:', e);
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
                console.error('[LocalBrowse] insert error:', e);
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
     * 显示右键菜单
     */
    showContextMenu(e, filePath, fileName, isDir) {
        var that = this;
        var menuEl = document.getElementById('cd-context-menu');
        if (!menuEl) return;

        // 先关闭可能已打开的菜单
        that.hideContextMenu();

        var items = [];
        if (isDir) {
            items.push({ icon: '📂', label: '打开', action: function() { that.loadDirectory(filePath); } });
            items.push({ type: 'divider' });
            if (that.isFavorite(filePath)) {
                items.push({ icon: '❌', label: '移除收藏', action: function() { that.removeFavorite(filePath); } });
            } else {
                items.push({ icon: '⭐', label: '添加到收藏', action: function() { that.addFavorite(filePath, fileName); } });
            }
            items.push({ type: 'divider' });
            items.push({ icon: '🔗', label: '添加到文档', action: function() { that.insertLocalFileLink(filePath, fileName, true); } });
            items.push({ type: 'divider' });
            items.push({ icon: 'ℹ️', label: '查看属性', action: function() { that.showFileProperties(filePath, fileName, isDir); } });
        } else {
            items.push({ icon: '📂', label: '打开文件', action: function() { that.openFile(filePath); } });
            items.push({ icon: '📁', label: '打开所在文件夹', action: function() { that.openContainingFolder(filePath); } });
            items.push({ type: 'divider' });
            items.push({ icon: '📋', label: '复制路径', action: function() { that.copyFilePath(filePath); } });
            items.push({ icon: '🔗', label: '复制 Markdown 链接', action: function() { that.copyMarkdownLink(filePath, fileName); } });
            items.push({ type: 'divider' });
            items.push({ icon: '📎', label: '插入本地链接', action: function() { that.handleFileClick(filePath, fileName); } });
            items.push({ icon: '📦', label: '复制到 assets 并插入', action: function() { that.copyFileToAssets(filePath, fileName); } });
            items.push({ type: 'divider' });
            items.push({ icon: 'ℹ️', label: '查看属性', action: function() { that.showFileProperties(filePath, fileName, isDir); } });
        }

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

        // 绑定菜单项点击（通过 data-idx 获取 items 数组中的真实位置）
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
     * 用系统默认程序打开文件
     */
    openFile(filePath) {
        try {
            var electron = window.require && window.require('electron');
            if (electron && electron.shell && electron.shell.openPath) {
                electron.shell.openPath(filePath);
                return;
            }
        } catch (e) {}
        // 降级：使用 spawn 避免 shell 注入（cp.exec 拼接字符串有命令注入风险）
        try {
            var cp = require('child_process');
            cp.spawn('cmd', ['/c', 'start', '""', filePath], { stdio: 'ignore', detached: true }).unref();
        } catch (e) {
            this.showToastMsg('无法打开文件，请手动访问：' + filePath);
        }
    }

    /**
     * 打开文件所在文件夹
     * Windows 上直接用 explorer /select 确保窗口在前台
     * 避免 electron.shell.showItemInFolder 后台打开的已知问题
     */
    openContainingFolder(filePath) {
        try {
            var cp = require('child_process');
            // Windows: explorer /select 直接打开并选中文件，窗口自动在前台
            cp.spawn('explorer', ['/select,', filePath], {
                stdio: 'ignore',
                detached: true
            }).unref();
            return;
        } catch (e) {
            this.showToastMsg('无法打开文件夹，请手动访问');
        }
    }

    /**
     * 复制文件路径到剪贴板
     */
    copyFilePath(filePath) {
        this.copyToClipboard(filePath);
        this.showToastMsg('✅ 路径已复制');
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
        this.showToastMsg('✅ Markdown 链接已复制');
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
    selectItem(selectedItem) {
        var list = document.getElementById('cd-file-list');
        if (list) {
            var items = list.querySelectorAll('.cd-item');
            for (var i = 0; i < items.length; i++) {
                items[i].classList.remove('cd-selected');
                items[i].style.background = '';
            }
        }
        selectedItem.classList.add('cd-selected');
        selectedItem.style.background = 'var(--b3-theme-primary-light,#bbdefb)';
    }

    /**
     * 将本地路径转换为 file:/// URL
     */
    toFileUrl(filePath) {
        var normalizedPath = filePath.replace(/\\/g, '/');
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
     * 显示图片悬浮预览
     */
    showImagePreview(filePath, fileName, fileSize, fileMtime) {
        var that = this;
        var previewEl = document.getElementById('cd-image-preview');
        var imgEl = document.getElementById('cd-preview-img');
        if (!previewEl || !imgEl) return;

        imgEl.src = that.toFileUrl(filePath);

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
        var previewW = 560;
        var previewH = 480;

        var mx = that._previewMousePos ? that._previewMousePos.x : 0;
        var my = that._previewMousePos ? that._previewMousePos.y : 0;

        var left = mx + 16;
        // 垂直方向以鼠标为中心偏下一点，避免上下跳跃
        var top = my - previewH / 2 + 20;

        // 如果右侧空间不够，显示在鼠标左侧（紧挨着鼠标）
        if (left + previewW > winW) {
            left = mx - previewW - 2;
        }
        // 边界保护
        if (top + previewH > winH) {
            top = winH - previewH - 8;
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
                    console.error('[LocalBrowse] save sort settings failed:', e);
                });
            } else {
                localStorage.setItem('cd_sort_settings', JSON.stringify(data));
            }
        } catch (e) {
            console.error('[LocalBrowse] save sort settings error:', e);
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
                        that.driveLetter = data.driveLetter;
                    }
                }).catch(function() {
                    // 忽略加载失败
                });
            } else {
                var saved = localStorage.getItem('cd_drive_settings');
                if (saved) {
                    var parsed = JSON.parse(saved);
                    if (parsed.driveLetter) that.driveLetter = parsed.driveLetter;
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
                    console.error('[LocalBrowse] save drive settings failed:', e);
                });
            } else {
                localStorage.setItem('cd_drive_settings', JSON.stringify(data));
            }
        } catch (e) {
            console.error('[LocalBrowse] save drive settings error:', e);
        }
    }

    /**
     * 从 data.json 加载路径设置
     */
    loadPathSettings() {
        var that = this;
        try {
            if (typeof this.loadData === 'function') {
                this.loadData('pathSettings').then(function(data) {
                    if (data && typeof data === 'object') {
                    if (data.currentPath) {
                        that.currentPath = data.currentPath;
                        var driveMatch = data.currentPath.match(/^([A-Za-z]):/);
                        if (driveMatch) {
                            that.driveLetter = driveMatch[1].toUpperCase();
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
                        that.currentPath = parsed.currentPath;
                        var driveMatch = parsed.currentPath.match(/^([A-Za-z]):/);
                        if (driveMatch) {
                            that.driveLetter = driveMatch[1].toUpperCase();
                        }
                    }
                }
            }
        } catch (e) {
            // 忽略错误
        }
    }

    /**
     * 保存路径设置到 data.json
     */
    savePathSettings() {
        var that = this;
        try {
            var data = { currentPath: this.currentPath };
            if (typeof this.saveData === 'function') {
                this.saveData('pathSettings', data).catch(function(e) {
                    console.error('[LocalBrowse] save path settings failed:', e);
                });
            } else {
                localStorage.setItem('cd_path_settings', JSON.stringify(data));
            }
        } catch (e) {
            console.error('[LocalBrowse] save path settings error:', e);
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
                    console.error('[LocalBrowse] save view settings failed:', e);
                });
            } else {
                localStorage.setItem('cd_view_settings', JSON.stringify(data));
            }
        } catch (e) {
            console.error('[LocalBrowse] save view settings error:', e);
        }
    }

    /**
     * 从 data.json 加载收藏夹
     */
    loadFavorites() {
        var that = this;
        try {
            if (typeof this.loadData === 'function') {
                this.loadData('favorites').then(function(data) {
                    if (Array.isArray(data)) {
                        that.favorites = data;
                        that.renderFavorites();
                    }
                }).catch(function() {
                    that.favorites = [];
                });
            } else {
                var saved = localStorage.getItem('cd_favorites');
                if (saved) {
                    that.favorites = JSON.parse(saved);
                }
                that.renderFavorites();
            }
        } catch (e) {
            this.favorites = [];
        }
    }

    /**
     * 保存收藏夹到 data.json
     */
    saveFavorites() {
        var that = this;
        try {
            if (typeof this.saveData === 'function') {
                this.saveData('favorites', this.favorites).catch(function(e) {
                    console.error('[LocalBrowse] save favorites failed:', e);
                });
            } else {
                localStorage.setItem('cd_favorites', JSON.stringify(this.favorites));
            }
        } catch (e) {
            console.error('[LocalBrowse] save favorites error:', e);
        }
        this.renderFavorites();
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
            btn.style.cssText = 'display:inline-flex;align-items:center;gap:3px;padding:2px 6px;font-size:10px;background:var(--b3-theme-surface,#f0f0f0);border:1px solid var(--b3-border,#ddd);border-radius:10px;cursor:pointer;white-space:nowrap;max-width:100px;overflow:hidden;text-overflow:ellipsis;transition:background 0.15s;flex-shrink:0';
            btn.title = fav.path;
            btn.innerHTML = '<span style="font-size:10px">⭐</span><span style="overflow:hidden;text-overflow:ellipsis">' + this.escapeHtml(fav.name) + '</span>';

            (function(favPath, favName) {
                btn.addEventListener('click', function() {
                    that.loadDirectory(favPath);
                });
                btn.addEventListener('mouseenter', function() {
                    this.style.background = 'var(--b3-theme-hover,#e3f2fd)';
                });
                btn.addEventListener('mouseleave', function() {
                    this.style.background = 'var(--b3-theme-surface,#f0f0f0)';
                });
                btn.addEventListener('contextmenu', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    if (confirm('确定要移除收藏 "' + favName + '" 吗？')) {
                        that.removeFavorite(favPath);
                    }
                });
            })(fav.path, fav.name);

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
        this.showToastMsg('⭐ 已收藏: ' + dirName);
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
            this.showToastMsg('❌ 已移除收藏: ' + removed);
        }
    }

    getFileIcon(fileName) {
        var ext = fileName.split('.').pop().toLowerCase();
        var icons = {
            'pdf': '📕', 'doc': '📄', 'docx': '📄', 'xls': '📊', 'xlsx': '📊',
            'ppt': '📊', 'pptx': '📊', 'txt': '📝', 'md': '📝',
            'jpg': '🖼️', 'jpeg': '🖼️', 'png': '🖼️', 'gif': '🖼️', 'webp': '🖼️', 'svg': '🖼️', 'bmp': '🖼️', 'heic': '🖼️', 'heif': '🖼️', 'livp': '📷',
            'mp3': '🎵', 'wav': '🎵', 'flac': '🎵',
            'mp4': '🎬', 'avi': '🎬', 'mkv': '🎬', 'mov': '🎬',
            'zip': '📦', 'rar': '📦', '7z': '📦', 'tar': '📦', 'gz': '📦',
            'exe': '⚙️', 'dll': '⚙️', 'msi': '⚙️'
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
     * 从图片文件中读取 EXIF 拍摄时间
     * 仅解析 JPEG 的 EXIF IFD，轻量实现无需第三方库
     */
    readExifData(filePath, callback) {
        var that = this;
        try {
            var fs = require('fs');
            fs.readFile(filePath, function(err, buf) {
                if (err || !buf || buf.length < 4) { callback(null); return; }
                try {
                    // 检查 JPEG 文件头
                    if (buf[0] !== 0xFF || buf[1] !== 0xD8) { callback(null); return; }

                    var offset = 2;
                    while (offset < buf.length - 4) {
                        if (buf[offset] !== 0xFF) break;
                        var marker = buf[offset + 1];
                        // APP1 (EXIF)
                        if (marker === 0xE1) {
                            var segLen = (buf[offset + 2] << 8) | buf[offset + 3];
                            // 检查 "Exif\0\0" 头
                            if (offset + 10 < buf.length &&
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
            });
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
        } else {
            fileListEl.insertAdjacentHTML('beforeend', html);
        }

        state.renderedCount = endIdx;

        // 绑定新项的事件
        that.bindItemEvents(fileListEl, files, currentPath);

        // 首次渲染时加载可见缩略图
        that.loadVisibleThumbnails(fileListEl);

        state.isLoading = false;

        // 如果内容没有撑满容器，自动加载下一批
        setTimeout(function() {
            if (fileListEl.scrollHeight <= fileListEl.clientHeight + 50) {
                if (state.renderedCount < state.files.length) {
                    that.renderIconBatch(fileListEl);
                }
            }
        }, 50);
    }

    /**
     * 加载当前视口内可见的缩略图
     * 只有在视口范围内的占位符才会被替换为真实 <img>
     */
    loadVisibleThumbnails(container) {
        if (!container) return;
        var wraps = container.querySelectorAll('.cd-thumb-wrap[data-src]:not([data-loaded])');
        if (wraps.length === 0) return;

        var containerRect = container.getBoundingClientRect();
        var viewTop = containerRect.top - 100;    // 上方预加载 100px
        var viewBottom = containerRect.bottom + 100; // 下方预加载 100px

        for (var i = 0; i < wraps.length; i++) {
            var wrap = wraps[i];
            var rect = wrap.getBoundingClientRect();
            // 判断是否在视口附近
            if (rect.bottom >= viewTop && rect.top <= viewBottom) {
                wrap.dataset.loaded = '1';
                var src = wrap.dataset.src;
                var img = document.createElement('img');
                img.src = src;
                img.decoding = 'async';
                img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;opacity:0;transition:opacity 0.15s';
                img.onload = function() { this.style.opacity = '1'; };
                img.onerror = function() {
                    // 加载失败保留占位符
                    this.parentNode.innerHTML = '<span class="cd-thumb-placeholder" style="font-size:20px;color:var(--b3-theme-secondary,#999)">🖼️</span>';
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
    }

    /**
     * 图标视图：滚动事件处理（带防抖）
     */
    onIconScroll(e) {
        var that = this;
        var fileListEl = e.target;
        var state = that.iconRenderState;
        if (!state || state.isLoading) return;

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

        // 防抖：200ms 后加载缩略图 + 检查是否需要加载更多
        that._scrollTimer = setTimeout(function() {
            // 滚动停止，加载当前视口内的缩略图
            that.loadVisibleThumbnails(fileListEl);

            var scrollTop = fileListEl.scrollTop;
            var clientHeight = fileListEl.clientHeight;
            var scrollHeight = fileListEl.scrollHeight;
            var scrollBottom = scrollTop + clientHeight;
            
            // 如果内容高度不足或接近底部，加载更多
            var needLoad = false;
            if (scrollHeight <= clientHeight + 50) {
                needLoad = true;
            } else if (scrollBottom >= scrollHeight - 100) {
                needLoad = true;
            }
            
            if (needLoad && state.renderedCount < state.files.length) {
                that.renderIconBatch(fileListEl);
            }
        }, 200);
    }

    // ========== 失效链接修复功能 ==========

    /**
     * 入口：点击 🔗 按钮触发
     */
    async relinkBrokenLinks() {
        var that = this;
        console.log('[LocalBrowse] relinkBrokenLinks started');

        // 1. 获取当前活动文档 ID
        var docId = that.getCurrentDocId();
        console.log('[LocalBrowse] relinkBrokenLinks - docId:', docId);
        if (!docId) {
            that.showToastMsg('请先打开一个文档');
            return;
        }

        // 2. 扫描失效链接
        try {
            var result = await that.scanBrokenLinks(docId);
            if (!result || !result.broken || result.broken.length === 0) {
                if (result && result.total === 0) {
                    that.showToastMsg('📄 当前文档没有本地文件链接');
                } else {
                    that.showToastMsg('✅ 该文档内所有本地链接均有效');
                }
                return;
            }

            // 3. 先弹出对话框显示失效链接列表
            that.showRelinkDialog(result.broken, result.total, result.valid, docId);

            // 4. 在对话框内自动搜索修复（并行处理所有失效链接）
            var dialog = document.getElementById('cd-relink-dialog');
            if (dialog) {
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
                        statusEl.textContent = '🔍 搜索中...';
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

                    // 第一轮：旧路径父目录，深度2
                    var r1Candidates = [];
                    if (parentDir && fs.existsSync(parentDir)) {
                        r1Candidates = await that.searchFileByName(item.fileName, parentDir, {
                            maxDepth: 2, maxResults: 5, maxDirs: 100, timeoutMs: 2000,
                            onProgress: function(info) {
                                if (candidateArea) candidateArea.innerHTML = '<span style="font-size:11px;color:var(--b3-theme-secondary,#999)">🔍 R1 已扫 ' + info.dirsScanned + ' 目录</span>';
                            }
                        });
                    }
                    var r1Exact = r1Candidates.filter(function(c) { return c.matchType === 'exact' || c.matchType === 'case-insensitive'; });
                    if (r1Exact.length > 0) candidates = r1Exact;

                    // 第二轮：父目录的上级，深度3
                    if (candidates.length === 0 && parentDir) {
                        var grandParent = '';
                        var gpSep = Math.max(parentDir.lastIndexOf('\\'), parentDir.lastIndexOf('/'));
                        if (gpSep > 2) grandParent = parentDir.substring(0, gpSep);
                        if (grandParent && grandParent.length > 3 && fs.existsSync(grandParent)) {
                            if (candidateArea) candidateArea.innerHTML = '<span style="font-size:11px;color:var(--b3-theme-secondary,#999)">🔍 R2 搜索中...</span>';
                            var r2Candidates = await that.searchFileByName(item.fileName, grandParent, {
                                maxDepth: 3, maxResults: 5, maxDirs: 150, timeoutMs: 2000,
                                onProgress: function(info) {
                                    if (candidateArea) candidateArea.innerHTML = '<span style="font-size:11px;color:var(--b3-theme-secondary,#999)">🔍 R2 已扫 ' + info.dirsScanned + ' 目录</span>';
                                }
                            });
                            var r2Exact = r2Candidates.filter(function(c) { return c.matchType === 'exact' || c.matchType === 'case-insensitive'; });
                            if (r2Exact.length > 0) candidates = r2Exact;
                        }
                    }

                    // 第三轮：全盘深度搜索
                    if (candidates.length === 0) {
                        var driveRoot = item.localPath.charAt(0) + ':\\';
                        var r3AllCandidates = [];
                        var r3TotalSearched = 0;
                        var r3TotalMatched = 0;

                        if (candidateArea) candidateArea.innerHTML = '<span style="font-size:11px;color:var(--b3-theme-secondary,#999)">🔍 R3 全盘深度搜索...</span>';

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
                                var rootEntries = fs.readdirSync(driveRoot, { withFileTypes: true });
                                var subDirs = [];
                                for (var ei = 0; ei < rootEntries.length; ei++) {
                                    var e = rootEntries[ei];
                                    var isDir = e.isDirectory();
                                    if (!isDir && !e.isFile()) {
                                        try { isDir = fs.statSync(driveRoot + e.name).isDirectory(); } catch(err) {}
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
                        if (candidateArea) candidateArea.innerHTML = '<span style="font-size:11px;color:var(--b3-theme-secondary,#999)">🔍 R3 搜索完成（' + r3TotalSearched + ' 目录）</span>';
                    }

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
                        candidateArea.innerHTML = candidateHtml;
                        candidateArea._candidates = exactCandidates;
                        if (statusEl) {
                            statusEl.textContent = '⚠️ 待确认';
                            statusEl.style.color = 'var(--b3-theme-warning,#faad14)';
                        }
                        var confirmBtn = candidateArea.querySelector('.cd-relink-confirm-btn');
                        if (confirmBtn) {
                            confirmBtn.addEventListener('click', async function() {
                                var idx = parseInt(this.getAttribute('data-index'));
                                var area = dialog.querySelector('.cd-relink-candidate-area[data-index="' + idx + '"]');
                                var selectedRadio = area.querySelector('input[type="radio"]:checked');
                                if (!selectedRadio) return;
                                var candIdx = parseInt(selectedRadio.value);
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
                                        bottomSpan.textContent = '⚠️ 已自动修复 ' + newFixed + '/' + result.broken.length + ' 个，' + newPending + ' 个待确认';
                                        bottomSpan.style.color = 'var(--b3-theme-warning,#faad14)';
                                    }
                                }
                            });
                        }
                        return { manual: true };
                    } else {
                        item._searchResults = [];
                        if (candidateArea) candidateArea.innerHTML = '<span style="font-size:11px;color:var(--b3-theme-error,#e74c3c)">❌ 未找到同名文件</span>';
                        if (statusEl) {
                            statusEl.textContent = '❌ 失效';
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
                                console.error('[LocalBrowse] processLink error for item', idx, e);
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
                        fixAllBtn.textContent = '⚠️ 已自动修复 ' + autoFixed + '/' + result.broken.length + ' 个，' + needManual.length + ' 个待确认';
                        fixAllBtn.style.color = 'var(--b3-theme-warning,#faad14)';
                    }
                }
            }
        } catch (e) {
            console.error('[LocalBrowse] relink scan error:', e);
            that.showToastMsg('扫描链接失败：' + (e.message || e));
        }
    }

    /**
     * 获取当前活动文档的 block ID
     */
    getCurrentDocId() {
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
                                console.log('[LocalBrowse] getCurrentDocId - method1 (layout API):', titleEl.dataset.nodeId);
                                return titleEl.dataset.nodeId;
                            }
                        }
                    }
                } catch (e2) {
                    console.log('[LocalBrowse] getCurrentDocId - method1 error:', e2.message);
                }
            }

            // 方式2：通过 DOM 查询 .protyle-title[data-node-id]
            var activeProtyl = document.querySelector('[data-type="wnd"].layout__wnd--active .protyle:not(.fn__none)') ||
                               document.querySelector('[data-type="wnd"] .protyle:not(.fn__none)');
            if (activeProtyl) {
                var titleEl2 = activeProtyl.querySelector('.protyle-title');
                if (titleEl2 && titleEl2.dataset && titleEl2.dataset.nodeId) {
                    console.log('[LocalBrowse] getCurrentDocId - method2 (DOM title):', titleEl2.dataset.nodeId);
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
                        console.log('[LocalBrowse] getCurrentDocId - method3 (wysiwyg→title):', titleEl3.dataset.nodeId);
                        return titleEl3.dataset.nodeId;
                    }
                }
            }

            console.log('[LocalBrowse] getCurrentDocId - all methods failed');
            return null;
        } catch (e) {
            console.error('[LocalBrowse] getCurrentDocId error:', e);
            return null;
        }
    }

    /**
     * 扫描文档中的 file:/// 链接，检测失效链接
     */
    async scanBrokenLinks(docId) {
        var that = this;

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
                if (sizeMatch) fileFingerprint.size = parseInt(sizeMatch[1]);
                if (mtimeMatch) fileFingerprint.mtime = parseInt(mtimeMatch[1]);
            }

            // 去重：同一个 URL 只检测一次
            if (seen[fullUrl]) continue;
            seen[fullUrl] = true;
            total++;

            // URL 转本地路径
            var localPath = that.fileUrlToLocalPath(fullUrl);

            // 检测文件是否存在
            if (fs && fs.existsSync && fs.existsSync(localPath)) {
                valid++;
            } else {
                // 提取文件名
                var fileName = localPath.split('\\').pop().split('/').pop();
                broken.push({
                    oldUrl: fullUrl,
                    localPath: localPath,
                    fileName: fileName,
                    displayText: displayText,
                    fileFingerprint: fileFingerprint  // 保存文件指纹，用于搜索时精确匹配
                });
            }
        }

        return { broken: broken, total: total, valid: valid };
    }

    /**
     * file:/// URL 转本地路径
     */
    fileUrlToLocalPath(url) {
        var decoded = decodeURIComponent(url);
        // file:///D:/docs/file.pdf → D:\docs\file.pdf
        var local = decoded.replace(/^file:\/\/\//, '').replace(/\//g, '\\');
        return local;
    }

    /**
     * 本地路径转 file:/// URL（URL 编码版本，用于 Kramdown/Markdown）
     */
    localPathToFileUrl(localPath) {
        // D:\腾讯电脑管家截图文件\局部截取_20250918_131642.png
        // → file:///D:/%E8%85%BE%E8%AE%AF.../局部截取_20250918_131642.png
        var normalized = localPath.replace(/\\/g, '/');
        // 只对路径中的每个段做编码，不编码 / 和 :
        var segments = normalized.split('/');
        var encodedSegments = segments.map(function(s) {
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
        var normalized = localPath.replace(/\\/g, '/');
        return 'file:///' + normalized;
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
                    '<span class="cd-relink-status" data-index="' + i + '" style="margin-left:auto;font-size:11px;color:var(--b3-theme-secondary,#999);white-space:nowrap">❌ 失效</span>' +
                '</div>' +
                '<div style="font-size:11px;color:var(--b3-theme-secondary,#999);word-break:break-all;margin-bottom:6px;padding-left:20px">旧路径：' + that.escapeHtml(item.localPath) + '</div>' +
                '<div class="cd-relink-candidate-area" data-index="' + i + '" style="padding-left:20px;font-size:11px;color:var(--b3-theme-secondary,#999);max-width:480px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></div>' +
            '</div>';
        }

        var contentHtml = '<div style="padding:16px;min-width:420px;max-width:560px;max-height:80vh;display:flex;flex-direction:column">' +
            '<div style="font-weight:bold;font-size:14px;margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid var(--b3-border,#eee)">🔗 修复失效链接</div>' +
            '<div style="font-size:12px;color:var(--b3-theme-secondary,#999);margin-bottom:10px">找到 <b style="color:var(--b3-theme-error,#e74c3c)">' + brokenLinks.length + '</b> 个失效链接（共 ' + total + ' 个本地链接，<b style="color:var(--b3-theme-success,#52c41a)">' + valid + '</b> 个有效）</div>' +
            '<div class="cd-relink-list" style="flex:1;overflow-y:auto;min-height:0">' + listHtml +             '</div>' +
            '<div style="margin-top:12px;display:flex;justify-content:flex-end;gap:8px">' +
                '<span id="cd-relink-fixall" style="padding:5px 16px;font-size:12px;background:transparent;color:var(--b3-theme-secondary,#999);border-radius:4px;pointer-events:none;user-select:none">🔍 搜索中...</span>' +
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
                    candidateArea.innerHTML = candidateHtml;
                    candidateArea._candidates = exactCandidates;

                    var confirmBtn = candidateArea.querySelector('.cd-relink-confirm-btn');
                    if (confirmBtn) {
                        confirmBtn.addEventListener('click', async function() {
                            var idx = parseInt(this.getAttribute('data-index'));
                            var area = dialog.querySelector('.cd-relink-candidate-area[data-index="' + idx + '"]');
                            var selectedRadio = area.querySelector('input[type="radio"]:checked');
                            if (!selectedRadio) return;
                            var candIdx = parseInt(selectedRadio.value);
                            var chosen = area._candidates[candIdx];
                            await that.replaceLink(docId, brokenLinks[idx].oldUrl, chosen.fullPath, idx, context);
                        });
                    }
                }
                failed++;
            } else {
                // 未找到
                if (statusEl) {
                    statusEl.textContent = '❌ 失效';
                    statusEl.style.color = 'var(--b3-theme-error,#e74c3c)';
                }
                if (candidateArea) {
                    candidateArea.innerHTML = '<span style="color:var(--b3-theme-error,#e74c3c)">❌ 未找到同名文件</span>';
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

        if (fixed > 0 && failed === 0) {
            that.showToastMsg('🎉 全部 ' + fixed + ' 个失效链接已修复');
        } else if (fixed > 0) {
            that.showToastMsg('✅ 已修复 ' + fixed + ' 个，' + failed + ' 个需要手动处理');
        } else {
            that.showToastMsg('❌ 未找到可自动修复的链接');
        }
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
            candidateArea.innerHTML = '<span style="font-size:11px;color:var(--b3-theme-secondary,#999)">🔍 正在搜索...</span>';

            // 异步搜索
            that.searchFileByName(item.fileName, searchDir, {
                maxDepth: 5, maxResults: 20,
                onProgress: function(info) {
                    candidateArea.innerHTML = '<span style="font-size:11px;color:var(--b3-theme-secondary,#999)">🔍 已扫 ' + info.dirsScanned + ' 目录，精确 ' + info.exactCount + ' 模糊 ' + info.fuzzyCount + '</span>';
                }
            }).then(function(candidates) {
                if (candidates.length === 0) {
                    candidateArea.innerHTML = '<span style="font-size:11px;color:var(--b3-theme-error,#e74c3c)">未找到同名或相似文件</span>';
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
                candidateArea.innerHTML = candidateHtml;

                // 存储候选数据
                candidateArea._candidates = candidates;

                // 绑定 radio 点击高亮
                var radios = candidateArea.querySelectorAll('input[type="radio"]');
                var labels = candidateArea.querySelectorAll('label');
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
                var confirmBtn = candidateArea.querySelector('.cd-relink-confirm-btn');
                if (confirmBtn) {
                    confirmBtn.addEventListener('click', function() {
                        var selectedRadio = candidateArea.querySelector('input[type="radio"]:checked');
                        if (!selectedRadio) return;
                        var candIdx = parseInt(selectedRadio.value);
                        var chosen = candidateArea._candidates[candIdx];
                        that.replaceLink(context.docId, item.oldUrl, chosen.fullPath, itemIndex, context);
                    });
                }

                // 取消按钮
                var cancelBtn = candidateArea.querySelector('.cd-relink-cancel-btn');
                if (cancelBtn) {
                    cancelBtn.addEventListener('click', function() {
                        candidateArea.innerHTML = '';
                        searchBtn.disabled = false;
                        searchBtn.textContent = '查找新位置';
                    });
                }

                searchBtn.disabled = false;
                searchBtn.textContent = '重新查找';
            }).catch(function(e) {
                candidateArea.innerHTML = '<span style="font-size:11px;color:var(--b3-theme-error,#e74c3c)">搜索出错：' + that.escapeHtml(e.message || String(e)) + '</span>';
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

        // 加载盘符
        that.detectDrives(function(drives) {
            if (driveSelect) {
                driveSelect.innerHTML = '';
                for (var d = 0; d < drives.length; d++) {
                    var opt = document.createElement('option');
                    opt.value = drives[d];
                    opt.textContent = drives[d] + ':';
                    // 根据初始路径选盘符
                    if (initialDir && initialDir.charAt(0).toUpperCase() === drives[d]) {
                        opt.selected = true;
                    }
                    driveSelect.appendChild(opt);
                }
            }
        });

        // 盘符切换
        if (driveSelect) {
            driveSelect.addEventListener('change', function() {
                var newDrive = this.value + ':\\';
                pathInput.value = newDrive;
                currentBrowsePath = newDrive;
                that.loadPickerSubdirs(subdirsDiv, newDrive, pathInput);
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

        // 点击遮罩关闭（等同取消）
        picker.addEventListener('click', function(e) {
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
        if (!fs || !fs.existsSync(dirPath)) {
            container.innerHTML = '<div style="padding:8px;color:var(--b3-theme-secondary,#999);text-align:center">目录不存在</div>';
            return;
        }

        try {
            var entries = fs.readdirSync(dirPath, { withFileTypes: true });
            var dirs = [];
            for (var i = 0; i < entries.length; i++) {
                if (entries[i].isDirectory()) {
                    dirs.push(entries[i].name);
                }
            }
            dirs.sort(function(a, b) { return a.localeCompare(b); });

            if (dirs.length === 0) {
                container.innerHTML = '<div style="padding:8px;color:var(--b3-theme-secondary,#999);text-align:center">无子目录</div>';
                return;
            }

            var html = '';
            // 添加"返回上级"选项
            var parentDir = path.dirname(dirPath);
            if (parentDir && parentDir !== dirPath) {
                html += '<div class="cd-pick-dir-item" data-dir="' + that.escapeHtml(parentDir) + '" style="padding:5px 10px;cursor:pointer;border-bottom:1px solid var(--b3-border,#f5f5f5);color:var(--b3-theme-secondary,#999)">📁 ..</div>';
            }
            for (var d = 0; d < dirs.length; d++) {
                var fullPath = dirPath + '\\' + dirs[d];
                html += '<div class="cd-pick-dir-item" data-dir="' + that.escapeHtml(fullPath) + '" style="padding:5px 10px;cursor:pointer;border-bottom:1px solid var(--b3-border,#f5f5f5)">📁 ' + that.escapeHtml(dirs[d]) + '</div>';
            }
            container.innerHTML = html;

            // 绑定点击进入子目录
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
        } catch (e) {
            container.innerHTML = '<div style="padding:8px;color:var(--b3-theme-error,#e74c3c);text-align:center">无法读取目录</div>';
        }
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

        if (!fs || !fs.existsSync(searchDir)) {
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
                var entries = fs.readdirSync(item.dir, { withFileTypes: true });
                for (var i = 0; i < entries.length; i++) {
                    if ((exactResults.length + fuzzyResults.length) >= maxResults) break;
                    var entry = entries[i];
                    try {
                        if (entry.isFile()) {
                            var matchType = null;

                            // 精确匹配（原逻辑）
                            if (entry.name === fileName) {
                                matchType = 'exact';
                            }
                            // 大小写不敏感匹配
                            else if (entry.name.toLowerCase() === fileNameLower) {
                                matchType = 'case-insensitive';
                            }
                            // 模糊匹配：相似度超过阈值
                            else if (enableFuzzy && that.stringSimilarity(entry.name, fileName) >= fuzzyThreshold) {
                                matchType = 'fuzzy';
                            }

                            if (matchType) {
                                var fullPath = path.join(item.dir, entry.name);
                                var stat = fs.statSync(fullPath);
                                var result = {
                                    fullPath: fullPath,
                                    size: stat.size,
                                    mtime: stat.mtime ? stat.mtime.getTime() : 0,
                                    matchType: matchType,
                                    similarity: matchType === 'exact' ? 1 : (matchType === 'case-insensitive' ? 0.95 : that.stringSimilarity(entry.name, fileName))
                                };
                                if (matchType === 'exact' || matchType === 'case-insensitive') {
                                    exactResults.push(result);
                                } else {
                                    fuzzyResults.push(result);
                                }
                            }
                        } else if (entry.isDirectory()) {
                            if (entry.name.charAt(0) === '.' || entry.name === '$RECYCLE.BIN' || entry.name === 'System Volume Information' || entry.name === 'node_modules' || entry.name === '.git') continue;
                            queue.push({ dir: path.join(item.dir, entry.name), depth: item.depth + 1 });
                        } else if (!entry.isFile()) {
                            // OTHER 类型（symlink/junction/挂载点等），通过 statSync 判断
                            try {
                                var st = fs.statSync(path.join(item.dir, entry.name));
                                if (st.isDirectory()) {
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

        // 排序：精确匹配在前，然后按修改时间降序（最近的排前面）
        exactResults.sort(function(a, b) { return b.mtime - a.mtime; });
        fuzzyResults.sort(function(a, b) {
            // 模糊匹配先按相似度降序，再按修改时间降序
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
            if (!normalizedPath.endsWith('\\')) normalizedPath += '\\';

            taskStarted();
            schedule(function() {
                if (abortFlag.cancelled) { taskFinished(); return Promise.resolve(); }
                if (exactResults.length >= maxResults) { taskFinished(); return Promise.resolve(); }

                // 异步读取目录（同 deepSearch）
                return fs.promises.readdir(normalizedPath, { withFileTypes: true }).then(function(entries) {
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
                                    var statP = fs.promises.stat(fp).then(function(st) {
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
                            searchRecursive(fullPath);
                        } else if (!isFile && !isDir) {
                            // OTHER 类型（symlink/junction）：尝试 fs.statSync 判断是否为目录
                            // Windows 上如 "Documents and Settings"、用户目录下的兼容性链接
                            try {
                                var st = fs.statSync(fullPath);
                                if (st.isDirectory()) {
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
            console.error('[LocalBrowse] deepSearchFileByName error:', e);
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
                    var frName = fr.name || (fr.path ? fr.path.split('\\').pop() : '');
                    if (frName === fileName || frName.toLowerCase() === fileNameLower) {
                        try {
                            var fst = fr.path ? fs.statSync(fr.path) : null;
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
     * 修复v4：找到包含链接的具体子块，只更新那个子块，避免重建整个文档
     * 新链接会附加 #size=xxx&mtime=xxx fragment，用于未来精确匹配
     */
    async replaceLink(docId, oldUrl, newLocalPath, itemIndex, context) {
        var that = this;

        // 为新链接生成文件指纹 title
        var newFingerprintTitle = '';
        try {
            var newStat = fs.statSync(newLocalPath);
            if (newStat) {
                newFingerprintTitle = 'size=' + newStat.size + '&mtime=' + (newStat.mtime ? newStat.mtime.getTime() : 0);
            }
        } catch(e) {}

        var newUrl = that.localPathToFileUrl(newLocalPath);
        var newUrlRaw = that.localPathToFileUrlRaw(newLocalPath);  // 不编码版本，用于 DOM 替换
        var newUrlWithTitle = newFingerprintTitle ? (newUrl + ' "' + newFingerprintTitle + '"') : newUrl;
        var newUrlRawWithTitle = newFingerprintTitle ? (newUrlRaw + ' "' + newFingerprintTitle + '"') : newUrlRaw;

        try {

            // === 步骤1：获取文档的所有子块 ===
            var childResp = await fetch('/api/block/getChildBlocks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: docId })
            });
            var childData = await childResp.json();
            if (childData.code !== 0 || !childData.data) {
                that.showToastMsg('获取子块失败');
                return;
            }
            var childBlocks = childData.data;

            // === 步骤2：找到包含旧链接的子块 ===
            var targetBlock = null;
            var targetMatchUrl = null;  // 记录实际匹配到的 URL 格式

            // 准备多种可能的 URL 格式用于匹配
            // oldUrl 已在 scanBrokenLinks 中去掉了 fragment，但 markdown 中可能仍保留 fragment
            var oldUrlVariants = [oldUrl];
            // 带可能 fragment 的版本（旧链接可能包含 #size=xxx&mtime=xxx）
            // 在 oldUrl 后面添加通配 fragment 匹配：搜索时先试不含 fragment 的，再试含 fragment 的
            // 编码版本（空格→%20，中文→UTF-8）
            oldUrlVariants.push(that.localPathToFileUrl(oldUrl.replace(/^file:\/\//, '').replace(/\\/g, '/')));
            // 只编码空格版本（思源有时只编码空格）
            oldUrlVariants.push(oldUrl.replace(/ /g, '%20'));
            // 只编码中文版本
            oldUrlVariants.push(encodeURI(oldUrl).replace(/%25/g, '%'));
            // 去掉 file:/// 前缀的原始路径
            oldUrlVariants.push(oldUrl.replace('file:///', ''));
            // 去掉 file:/// 前缀且斜杠替换为反斜杠
            oldUrlVariants.push(oldUrl.replace('file:///', '').replace(/\//g, '\\'));

            // 如果旧链接可能带有 fragment（size/mtime），也添加带 fragment 的变体
            // 这里用 startswith 匹配：如果 markdown 中包含 oldUrl 的开头部分就能匹配
            // 但 indexOf 是精确匹配，所以需要额外加入带 #size 的变体
            // 由于 fragment 的具体值不确定，使用子串搜索方式：在匹配时先搜索 oldUrl 前缀
            // 这里不需要添加带 fragment 的变体，因为不含 fragment 的 oldUrl 是含 fragment 的前缀
            // block.markdown.indexOf(oldUrl) 在 markdown 中如果 URL 是 "file:///D:/xxx.png#size=123"
            // 而 oldUrl 是 "file:///D:/xxx.png"，那么 indexOf 仍然能匹配到！
            // 因为 "file:///D:/xxx.png" 是 "file:///D:/xxx.png#size=123" 的子串


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
                // 打印所有子块的 markdown 前200字符用于调试
                for (var i = 0; i < Math.min(childBlocks.length, 5); i++) {
                    var md = childBlocks[i].markdown || '';
                }
                that.showToastMsg('未找到包含该链接的块');
                return;
            }

            // === 步骤3：获取该子块的 DOM ===
            var domResp = await fetch('/api/block/getBlockDOM', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: targetBlock.id })
            });
            var domData = await domResp.json();
            if (domData.code !== 0 || !domData.data || !domData.data.dom) {
                that.showToastMsg('获取块 DOM 失败');
                return;
            }
            var blockDom = domData.data.dom;

            // === 步骤4：在 DOM 中替换链接 ===
            // DOM 中的链接可能是未编码的中文，也可能有编码
            // 可能包含旧的 fragment（#size=xxx&mtime=xxx），需要一并替换
            // 策略：用正则匹配旧 URL（含可能的 fragment），替换为新 URL（含新 fragment）
            var newDom = blockDom;
            var replaced = false;

            // 构建匹配旧 URL 的正则，同时捕获可能存在的 fragment
            // oldUrl 是不含 fragment 的纯 URL
            function escapeRegex(str) {
                return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            }

            // 方式1：用 targetMatchUrl（实际在 markdown 中匹配到的格式）替换
            if (targetMatchUrl && newDom.indexOf(targetMatchUrl) !== -1) {
                var isEncoded = targetMatchUrl !== oldUrl && targetMatchUrl.indexOf('%') !== -1;
                var replacementUrl = isEncoded ? newUrl : newUrlRaw;
                // targetMatchUrl 可能不包含 fragment（因为是子串匹配），需要检查并去掉 DOM 中旧的 fragment
                var escapedTarget = escapeRegex(targetMatchUrl);
                var regex1 = new RegExp(escapedTarget + '(#[^"\\s<>]*)?');
                newDom = newDom.replace(regex1, replacementUrl);
                replaced = true;
            }
            // 方式2：直接替换旧 URL（未编码），用未编码的新 URL 替换
            if (!replaced && newDom.indexOf(oldUrl) !== -1) {
                var escapedOld = escapeRegex(oldUrl);
                var regex2 = new RegExp(escapedOld + '(#[^"\\s<>]*)?');
                newDom = newDom.replace(regex2, newUrlRaw);
                replaced = true;
            }
            // 方式3：旧 URL 编码版本，用编码的新 URL 替换
            if (!replaced) {
                var oldEncoded = that.localPathToFileUrl(oldUrl.replace(/^file:\/\//, '').replace(/\\/g, '/'));
                if (newDom.indexOf(oldEncoded) !== -1) {
                    var escapedEncoded = escapeRegex(oldEncoded);
                    var regex3 = new RegExp(escapedEncoded + '(#[^"\\s<>]*)?', 'g');
                    newDom = newDom.replace(regex3, newUrl);
                    replaced = true;
                }
            }
            // 方式4：只编码空格版本
            if (!replaced) {
                var oldSpaceEncoded = oldUrl.replace(/ /g, '%20');
                if (newDom.indexOf(oldSpaceEncoded) !== -1) {
                    var newSpaceEncoded = newUrlRaw.replace(/ /g, '%20');
                    var escapedSpace = escapeRegex(oldSpaceEncoded);
                    var regex4 = new RegExp(escapedSpace + '(#[^"\\s<>]*)?', 'g');
                    newDom = newDom.replace(regex4, newSpaceEncoded);
                    replaced = true;
                }
            }
            // 方式5：部分匹配 - 去掉 file:/// 前缀
            if (!replaced) {
                var oldPathPart = oldUrl.replace('file:///', '');
                var oldPathEncoded = that.localPathToFileUrl(oldUrl.replace(/^file:\/\//, '').replace(/\\/g, '/')).replace('file:///', '');
                var newPathPartRaw = newUrlRaw.replace('file:///', '');
                var newPathPartEncoded = newUrl.replace('file:///', '');

                if (newDom.indexOf(oldPathPart) !== -1) {
                    var escapedPath = escapeRegex(oldPathPart);
                    var regex5a = new RegExp(escapedPath + '(#[^"\\s<>]*)?', 'g');
                    newDom = newDom.replace(regex5a, newPathPartRaw);
                    replaced = true;
                } else if (newDom.indexOf(oldPathEncoded) !== -1) {
                    var escapedPathEnc = escapeRegex(oldPathEncoded);
                    var regex5b = new RegExp(escapedPathEnc + '(#[^"\\s<>]*)?', 'g');
                    newDom = newDom.replace(regex5b, newPathPartEncoded);
                    replaced = true;
                }
            }

            if (!replaced) {
                that.showToastMsg('未找到需要替换的链接');
                return;
            }

            // 更新 DOM 中的文件指纹 title（修复后新链接需要携带新指纹，用于未来精确定位）
            // 注意：只替换目标链接附近的 title，避免误伤同一块中的其他链接
            if (newFingerprintTitle && replaced) {
                // 在已替换的链接附近查找并替换 title（只替换第一次匹配，对应刚替换的那个链接）
                var titleRegex = /title="size=\d+&(?:amp;)?mtime=\d+"/;
                newDom = newDom.replace(titleRegex, 'title="' + newFingerprintTitle + '"');
            }

            // === 步骤5：用 dataType: 'dom' 更新该子块 ===
            var updateResp = await fetch('/api/block/updateBlock', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: targetBlock.id,
                    dataType: 'dom',
                    data: newDom
                })
            });
            var updateData = await updateResp.json();
            if (updateData.code !== 0) {
                that.showToastMsg('替换链接失败：' + (updateData.msg || '未知错误'));
                return;
            }

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

            that.showToastMsg('✅ 已修复：' + (context.brokenLinks[itemIndex] ? context.brokenLinks[itemIndex].fileName : ''));

        } catch (e) {
            console.error('[LocalBrowse] replaceLink error:', e);
            that.showToastMsg('替换链接失败：' + (e.message || e));
        }
    }
}

module.exports = LocalBrowsePlugin;

// console.log("[LocalBrowse] === LOADED ===");
