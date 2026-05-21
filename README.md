# LocalBrowse for SiYuan

Browse local mounted drive files directly in SiYuan's dock panel. Click any file to automatically copy it to SiYuan's assets folder and insert it as an attachment.

## Features

- **Browse local drives**: Navigate through local mounted drives using native file system access
- **One-click insert**: Click a file to copy it to `workspace/data/assets/` and insert into the current note
- **Image support**: Images are inserted with `![]()` markdown for inline display
- **File support**: Other files are inserted as `[filename](assets/...)` links
- **Duplicate handling**: Files are renamed with timestamps to avoid conflicts
- **Dark mode compatible**: Styles adapt to SiYuan's theme
- **Multi-drive support**: Switch between multiple mounted drives via dropdown
- **Favorites**: Pin frequently used folders for quick access
- **Search & deep search**: Real-time filtering + recursive search across subdirectories
- **Sorting**: Sort by name / size / modification time, ascending or descending
- **List & icon views**: Toggle between compact list and thumbnail grid
- **Image hover preview**: Hover over images to see a preview with filename
- **File modification time**: Display file size and modification time in list view
- **Persistent state**: Remembers last drive, folder, view mode, and sort preferences

## Requirements

- SiYuan Note v3.0.0+ (desktop version)
- Windows, macOS, or Linux desktop environment
- Optional: CloudDrive2, Alist, or any drive mounting tool

## Installation

1. Download the latest release ZIP from GitHub
2. In SiYuan: Settings → Bazaar → Download → Import
3. Select the ZIP file and install
4. Enable the plugin in the plugin list

## Tutorial

### Opening the File Browser

1. After installation, a **folder+cloud icon** appears in the right dock panel
2. Click the icon to open the file browser panel
3. The panel displays files and folders from your last visited location (or the default drive root)

### Navigating Files

- **Click a folder** to enter it
- **Click a file** to select it (highlighted)
- **Double-click a file** to insert it into the current note
- Use the **breadcrumb navigation** at the top to go back to parent folders
- Click the **home icon (🏠)** in the breadcrumb to return to the drive root

### Switching Drives

- Use the **drive dropdown** in the top-left to switch between available drives (T:, D:, etc.)
- The plugin remembers your last selected drive

### Using Favorites

1. **Right-click** any folder → select **"Add to Favorites"**
2. Favorite folders appear as quick-access chips at the top
3. Click a favorite to jump directly to that folder
4. Right-click a favorite → select **"Remove from Favorites"** to delete

### Searching Files

- **Real-time search**: Type in the search box to filter files in the current directory
- **Deep search**: Press **Enter** to search recursively across all subdirectories
- During deep search, a **"Return"** button appears to go back to normal browsing

### Sorting Files

- Click the **sort button** (e.g., "↑ Name") next to the breadcrumb
- Choose from: **By Name** / **By Size** / **By Modification Time**
- Toggle **Ascending / Descending** order
- Your sort preference is saved automatically

### Switching Views

- Click the **view toggle button** (☰ / ⊞) to switch between:
  - **List view**: Compact list with file name, size, and modification time
  - **Icon view**: Thumbnail grid with image previews
- Your view preference is saved automatically

### Image Preview

- In **icon view**, hover over an image file to see a large preview
- The preview appears to the right of your cursor
- The **filename** is displayed below the preview image

### Inserting Files into Notes

1. Navigate to the file you want
2. **Double-click** the file (or right-click → "Open")
3. The file is automatically:
   - Copied to your SiYuan workspace's `data/assets/` directory
   - Inserted at the cursor position in the current editor
4. For images: inserted as `![filename](assets/filename)`
5. For other files: inserted as `[filename](assets/filename)`

## Troubleshooting

### "Cannot access directory"
- Make sure the drive is mounted and accessible
- Check that the drive letter is correct

### "Cannot get workspace path"
- Make sure you're using the desktop version of SiYuan
- The plugin needs access to the local file system

### File not inserted
- Make sure the editor is focused before clicking a file
- If automatic insertion fails, the markdown link is copied to clipboard - just Ctrl+V

## Changelog

### v0.4.0
- Renamed to LocalBrowse (formerly CloudDrive File Browser)
- Added favorites support for quick folder access
- Added search and deep search across subdirectories
- Added sorting by name / size / modification time
- Added list view and icon view with thumbnail grid
- Added image hover preview with filename
- Added file size and modification time display
- Persistent state for drive, folder, view mode, and sort preferences
- Multi-drive support with dropdown selector
- Improved breadcrumb navigation with home icon

### v0.3.0
- Rewrote file reading to use Node.js fs instead of SiYuan API
- Files are now copied to assets folder instead of just linking
- Added proper image/asset markdown insertion
- Added duplicate filename handling with timestamps
- Improved error handling and user feedback

## License

Copyright (C) 2026 sqalei. Licensed under the [GNU General Public License v3.0](LICENSE).
