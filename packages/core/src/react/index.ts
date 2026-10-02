// React hooks over core's controllers: ONE implementation, exported to apps by
// @koolbase/react-native (from its root, as always) and @koolbase/js/react.
// React only -- nothing native, nothing DOM. Deliberately not exported from
// core's root entry, so importing @koolbase/core never loads React.
export { createUseCollection, type UseCollectionResult } from './use-collection.js';
export { createUseRecord, type UseRecordResult } from './use-record.js';
