# 🗂️ Tab Collection Manager - Feature List

This document lists all the user-facing and technical features implemented in the **Tab Collection Manager** Chrome extension.

---

## 🚀 User-Facing Features

### 1. Tab Session Auto-Save & Recovery
- **Automatic Background Sync**: Automatically tracks open tabs in the active window and updates a dedicated **Current Session** collection in real-time.
- **Enable/Disable Auto-Save Toggle**: Allows users to toggle auto-save on or off directly from the popup settings.
- **Startup Stabilization Period**: Postpones auto-save operations for the first 8 seconds after browser startup to allow Chrome to load and restore tabs before capturing the session state.
- **Crash Recovery & Overwrite Protection**: Safeguards collections from partial/empty states. If open tabs drop by more than 70% within the first 30 seconds of extension startup (e.g., during crash recovery or system lag), the extension refuses to overwrite the saved session.
- **Accidental Closure Backup**: Creates a backup (`lastSessionBackup`) of the previous tab list before updating or overwriting.
- **One-Click Backup Restore**: Displays a backup banner indicating the timestamp and size of the last session history backup, allowing users to restore past sessions with a single click.

### 2. Tab Collection Management
- **Create Custom Collections**: Users can create named folder-like collections to categorize tabs.
- **Unique Name Validation**:
  - Validates names to be under 100 characters.
  - Normalizes text representation (using Unicode NFKC normalization) to avoid duplicate entries with conflicting byte sequences.
  - Enforces case-insensitive uniqueness constraints when creating or renaming.
- **Inline Editing & Renaming**: Double-click or click the edit icon to rename collections dynamically with automatic save on blur or pressing `Enter`. Supports `Escape` key to revert changes.
- **Accordions & Expand/Collapse State**: Accordion panels expand to display tabs. Expand/collapse states are persisted in local storage.
- **Collection Meta Indicators**: Displays the current tab count and relative updated time (e.g., *"3m ago"*, *"just now"*).
- **Delete Protection**: Users can delete any custom collection (prompts for confirmation), but deleting or renaming the core **Current Session** collection is blocked to prevent breaking auto-save.

### 3. Individual Tab Management
- **List Details**: Displays tab number, favicon placeholder, custom title, and full URL tooltip.
- **Edit Tab Title**: Modify tab titles inline to customize bookmarks.
- **Background Restoring**: Opens tabs in the background (preventing browser flickering and active window grabs) by clicking the external link icon.
- **Remove Tabs**: Delete single tabs from a collection dynamically.
- **Collection Tab Limits**: Limits any single collection to a maximum of 200 tabs to maintain performance and avoid hitting storage constraints.

### 4. Adding Tabs to Collections
- **Manual Mode**: Allows users to type or paste a custom Title and URL with full validation.
- **Multi-Select Mode**: Lists all currently open tabs in the active browser window with checkboxes and a **Select All** toggle to bulk add selected tabs.
- **Smart Duplicate URL Warning**:
  - Warns the user when trying to add a URL that already exists in another collection.
  - Displays a modal detailing which collections currently house that URL, offering a choice to **Cancel** or **Add Anyway**.
  - Current Session is excluded from duplicate checks because it dynamically mirrors all open tabs.
- **Context Menu Integration**:
  - Adds an **"Add to Collection"** parent right-click context menu.
  - Dynamically lists all user-created collections as submenus.
  - Right-clicking on any page or link adds it to the selected collection.
  - Includes duplicate checks: alerts the user by flashing a red status badge (`!`) on the extension icon and blocks duplicate saves.
  - Flashes a green checkmark badge (`✓`) on the extension icon upon successful context-menu save.

### 5. Advanced Interactive Drag & Drop
- **Collection Reordering**: Drag and drop collection panels vertically to organize their placement order.
- **Intra-Collection Tab Reordering**: Drag and drop tabs inside a collection panel to sort/reorder them.
- **Inter-Collection Tab Moving (Standard)**: Drag a tab from one collection and drop it directly onto another collection's header/body to move it.
- **Inter-Collection Tab Moving (Indexed)**: Drag a tab from one collection and drop it directly between specific tabs of another collection to place it precisely at that index.

### 6. Search & Filtering
- **Popup-Wide Global Search**: Features a global search bar with a 150ms input debounce that dynamically matches collection names and tab titles/URLs. Pressing `Escape` clears search and restores original items.
- **In-Collection Tab Filtering**: Features a search input inside each collection's tab list to filter tabs only within that specific collection.

### 7. Backup Import & Export (JSON Engine)
- **Global Data Export**: Exports all collections and settings to a JSON file. The export includes metadata with the export ISO timestamp (`exportedAt`). The filename is dynamically formatted with the current local date and time: `tab_collections_backup_YYYY-MM-DD_HH-MM-SS.json`.
- **Global Data Import**: Imports collections from JSON, automatically creating new collections or merging tabs into matching collection names without duplicates. Backward-compatible to support both the new object structure and the old direct-array format.
- **Per-Collection Export**: Exports a single collection's tabs to a JSON file, including the collection metadata and an `exportedAt` ISO timestamp. The filename is dynamically formatted as `${collection_name}_tabs_YYYY-MM-DD_HH-MM-SS.json`.
- **Per-Collection Import**: Imports tabs from a JSON file directly into a chosen collection. Backward-compatible to support both the new object structure and the old direct-array format.

---

## 🛠️ Technical & Architectural Features

- **Manifest V3 Architecture**: Fully optimized for Manifest V3 using a Service Worker (`background.js`) to handle background tab hooks, runtime messages, and context menus.
- **Cross-Browser Compatibility**: Implements `typeof browser !== 'undefined' ? browser : chrome` wrappers, enabling compatibility with Google Chrome, Microsoft Edge, Brave, and Mozilla Firefox.
- **Race Condition Guard (Strict State Serialization)**: Uses a Promise-based serialized write queue (`updateState()`) in both the popup and background worker. This ensures storage updates occur sequentially, preventing data corruption during concurrent events (like bulk tab actions or rapid auto-saves).
- **Data Integrity & Validation**:
  - Sanity checks URLs for schema structure and protocol validation.
  - Filters out internal browser URLs (e.g. `chrome://`, `about:blank`, `edge://`) to keep saves clean.
- **Premium Glassmorphism Dark Mode UI**:
  - Built with pure HTML/CSS (Vanilla CSS) and vanilla JavaScript.
  - Font styling utilizing Google Fonts (*Inter*).
  - Modern icon set using Font Awesome.
  - Sleek dark theme featuring subtle gradients, translucent glass borders, blur filters (`backdrop-filter`), smooth hover transitions, and animated toast notifications.
