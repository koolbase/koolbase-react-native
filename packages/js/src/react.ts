// @koolbase/js/react -- useCollection and useRecord for React in the browser.
// The same implementation @koolbase/react-native exports (@koolbase/core's
// React entry), bound to this package's Koolbase. A separate entry on purpose:
// `import { Koolbase } from '@koolbase/js'` never loads React.

import { createUseCollection, createUseRecord } from '@koolbase/core/react';
import { Koolbase } from './index.js';

export type { UseCollectionResult, UseRecordResult } from '@koolbase/core/react';

/** A collection as React state: loading, loaded or error, with refresh and loadMore. Use it after Koolbase.initialize(). */
export const useCollection = createUseCollection(() => Koolbase.db);

/** One record, by id, as React state: loading, loaded, notFound or error, with refresh. Use it after Koolbase.initialize(). */
export const useRecord = createUseRecord(() => Koolbase.db);
