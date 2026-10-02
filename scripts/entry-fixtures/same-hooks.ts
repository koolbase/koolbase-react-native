// Both packages export the same hooks: one implementation, the same types.
import type * as RN from '@koolbase/react-native';
import type * as JS from '@koolbase/js/react';

type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false;
export const same: [Equal<typeof RN.useCollection, typeof JS.useCollection>, Equal<typeof RN.useRecord, typeof JS.useRecord>, Equal<RN.UseCollectionResult, JS.UseCollectionResult>, Equal<RN.UseRecordResult, JS.UseRecordResult>] = [true, true, true, true];
