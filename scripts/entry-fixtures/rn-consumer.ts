// A React Native app's imports, exactly as with 12.9.0: they must keep compiling.
import { Koolbase, useCollection, useRecord, type UseCollectionResult, type UseRecordResult } from '@koolbase/react-native';

export const list = (c: string): UseCollectionResult => useCollection(c, { orderBy: 'title' });
export const one = (c: string, id: string): UseRecordResult => useRecord(c, id);
export const sdk = Koolbase;
