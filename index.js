/**
 * SiYuan Plugin: LocalBrowse - 本地文件浏览器
 * 在Dock面板快速浏览本地文件，便捷插入本地文件链接为思源附件
 *
 * Copyright (C) 2026 sqalei
 * Licensed under the GNU General Public License v3.0
 * https://github.com/sqalei/siyuan-plugin-localbrowse
 */

console.log("[LocalBrowse] === LOADING ===");

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
    console.log("[LocalBrowse] Node.js modules loaded successfully");
} catch (e) {
    console.error("[LocalBrowse] Failed to load Node.js modules:", e);
}

class LocalBrowsePlugin extends Plugin {
    constructor(options) {
        super(options);
        this.dockPanel = null;
        this.currentPath = '';
        this.driveLetter = 'T';
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
        try {
            this.addDock({
                config: {
                    position: 'RightTop',
                    size: { width: 300, height: 600 },
                    icon: 'iconLocalBrowse',
                    title: '本地文件',
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
            '</div>' +
        '</div>';
        
        // 绑定刷新按钮（innerHTML 已同步渲染，无需 setTimeout）
        var refreshBtn = el.querySelector('#cd-refresh');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', function() {
                that.loadDirectory(that.currentPath || that.driveLetter + ':\\');
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
                // 重新渲染当前目录
                if (that.cachedFiles.length && that.cachedPath) {
                    that.doRender(that.cachedFiles, that.cachedPath, '', that.isDeepSearchMode);
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
                            console.log('[LocalBrowse] 目录不存在或为空（挂载盘空文件夹特性）:', dirPath);
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

                    files.push({
                        name: entry.name,
                        isDir: entry.isDirectory(),
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

        for (var i = 0; i < letters.length; i++) {
            (function(letter) {
                var drivePath = letter + ':\\';
                fs.access(drivePath, fs.constants.F_OK, function(err) {
                    checked++;
                    if (!err) {
                        drives.push(letter);
                    }
                    if (checked === letters.length) {
                        // 按字母排序
                        drives.sort();
                        // 如果没有检测到任何盘符，默认保留 T
                        if (drives.length === 0) drives.push('T');
                        that.availableDrives = drives;
                        callback(drives);
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
        console.log('[LocalBrowse] renderFiles: ' + files.length + ' 个文件');
        // 保存缓存用于搜索过滤
        this.cachedFiles = files.slice();
        this.cachedPath = currentPath;
        // 应用当前排序
        files = this.sortFiles(files);
        console.log('[LocalBrowse] 调用 doRender, currentView=' + this.currentView);
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
            // 文件夹始终在文件前面（除非按大小或修改时间排序时混合）
            if (sortBy === 'name' && a.isDir !== b.isDir) {
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
     * 开始深度搜索（递归搜索子目录）
     */
    startDeepSearch(query) {
        var that = this;
        var fileListEl = document.getElementById('cd-file-list');
        var breadcrumbEl = document.getElementById('cd-breadcrumb');
        var searchInput = document.getElementById('cd-search');

        if (!fileListEl) return;

        // 保存搜索前的目录，用于返回
        this.preSearchPath = this.currentPath || this.driveLetter + ':\\';

        // 禁用搜索框并显示 loading
        if (searchInput) searchInput.disabled = true;
        that.renderSearchBreadcrumb(query, true);
        fileListEl.innerHTML = '<div style="padding:20px;text-align:center;color:#999">正在深度搜索...</div>';

        this.deepSearch(this.currentPath || this.driveLetter + ':\\', query, function(results) {
            if (searchInput) searchInput.disabled = false;
            // 保存深度搜索结果到缓存，支持后续实时过滤
            that.cachedFiles = results;
            that.cachedPath = that.currentPath;
            that.isDeepSearchMode = true;

            if (results.length === 0) {
                that.renderSearchBreadcrumb(query, false);
                fileListEl.innerHTML = '<div style="padding:20px;text-align:center;color:#999">未找到匹配文件</div>';
                return;
            }
            that.renderSearchBreadcrumb(query, false);
            that.doRender(results, that.currentPath, query, true);
        });
    }

    /**
     * 渲染深度搜索时的面包屑（带返回按钮）
     */
    renderSearchBreadcrumb(query, isLoading) {
        var that = this;
        var breadcrumbEl = document.getElementById('cd-breadcrumb');
        if (!breadcrumbEl) return;

        breadcrumbEl.innerHTML = '';
        breadcrumbEl.style.cursor = 'default';

        var searchLabel = document.createElement('span');
        searchLabel.textContent = isLoading ? '🔍 深度搜索: ' + query + '（搜索中...）' : '🔍 深度搜索: ' + query;
        searchLabel.style.fontWeight = 'bold';
        searchLabel.style.color = 'var(--b3-theme-on-background,#333)';
        breadcrumbEl.appendChild(searchLabel);

        if (!isLoading) {
            var sep = document.createElement('span');
            sep.textContent = ' | ';
            sep.style.margin = '0 8px';
            sep.style.color = 'var(--b3-theme-secondary,#999)';
            breadcrumbEl.appendChild(sep);

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
     * 递归搜索子目录中的文件（最大深度 5）
     */
    deepSearch(dirPath, query, callback) {
        var that = this;
        var results = [];
        var pending = 1;
        var maxDepth = 5;
        var lowerQuery = query.toLowerCase();

        function searchRecursive(currentDir, depth) {
            if (depth > maxDepth) {
                pending--;
                if (pending === 0) callback(results);
                return;
            }

            var normalizedPath = currentDir;
            if (!normalizedPath.endsWith('\\')) normalizedPath += '\\';

            fs.readdir(normalizedPath, { withFileTypes: true }, function(err, entries) {
                if (!err && entries) {
                    for (var i = 0; i < entries.length; i++) {
                        var entry = entries[i];
                        var fullPath = normalizedPath + entry.name;

                        if (entry.name.toLowerCase().indexOf(lowerQuery) !== -1) {
                            var item = {
                                name: entry.name,
                                isDir: entry.isDirectory(),
                                path: fullPath,
                                relativePath: that.getRelativePath(fullPath, dirPath)
                            };
                            if (!entry.isDirectory()) {
                                try {
                                    item.size = fs.statSync(fullPath).size;
                                } catch(e) {
                                    item.size = 0;
                                }
                            }
                            results.push(item);
                        }

                        if (entry.isDirectory()) {
                            pending++;
                            searchRecursive(fullPath, depth + 1);
                        }
                    }
                }

                pending--;
                if (pending === 0) callback(results);
            });
        }

        searchRecursive(dirPath, 0);
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
     */
    applyFilter(query) {
        if (!this.cachedFiles.length || !this.cachedPath) return;

        var filtered;
        if (!query) {
            filtered = this.cachedFiles.slice();
        } else {
            var lowerQuery = query.toLowerCase();
            filtered = this.cachedFiles.filter(function(f) {
                return f.name.toLowerCase().indexOf(lowerQuery) !== -1;
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
            fileListEl.removeEventListener('scroll', that._boundIconScroll);
            that._boundIconScroll = that.onIconScroll.bind(that);
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
            var imgUrl = that.toFileUrl(fullPath);
            // 大文件（>5MB）显示占位图标，避免加载慢
            var isLargeFile = f.size > 5 * 1024 * 1024;
            if (isLargeFile) {
                iconHtml = '<div style="width:56px;height:56px;border-radius:4px;background:var(--b3-theme-surface,#f0f0f0);overflow:hidden;position:relative;flex-shrink:0;display:flex;align-items:center;justify-content:center">' +
                    '<span style="font-size:28px;color:var(--b3-theme-secondary,#999)">🖼️</span>' +
                    '</div>';
            } else {
                // 使用浏览器原生 loading="lazy" 懒加载
                iconHtml = '<div style="width:56px;height:56px;border-radius:4px;background:var(--b3-theme-surface,#f0f0f0);overflow:hidden;position:relative;flex-shrink:0">' +
                    '<img src="' + imgUrl + '" loading="lazy" decoding="async" style="width:100%;height:100%;object-fit:cover;display:block;opacity:0;transition:opacity 0.2s">' +
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
                    // 图片文件：延迟显示预览
                    var isDir = item.dataset.isdir === 'true';
                    var name = item.dataset.name;
                    if (!isDir && that.isImageFile(name)) {
                        that._previewTimer = setTimeout(function() {
                            // 从 files 数组中查找对应的文件大小
                            var fileSize = null;
                            if (that.iconRenderState && that.iconRenderState.files) {
                                for (var fi = 0; fi < that.iconRenderState.files.length; fi++) {
                                    var f = that.iconRenderState.files[fi];
                                    if (f.name === name) {
                                        fileSize = f.size;
                                        break;
                                    }
                                }
                            }
                            that.showImagePreview(item.dataset.path, name, fileSize);
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
        var that = this;
        
        this.showToastMsg('正在插入: ' + fileName);
        
        // 直接插入本地文件链接
        this.insertLocalFileLink(filePath, fileName);
    }

    /**
     * 插入本地文件链接到编辑器
     */
    insertLocalFileLink(filePath, fileName) {
        var ext = fileName.split('.').pop().toLowerCase();
        var normalizedPath = filePath.replace(/\\/g, '/');
        
        // 确保路径以 file:/// 开头（三个斜杠）
        var fileUrl;
        if (normalizedPath.startsWith('file:///')) {
            fileUrl = normalizedPath;
        } else if (normalizedPath.startsWith('file://')) {
            fileUrl = 'file:///' + normalizedPath.substring(7);
        } else if (normalizedPath.startsWith('/')) {
            fileUrl = 'file://' + normalizedPath;
        } else {
            // Windows 路径如 T:/Videos/xxx.mkv
            fileUrl = 'file:///' + normalizedPath;
        }
        
        var markdown;
        var imageExts = {'jpg':1,'jpeg':1,'png':1,'gif':1,'webp':1,'svg':1,'bmp':1};
        
        if (imageExts[ext]) {
            // 图片：直接显示
            markdown = '![' + this.escapeMarkdown(fileName) + '](' + fileUrl + ')';
        } else {
            // 其他文件：显示为链接
            markdown = '[' + this.escapeMarkdown(fileName) + '](' + fileUrl + ')';
        }
        
        console.log('[LocalBrowse] Inserting link:', markdown);
        
        // 尝试插入到编辑器
        var inserted = this.tryInsertToEditor(markdown);
        
        if (inserted) {
            this.showToastMsg('✅ 已插入链接: ' + fileName);
        } else {
            // 如果插入失败，复制到剪贴板
            this.copyToClipboard(markdown);
            this.showToastMsg('已复制到剪贴板，请 Ctrl+V 粘贴');
        }
    }

    /**
     * 复制文件链接到剪贴板（降级方案）
     */
    copyFileLink(filePath, fileName) {
        var ext = fileName.split('.').pop().toLowerCase();
        var normalizedPath = filePath.replace(/\\/g, '/');
        var markdown;
        
        var imageExts = {'jpg':1,'jpeg':1,'png':1,'gif':1,'webp':1,'svg':1,'bmp':1};
        if (imageExts[ext]) {
            markdown = '![](' + normalizedPath + ')';
        } else {
            markdown = '[' + fileName + '](' + normalizedPath + ')';
        }
        
        this.copyToClipboard(markdown);
    }

    /**
     * 插入资源到编辑器
     */
    insertAssetToEditor(assetPath, fileName) {
        var ext = fileName.split('.').pop().toLowerCase();
        var markdown;
        
        var imageExts = {'jpg':1,'jpeg':1,'png':1,'gif':1,'webp':1,'svg':1,'bmp':1};
        if (imageExts[ext]) {
            markdown = '![' + this.escapeMarkdown(fileName) + '](' + assetPath + ')';
        } else {
            markdown = '[' + this.escapeMarkdown(fileName) + '](' + assetPath + ')';
        }
        
        console.log('[LocalBrowse] Inserting asset:', markdown);
        
        // 尝试多种方式插入
        var inserted = this.tryInsertToEditor(markdown);
        
        if (!inserted) {
            this.copyToClipboard(markdown);
            this.showToastMsg('已复制到剪贴板，请 Ctrl+V 粘贴');
        }
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
     * 尝试插入到编辑器
     */
    tryInsertToEditor(text) {
        // 方式1: 直接操作 DOM，在光标位置插入（不换行）
        try {
            var protyle = document.querySelector('.protyle-wysiwyg[contenteditable="true"]');
            if (protyle) {
                protyle.focus();
                var selection = window.getSelection();
                if (selection && selection.rangeCount > 0) {
                    var range = selection.getRangeAt(0);
                    
                    // 检查是否在编辑器内
                    if (protyle.contains(range.commonAncestorContainer)) {
                        range.deleteContents();
                        var textNode = document.createTextNode(text);
                        range.insertNode(textNode);
                        range.setStartAfter(textNode);
                        range.collapse(true);
                        selection.removeAllRanges();
                        selection.addRange(range);
                        
                        // 触发输入事件
                        var inputEvent = new InputEvent('input', {
                            bubbles: true,
                            cancelable: true,
                            inputType: 'insertText',
                            data: text
                        });
                        protyle.dispatchEvent(inputEvent);
                        
                        return true;
                    }
                }
            }
        } catch (e) {
            console.error('[LocalBrowse] insert error:', e);
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
        if (typeof this.showMessage === 'function') {
            this.showMessage(msg);
        } else if (window.siyuan && window.siyuan.messenger) {
            window.siyuan.messenger.show(msg);
        } else {
            console.log('[LocalBrowse] ' + msg);
        }
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
            items.push({ icon: '📋', label: '复制路径', action: function() { that.copyFilePath(filePath); } });
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
        // 降级：尝试用 child_process
        try {
            var cp = require('child_process');
            cp.exec('start "" "' + filePath + '"');
        } catch (e) {
            this.showToastMsg('无法打开文件，请手动访问：' + filePath);
        }
    }

    /**
     * 打开文件所在文件夹
     */
    openContainingFolder(filePath) {
        try {
            var folder = filePath.substring(0, filePath.lastIndexOf('\\')) || filePath;
            var electron = window.require && window.require('electron');
            if (electron && electron.shell && electron.shell.showItemInFolder) {
                // showItemInFolder 会打开文件夹并选中文件，同时确保窗口在前台
                electron.shell.showItemInFolder(filePath);
                return;
            }
            if (electron && electron.shell && electron.shell.openPath) {
                electron.shell.openPath(folder);
                return;
            }
        } catch (e) {}
        try {
            var cp = require('child_process');
            // 使用 explorer /select 打开并选中文件
            cp.exec('explorer /select,"' + filePath + '"');
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
     */
    copyMarkdownLink(filePath, fileName) {
        var ext = fileName.split('.').pop().toLowerCase();
        var normalizedPath = filePath.replace(/\\/g, '/');
        var fileUrl;
        if (normalizedPath.startsWith('file:///')) {
            fileUrl = normalizedPath;
        } else if (normalizedPath.startsWith('file://')) {
            fileUrl = 'file:///' + normalizedPath.substring(7);
        } else if (normalizedPath.startsWith('/')) {
            fileUrl = 'file://' + normalizedPath;
        } else {
            fileUrl = 'file:///' + normalizedPath;
        }
        var imageExts = {'jpg':1,'jpeg':1,'png':1,'gif':1,'webp':1,'svg':1,'bmp':1};
        var markdown;
        if (imageExts[ext]) {
            markdown = '![' + this.escapeMarkdown(fileName) + '](' + fileUrl + ')';
        } else {
            markdown = '[' + this.escapeMarkdown(fileName) + '](' + fileUrl + ')';
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
        var imageExts = {'jpg':1,'jpeg':1,'png':1,'gif':1,'webp':1,'svg':1,'bmp':1};
        return !!imageExts[ext];
    }

    /**
     * 显示图片悬浮预览
     */
    showImagePreview(filePath, fileName, fileSize) {
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
    }

    /**
     * 更新排序按钮显示文本
     */
    updateSortButton(btn) {
        var labels = { name: '名称', size: '大小', mtime: '修改时间' };
        var arrow = this.sortOrder === 'asc' ? '↑' : '↓';
        btn.textContent = arrow + ' ' + (labels[this.sortBy] || '名称');
    }

    /**
     * 显示排序菜单
     */
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
                        var lowerQuery = query.toLowerCase();
                        filtered = filtered.filter(function(f) {
                            return f.name.toLowerCase().indexOf(lowerQuery) !== -1;
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
            }
        };
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
                    if (data && typeof data === 'object' && data.currentPath) {
                        that.currentPath = data.currentPath;
                        // 同步盘符
                        var driveMatch = data.currentPath.match(/^([A-Za-z]):/);
                        if (driveMatch) {
                            that.driveLetter = driveMatch[1].toUpperCase();
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
                    // 提取收藏路径的盘符并同步到下拉框
                    var match = favPath.match(/^([A-Za-z]):/);
                    if (match) {
                        var newDrive = match[1].toUpperCase();
                        if (newDrive !== that.driveLetter) {
                            that.driveLetter = newDrive;
                            var driveSelect = document.getElementById('cd-drive-select');
                            if (driveSelect) {
                                driveSelect.value = newDrive;
                            }
                        }
                    }
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
            'jpg': '🖼️', 'jpeg': '🖼️', 'png': '🖼️', 'gif': '🖼️', 'webp': '🖼️', 'svg': '🖼️', 'bmp': '🖼️',
            'mp3': '🎵', 'wav': '🎵', 'flac': '🎵',
            'mp4': '🎬', 'avi': '🎬', 'mkv': '🎬', 'mov': '🎬',
            'zip': '📦', 'rar': '📦', '7z': '📦', 'tar': '📦', 'gz': '📦',
            'exe': '⚙️', 'dll': '⚙️', 'msi': '⚙️'
        };
        return icons[ext] || '📄';
    }

    formatSize(bytes) {
        if (!bytes || bytes === 0) return '';
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
        var div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    escapeMarkdown(text) {
        return text.replace(/[\[\]\(\)\*\_\`]/g, '\\$&');
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

        // 处理缩略图加载状态
        var thumbImgs = fileListEl.querySelectorAll('img');
        for (var ti = 0; ti < thumbImgs.length; ti++) {
            (function(img) {
                if (img.complete && img.naturalWidth > 0) {
                    img.style.opacity = '1';
                } else {
                    img.onload = function() { img.style.opacity = '1'; };
                    img.onerror = function() {
                        var wrap = img.parentNode;
                        if (wrap) {
                            wrap.innerHTML = '<span style="font-size:28px;line-height:56px;text-align:center;display:block;color:var(--b3-theme-secondary,#999)">🖼️</span>';
                        }
                    };
                }
            })(thumbImgs[ti]);
        }

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
     * 图标视图：滚动事件处理（带防抖）
     */
    onIconScroll(e) {
        var that = this;
        var fileListEl = e.target;
        var state = that.iconRenderState;
        if (!state || state.isLoading) return;

        // 清除之前的定时器
        if (that._scrollTimer) {
            clearTimeout(that._scrollTimer);
        }

        // 防抖：200ms 后检查是否需要加载
        that._scrollTimer = setTimeout(function() {
            var scrollTop = fileListEl.scrollTop;
            var clientHeight = fileListEl.clientHeight;
            var scrollHeight = fileListEl.scrollHeight;
            var scrollBottom = scrollTop + clientHeight;
            
            // 如果内容高度不足或接近底部，加载更多
            var needLoad = false;
            if (scrollHeight <= clientHeight + 50) {
                // 内容没有撑满容器，需要加载更多
                needLoad = true;
            } else if (scrollBottom >= scrollHeight - 100) {
                // 滚动到底部附近
                needLoad = true;
            }
            
            if (needLoad && state.renderedCount < state.files.length) {
                that.renderIconBatch(fileListEl);
            }
        }, 200);
    }
}

module.exports = LocalBrowsePlugin;

console.log("[LocalBrowse] === LOADED ===");
