// @koolbase/js/react -- useCollection and useRecord for React in the browser.
// The same implementation @koolbase/react-native exports (@koolbase/core's
// React entry), bound to this package's Koolbase. A separate entry on purpose:
// `import { Koolbase } from '@koolbase/js'` never loads React.

import { createUseCollection, createUseFile, createUseFiles, createUseRecord, createUseUploadQueue } from '@koolbase/core/react';
import { Koolbase } from './index.js';

export type { UseCollectionResult, UseFileResult, UseFilesResult, UseRecordResult, UseUploadQueueResult } from '@koolbase/core/react';

/** A collection as React state: loading, loaded or error, with refresh and loadMore. Use it after Koolbase.initialize(). */
export const useCollection = createUseCollection(() => Koolbase.db);

/** One record, by id, as React state: loading, loaded, notFound or error, with refresh. Use it after Koolbase.initialize(). */
export const useRecord = createUseRecord(() => Koolbase.db);

/** A bucket's files as React state, with refresh and loadMore; reloads after changes made through this SDK (storage S4). Use it after Koolbase.initialize(). */
export const useFiles = createUseFiles(() => Koolbase.storage);

/** One file's details as React state, with refresh; read again after changes made through this SDK, a deleted file notFound (storage S4). Use it after Koolbase.initialize(). */
export const useFile = createUseFile(() => Koolbase.storage);

/** Several uploads as React state: a few at a time, each file with its own status, progress, cancel and retry (storage S4). Use it after Koolbase.initialize(). */
export const useUploadQueue = createUseUploadQueue(() => Koolbase.storage);
