// Public surface of the collections feature — append only (skill.md §4.1).
export { CollectionList } from './components/CollectionList.jsx';
export { useCollectionActions } from './hooks/useCollectionActions.js';
export { setCollectionExpanded } from './lib/collectionDraft.js';
export { createCollection } from './lib/collectionAdmin.js';
export { createFolder, nextFolderName, setFolderExpanded } from './lib/folderDraft.js';
