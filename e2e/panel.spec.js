// End-to-end walk of the built panel (react-migration-plan.md §9).
//
// These tests drive `dist/` loaded unpacked into Playwright's Chromium, which is what used to be a
// manual smoke pass: they cover the parts jsdom cannot — the MV3 worker, the real `chrome.*` APIs,
// the real stylesheet, storage surviving a reload, and the packaged extension loading at all.
import { test, expect } from './fixtures.js';

/**
 * The values of a set of inputs, so an assertion never depends on DOM order.
 *
 * @param {import('@playwright/test').Locator} locator
 * @returns {Promise<string[]>}
 */
async function values(locator) {
  return locator.evaluateAll((inputs) => inputs.map((input) => input.value));
}

/**
 * The card for a named collection.
 *
 * A collection's name lives in an input's *value*, which no Playwright selector can match, and the
 * card carries only `data-id` — so the id is resolved from the DOM and a locator is pinned to it.
 * Resolving it also waits for the card to appear, which is what makes creating one race-free.
 *
 * @param {import('@playwright/test').Page} panel
 * @param {string} name
 */
async function cardFor(panel, name) {
  // The poll reports the whole panel state rather than just the id, so a timeout says *why* the
  // card is missing (no cards at all? a storage error on boot?) instead of only that it is.
  let state = /** @type {{id?: string, names: string[], storageError: string|null}|null} */ (null);
  await expect
    .poll(
      async () => {
        state = await panel.evaluate((wanted) => {
          const inputs = [
            ...document.querySelectorAll('#collectionsContainer input.cc-collection-name'),
          ];
          return {
            id: inputs.find((input) => input.value === wanted)?.closest('.cc-collection')?.dataset
              .id,
            names: inputs.map((input) => input.value),
            storageError: document.querySelector('#collectionsContainer .sh-error')?.textContent,
          };
        }, name);
        return state;
      },
      { message: `waiting for the "${name}" collection card` }
    )
    .toMatchObject({ id: expect.any(String) });

  return panel.locator(`#collectionsContainer > .cc-collection[data-id="${state?.id}"]`);
}

/**
 * The collection names `chrome.storage.local` currently holds. Storage is the source of truth
 * (`skill.md` §2.2), so this is what "saved" means — not what the list happens to be rendering.
 *
 * @param {import('@playwright/test').Page} panel
 * @returns {Promise<string[]>}
 */
async function storedNames(panel) {
  return panel.evaluate(async () => {
    const { collections = [] } = await chrome.storage.local.get('collections');
    return collections.map((collection) => collection.name);
  });
}

/**
 * Create a collection the way a user does: open the slide from the controls bar and press Enter.
 *
 * @param {import('@playwright/test').Page} panel
 * @param {string} name
 */
async function createCollection(panel, name) {
  await panel.locator('#toggleCreateBtn').click();
  const input = panel.getByPlaceholder('New collection name');
  await expect(input).toBeFocused();
  await input.fill(name);
  await input.press('Enter');

  await expect(await cardFor(panel, name)).toBeVisible();
  // Success closes the slide, so the default actions row is back.
  await expect(panel.locator('#actionsBarDefault')).not.toHaveClass(/ut-hidden/);
}

/**
 * Open a real page in another tab of the same window, and wait until Chrome knows its title.
 *
 * @param {import('@playwright/test').BrowserContext} context
 * @param {string} url
 * @param {string} title
 */
async function openPage(context, url, title) {
  const page = await context.newPage();
  await page.goto(url);
  await expect(page).toHaveTitle(title);
}

test('loads dist/ unpacked and mounts the React panel', async ({
  panel,
  serviceWorker,
  extensionId,
}) => {
  // The worker is the packaged extension's, loaded from the build under test.
  expect(serviceWorker.url()).toBe(`chrome-extension://${extensionId}/background.js`);
  expect(panel.url()).toBe(`chrome-extension://${extensionId}/sidepanel.html`);

  await expect(panel.locator('#app-name')).toHaveText('Tab Collection Manager');
  await expect(panel.locator('#version')).toHaveText(/^v\d+\.\d+\.\d+$/);
  await expect(panel.locator('#settingsBtn')).toBeVisible();
  await expect(panel.locator('#toggleCreateBtn')).toBeVisible();
  await expect(panel.locator('#historyBtn')).toBeVisible();

  // Either the first-run empty state or a collection the worker already auto-saved.
  await expect(
    panel.locator('#emptyState').or(panel.locator('#collectionsContainer > .cc-collection').first())
  ).toBeVisible();
});

test('creates a collection from the controls bar and keeps it across a reload', async ({
  panel,
}) => {
  await createCollection(panel, 'E2E Reading');
  await expect((await cardFor(panel, 'E2E Reading')).locator('.tab-count')).toHaveText('0 tabs');

  // The card renders from the store's snapshot, so confirm the write actually reached storage
  // before reloading — this test is about durability, not about the in-memory list.
  await expect.poll(() => storedNames(panel)).toContain('E2E Reading');

  await panel.reload();

  // Hydration runs again from storage: the collection is still there, which is the store's write
  // queue and `chrome.storage.local` round trip proven end to end.
  await expect(panel.locator('html')).toHaveAttribute('data-theme', /^(light|dark)$/);
  await expect(await cardFor(panel, 'E2E Reading')).toBeVisible();
});

test('adds tabs, then edits, pins and removes through the card menus', async ({ panel }) => {
  await createCollection(panel, 'E2E Tabs');
  const card = await cardFor(panel, 'E2E Tabs');

  await card.locator('.cc-expand-btn').click();
  await expect(card.locator('.tab-collection-tabs')).toHaveClass(/ut-expanded/);

  // Manual tab through the collection menu.
  await card.locator('.cc-collection-menu-btn').click();
  await card.getByRole('button', { name: 'Add new tab' }).click();

  const addTabs = panel.getByRole('dialog', { name: 'Add Tabs' });
  await expect(addTabs).toBeVisible();
  await addTabs.getByLabel('Title').fill('Example docs');
  await addTabs.getByLabel('URL').fill('https://example.com/docs');
  await addTabs.getByRole('button', { name: 'Add Tab' }).click();
  await expect(addTabs).toBeHidden();

  await expect(card.locator('.tab-item')).toHaveCount(1);
  await expect(card.locator('.tab-title')).toHaveValue('Example docs');
  await expect(card.locator('.tab-count')).toHaveText('1 tab');

  // The same URL again is a duplicate: it asks first, then adds on confirmation.
  await card.locator('.cc-collection-menu-btn').click();
  await card.getByRole('button', { name: 'Add new tab' }).click();
  await addTabs.getByLabel('Title').fill('Example docs again');
  await addTabs.getByLabel('URL').fill('https://example.com/docs');
  await addTabs.getByRole('button', { name: 'Add Tab' }).click();

  const duplicate = panel.getByRole('dialog', { name: 'Duplicate URL Found' });
  await expect(duplicate).toBeVisible();
  await duplicate.getByRole('button', { name: 'Add Anyway' }).click();
  await expect(duplicate).toBeHidden();
  await expect(addTabs).toBeHidden();
  await expect(card.locator('.tab-item')).toHaveCount(2);

  // Rename a tab through its own menu; clicking the title would open the tab instead.
  await card.locator('.tab-menu-btn').first().click();
  await card.getByRole('button', { name: 'Edit tab title' }).first().click();
  await card.locator('.tab-title').first().fill('Renamed docs');
  await card.locator('.tab-title').first().press('Enter');
  await expect(card.locator('.tab-title').first()).toHaveValue('Renamed docs');

  // Pin the tab, then remove it from the same menu.
  await card.locator('.tab-pin-tab-btn').first().click();
  await expect(card.locator('.tab-item').first()).toHaveClass(/ut-pinned/);

  await card.locator('.tab-menu-btn').first().click();
  await card.getByRole('button', { name: 'Remove tab' }).first().click();
  await expect(card.locator('.tab-item')).toHaveCount(1);

  // Pin the collection, then rename it.
  await card.locator('.cc-pin-collection-btn').click();
  await expect(card).toHaveClass(/ut-pinned/);

  await card.locator('.cc-collection-menu-btn').click();
  await card.getByRole('button', { name: 'Edit collection name' }).click();
  await card.locator('.cc-collection-name').fill('E2E Renamed');
  await card.locator('.cc-collection-name').press('Enter');
  await expect(await cardFor(panel, 'E2E Renamed')).toBeVisible();
});

test('imports the window’s open tabs through the multi-select picker', async ({
  context,
  panel,
  tabServer,
}) => {
  await openPage(context, tabServer.url('alpha'), 'Alpha page');
  await openPage(context, tabServer.url('beta'), 'Beta page');

  await createCollection(panel, 'E2E Imported');
  const card = await cardFor(panel, 'E2E Imported');

  await card.locator('.cc-collection-menu-btn').click();
  await card.getByRole('button', { name: 'Add new tab' }).click();

  const addTabs = panel.getByRole('dialog', { name: 'Add Tabs' });
  // The second mode button is "Multi‑Select" (note the non-breaking hyphen, hence the index).
  await addTabs.locator('.dl-mode-btn').nth(1).click();

  await expect(addTabs.getByLabel('Alpha page')).toBeVisible();
  await addTabs.getByLabel('Alpha page').check();
  await addTabs.getByLabel('Beta page').check();
  await addTabs.getByRole('button', { name: 'Add Selected' }).click();
  await expect(addTabs).toBeHidden();

  await expect(card.locator('.tab-item')).toHaveCount(2);
  await expect(card.locator('.tab-count')).toHaveText('2 tabs');
  // Order-independent: the saved tabs carry the live pages' titles.
  await expect
    .poll(async () => (await values(card.locator('.tab-title'))).sort())
    .toEqual(['Alpha page', 'Beta page']);
});

test('searches collections and tabs, and returns focus when the search closes', async ({
  panel,
}) => {
  await createCollection(panel, 'Zeta Notes');

  // Ctrl+F focuses the search field.
  await panel.keyboard.press('Control+f');
  const input = panel.getByPlaceholder('Search collections or tabs…');
  await expect(input).toBeFocused();

  await input.fill('zeta');
  // The results replace the list rather than filtering it in place.
  const result = panel.locator('.sh-search-collection-result');
  await expect(result).toHaveCount(1);
  await expect(result).toContainText('Zeta Notes');
  await expect(panel.locator('#collectionsContainer')).toHaveCount(0);

  await input.press('Escape');
  await expect(panel.locator('#collectionsContainer')).toBeVisible();

  // Opened from the button, closing the slide hands focus back to that button.
  await panel.locator('#toggleSearchBtn').click();
  await expect(input).toBeFocused();
  await input.press('Escape');
  await expect(panel.locator('#toggleSearchBtn')).toBeFocused();
});

test('toggles layout and sort, exports the collections, and answers the keyboard', async ({
  panel,
}) => {
  await createCollection(panel, 'Alpha One');
  await createCollection(panel, 'Beta Two');

  // Layout toggle.
  await panel.locator('#toggleLayoutBtn').click();
  await expect(panel.locator('#collectionsContainer')).toHaveClass(/ut-grid-view/);
  await panel.locator('#toggleLayoutBtn').click();
  await expect(panel.locator('#collectionsContainer')).not.toHaveClass(/ut-grid-view/);

  // Collections sort menu: choosing an option closes it and marks the list as sorted.
  await panel.locator('#collectionSortBtn').click();
  await expect(panel.locator('#collectionSortBtn')).toHaveAttribute('aria-expanded', 'true');
  await panel.getByRole('menuitem', { name: 'Name (A-Z)' }).click();
  await expect(panel.locator('#collectionSortBtn')).toHaveAttribute('aria-expanded', 'false');
  await expect(panel.locator('#collectionsContainer')).toHaveClass(/ut-sort-active/);

  // Export writes a JSON download and confirms with a toast.
  const [download] = await Promise.all([
    panel.waitForEvent('download'),
    panel.locator('#globalExportBtn').click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^tab_collections_backup_.*\.json$/);
  await expect(
    panel.locator('.ts-toast').filter({ hasText: 'exported successfully' })
  ).toBeVisible();

  // Ctrl+E expands every collection (focus is on the export button, so combos still apply).
  await panel.keyboard.press('Control+e');
  await expect((await cardFor(panel, 'Alpha One')).locator('.cc-expand-btn')).toHaveClass(
    /ut-rotated/
  );
  await expect((await cardFor(panel, 'Beta Two')).locator('.cc-expand-btn')).toHaveClass(
    /ut-rotated/
  );

  // `?` opens the shortcut help; Escape closes it and leaves focus on the export button.
  await panel.keyboard.press('?');
  const help = panel.getByRole('dialog', { name: 'Keyboard Shortcuts' });
  await expect(help).toBeVisible();
  await panel.keyboard.press('Escape');
  await expect(help).toBeHidden();

  // `x` asks the panel to close.
  await panel.keyboard.press('x');
  await expect(panel.locator('body')).toHaveClass(/ut-panel-closing/);
});

test('opens the history and settings dialogs, and returns focus when each closes', async ({
  panel,
}) => {
  await panel.locator('#historyBtn').click();
  const history = panel.getByRole('dialog', { name: 'Session History' });
  await expect(history).toBeVisible();
  await expect(history.locator('.dl-history-modal-body')).toBeVisible();

  await panel.keyboard.press('Escape');
  await expect(history).toBeHidden();
  await expect(panel.locator('#historyBtn')).toBeFocused();

  await panel.locator('#settingsBtn').click();
  const settings = panel.getByRole('dialog', { name: 'Settings' });
  await expect(settings).toBeVisible();

  // The switch is a checkbox behind a zero-size input, so click its visible track.
  await settings.locator('label.set-toggle-switch:has(#lightModeToggle) .set-toggle-track').click();
  await expect(settings.locator('#lightModeToggle')).toBeChecked();
  await expect(panel.locator('html')).toHaveAttribute('data-theme', 'light');

  await panel.keyboard.press('Escape');
  await expect(settings).toBeHidden();
  await expect(panel.locator('#settingsBtn')).toBeFocused();
});

test('creates a folder and keeps its options menu on top of the empty card', async ({ panel }) => {
  await panel.locator('#createFolderBtn').click();
  const folder = panel.locator('#collectionsContainer > .cc-folder').first();
  await expect(folder).toBeVisible();
  await expect(folder.locator('.cc-folder-name')).toHaveValue(/^New folder/);
  await expect(folder.locator('.cc-folder-empty')).toBeVisible();

  // Regression: on a short, still-empty folder the absolutely-positioned options menu used to be
  // clipped by the folder's own `overflow: hidden`, so it never appeared. Assert it renders *and*
  // is the topmost element at its centre (a clipped or covered menu fails `elementFromPoint`).
  await folder.locator('.folder-menu-btn').click();
  const menu = folder.locator('.cc-collection-dropdown-menu');
  await expect(menu).toBeVisible();
  const onTop = await menu.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const sample = (x, y) => {
      const hit = document.elementFromPoint(x, y);
      return Boolean(hit) && (hit === el || el.contains(hit));
    };
    return {
      center: sample(rect.left + rect.width / 2, rect.top + rect.height / 2),
      // The bottom edge is what an ancestor's `overflow: hidden` clips first.
      bottom: sample(rect.left + rect.width / 2, rect.bottom - 2),
    };
  });
  expect(onTop).toEqual({ center: true, bottom: true });

  // The folder's own actions still work from that menu. Removing a folder confirms first, so
  // Playwright must accept the dialog (it auto-dismisses otherwise).
  panel.once('dialog', (dialog) => dialog.accept());
  await folder.getByRole('button', { name: 'Remove folder' }).click();
  await expect(panel.locator('#collectionsContainer > .cc-folder')).toHaveCount(0);
});

test('folds a whole section away from its heading', async ({ panel }) => {
  await createCollection(panel, 'E2E Keep');
  await panel.locator('#createFolderBtn').click();
  await expect(panel.locator('#collectionsContainer > .cc-folder')).toHaveCount(1);

  const toggle = panel.locator('#collectionsContainer .folders-heading .cc-section-toggle');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(panel.locator('#collectionsContainer > .cc-folder')).toHaveCount(0);
  // The heading stays, with its live count, and the other section is untouched.
  await expect(
    panel.locator('#collectionsContainer .folders-heading .cc-section-count')
  ).toHaveText('1');
  await expect(panel.locator('#collectionsContainer .collections-heading')).toBeVisible();
  await expect(panel.locator('#collectionsContainer > .cc-collection').first()).toBeVisible();

  await toggle.click();
  await expect(panel.locator('#collectionsContainer > .cc-folder')).toHaveCount(1);
});

test('keeps a folder’s collections in list layout in grid view', async ({ panel }) => {
  await createCollection(panel, 'E2E Root');
  await createCollection(panel, 'E2E Foldered');
  await panel.locator('#createFolderBtn').click();
  const folder = panel.locator('#collectionsContainer > .cc-folder').first();

  // Move the collection into the folder through its card menu.
  const card = await cardFor(panel, 'E2E Foldered');
  await card.locator('.cc-collection-menu-btn').click();
  await card.locator('.move-to-folder-btn').first().click();
  await expect(folder.locator('.cc-folder-body .cc-collection-name')).toHaveValue('E2E Foldered'); // Two stacked sections, folders first, each with its own live count badge.
  const foldersHeading = panel.locator('#collectionsContainer .folders-heading');
  const collectionsHeading = panel.locator('#collectionsContainer .collections-heading');
  await expect(foldersHeading.locator('.section-heading-label')).toHaveText('Folders');
  await expect(collectionsHeading.locator('.section-heading-label')).toHaveText('Collections');
  // Each badge counts what its section actually holds. The worker's Current Session is a root
  // collection too, so assert against the rendered counts rather than a hard-coded number.
  await expect(foldersHeading.locator('.cc-section-count')).toHaveText(
    String(await panel.locator('#collectionsContainer > .cc-folder').count())
  );
  await expect(collectionsHeading.locator('.cc-section-count')).toHaveText(
    String(await panel.locator('#collectionsContainer > .cc-collection').count())
  );
  const sectionOrder = await panel.evaluate(() =>
    [...document.querySelectorAll('#collectionsContainer .section-heading-label')].map(
      (label) => label.textContent
    )
  );
  expect(sectionOrder).toEqual(['Folders', 'Collections']);

  await panel.locator('#toggleLayoutBtn').click();
  await expect(panel.locator('#collectionsContainer')).toHaveClass(/ut-grid-view/);

  // A root card stacks its header into the grid-card shape…
  const rootDirection = await panel
    .locator('#collectionsContainer > .cc-collection .cc-collection-header')
    .first()
    .evaluate((el) => getComputedStyle(el).flexDirection);
  expect(rootDirection).toBe('column');

  // …while a collection inside a folder keeps the row layout it has in list view.
  const nestedDirection = await folder
    .locator('.cc-folder-body .cc-collection-header')
    .evaluate((el) => getComputedStyle(el).flexDirection);
  expect(nestedDirection).toBe('row');

  // And the folder spans the whole grid rather than a single column.
  const spansBothColumns = await folder.evaluate((el) => {
    const rootCard = el.parentElement?.querySelector(':scope > .cc-collection');
    if (!rootCard) return false;
    return el.getBoundingClientRect().width > rootCard.getBoundingClientRect().width + 20;
  });
  expect(spansBothColumns).toBe(true);
});

test('rebuilds real Chrome tab groups when a session snapshot is restored', async ({
  panel,
  tabServer,
}) => {
  // Restoring a session snapshot is what the history dialog's Open All and "Restore Previous
  // Session" both do: they hand the worker the tabs plus the group metadata those tabs reference.
  // Only a real browser can prove the groups come back, which is why this cannot be a unit test.
  const sent = await panel.evaluate(
    async ({ alpha, beta }) => {
      const { success } = await chrome.runtime.sendMessage({
        command: 'restoreSession',
        backupData: {
          tabs: [
            { title: 'Alpha page', url: alpha, pinned: false, chromeGroupId: 1 },
            { title: 'Beta page', url: beta, pinned: false, chromeGroupId: 1 },
          ],
          chromeGroups: { 1: { title: 'E2E Snapshot Group', color: 'purple', collapsed: false } },
          name: 'E2E snapshot',
        },
      });
      return success;
    },
    { alpha: tabServer.url('alpha'), beta: tabServer.url('beta') }
  );
  expect(sent).toBe(true);

  // The restore is fire-and-forget, so poll until Chrome reports the group with the saved metadata.
  await expect
    .poll(() =>
      panel.evaluate(async () => {
        const groups = await chrome.tabGroups.query({});
        return groups.map((group) => ({ title: group.title, color: group.color }));
      })
    )
    .toContainEqual({ title: 'E2E Snapshot Group', color: 'purple' });
});

test('bulk-deletes a folder with its contents, a nested collection and a root collection', async ({
  panel,
}) => {
  await createCollection(panel, 'E2E Keep');
  await createCollection(panel, 'E2E Bulk');
  await createCollection(panel, 'E2E Inner');
  await panel.locator('#createFolderBtn').click();
  const doomedFolder = panel.locator('#collectionsContainer > .cc-folder').nth(0);
  await expect(doomedFolder).toBeVisible();

  // Two folders, each holding one collection, moved in through each card's menu. The menu lists
  // the folders in order, so nth(0) is the first folder and nth(1) the second.
  const bulkCard = await cardFor(panel, 'E2E Bulk');
  await bulkCard.locator('.cc-collection-menu-btn').click();
  await bulkCard.locator('.move-to-folder-btn').nth(0).click();
  await expect(doomedFolder.locator('.cc-folder-body .cc-collection-name')).toHaveValue('E2E Bulk');

  await panel.locator('#createFolderBtn').click();
  const keptFolder = panel.locator('#collectionsContainer > .cc-folder').nth(1);
  const innerCard = await cardFor(panel, 'E2E Inner');
  await innerCard.locator('.cc-collection-menu-btn').click();
  await innerCard.locator('.move-to-folder-btn').nth(1).click();
  await expect(keptFolder.locator('.cc-folder-body .cc-collection-name')).toHaveValue('E2E Inner');

  // Selection mode swaps the actions row for a selection bar with a live count.
  await panel.locator('#toggleSelectBtn').click();
  const bar = panel.locator('#selectionBar');
  await expect(bar).toBeVisible();
  await expect(bar.locator('.sh-selection-count')).toHaveText('0 selected');
  await expect(bar.locator('#deleteSelectedBtn')).toBeDisabled();

  // The live Current Session can never be deleted, so its box is disabled rather than deletable.
  await expect(
    panel.locator(
      '#collectionsContainer > .cc-collection.cc-current-session-collection .cc-select-checkbox input'
    )
  ).toBeDisabled();

  // Three different selections, each with a checkbox of its own: a whole folder (which cascades to
  // its collection), a collection nested inside another folder, and a root collection.
  // The folder's own box is the header one; the cards nested in its body have their own.
  await doomedFolder.locator('.cc-folder-header .cc-select-checkbox input').check();
  await expect(bar.locator('.sh-selection-count')).toHaveText('1 selected');
  await keptFolder.locator('.cc-folder-body .cc-collection .cc-select-checkbox input').check();
  await expect(bar.locator('.sh-selection-count')).toHaveText('2 selected');
  await (await cardFor(panel, 'E2E Keep')).locator('.cc-select-checkbox input').check();
  await expect(bar.locator('.sh-selection-count')).toHaveText('3 selected');

  // Deleting asks once; Playwright has to accept the dialog (it auto-dismisses otherwise).
  panel.once('dialog', (dialog) => dialog.accept());
  await bar.locator('#deleteSelectedBtn').click();

  // The selected folder and its collection went with it, and so did the nested collection and the
  // root one — but the *unselected* second folder survives, now empty.
  await expect(panel.locator('#collectionsContainer > .cc-folder')).toHaveCount(1);
  // The survivor is the only folder left, so re-resolve it rather than reuse the pre-delete index.
  const survivor = panel.locator('#collectionsContainer > .cc-folder').first();
  await expect(survivor.locator('.cc-folder-empty')).toBeVisible();
  await expect.poll(() => storedNames(panel)).not.toContain('E2E Keep');
  await expect.poll(() => storedNames(panel)).not.toContain('E2E Bulk');
  await expect.poll(() => storedNames(panel)).not.toContain('E2E Inner');
  await expect
    .poll(() =>
      panel.evaluate(async () => {
        const { folders = [] } = await chrome.storage.local.get('folders');
        return folders.map((folder) => folder.name);
      })
    )
    .toEqual([await survivor.locator('.cc-folder-name').inputValue()]);
  await expect(bar).toBeHidden();
  await expect(panel.locator('#actionsBarDefault')).not.toHaveClass(/ut-hidden/);
});

test('labels two collections by colour and filters the list to one', async ({ panel }) => {
  await createCollection(panel, 'E2E Colour Blue');
  await createCollection(panel, 'E2E Colour Red');

  const blue = await cardFor(panel, 'E2E Colour Blue');
  const red = await cardFor(panel, 'E2E Colour Red');

  // Assign a colour from each card's options menu (the swatch row lives in the dropdown).
  await blue.locator('.cc-collection-menu-btn').click();
  await blue.locator('.cc-color-swatches button[aria-label="Blue"]').click();
  await expect(blue.locator('.cc-color-dot')).toBeVisible();

  await red.locator('.cc-collection-menu-btn').click();
  await red.locator('.cc-color-swatches button[aria-label="Red"]').click();
  await expect(red.locator('.cc-color-dot')).toBeVisible();

  // The label is a storage write, not just DOM styling.
  await expect
    .poll(() =>
      panel.evaluate(async () => {
        const { collections = [] } = await chrome.storage.local.get('collections');
        return collections.map((collection) => collection.color);
      })
    )
    .toEqual(expect.arrayContaining(['blue', 'red']));

  // The Color sort mode groups the list into one section per colour label.
  await panel.locator('#collectionSortBtn').click();
  await panel.getByRole('menuitem', { name: 'Color' }).click();
  await expect(panel.locator('.color-heading[data-color="blue"]')).toBeVisible();
  await expect(panel.locator('.color-heading[data-color="red"]')).toBeVisible();

  // Filtering still applies on top of the grouping: blue keeps its section, red loses its own.
  await panel.locator('#colorFilterBtn').click();
  await panel.getByRole('menuitemcheckbox', { name: 'Blue' }).click();

  await expect(blue).toBeVisible();
  await expect(red).toHaveCount(0);
});

test('reflows the controls onto one row as the panel widens', async ({ panel }) => {
  const bar = panel.locator('#actionsBarDefault');
  await expect(bar).toBeVisible();

  /**
   * Resize the panel and read back how the controls laid out: the number of rows they occupy and
   * the set of tile widths. Polling covers the resize+reflow frame; the widths are asserted to be a
   * single value of 48 so a stretched or shrunken tile fails here rather than only looking wrong.
   *
   * @param {number} width
   */
  const layoutAt = async (width) => {
    await panel.setViewportSize({ width, height: 800 });
    /** @type {{rows: number, widths: number[], tiles: number}|null} */
    let layout = null;
    await expect
      .poll(async () => {
        layout = await bar.evaluate((element) => {
          const tiles = [...element.children].filter(
            (child) => !child.classList.contains('ut-hidden')
          );
          const rects = tiles.map((child) => child.getBoundingClientRect());
          return {
            rows: new Set(rects.map((rect) => Math.round(rect.top))).size,
            widths: [...new Set(rects.map((rect) => Math.round(rect.width)))],
            tiles: tiles.length,
          };
        });
        return layout.widths.length === 1 && layout.widths[0] === 48 && layout.rows > 0;
      })
      .toBe(true);
    return layout;
  };

  // Wide enough for every control: a single row of 48px tiles.
  const wide = await layoutAt(760);
  expect(wide.rows).toBe(1);

  // Narrower than one row needs, so the controls wrap rather than shrink.
  const narrow = await layoutAt(470);
  expect(narrow.rows).toBeGreaterThanOrEqual(2);

  // Widening again pulls them back onto one row — the regression this test exists for.
  const widened = await layoutAt(760);
  expect(widened.rows).toBe(1);
  expect(widened.tiles).toBe(wide.tiles);
});
