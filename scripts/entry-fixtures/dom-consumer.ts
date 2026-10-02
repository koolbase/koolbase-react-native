// A React app in the browser: the SDK from @koolbase/js, the hooks from its React entry.
import { Koolbase } from '@koolbase/js';
import { useCollection, useRecord, type UseCollectionResult, type UseRecordResult } from '@koolbase/js/react';

export const list = (c: string): UseCollectionResult => useCollection(c, { orderBy: 'title' });
export const one = (c: string, id: string): UseRecordResult => useRecord(c, id);
export const sdk = Koolbase;
