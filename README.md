## Overview

**LocalBrowse** is a SiYuan Note desktop plugin that provides a local file browser in the right Dock panel. It supports browsing, searching, bookmarking, one-click file link insertion, automatic broken link repair, and cross-device sync folder functionality.

- **Platforms**: Windows / macOS / Linux desktop SiYuan Note (v3.0.0+)
- **License**: GPL-3.0
- **GitHub**: https://github.com/sqalei/siyuan-plugin-localbrowse

---

## Quick Start

### 1. Open File Browser

After installation, a 📂 icon appears in the right Dock panel. Click to open.

### 2. Browse Files

- Select storage from the top-left dropdown (Windows drive letters / macOS volumes / Linux mount points)
- Click a folder to enter, click breadcrumbs to go back
- Press **Backspace** to go up one level

### 3. Configure Cross-Device Sync Folder (Recommended if you use multiple devices)

Right-click the sync folder button on the toolbar to open the configuration window. Configure your sync folder, e.g., PC A: `D:\BaiduSyncdisk\LocalBrowseSync`, PC B: `E:\BaiduSyncdisk\LocalBrowseSync`.

Note: `LocalBrowseSync` is fixed. Select the parent folder of your sync disk (e.g., Baidu Netdisk sync folder), and the plugin will automatically create `LocalBrowseSync` inside it. All devices must use `LocalBrowseSync` as the sync folder name.

### 4. Insert File Links

- **Right-click a file** → Insert local file link (supports file reorganization — if you move files, links auto-repair to the new path)
- **Right-click a folder** → Insert a folder link (📂 icon)

### 5. Bookmark Folders

Right-click a folder → "Add Bookmark". Click the bookmark tag at the top for one-click navigation.

### 6. Broken Link Auto-Repair

The indicator light shows link status when switching documents:

- 🟢 Green = All links valid
- 🟡 Yellow = Multiple candidates, click indicator to choose
- 🔴 Red = Unrepairable links

---

## Features

### 📁 Browse Local File System

Automatically detects all available storage. Switch quickly via the top-left dropdown. Supports local disks, mounted cloud drives, and sync folders.

- Breadcrumb navigation: click any level to go back
- Backspace shortcut: go up one level
- Status bar: shows file count and total size of current directory

### ✨ Insert File/Folder Links

**Right-click a file** to insert a link. Different file types have different effects:


| File Type | Format | Effect |
|-----------|--------|--------|
| Images (jpg/png/gif/webp/bmp/svg etc.) | `![filename](file:///path)` | Inline display in SiYuan |
| Videos (mp4/webm/ogg/mov/mkv/flv/avi/wmv etc.) | `[🎬 filename](file:///path)` | Clickable link with video icon |
| Other files (PDF/Word/Excel/archives etc.) | `[📄 filename](file:///path)` | Clickable link with file type icon |

**Right-click a folder** to insert a folder link: `[📂 foldername](file:///path)`

**Drag-and-drop** to insert links:

- Drag a file/folder from the browser panel directly into a document
- **Multi-select**: Ctrl/Cmd+Click to toggle, Shift+Click to range-select, then batch drag
- Each file in a batch gets its own block (vertical layout)
- Smart insertion: drops onto editor content → inserts at mouse cursor position; drops onto blank area → appends to document bottom

**Click links in documents**:

- Click a file link → opens the file AND the browser panel auto-navigates to and highlights the file
- Click a folder link → opens the folder in the browser panel (no longer opens system file manager)

**Right-click menu** provides more options:


| Menu Item | Description | Cross-Device |
|-----------|-------------|--------------|
| Insert Local File | Copy file to SiYuan `assets` directory and insert | ✅ Accessible on any device |
| Insert Local Link | Insert `file:///` absolute path link | ⚠️ Current device only (works cross-device with sync folder) |
| Associate with Current Doc | Link file to current doc and insert link at top | — |
| Open File/Folder | Open with system default app | — |
| Show in File Manager | Open file/folder location | — |
| Copy Path | Copy full path to clipboard | — |

**Which insertion method to use?**


| Scenario | Recommended Method |
|----------|-------------------|
| Files in sync folder, used on multiple computers | Double-click + configure cross-device sync folder |
| Files used on one computer only | Right-click → Insert Local Link |
| Need access on all devices (including mobile) | Right-click → Insert Local File (stored in assets) |

### 🔍 Search Files

- **Real-time Filter**: Type keywords in the search box to instantly filter the current directory (supports multiple keywords with space-separated AND matching)
- **Deep Search**: Press **Enter** or click 🔍 to recursively search all subdirectories with live progress
- **Cancel Search**: Click the × button or clear the search box

### ⭐ Bookmarks

- **Add Bookmark**: Right-click a folder → "Add Bookmark"
- **Remove Bookmark**: Right-click a bookmarked folder → "Remove Bookmark"
- **Reorder**: Drag bookmark tags
- **Quick Navigation**: Click a bookmark tag to jump directly

### 📊 Sorting

Click the "⇅ Name" button on the toolbar to sort by **name/size/modification time**. Click again to toggle ascending/descending. Sort preference is saved automatically.

### 🖼️ View Toggle

Click the ☰ / ⊞ button on the toolbar to switch:

- **List View**: Compact layout showing filename, size, and modification time
- **Icon View**: Thumbnail grid with hover-to-preview for images

Preference is saved automatically.

---

### 🔗 Broken Link Repair

The plugin automatically detects `file:///` local links in the current document. The toolbar indicator light shows status:


| Indicator | Status | Meaning |
|-----------|--------|---------|
| ⚪ | White | No local file links in current document |
| ⏳ | Spinning | Detecting and repairing links... |
| 🟢 | Green | All local links valid ✅ |
| 🟡 | Yellow | Multiple candidates need manual selection ⚠️ |
| 🔴 | Red | File deleted or renamed, cannot auto-repair 🔗 |

**Auto-Repair (Seamless)**: When opening a document, the plugin automatically scans and repairs broken links in the background — single matches are replaced automatically with no user action needed.

**Manual Repair (Yellow/Red light)**:

1. Click the 🟡 or 🔴 indicator on the toolbar
2. A repair dialog shows each broken link's status
3. For multiple candidates, click to select the correct file
4. Click "Apply Repair"

---

### 🔄 Cross-Device Sync Folder

When using sync disks (Baidu Netdisk, Nutstore, iCloud Drive, OneDrive, etc.) across multiple computers, the same file has different paths on each device. After configuring the cross-device sync folder, the plugin automatically repairs broken links caused by path differences.

**Supported scenarios**:

- **Cross-platform**: Windows ↔ macOS ↔ Linux
- **Same-platform cross-device**: Two Windows PCs with different drive letters (e.g., `D:\` ↔ `E:\`)

#### Configuration Steps

**Perform once on each computer**:

1. **Right-click** the 🔄 button on the toolbar to open the settings panel
2. The panel title shows the current platform tag (🪟 Windows / 🍎 macOS / 🐧 Linux)
3. Click the 📂 browse button to select the **parent folder** of your sync disk
   - The plugin automatically creates a `LocalBrowseSync` subfolder, which your sync disk will sync automatically
4. Click **Save**
5. Configuration is automatically synced to other devices via SiYuan Cloud

**Example**: Using Baidu Netdisk sync, three devices configured as follows:


| Device | Platform | Selected Parent Folder | Actual Sync Folder Path |
|--------|----------|----------------------|------------------------|
| Office Desktop | Windows | `D:\BaiduSyncdisk` | `D:\BaiduSyncdisk\LocalBrowseSync` |
| Home Laptop | Windows | `E:\BaiduSyncdisk` | `E:\BaiduSyncdisk\LocalBrowseSync` |
| MacBook | macOS | `/Users/sqalei/BaiduSyncdisk` | `/Users/sqalei/BaiduSyncdisk/LocalBrowseSync` |

**After configuration**:

- 🔄 button shows **🔄 LocalBrowseSync** (green, indicating configured)
- Click 🔄 button to open the sync folder directly
- Right-click 🔄 button to modify or clear configuration

#### Cross-Device Repair Effect

After inserting a file link from the sync folder on Computer A, when you open the same note on Computer B, the plugin automatically repairs the path to Computer B's correct path — no manual action needed.

Repair flow for links within the sync folder:

1. Replace path prefix → File exists → **Repaired directly** ✅
2. Replace path prefix → File not found → **Deep search** within sync folder → Repair if found
3. Still not found after search → Report failure, no full-disk search

> 💡 Links outside the sync folder are not affected by cross-device repair: current-platform links go through R1→R2→R3 full disk search, other-platform links are ignored (not repaired).

---

### 🎵 Music Player

Double-click any audio file to play. Built-in music player features:

- **Playback Controls**: Play/pause, previous/next track, seekable progress bar
- **Volume Control**: Adjustable volume slider with persistent settings
- **Real-time Lyrics**: Auto-searches for .lrc lyric files, synchronized highlighting, click to seek
- **Cover Art**: Auto-extracts MP3 embedded cover art, preloads covers during browsing
- **Immersive Experience**: Blurred cover art as lyrics background with crossfade transition animations
- **Playlist**: Auto-detects all audio files in the current directory, continuous folder playback
- **Preload Optimization**: Preloads next track audio and cover art for instant switching

### 📦 Internal Assets Manager

The new **📦 Internal Assets** tab lets you browse and manage all resource files in SiYuan's `assets/` directory directly from the Dock panel — no need to open the system file manager.

#### Browse Assets

- **Tree structure**: Organized by sub-document hierarchy. Root level shows notebooks; child levels show resources associated with each document
- **Type filter**: Top dropdown — All / Images / Videos / Audio / Documents / Others
- **Extension filter**: Top tag bar for quick filtering by PDF / XLSX / DOCX / ZIP, etc.
- **Real-time search**: Type keywords to instantly filter resource filenames

#### Asset Details

- File size and modification time for each resource
- Reference count (how many documents reference this resource)
- Hover-to-preview large images

#### View Toggle

Click the ☰ / ⊞ button on the toolbar to switch:

- **List View**: Compact layout showing filename, size, and modification time
- **Icon View**: Thumbnail grid. Root-level notebooks displayed as tiles; child levels show image thumbnails

#### Quick Actions

| Action | Description |
|--------|-------------|
| **Double-click** | Open the document that references this resource and jump to the reference location |
| **Right-click → 📋 Open File** | Open the resource with the system default application |
| **Right-click → 📂 Show in File Manager** | Locate and highlight the file in the system file manager |
| **Right-click → 📄 Open Referencing Doc** | Same as double-click — open the referencing document and locate |
| **Right-click → 🗑️ Delete** | Delete the resource from the `assets/` directory |

> 💡 Subdirectories under `assets/` (e.g., `assets/memos/`) are fully supported. Right-click "Open File" automatically resolves the correct relative path.

---

## FAQ

**Q: "Cannot access directory" error?**
A: Confirm the storage path is properly mounted and accessible. For cloud drive mounting tools, ensure the mounting service is running.

**Q: File not inserted into the note?**
A: Make sure the editor is focused (click the editing area) before double-clicking. If auto-insert fails, the link is copied to the clipboard — just Ctrl+V to paste.

**Q: Inserted links don't work on other computers?**
A: Double-click inserts a `file:///` local link, valid only on the current computer. Solutions for cross-device use:

- **Option 1**: Right-click → "Insert Local File" — file is stored in SiYuan `assets` directory, accessible on any device after sync
- **Option 2**: If the file is in a sync disk, configure cross-device sync folder for automatic repair

**Q: Does it support macOS / Linux?**
A: ✅ Full support for all three platforms. macOS auto-detects `/Volumes/` mount volumes, Linux auto-detects `/mnt/` and `/media/` mount points.

**Q: Two Windows PCs with different drive letters?**
A: ✅ Fully supported! But you need to use the cross-device sync folder feature. Configure the sync folder, e.g., PC A: `D:\BaiduSyncdisk\LocalBrowseSync`, PC B: `E:\BaiduSyncdisk\LocalBrowseSync` — the plugin automatically replaces the drive letter prefix.

**Q: Must the sync folder name be identical?**
A: The plugin automatically unifies it to `LocalBrowseSync`. Just select the parent folder — no need to worry about name inconsistency. However, the **parent folder name** (e.g., `BaiduSyncdisk`) must be the same across all devices.

**Q: Can I configure multiple sync folders?**
A: Currently only one group is supported. If you use multiple sync disks, put them under the same parent folder.

**Q: Broken link repair can't find a file?**
A: Ensure the file exists on accessible storage. For mounted cloud drives, confirm they're properly mounted. R3 full disk search covers all storage including mounted volumes.

---

## Changelog

### v0.8.0

**📦 Internal Assets Manager + Experience Improvements**

- 📦 New "Internal Assets" tab for browsing and managing SiYuan `assets/` resources
- 🏷️ Type filtering (Images/Videos/Audio/Documents/Others) and extension filtering
- 🔢 Resource reference count display
- 🔍 Real-time search by resource filename
- 👁️ Hover-to-preview large images
- 📑 Double-click resource to open referencing document and auto-locate
- 📋 Right-click menu: Open File / Show in File Manager / Open Referencing Doc / Delete
- 🖼️ List/Icon dual view toggle (with root-level notebook tiles and child-level thumbnails)

### v0.7.0

**Drag-and-drop links + file-document association + click-to-locate**

- 🖱️ Drag files/folders from the browser panel directly into documents to insert links
- ✋ Multi-select files with Ctrl/Shift+Click, then batch drag-and-drop to insert multiple links at once
- 🔗 Right-click "Associate with Current Doc" auto-inserts file link at the top of the document
- 📍 Click a file link in a document → file opens AND the browser panel auto-navigates to and highlights the file
- 📂 Click a folder link in a document → opens the folder in the browser panel instead of the system file manager
- 🎯 Smart insertion: drag to editor → inserts at mouse cursor position; drag to blank area → appends to document bottom

### v0.6.1

**Music player + performance optimizations**

- 🎵 Music player: play/pause, prev/next, seek, volume, LRC lyrics sync, cover art, immersive lyrics background
- Cover/lyrics crossfade transition animations

### v0.6.0

**Cross-platform support + cross-device sync folder upgrade**

- Windows / macOS / Linux platform-specific adaptation
- Cross-device sync folder supports same-platform multi-device (stored by hostname, no overwriting)
- Full path prefix matching — no false positives from same-name folders
- Unified sync folder name to `LocalBrowseSync`
- Opens sync folder by default on startup
- macOS cloud drive shortcuts
- Docker / API dual-mode support

### v0.5.6

- Broken link repair upgraded to red/yellow/green indicator + seamless auto-repair
- Double-click folder to insert folder link

### v0.5.5

- New broken link repair feature (3-level search + fingerprint matching)
- New link status indicator
- New file link click interceptor

### v0.4.0

- New bookmarks, sorting, list/icon views, image hover preview

### v0.3.0

- New deep search, real-time search filter, right-click menu

### v0.2.0

- New state persistence, breadcrumb navigation, dark mode adaptation

### v0.1.0

- Initial release: local file browser, double-click to insert files, storage switching

---

## Feedback

- **GitHub Issues**: https://github.com/sqalei/siyuan-plugin-localbrowse/issues
- Email: sqalei@qq.com

If you find this plugin useful, please give it a 🌟. Thank you for your support! 🙏
